import XCTest

final class ScreenshotTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testCaptureScreens() {
        for appearance in [Appearance.light, Appearance.dark] {
            captureScreens(appearance)
        }
    }

    private func captureScreens(_ appearance: Appearance) {
        var app = launchApp(reset: true, appearance: appearance)
        waitFor(app.secureTextFields["login-token-field"])
        snapshot("login", appearance: appearance)

        submitToken(Fixture.token, in: app)
        waitFor(app.element("login-repository-list"))
        waitFor(app.element("login-repository-row"))
        snapshot("repositories", appearance: appearance)

        pickRepository(Fixture.notes, in: app)
        waitFor(app.secureTextFields["login-passphrase-field"])
        XCTAssertFalse(app.element("login-public-warning").exists)
        snapshot("unlock", appearance: appearance)

        app = launchApp(reset: true, appearance: appearance)
        submitToken(Fixture.token, in: app)
        pickRepository(Fixture.empty, in: app)
        waitFor(app.element("init-description"))
        typeNewPassphrase(app.secureTextFields["init-passphrase-field"], "short passphrase", in: app)
        waitFor(app.element("init-strength"))
        snapshot("initialise", appearance: appearance)

        app = launchApp(reset: true, appearance: appearance)
        logInToNotes(in: app)
        expandFolder("Journal", in: app)
        snapshot("tree", appearance: appearance)

        let welcome = note("Welcome", in: app)
        waitFor(welcome)
        welcome.tap()
        waitFor(app.element("note-editor"))
        if isPad {
            waitFor(app.element("tree-note"))
        }
        snapshot("note", appearance: appearance)

        captureEditingScreens(appearance)

        app = launchApp(reset: true, appearance: appearance)
        submitToken(Fixture.token, in: app)
        pickRepository(Fixture.newer, in: app)
        waitFor(app.element("login-error"))
        snapshot("newer-format", appearance: appearance)
    }

    private func captureEditingScreens(_ appearance: Appearance) {
        var app = resumeNotes(appearance: appearance)
        openWelcome(in: app)
        focusEditor(in: app)
        snapshot("editor", appearance: appearance)

        app = resumeNotes(appearance: appearance)
        hittable(app.buttons.matching(identifier: "new-note-button")).tap()
        waitForFocus(app.element("draft-name-field"))
        snapshot("new-note", appearance: appearance)

        app = resumeNotes(appearance: appearance)
        openFolderSheet(in: app)
        waitForFocus(app.element("new-folder-name-field"))
        snapshot("new-folder", appearance: appearance)

        app = resumeNotes(appearance: appearance)
        openWelcome(in: app)
        useTestingMenu("testing-fail-saves", in: app)
        typeAtEnd("Not saved yet", in: app)
        waitForValue(syncStatus(in: app), "failed")
        openStatusMenu(in: app)
        waitFor(app.element("sync-status-note-0"))
        snapshot("sync-status", appearance: appearance)

        app = resumeNotes(appearance: appearance)
        makeConflict(in: app)
        snapshot("conflict", appearance: appearance)
        leaveNote(in: app)
        waitFor(app.buttons["notice-action-button"])
        snapshot("notice-action", appearance: appearance)

        app = resumeNotes(appearance: appearance)
        openWelcome(in: app)
        useTestingMenu("testing-fail-saves", in: app)
        typeAtEnd("Not saved yet", in: app)
        tapLogOut(in: app)
        waitFor(unsavedAlert(in: app), timeout: 30)
        snapshot("logout-unsaved", appearance: appearance)

        app = resumeNotes(appearance: appearance)
        changeKeyWithUnsavedEdit("Not saved yet", in: app)
        waitFor(app.buttons["key-changed-export-button"])
        snapshot("key-changed-export", appearance: appearance)
    }
}
