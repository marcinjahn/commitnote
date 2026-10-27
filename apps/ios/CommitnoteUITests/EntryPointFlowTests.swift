import XCTest

final class EntryPointFlowTests: XCTestCase {
    private static var loggedIn = false

    override func setUp() {
        continueAfterFailure = false
    }

    private func openNotes() -> XCUIApplication {
        guard Self.loggedIn else {
            let app = launchApp(reset: true)
            logInToNotes(in: app)
            Self.loggedIn = true
            return app
        }
        return resumeAtTree()
    }

    private func sortedNoteLabels(in app: XCUIApplication) -> [String] {
        treeNoteLabels(in: app).sorted()
    }

    func testANewNoteLink() {
        let app = openNotes()
        let labelsBefore = sortedNoteLabels(in: app)

        openLink("commitnote://new-note")
        waitForLinkedDraft(in: app)
        XCTAssertFalse(app.element("search-results").exists, "Search stays closed")

        leaveLinkedDraft(in: app)
        XCTAssertEqual(sortedNoteLabels(in: app), labelsBefore, "An untouched draft leaves no note")
    }

    func testBSearchLink() {
        let app = openNotes()

        openLink("commitnote://?action=search")
        waitForLinkedSearch(in: app)
        XCTAssertFalse(app.element("draft-name-field").exists, "No draft opens")

        closeLinkedSearch(in: app)
    }

    func testCDroppedWhileSheetOpen() {
        let app = openNotes()
        openSettings(in: app)

        openLink("commitnote://new-note")
        XCTAssertTrue(app.element("settings-screen").exists, "Settings stays open")
        closeSettings(in: app)

        expectNoLinkedDraft(in: app)
        waitFor(app.element("notes-tree"))
    }

    func testDHeldUntilTreeReady() {
        if !Self.loggedIn {
            _ = openNotes()
        }
        let app = launchApp(reset: false, holdLoading: true)
        let loading = app.element("loading-screen")
        let earlyName = app.element("early-draft-name")
        let results = app.element("search-results")
        waitFor(loading, timeout: 30)
        waitFor(earlyName)
        waitFor(app.buttons["testing-finish-loading"])

        openLink("commitnote://search")
        // Links are handled in order, so once new-note has focused the early draft the search was handled too.
        openLink("commitnote://new-note")
        waitForFocus(earlyName)
        XCTAssertTrue(loading.exists, "Still loading")
        XCTAssertFalse(results.exists, "Search waits for the tree")

        finishHeldLoading(in: app)
        waitForLinkedSearch(in: app, timeout: 45)
        XCTAssertFalse(app.element("draft-name-field").exists, "The early draft consumed new-note")

        closeLinkedSearch(in: app)
    }
}
