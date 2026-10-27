import XCTest

extension XCTestCase {
    func waitForLinkedDraft(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        waitForFocus(app.element("draft-name-field"), file: file, line: line)
        XCTAssertTrue(app.element("note-view").exists, "The draft opens in the note view", file: file, line: line)
    }

    /// Without a remembered session the launch action opens its draft as soon as the notes are
    /// ready, so on iPhone the tree may never show before the note view covers it.
    func logInToLinkedDraft(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        submitToken(Fixture.token, in: app, file: file, line: line)
        pickRepository(Fixture.notes, in: app)
        unlock(in: app)
        // Deriving the keys can take most of a minute on a freshly booted CI simulator.
        waitFor(app.element("draft-name-field"), timeout: 60, file: file, line: line)
        waitForLinkedDraft(in: app, file: file, line: line)
    }

    /// An untouched draft is dropped once another note opens or, on iPhone, once the note view is left.
    func leaveLinkedDraft(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        if isPad {
            openWelcome(in: app, file: file, line: line)
        } else {
            leaveNote(in: app)
        }
        waitUntilGone(app.element("draft-name-field"), file: file, line: line)
    }

    /// A dropped action leaves nothing to wait for, so the draft gets a few seconds to show up.
    func expectNoLinkedDraft(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertFalse(
            appears(app.element("draft-name-field"), within: 5), "The dropped link opened no draft",
            file: file, line: line)
    }

    func waitForLinkedSearch(
        in app: XCUIApplication, timeout: TimeInterval = 20, file: StaticString = #filePath, line: UInt = #line
    ) {
        waitFor(app.element("search-results"), timeout: timeout, file: file, line: line)
        waitForFocus(app.searchFields.firstMatch, file: file, line: line)
    }

    /// Ends the search with the search bar's Cancel or close button, or the sidebar's close button.
    func closeLinkedSearch(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let results = app.element("search-results")
        let cancel = app.buttons.matching(
            NSPredicate(format: "label IN %@ OR identifier == %@", ["Cancel", "Close"], "search-close"))
        for _ in 0..<3 where results.exists {
            if cancel.firstMatch.exists {
                hittable(cancel, file: file, line: line).tap()
            } else {
                app.searchFields.firstMatch.typeKey(.escape, modifierFlags: [])
            }
            if poll(timeout: 10, until: { !results.exists }) { break }
        }
        waitUntilGone(results, file: file, line: line)
        waitFor(app.element("notes-tree"), file: file, line: line)
    }

    /// Releasing the held loading twice is harmless, so a tap lost on a slow runner is repeated.
    func finishHeldLoading(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let loading = app.element("loading-screen")
        let finish = app.buttons["testing-finish-loading"]
        for _ in 0..<3 where loading.exists && finish.exists {
            tapRevealed(finish, in: app)
            if poll(timeout: 15, until: { !loading.exists }) { break }
        }
        waitUntilGone(loading, timeout: 45, file: file, line: line)
    }
}
