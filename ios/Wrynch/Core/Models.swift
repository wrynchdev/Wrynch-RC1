import Foundation

// What each screen shows, as worked out by the shared rules (ios/bridge/bridge.ts). Field names match that file.

struct Summary: Decodable, Equatable {
    var ok = 0, monitor = 0, immediate = 0, notChecked = 0, unrated = 0, total = 0
}

struct OverviewVM: Decodable {
    struct Stage: Decodable, Identifiable {
        let id: String, name: String
        let done: Int, total: Int, pending: Int, photos: Int
        let complete: Bool
        let points: [PointRow]
    }
    struct PointRow: Decodable, Identifiable {
        let id: String, name: String
        let parts: Int, photos: Int
        let done: Bool
        let state: String
        let badge: String?
        let ai: Bool
    }
    let title: String, subtitle: String, status: String
    let locked: Bool
    let summary: Summary
    let aiItems: Int, gateCount: Int, pointsDone: Int, pointsTotal: Int, photos: Int
    let firstOpenStage: String?
    let stages: [Stage]
    let dtcs: [String]
}

struct SetupVM: Decodable {
    struct Option: Decodable, Hashable { let value: String, label: String }
    struct Row: Decodable, Identifiable { let key: String, label: String; let options: [Option]; let value: String; var id: String { key } }
    struct Flag: Decodable, Identifiable { let key: String, label: String; let on: Bool; var id: String { key } }
    let rows: [Row]
    let flags: [Flag]
    let templateName: String
    let points: Int, applies: Int, na: Int
}

struct PointVM: Decodable {
    struct Part: Decodable, Identifiable { let key: String, name: String, detail: String, state: String; let badge: String?; var id: String { key } }
    struct Group: Decodable, Identifiable { let title: String; let parts: [Part]; var id: String { title } }
    struct NotApplicable: Decodable { let count: Int; let labels: [String] }
    struct LooksOk: Decodable { let ids: [String]; let parts: [String] }
    struct Photo: Decodable, Identifiable { let id: String, path: String, caption: String; let pending: Bool; let firstPart: String? }
    struct Next: Decodable { let id: String, name: String }
    let id: String, name: String, stageId: String, stageName: String
    let note: String?
    let state: String
    let partCount: Int
    let groups: [Group]
    let notApplicable: NotApplicable
    let looksOk: LooksOk
    let unrated: Int
    let photos: [Photo]
    let noteText: String
    let noteStatus: String?
    let nextPoint: Next?
    let locked: Bool
}

struct PartVM: Decodable {
    struct NotInspected: Decodable { let kind: String, reason: String }
    struct PendingFinding: Decodable, Identifiable {
        let id: String, key: String, label: String, severity: String
        let confidence: Double?
        let rationale: String?
        let photoPath: String?
        let rating: String
    }
    struct LooksOk: Decodable { let ids: [String]; let note: String?; let confidence: Double? }
    struct Bands: Decodable { let ok: String; let monitor: String?; let immediate: String? }
    struct Result: Decodable { let rating: String; let value: Double? }
    struct Check: Decodable, Identifiable {
        let key: String, name: String, how: String
        let unit: String?
        let measured: Bool
        let basis: String
        let bands: Bands
        let ratings: [String]
        let result: Result?
        var id: String { key }
    }
    struct Finding: Decodable, Identifiable {
        let id: String, label: String, severity: String, rating: String, source: String, status: String
        let removable: Bool
    }
    struct FindingOption: Decodable, Identifiable { let key: String, label: String; let ratings: [String: String]; var id: String { key } }
    struct Photo: Decodable, Identifiable { let id: String, path: String; let pending: Bool }
    let key: String, title: String, subtitle: String, state: String
    let notInspected: NotInspected?
    let capture: String
    let pendingFindings: [PendingFinding]
    let looksOk: LooksOk?
    let checks: [Check]
    let findings: [Finding]
    let findingOptions: [FindingOption]
    let photos: [Photo]
    let locked: Bool
}

struct SortVM: Decodable {
    struct Need: Decodable, Identifiable { let id: String, path: String; let analyzed: Bool }
    struct Photo: Decodable, Identifiable { let id: String, path: String, caption: String; let pending: Bool; let status: String }
    struct PointPhotos: Decodable, Identifiable { let id: String, name: String; let photos: [Photo] }
    let stageName: String
    let total: Int, unread: Int
    let noneRead: Bool
    let partsSeen: Int, proposedLinks: Int
    let needs: [Need]
    let points: [PointPhotos]
    let locked: Bool
}

struct PlaceVM: Decodable {
    struct Saw: Decodable, Hashable { let part: String, detail: String }
    struct Part: Decodable, Identifiable { let key: String, label: String; let ai: Bool; var id: String { key } }
    struct Group: Decodable, Identifiable { let stage: String; let sameStage: Bool; let point: String; let parts: [Part]; var id: String { stage + "|" + point } }
    let path: String
    let picked: [String]
    let aiSaw: [Saw]
    let groups: [Group]
}

struct FinishVM: Decodable {
    struct Item: Decodable, Identifiable { let kind: String, id: String, title: String, detail: String; let partKey: String?; let stageId: String? }
    struct Note: Decodable, Identifiable { let pointId: String, point: String, techText: String, aiText: String; var id: String { pointId } }
    let gateCount: Int
    let items: [Item]
    let summary: Summary
    let aiToReview: Int
    let notes: [Note]
    let ready: Bool
    let autoNoteTodo: [String]
    let status: String
}

// MARK: from the server

struct VehicleHeader: Decodable {
    let id: String
    let vin: String?
    let year: Int?
    let make: String?, model: String?, trim: String?, customer: String?
    var name: String { [year.map(String.init) ?? "", make ?? "", model ?? "", trim ?? ""].filter { !$0.isEmpty }.joined(separator: " ") }
}

struct JobHeader: Decodable, Identifiable {
    let id: String
    let ro: String
    let status: String
    let date: String
    let odometer: Int?
    let technician: String?
    let concerns: [String]?
    let summary: Summary?
    let pendingAi: Int?
    let vehicle: VehicleHeader
}

struct ShopRef: Decodable, Identifiable, Hashable { let id: String; let name: String; let role: String? }

/// One inspection as the database returns it (get_inspection), kept as JSON for the shared rules.
struct InspectionBundle {
    var inspection: JSONValue
    var vehicle: JSONValue
    var template: JSONValue
    var version: Int

    var id: String { inspection["id"]?.string ?? "" }
    var status: String { inspection["status"]?.string ?? "" }
    var vehicleId: String { vehicle["id"]?.string ?? "" }
    var startedAt: String? { inspection["startedAt"]?.string }
    var firstSubmittedAt: String? { inspection["firstSubmittedAt"]?.string }
    var media: [JSONValue] { inspection["media"]?.array ?? [] }
}

/// What the VIN lookup returns.
struct DecodedVin: Decodable {
    let year: Int?
    let make: String, model: String, trim: String, engine: String
}

enum Labels {
    static func state(_ s: String) -> String {
        switch s {
        case "ok": return "OK"
        case "monitor": return "Monitor"
        case "immediate": return "Immediate"
        case "not_inspected": return "Not checked"
        case "unable_to_assess": return "Can’t assess"
        default: return "Not rated"
        }
    }
    struct Option: Hashable { let key: String; let label: String }
    struct Corner: Hashable { let key: String; let short: String; let label: String }
    static let reasons: [Option] = [
        Option(key: "not_accessible", label: "Not accessible"), Option(key: "not_performed_this_visit", label: "Not done this visit"),
        Option(key: "blocked_by_other_condition", label: "Blocked by another problem"), Option(key: "vehicle_not_road_tested", label: "Not road tested"),
        Option(key: "customer_declined", label: "Customer declined"), Option(key: "unsafe_to_inspect", label: "Unsafe to inspect"),
    ]
    static func reason(_ r: String) -> String { reasons.first { $0.key == r }?.label ?? r }
    static let severities = ["minor", "moderate", "severe", "critical"]
    static let corners: [Corner] = [
        Corner(key: "left_front", short: "LF", label: "Left front"), Corner(key: "right_front", short: "RF", label: "Right front"),
        Corner(key: "left_rear", short: "LR", label: "Left rear"), Corner(key: "right_rear", short: "RR", label: "Right rear"),
    ]
    static let jobStatus = ["not_started": "Ready to inspect", "in_progress": "In progress", "submitted": "With advisor", "sent": "Sent to customer"]
}
