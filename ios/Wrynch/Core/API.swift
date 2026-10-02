import Foundation
import Security

/// The public settings the app needs to reach the database. They come from the server (`/api/app-config`), so no keys
/// are compiled into the app.
struct AppConfig: Codable, Equatable {
    let supabaseUrl: String
    let supabaseAnonKey: String
    let appDomain: String
}

struct Session: Codable, Equatable {
    var accessToken: String
    var refreshToken: String
    var expiresAt: Date
    var userId: String
    var email: String
}

struct APIError: LocalizedError {
    let status: Int
    let message: String
    var errorDescription: String? { message }

    /// Server and auth messages in plain words (the same wording as the web app).
    static func friendly(_ msg: String, status: Int) -> APIError {
        let m: String
        if msg.range(of: "Invalid login credentials", options: .caseInsensitive) != nil { m = "That email and password don’t match an account." }
        else if msg.range(of: "Email not confirmed", options: .caseInsensitive) != nil { m = "Confirm your email first: open the link we sent you." }
        else if msg.range(of: "JWT expired", options: .caseInsensitive) != nil { m = "Your session expired. Sign in again." }
        else { m = msg }
        return APIError(status: status, message: m)
    }
}

/// The signed-in session, kept in the Keychain (never in plain files).
enum Keychain {
    private static let service = "app.wrynch.session"

    static func load() -> Session? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return try? JSONDecoder().decode(Session.self, from: data)
    }

    static func save(_ s: Session?) {
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service]
        SecItemDelete(base as CFDictionary)
        guard let s, let data = try? JSONEncoder().encode(s) else { return }
        var add = base
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }
}

/// Talks to Supabase (sign-in, database functions, photo storage) and the app's /api routes. Every database write
/// goes through the same security-checked database functions the web app uses.
@MainActor
final class API {
    let appURL: URL
    private(set) var config: AppConfig?
    private(set) var session: Session? {
        didSet { Keychain.save(session); if session == nil, oldValue != nil { onSignedOut?() } }
    }
    var onSignedOut: (() -> Void)?
    private var refreshing: Task<Void, Error>?
    private let http: URLSession

    init(appURL: URL, http: URLSession = .shared) {
        self.appURL = appURL
        self.http = http
        self.session = Keychain.load()
        if let data = UserDefaults.standard.data(forKey: "wrynch.config") { config = try? JSONDecoder().decode(AppConfig.self, from: data) }
    }

    var signedIn: Bool { session != nil }

    // MARK: configuration

    @discardableResult
    func loadConfig() async throws -> AppConfig {
        let (data, r) = try await http.data(from: URL(string: "api/app-config", relativeTo: appURL)!.absoluteURL)
        try check(r, data)
        let c = try JSONDecoder().decode(AppConfig.self, from: data)
        config = c
        UserDefaults.standard.set(data, forKey: "wrynch.config")
        return c
    }

    private func cfg() async throws -> AppConfig {
        if let config { return config }
        return try await loadConfig()
    }

    // MARK: auth

    func signIn(email: String, password: String) async throws {
        let b = try await authPost("token?grant_type=password", ["email": .string(email), "password": .string(password)])
        session = try toSession(b)
    }

    func resetPassword(email: String) async throws {
        _ = try await authPost("recover", ["email": .string(email)])
    }

    func signOut() async {
        let token = session?.accessToken
        session = nil
        guard let token, let c = try? await cfg() else { return }
        var req = URLRequest(url: URL(string: "\(c.supabaseUrl)/auth/v1/logout")!)
        req.httpMethod = "POST"
        req.setValue(c.supabaseAnonKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        _ = try? await http.data(for: req)
    }

    private func authPost(_ path: String, _ body: JSONValue, token: String? = nil) async throws -> JSONValue {
        let c = try await cfg()
        var req = URLRequest(url: URL(string: "\(c.supabaseUrl)/auth/v1/\(path)")!)
        req.httpMethod = "POST"
        req.setValue(c.supabaseAnonKey, forHTTPHeaderField: "apikey")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        req.httpBody = try JSONEncoder().encode(body)
        let (data, r) = try await http.data(for: req)
        try check(r, data)
        return try JSONDecoder().decode(JSONValue.self, from: data)
    }

    private func toSession(_ b: JSONValue) throws -> Session {
        guard let access = b["access_token"]?.string, let refresh = b["refresh_token"]?.string,
              let user = b["user"], let id = user["id"]?.string else { throw APIError(status: 500, message: "Sign-in returned no session") }
        return Session(accessToken: access, refreshToken: refresh,
                       expiresAt: Date().addingTimeInterval(b["expires_in"]?.number ?? 3600),
                       userId: id, email: user["email"]?.string ?? "")
    }

    /// A valid access token, refreshed a minute before it expires.
    func freshToken() async throws -> String {
        guard let s = session else { throw APIError(status: 401, message: "Sign in first") }
        if s.expiresAt.timeIntervalSinceNow < 60 {
            if refreshing == nil {
                refreshing = Task { [weak self] in
                    guard let self else { return }
                    defer { self.refreshing = nil }
                    do {
                        let b = try await self.authPost("token?grant_type=refresh_token", ["refresh_token": .string(s.refreshToken)])
                        self.session = try self.toSession(b)
                    } catch {
                        self.session = nil
                        throw APIError(status: 401, message: "Your session expired. Sign in again.")
                    }
                }
            }
            try await refreshing?.value
        }
        guard let token = session?.accessToken else { throw APIError(status: 401, message: "Sign in first") }
        return token
    }

    // MARK: database functions and /api routes

    /// Call a database function as the signed-in user.
    func rpc(_ name: String, _ args: [String: JSONValue] = [:]) async throws -> JSONValue {
        let c = try await cfg()
        let token = try await freshToken()
        var req = URLRequest(url: URL(string: "\(c.supabaseUrl)/rest/v1/rpc/\(name)")!)
        req.httpMethod = "POST"
        req.setValue(c.supabaseAnonKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(JSONValue.object(args))
        let (data, r) = try await http.data(for: req)
        if (r as? HTTPURLResponse)?.statusCode == 401 { session = nil }
        try check(r, data)
        return data.isEmpty ? .null : ((try? JSONDecoder().decode(JSONValue.self, from: data)) ?? .null)
    }

    /// Call one of the app's /api routes (photo sorting, notes, VIN decoding, …).
    func fn(_ path: String, method: String = "POST", body: JSONValue? = nil, auth: Bool = true) async throws -> JSONValue {
        let base = appURL.absoluteString.hasSuffix("/") ? String(appURL.absoluteString.dropLast()) : appURL.absoluteString
        guard let url = URL(string: "\(base)/api/\(path)") else { throw APIError(status: 400, message: "Bad address") }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = 70
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if auth { req.setValue("Bearer \(try await freshToken())", forHTTPHeaderField: "Authorization") }
        if let body { req.httpBody = try JSONEncoder().encode(body) }
        let (data, r) = try await http.data(for: req)
        try check(r, data)
        return data.isEmpty ? .null : ((try? JSONDecoder().decode(JSONValue.self, from: data)) ?? .null)
    }

    /// Upload a photo to the inspection photo store.
    func upload(path: String, jpeg: Data) async throws {
        let c = try await cfg()
        let token = try await freshToken()
        var req = URLRequest(url: URL(string: "\(c.supabaseUrl)/storage/v1/object/inspection-media/\(path)")!)
        req.httpMethod = "POST"
        req.setValue(c.supabaseAnonKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
        req.setValue("false", forHTTPHeaderField: "x-upsert")
        let (data, r) = try await http.upload(for: req, from: jpeg)
        try check(r, data)
    }

    /// Short-lived links to view photos.
    func signPhotos(_ paths: [String]) async throws -> [String: URL] {
        guard !paths.isEmpty else { return [:] }
        let c = try await cfg()
        let token = try await freshToken()
        var req = URLRequest(url: URL(string: "\(c.supabaseUrl)/storage/v1/object/sign/inspection-media")!)
        req.httpMethod = "POST"
        req.setValue(c.supabaseAnonKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(JSONValue.object(["expiresIn": 3600, "paths": .array(paths.map { .string($0) })]))
        let (data, r) = try await http.data(for: req)
        try check(r, data)
        var out: [String: URL] = [:]
        for item in (try JSONDecoder().decode(JSONValue.self, from: data)).array ?? [] {
            if let p = item["path"]?.string, let signed = item["signedURL"]?.string, let url = URL(string: "\(c.supabaseUrl)/storage/v1\(signed)") { out[p] = url }
        }
        return out
    }

    private func check(_ r: URLResponse, _ data: Data) throws {
        guard let h = r as? HTTPURLResponse else { return }
        guard !(200..<300).contains(h.statusCode) else { return }
        let body = try? JSONDecoder().decode(JSONValue.self, from: data)
        var msg = "Request failed (\(h.statusCode))"
        for key in ["message", "error_description", "msg", "error"] {
            if let text = body?[key]?.string, !text.isEmpty { msg = text; break }
        }
        throw APIError.friendly(msg, status: h.statusCode)
    }
}
