import XCTest
@testable import Wrynch

/// The shared rules run in JavaScriptCore and their answers decode into the screens' types.
/// The fixture is the web app's demo inspection with AI-sorted photos (written by `npm run ios:domain`).
@MainActor
final class DomainTests: XCTestCase {
    private var domain: Domain!
    private var inspection: JSONValue!
    private var vehicle: JSONValue!

    override func setUp() async throws {
        domain = try Domain()
        let url = try XCTUnwrap(Bundle(for: DomainTests.self).url(forResource: "sample", withExtension: "json"))
        let sample = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url))
        inspection = sample["inspection"]
        vehicle = sample["vehicle"]
        try domain.configure(template: .null, thresholds: .null, disabled: .null)
    }

    func testOverviewDecodesAndCountsAgree() throws {
        let o = try domain.run("overview", [inspection, vehicle], as: OverviewVM.self)
        XCTAssertFalse(o.stages.isEmpty)
        XCTAssertEqual(o.pointsTotal, o.stages.reduce(0) { $0 + $1.total })
        XCTAssertGreaterThan(o.summary.total, 0)
        XCTAssertGreaterThan(o.aiItems, 0, "the fixture has AI suggestions to review")
        XCTAssertEqual(o.status, "in_progress")
    }

    func testEveryScreenDecodes() throws {
        let setup = try domain.run("setup", [inspection, vehicle], as: SetupVM.self)
        XCTAssertFalse(setup.rows.isEmpty)
        let point = try domain.run("point", [inspection, vehicle, "S24"], as: PointVM.self)
        XCTAssertEqual(point.name, "Visual brake system condition")
        let key = try XCTUnwrap(point.groups.first?.parts.first?.key)
        let part = try domain.run("part", [inspection, vehicle, .string(key)], as: PartVM.self)
        XCTAssertFalse(part.checks.isEmpty)
        let sort = try domain.run("sort", [inspection, vehicle, "under_car"], as: SortVM.self)
        XCTAssertEqual(sort.total, 6)
        let place = try domain.run("place", [inspection, vehicle, "m-1"], as: PlaceVM.self)
        XCTAssertTrue(place.groups.first?.sameStage ?? false)
        let finish = try domain.run("finish", [inspection, vehicle], as: FinishVM.self)
        XCTAssertGreaterThan(finish.gateCount, 0)
        let untouched = try domain.run("untouched", [inspection, vehicle, "S22"], as: JSONValue.self)
        XCTAssertNotNil(untouched.array)
    }

    func testErrorsComeBackAsSwiftErrors() {
        XCTAssertThrowsError(try domain.run("point", [inspection, vehicle, "NOPE"], as: PointVM.self))
        XCTAssertThrowsError(try domain.run("noSuchFunction", [], as: JSONValue.self))
    }

    func testTurnedOffChecksAreHidden() throws {
        try domain.configure(template: .null, thresholds: .null, disabled: ["platform": [], "shop": ["tire.age"]])
        var blank = inspection!
        blank["results"] = []
        let tire = try domain.run("part", [blank, vehicle, "4@left_front"], as: PartVM.self)
        XCTAssertFalse(tire.checks.contains { $0.key == "tire.age" })
    }
}

final class JSONValueTests: XCTestCase {
    func testRoundTripAndAccess() throws {
        let v: JSONValue = ["a": 1, "b": [true, nil, "x"], "c": 1.5]
        let back = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(v))
        XCTAssertEqual(v, back)
        XCTAssertEqual(back["a"]?.number, 1)
        XCTAssertEqual(back["b"]?.array?.count, 3)
        XCTAssertEqual(String(decoding: try JSONEncoder().encode(JSONValue.number(53)), as: UTF8.self), "53", "whole numbers stay whole")
    }
}
