import Foundation
import JavaScriptCore

/// The shared inspection rules, run in JavaScriptCore from the same code as the web app (see ios/bridge/bridge.ts).
/// Every rating, count and "done" mark the app shows comes from here, so the phone and the web always agree.
@MainActor
final class Domain {
    struct Failure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    private let context: JSContext
    private let call: JSValue
    private var configuredKey: String?

    init(bundle: Bundle = .main) throws {
        guard let url = bundle.url(forResource: "wrynch-domain", withExtension: "js"),
              let source = try? String(contentsOf: url, encoding: .utf8) else {
            throw Failure(message: "The inspection rules are missing from the app (run npm run ios:domain before building).")
        }
        guard let context = JSContext() else { throw Failure(message: "Couldn’t start the rules engine.") }
        var loadError: String?
        context.exceptionHandler = { _, exception in loadError = exception?.toString() }
        context.evaluateScript(source)
        if let loadError { throw Failure(message: "The inspection rules didn’t load: \(loadError)") }
        guard let fn = context.objectForKeyedSubscript("WrynchCall"), !fn.isUndefined else { throw Failure(message: "The inspection rules didn’t load.") }
        self.context = context
        self.call = fn
    }

    /// Run one rules function with JSON arguments and decode its answer.
    func run<T: Decodable>(_ name: String, _ args: [JSONValue], as type: T.Type = T.self) throws -> T {
        let argsJson = String(decoding: try JSONEncoder().encode(JSONValue.array(args)), as: UTF8.self)
        guard let out = call.call(withArguments: [name, argsJson])?.toString(), let data = out.data(using: .utf8) else {
            throw Failure(message: "The rules engine didn’t answer (\(name)).")
        }
        let envelope = try JSONDecoder().decode(JSONValue.self, from: data)
        if let error = envelope["error"]?.string { throw Failure(message: error) }
        return try (envelope["ok"] ?? .null).decode(T.self)
    }

    /// Install a template, rating rules and turned-off checks (skipped when they're already installed).
    func configure(template: JSONValue, thresholds: JSONValue, disabled: JSONValue) throws {
        let key = String(decoding: try JSONEncoder().encode(JSONValue.array([template, thresholds, disabled])), as: UTF8.self)
        guard key != configuredKey else { return }
        _ = try run("configure", [template, thresholds, disabled], as: JSONValue.self)
        configuredKey = key
    }
}
