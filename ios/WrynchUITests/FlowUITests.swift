import XCTest

/// A technician's flow in the real app against the local test server (scripts/ios-ui-test.sh seeds it):
/// sign in, open today's inspection, set up and start it, open a point, mark "nothing found", and see it counted.
final class FlowUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    func testTechnicianInspectsAPoint() throws {
        let app = XCUIApplication()
        app.launchEnvironment["WRYNCH_APP_URL"] = "http://localhost:5189"
        app.launch()

        // Sign in (a fresh simulator has no saved session).
        let email = app.textFields["Email"]
        XCTAssertTrue(email.waitForExistence(timeout: 20), "sign-in screen")
        email.tap(); email.typeText("tech@shop.test")
        let password = app.secureTextFields["Password"]
        password.tap(); password.typeText("wrynch-ios-1")
        app.buttons["Sign in"].tap()

        // Today's list shows the seeded repair order.
        let vehicle = app.staticTexts["2011 Toyota 4Runner SR5"]
        XCTAssertTrue(vehicle.waitForExistence(timeout: 20), "today's inspections")
        XCTAssertTrue(app.staticTexts["RO 77001"].exists)
        vehicle.tap()

        // Vehicle setup, then start.
        let start = app.buttons["Start inspection"]
        XCTAssertTrue(start.waitForExistence(timeout: 20), "vehicle setup")
        XCTAssertTrue(app.staticTexts["JTEBU5JR4B5012345"].exists)
        start.tap()

        // Overview: the first unfinished stage is open; open its first point.
        let progress = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH '0 of '")).firstMatch
        XCTAssertTrue(progress.waitForExistence(timeout: 20), "overview with progress")
        let point = app.staticTexts["Walkaround, VIN, and tire placard photos"]
        XCTAssertTrue(point.waitForExistence(timeout: 10), "road test stage open")
        point.tap()

        // "Nothing found" rates the point's untouched parts OK.
        let nothing = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Nothing found'")).firstMatch
        XCTAssertTrue(nothing.waitForExistence(timeout: 20), "point screen")
        nothing.tap()
        let ok = app.staticTexts.matching(NSPredicate(format: "label == 'OK'")).firstMatch
        XCTAssertTrue(ok.waitForExistence(timeout: 20), "the point shows OK after saving")
        XCTAssertFalse(nothing.exists, "nothing left unrated on this point")

        // Back on the overview, the point counts as done and Finish is still locked.
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let done = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH '1 of '")).firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 20), "one point done")
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS 'items left'")).firstMatch.exists, "finish locked until everything is rated")

        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.lifetime = .keepAlways
        add(shot)
    }
}
