import Foundation
import Observation
import UIKit

/// Everything the screens read and every action they take. Changes go to the server first (through the same
/// database functions as the web app), one at a time per inspection, and the inspection is reloaded once nothing is
/// waiting, so the screen always ends up showing what the server stored.
@MainActor
@Observable
final class AppModel {
    // Session and shop
    var signedIn = false
    var starting = true
    var shops: [ShopRef] = []
    var shopId: String?
    var shopName = ""
    var role: String?
    var myName = ""
    var jobs: [JobHeader] = []
    var aiOn = true

    // Inspections, keyed by id
    var inspections: [String: InspectionBundle] = [:]
    var photoURLs: [String: URL] = [:]
    var saving: Set<String> = []
    var busy: String?
    var message: (text: String, error: Bool)?

    @ObservationIgnored let api: API
    @ObservationIgnored private(set) var domain: Domain?
    @ObservationIgnored private var thresholds: JSONValue = .array([])
    @ObservationIgnored private var disabled: JSONValue = .null
    @ObservationIgnored private var queues: [String: (tail: Task<Void, Never>, waiting: Int)] = [:]
    @ObservationIgnored private var vmCache: [String: Any] = [:]
    @ObservationIgnored private var photosSignedAt = Date.distantPast

    init(api: API? = nil) {
        // WRYNCH_APP_URL points the app at a local test server (UI tests); otherwise it's wrynch.app.
        let configured = ProcessInfo.processInfo.environment["WRYNCH_APP_URL"] ?? Bundle.main.object(forInfoDictionaryKey: "WrynchAppURL") as? String
        let url = URL(string: configured ?? "https://wrynch.app") ?? URL(string: "https://wrynch.app")!
        self.api = api ?? API(appURL: url)
        do { domain = try Domain() } catch { message = (error.localizedDescription, true) }
        self.api.onSignedOut = { [weak self] in self?.resetSession() }
    }

    // MARK: messages

    func show(_ text: String, error: Bool = false) { message = (text, error) }
    func show(_ error: Error) { message = (error.localizedDescription, true) }

    // MARK: session

    func start() async {
        defer { starting = false }
        signedIn = api.signedIn
        if signedIn { await loadWorkspace() }
        do { let s = try await self.api.fn("status", method: "GET", auth: false); aiOn = s["ai"]?.bool ?? true } catch { /* unknown: sorting reports its own errors */ }
    }

    func signIn(email: String, password: String) async throws {
        try await self.api.loadConfig()
        try await self.api.signIn(email: email, password: password)
        signedIn = true
        await loadWorkspace()
    }

    func signOut() async {
        await self.api.signOut()
        resetSession()
    }

    private func resetSession() {
        signedIn = false; shops = []; shopId = nil; jobs = []; inspections = [:]; photoURLs = [:]; role = nil; vmCache = [:]
    }

    func loadWorkspace(shop: String? = nil) async {
        do {
            let ws = try await self.api.rpc("get_workspace", ["p_shop": .opt(shop ?? shopId), "p_days": 14])
            shops = (try? (ws["shops"] ?? .array([])).decode([ShopRef].self)) ?? []
            shopId = ws["shop"]?["id"]?.string
            shopName = ws["shop"]?["name"]?.string ?? ""
            role = ws["role"]?.string
            myName = ws["me"]?["name"]?.string ?? ""
            jobs = (try? (ws["jobs"] ?? .array([])).decode([JobHeader].self)) ?? []
            thresholds = ws["rules"]?["thresholds"] ?? .array([])
            if let shopId { disabled = (try? await self.api.rpc("disabled_checks", ["p_shop": .string(shopId)])) ?? .null }
            vmCache = [:]
        } catch { show(error) }
    }

    // MARK: inspections

    func bundle(_ id: String) -> InspectionBundle? { inspections[id] }

    func loadInspection(_ id: String) async {
        do {
            let b = try await self.api.rpc("get_inspection", ["p_id": .string(id)])
            if (queues[id]?.waiting ?? 0) > 0 { return } // a change is on its way; its own reload follows
            let version = (inspections[id]?.version ?? 0) + 1
            inspections[id] = InspectionBundle(inspection: b["inspection"] ?? .null, vehicle: b["vehicle"] ?? .null, template: b["template"] ?? .null, version: version)
            await signPhotos(for: id)
        } catch { show(error) }
    }

    private func signPhotos(for id: String) async {
        guard let b = inspections[id] else { return }
        if Date().timeIntervalSince(photosSignedAt) > 45 * 60 { photoURLs = [:]; photosSignedAt = Date() }
        let missing = b.media.compactMap { $0["url"]?.string }.filter { photoURLs[$0] == nil }
        guard !missing.isEmpty, let urls = try? await self.api.signPhotos(missing) else { return }
        photoURLs.merge(urls) { _, new in new }
    }

    /// Run a change on the server, in order with the other changes to this inspection, then reload it.
    func change(_ id: String, _ op: @escaping () async throws -> Void) {
        let prev = queues[id]?.tail
        var q = queues[id] ?? (tail: Task {}, waiting: 0)
        q.waiting += 1
        saving.insert(id)
        q.tail = Task { [weak self] in
            await prev?.value
            guard let self else { return }
            do { try await op() } catch { self.show(error) }
            self.queues[id]?.waiting -= 1
            if (self.queues[id]?.waiting ?? 0) == 0 {
                self.saving.remove(id)
                await self.loadInspection(id)
            }
        }
        queues[id] = q
    }

    /// Wait for the changes already sent for an inspection.
    func settle(_ id: String) async { await queues[id]?.tail.value }

    // MARK: the shared rules, per screen

    private func vm<T: Decodable>(_ name: String, _ id: String, _ extra: [JSONValue] = [], as type: T.Type) -> T? {
        guard let b = inspections[id], let domain else { return nil }
        let key = "\(name)|\(id)|\(b.version)|\(extra.map { $0.string ?? "" }.joined(separator: ","))"
        if let hit = vmCache[key] as? T { return hit }
        do {
            try domain.configure(template: b.template, thresholds: thresholds, disabled: disabled)
            let out = try domain.run(name, [b.inspection, b.vehicle] + extra, as: T.self)
            vmCache[key] = out
            return out
        } catch {
            let text = "Couldn’t work out this screen: \(error.localizedDescription)"
            DispatchQueue.main.async { [weak self] in self?.show(text, error: true) }
            return nil
        }
    }

    func overview(_ id: String) -> OverviewVM? { vm("overview", id, as: OverviewVM.self) }
    func setup(_ id: String) -> SetupVM? { vm("setup", id, as: SetupVM.self) }
    func point(_ id: String, _ pointId: String) -> PointVM? { vm("point", id, [.string(pointId)], as: PointVM.self) }
    func part(_ id: String, _ key: String) -> PartVM? { vm("part", id, [.string(key)], as: PartVM.self) }
    func sort(_ id: String, _ stageId: String) -> SortVM? { vm("sort", id, [.string(stageId)], as: SortVM.self) }
    func place(_ id: String, _ mediaId: String) -> PlaceVM? { vm("place", id, [.string(mediaId)], as: PlaceVM.self) }
    func finish(_ id: String) -> FinishVM? { vm("finish", id, as: FinishVM.self) }

    func blankConfig() -> JSONValue { (try? domain?.run("blankConfig", [], as: JSONValue.self)) ?? .object([:]) }

    // MARK: new inspection and vehicle setup

    func decodeVin(_ vin: String) async throws -> (DecodedVin, JSONValue) {
        let r = try await self.api.fn("vin?vin=\(vin.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? vin)", method: "GET")
        return (try r.decode(DecodedVin.self), r["config"] ?? blankConfig())
    }

    struct NewInspection {
        var vin = "", year = "", make = "", model = "", trim = "", engine = ""
        var customerName = "", customerPhone = "", customerEmail = ""
        var ro = "", odometer = "", concerns = ""
        var config: JSONValue = .object([:])
    }

    func createInspection(_ f: NewInspection) async throws -> String {
        guard let shopId else { throw APIError(status: 400, message: "Pick a shop first") }
        let odo = Int(f.odometer.filter(\.isNumber))
        let concerns: [JSONValue] = f.concerns.split(separator: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.map { JSONValue.string($0) }
        let id = try await self.api.rpc("create_inspection", [
            "p_shop": .string(shopId), "p_vin": .string(f.vin.uppercased()), "p_year": .opt(Int(f.year)), "p_make": .string(f.make),
            "p_model": .string(f.model), "p_trim": .string(f.trim), "p_engine": .string(f.engine), "p_config": f.config,
            "p_customer_name": .string(f.customerName), "p_customer_phone": .string(f.customerPhone), "p_customer_email": .string(f.customerEmail),
            "p_ro": .string(f.ro), "p_odometer": .opt(odo),
            "p_concerns": .array(concerns),
        ])
        guard let newId = id.string else { throw APIError(status: 500, message: "The inspection wasn’t created") }
        await loadInspection(newId)
        await loadWorkspace()
        return newId
    }

    func setConfig(_ id: String, key: String, value: JSONValue) {
        guard var b = inspections[id] else { return }
        var config = b.vehicle["config"] ?? .object([:])
        config[key] = value
        b.vehicle["config"] = config
        b.version += 1
        inspections[id] = b // shows right away; the reload after saving brings the server's copy
        change(id) { _ = try await self.api.rpc("set_vehicle_config", ["p_inspection": .string(id), "p_config": config]) }
    }

    func setOdometer(_ id: String, _ miles: Int) {
        change(id) { _ = try await self.api.rpc("set_odometer", ["p_inspection": .string(id), "p_odometer": .opt(miles)]) }
    }

    func startInspection(_ id: String) {
        guard inspections[id]?.status == "not_started" else { return }
        change(id) { _ = try await self.api.rpc("start_inspection", ["p_inspection": .string(id)]) }
    }

    // MARK: checks, findings, notes

    func setCheck(_ id: String, key: String, check: String, value: Double?, rating: String?) {
        change(id) {
            _ = try await self.api.rpc("set_check", ["p_inspection": .string(id), "p_key": .string(key), "p_check": .string(check),
                                                "p_value": .opt(value), "p_rating": .opt(rating)])
        }
    }
    func clearCheck(_ id: String, key: String, check: String) {
        change(id) { _ = try await self.api.rpc("clear_check", ["p_inspection": .string(id), "p_key": .string(key), "p_check": .string(check)]) }
    }
    func addFinding(_ id: String, key: String, finding: String, severity: String) {
        change(id) {
            _ = try await self.api.rpc("add_finding", ["p_inspection": .string(id), "p_key": .string(key), "p_finding": .string(finding), "p_severity": .string(severity)])
        }
    }
    func removeFinding(_ id: String, findingId: String) {
        change(id) { _ = try await self.api.rpc("remove_finding", ["p_finding": .string(findingId)]) }
    }
    /// Confirm or reject an AI finding, or confirm it with a different finding or severity.
    func reviewFinding(_ id: String, findingId: String, action: String, key: String? = nil, severity: String? = nil) {
        var args: [String: JSONValue] = ["p_finding": .string(findingId), "p_action": .string(action)]
        if action == "modify" { args["p_key"] = .opt(key); args["p_severity"] = .opt(severity) }
        change(id) { _ = try await self.api.rpc("review_finding", args) }
    }
    func setNotInspected(_ id: String, key: String, kind: String?, reason: String?) {
        change(id) {
            _ = try await self.api.rpc("set_not_inspected", ["p_inspection": .string(id), "p_key": .string(key), "p_kind": .opt(kind), "p_reason": .opt(reason)])
        }
    }
    /// "Nothing found" on the parts of a point nobody has rated yet.
    func markPointOk(_ id: String, pointId: String) {
        guard let b = inspections[id], let domain,
              let items = try? domain.run("untouched", [b.inspection, b.vehicle, .string(pointId)], as: JSONValue.self) else { return }
        change(id) { _ = try await self.api.rpc("mark_ok", ["p_inspection": .string(id), "p_items": items]) }
    }
    /// Confirm or dismiss AI "looks OK" suggestions.
    func reviewLooksOk(_ id: String, ids: [String], confirm: Bool) {
        guard let b = inspections[id], let domain,
              let items = try? domain.run("observationChecks", [b.inspection, .array(ids.map { .string($0) })], as: JSONValue.self) else { return }
        change(id) {
            _ = try await self.api.rpc("review_observations", ["p_inspection": .string(id), "p_action": .string(confirm ? "confirm" : "reject"), "p_items": items])
        }
    }
    func setNote(_ id: String, pointId: String, text: String) {
        change(id) { _ = try await self.api.rpc("set_note", ["p_inspection": .string(id), "p_point": .string(pointId), "p_text": .string(text)]) }
    }
    /// A draft note from the confirmed ratings and photos. Not saved until the technician uses it.
    func draftNote(_ id: String, pointId: String) async throws -> String {
        await settle(id)
        let r = try await self.api.fn("ai-note", body: ["inspectionId": .string(id), "pointId": .string(pointId)])
        return r["text"]?.string ?? ""
    }
    /// Automatic notes on the Finish screen: reworded or drafted, each waiting for the technician's approval.
    func autoNotes(_ id: String, pointIds: [String]) async -> Int {
        await settle(id)
        var failed = 0
        for start in stride(from: 0, to: pointIds.count, by: 3) {
            let chunk = Array(pointIds[start..<min(start + 3, pointIds.count)])
            await withTaskGroup(of: Bool.self) { group in
                for p in chunk { group.addTask { await self.wording(id, p) } }
                for await ok in group where !ok { failed += 1 }
            }
        }
        await loadInspection(id)
        return failed
    }
    private func wording(_ id: String, _ pointId: String) async -> Bool {
        do { _ = try await self.api.fn("ai-wording", body: ["inspectionId": .string(id), "pointId": .string(pointId)]); return true } catch { return false }
    }
    func resolveWording(_ id: String, pointId: String, action: String, text: String? = nil) {
        var args: [String: JSONValue] = ["p_inspection": .string(id), "p_point": .string(pointId), "p_action": .string(action)]
        if action == "edit" { args["p_text"] = .opt(text) }
        change(id) { _ = try await self.api.rpc("resolve_wording", args) }
    }

    // MARK: photos

    func confirmPlacements(_ id: String, stageId: String) {
        change(id) { _ = try await self.api.rpc("confirm_placements", ["p_inspection": .string(id), "p_section": .string(stageId)]) }
    }
    func setPhotoParts(_ id: String, mediaId: String, keys: [String]) {
        change(id) { _ = try await self.api.rpc("set_photo_parts", ["p_media": .string(mediaId), "p_keys": .array(keys.map { .string($0) })]) }
    }
    func excludePhoto(_ id: String, mediaId: String) {
        change(id) { _ = try await self.api.rpc("exclude_photo", ["p_media": .string(mediaId)]) }
    }

    /// Upload photos for a stage (optionally for one point, or tagged with the corner of the car) and let the AI sort
    /// them. Photos are shrunk first (long side 1600 px), like the web app does.
    func addPhotos(_ id: String, stageId: String, images: [Data], pointId: String? = nil, corner: String? = nil, quiet: Bool = false) async {
        guard let shopId, !images.isEmpty else { return }
        var ids: [String] = []
        do {
            for (k, raw) in images.enumerated() {
                if !quiet { busy = "Uploading photo \(k + 1) of \(images.count)…" }
                let mediaId = UUID().uuidString.lowercased()
                let path = "\(shopId)/\(id)/\(mediaId).jpg"
                try await self.api.upload(path: path, jpeg: Photo.shrink(raw))
                let label: JSONValue = .string("IMG_\(mediaId.prefix(6)).jpg")
                if let corner {
                    _ = try await self.api.rpc("add_captured_media", ["p_inspection": .string(id), "p_media": .string(mediaId), "p_section": .string(stageId),
                                                                 "p_point": .opt(pointId), "p_corner": .string(corner), "p_path": .string(path), "p_label": label])
                } else if let pointId {
                    _ = try await self.api.rpc("add_point_media", ["p_inspection": .string(id), "p_media": .string(mediaId), "p_section": .string(stageId),
                                                              "p_point": .string(pointId), "p_path": .string(path), "p_label": label])
                } else {
                    _ = try await self.api.rpc("add_media", ["p_inspection": .string(id), "p_media": .string(mediaId), "p_section": .string(stageId),
                                                        "p_path": .string(path), "p_label": label])
                }
                ids.append(mediaId)
            }
            if aiOn { await sortWithAi(id, mediaIds: ids, quiet: quiet) }
            else { show("\(ids.count) photo\(ids.count == 1 ? "" : "s") saved. AI sorting isn’t set up, so place them by hand.") }
        } catch {
            show("\(error.localizedDescription)\(ids.isEmpty ? "" : " (\(ids.count) photos saved)")", error: true)
        }
        if !quiet { busy = nil }
        await loadInspection(id)
    }

    /// Ask the AI to sort photos, one photo per request and three at a time.
    func sortWithAi(_ id: String, mediaIds: [String], quiet: Bool = false) async {
        var failed = 0, done = 0
        var reason = ""
        if !quiet { busy = "AI is reading photo 1 of \(mediaIds.count)…" }
        for start in stride(from: 0, to: mediaIds.count, by: 3) {
            let chunk = Array(mediaIds[start..<min(start + 3, mediaIds.count)])
            await withTaskGroup(of: String?.self) { group in
                for m in chunk {
                    group.addTask { await self.sortOne(id, m) }
                }
                for await r in group {
                    done += 1
                    if let r { failed += 1; if reason.isEmpty { reason = r } }
                    if !quiet { busy = done < mediaIds.count ? "AI is reading photo \(done + 1) of \(mediaIds.count)…" : "Saving…" }
                }
            }
        }
        if !quiet { busy = nil }
        if failed > 0 { show("The AI couldn’t read \(failed) of \(mediaIds.count) photos. \(reason) Use “Sort with AI” to retry or place them by hand.", error: true) }
    }

    /// One photo through the AI; nil when it worked, else the reason it didn't.
    private func sortOne(_ id: String, _ mediaId: String) async -> String? {
        do {
            let r = try await api.fn("ai-sort", body: ["inspectionId": .string(id), "mediaIds": [.string(mediaId)]])
            return (r["failed"]?.number ?? 0) > 0 ? (r["reason"]?.string ?? "") : nil
        } catch { return error.localizedDescription }
    }

    /// Photos in a stage the AI hasn't read yet.
    func unreadPhotos(_ id: String, stageId: String) -> [String] {
        (inspections[id]?.media ?? []).filter {
            $0["sectionId"]?.string == stageId && $0["excluded"]?.bool != true && $0["analyzed"]?.bool != true && ($0["links"]?.array ?? []).isEmpty
        }.compactMap { $0["id"]?.string }
    }

    // MARK: finishing

    func submit(_ id: String) async -> Bool {
        await settle(id)
        guard let b = inspections[id], let domain else { return false }
        do {
            let summary = try domain.run("summary", [b.inspection, b.vehicle], as: JSONValue.self)
            _ = try await self.api.rpc("submit_inspection", ["p_inspection": .string(id), "p_summary": summary])
            await loadInspection(id)
            await loadWorkspace()
            return true
        } catch {
            show(error)
            await loadInspection(id)
            return false
        }
    }
}

enum Photo {
    /// Long side 1600 px, JPEG: saves data and keeps the AI calls fast.
    static func shrink(_ data: Data) -> Data {
        guard let image = UIImage(data: data) else { return data }
        let scale = min(1, 1600 / max(image.size.width, image.size.height))
        let size = CGSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let out = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        return out.jpegData(compressionQuality: 0.82) ?? data
    }
}
