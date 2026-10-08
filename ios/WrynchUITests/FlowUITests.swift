import XCTest

/// A technician's flow in the real app against the local test server (scripts/ios-ui-test.sh seeds it):
/// sign in, open today's inspection, set up and start it, move through points with Back / Next / Jump, mark "nothing found", and see it counted.
final class FlowUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    /// What's on screen, for failure messages (alerts first).
    private func screen(_ app: XCUIApplication) -> String {
        let alert = app.alerts.firstMatch
        if alert.exists { return "ALERT: " + alert.staticTexts.allElementsBoundByIndex.map(\.label).joined(separator: " | ") }
        let texts = app.staticTexts.allElementsBoundByIndex.prefix(25).map(\.label)
        let buttons = app.buttons.allElementsBoundByIndex.prefix(15).map(\.label)
        return "TEXT: " + texts.joined(separator: " | ") + " BUTTONS: " + buttons.joined(separator: " | ")
    }

    func testTechnicianInspectsAPoint() throws {
        let app = XCUIApplication()
        app.launchEnvironment["WRYNCH_APP_URL"] = "http://localhost:5189"
        app.launch()

        // Sign in (a fresh simulator has no saved session).
        let email = app.textFields["Email"]
        XCTAssertTrue(email.waitForExistence(timeout: 20), "sign-in screen — " + screen(app))
        email.tap(); email.typeText("tech@shop.test")
        let password = app.secureTextFields["Password"]
        password.tap(); password.typeText("wrynch-ios-1")
        app.buttons["Sign in"].tap()

        // Today's list shows the seeded repair order.
        let vehicle = app.staticTexts["2011 Toyota 4Runner SR5"]
        XCTAssertTrue(vehicle.waitForExistence(timeout: 20), "today's inspections — " + screen(app))
        XCTAssertTrue(app.staticTexts["RO 77001"].exists)
        vehicle.tap()

        // Vehicle setup, then start: the inspection opens full screen on its first unfinished point.
        let start = app.buttons["Start inspection"]
        XCTAssertTrue(start.waitForExistence(timeout: 20), "vehicle setup — " + screen(app))
        XCTAssertTrue(app.staticTexts["JTEBU5JR4B5012345"].exists)
        start.tap()

        let pointOne = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Point 1 of'")).firstMatch
        let pointTwo = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Point 2 of'")).firstMatch
        XCTAssertTrue(pointOne.waitForExistence(timeout: 20), "wizard on the first point — " + screen(app))
        XCTAssertTrue(app.staticTexts["Walkaround, VIN, and tire placard photos"].exists)

        // Glove-sized controls and the voice-note button.
        let next = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Next: '")).firstMatch
        XCTAssertTrue(next.exists, "Next button — " + screen(app))
        XCTAssertGreaterThanOrEqual(next.frame.height, 64, "Next is big enough for gloves")
        XCTAssertTrue(app.buttons["Speak a note"].exists, "voice note button — " + screen(app))

        // The overview shows progress; Continue goes back to the first unfinished point.
        app.buttons["Inspection overview"].tap()
        let progress = app.staticTexts.matching(NSPredicate(format: "label ENDSWITH 'points done'")).firstMatch
        XCTAssertTrue(progress.waitForExistence(timeout: 20), "overview with progress — " + screen(app))
        let before = Int(progress.label.split(separator: " ").first ?? "") ?? -1
        let resume = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Continue inspection' OR label CONTAINS 'Start with the first point'")).firstMatch
        XCTAssertTrue(resume.exists, "continue button — " + screen(app))
        resume.tap()
        XCTAssertTrue(pointOne.waitForExistence(timeout: 20), "continue resumes at point 1 — " + screen(app))

        // "Nothing found" rates the point's untouched parts OK.
        let nothing = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Nothing found'")).firstMatch
        XCTAssertTrue(nothing.waitForExistence(timeout: 20), "point screen — " + screen(app))
        // On a small phone it can sit under the Back / Jump / Next footer: scroll it clear first.
        for _ in 0..<4 where nothing.frame.maxY > next.frame.minY - 8 { app.swipeUp(); sleep(1) }
        let where_ = "frame \(nothing.frame), footer top \(next.frame.minY), window \(app.windows.firstMatch.frame)"
        nothing.tap()
        let ok = app.staticTexts.matching(NSPredicate(format: "label == 'OK'")).firstMatch
        XCTAssertTrue(ok.waitForExistence(timeout: 20), "the point shows OK after saving (" + where_ + ") — " + screen(app))
        XCTAssertFalse(nothing.exists, "nothing left unrated on this point")

        // Next and Back move one point at a time.
        next.tap()
        XCTAssertTrue(pointTwo.waitForExistence(timeout: 20), "Next goes to point 2 — " + screen(app))
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Back'")).firstMatch.tap()
        XCTAssertTrue(pointOne.waitForExistence(timeout: 20), "Back returns to point 1 — " + screen(app))

        // Jump straight to another point, then to the overview.
        app.buttons["Jump to a point"].tap()
        let cranking = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Engine cranking'")).firstMatch
        XCTAssertTrue(cranking.waitForExistence(timeout: 10), "jump list — " + screen(app))
        cranking.tap()
        XCTAssertTrue(pointTwo.waitForExistence(timeout: 20), "jumped to Engine cranking — " + screen(app))
        app.buttons["Jump to a point"].tap()
        let overview = app.buttons["Overview"]
        XCTAssertTrue(overview.waitForExistence(timeout: 10), "jump list overview button — " + screen(app))
        overview.tap()

        // Back on the overview, the point counts as done and Finish is still locked.
        let done = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "\(before + 1) of ")).firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 20), "one more point done — " + screen(app))
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS 'items left'")).firstMatch.exists, "finish locked until everything is rated")

        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.lifetime = .keepAlways
        add(shot)
    }
}
