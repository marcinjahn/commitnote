import XCTest

final class CachedStartFlowTests: XCTestCase {
    private static let remoteEditLine = "Edited on another device"

    override func setUp() {
        continueAfterFailure = false
    }

    /// Logs in with Welcome open, waits for the core to keep the tree and relaunches with the
    /// forge refresh held, so the notes on screen can only come from the kept tree.
    private func relaunchFromCache() -> XCUIApplication {
        let first = launchApp(reset: true)
        logInToNotes(in: first)
        openWelcome(in: first)
        waitForValue(syncStatus(in: first), "synced")
        waitForStartKept(in: first)
        first.terminate()
        XCTAssertTrue(poll(timeout: 20) { first.state == .notRunning }, "The app stopped")

        let app = launchApp(reset: false, holdRefresh: true)
        waitForText(editor(in: app), startingWith: SampleNote.welcomeFirstLine, timeout: 90)
        XCTAssertFalse(app.secureTextFields["login-token-field"].exists, "The cached start asks for no token")
        XCTAssertFalse(app.element("loading-screen").exists, "The cached start shows no loading screen")
        return app
    }

    func testCachedStartShowsLastView() {
        let app = relaunchFromCache()
        if isPad {
            waitFor(note(SampleNote.welcome, in: app))
        }

        useTestingMenu("testing-finish-refresh", in: app)
        waitForValue(syncStatus(in: app), "synced")
        waitForText(editor(in: app), startingWith: SampleNote.welcomeFirstLine)
    }

    func testCachedStartRefreshUpdatesNote() {
        let app = relaunchFromCache()
        let editor = self.editor(in: app)
        useTestingMenu("testing-remote-edit", in: app)
        XCTAssertFalse(
            ((editor.value as? String) ?? "").hasPrefix(Self.remoteEditLine),
            "The remote edit waits for the refresh")

        useTestingMenu("testing-finish-refresh", in: app)
        waitForText(editor, startingWith: Self.remoteEditLine)
    }

    func testCachedStartStaleEditMerges() {
        let app = relaunchFromCache()
        let editor = self.editor(in: app)
        useTestingMenu("testing-remote-edit", in: app)
        typeAtEnd("Typed on stale content", in: app)

        useTestingMenu("testing-finish-refresh", in: app)
        waitForText(editor, startingWith: Self.remoteEditLine)
        waitForText(editor, containing: "Typed on stale content")
        waitForValue(syncStatus(in: app), "synced")
    }

    func testCachedStartRefreshFailed() {
        let app = relaunchFromCache()

        useTestingMenu("testing-fail-refresh", in: app)
        let notice = text(containing: "Could not reach GitHub. Showing the last loaded notes.", in: app)
        waitForCondition("The failed refresh is reported", timeout: 30) { notice.exists }
        XCTAssertTrue(editor(in: app).exists, "The kept notes stay")
    }

    func testCachedStartRevokedTokenKeepsEdits() {
        let app = relaunchFromCache()
        let editor = self.editor(in: app)
        typeAtEnd("Typed before the token check", in: app)

        useTestingMenu("testing-revoke-refresh", in: app)
        let notice = text(containing: "Your access token is no longer valid.", in: app)
        waitForCondition("The revoked token is reported", timeout: 30) { notice.exists }
        XCTAssertFalse(app.secureTextFields["login-token-field"].exists, "The session stays")
        waitForText(editor, containing: "Typed before the token check")
    }

    func testCachedStartKeyChanged() {
        let app = relaunchFromCache()

        useTestingMenu("testing-change-key", in: app)
        useTestingMenu("testing-finish-refresh", in: app)
        waitFor(app.element("key-changed-screen"), timeout: 30)
    }
}
