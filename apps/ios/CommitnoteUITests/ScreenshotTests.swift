import XCTest

final class ScreenshotTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testCaptureScreens() {
        captureScreens()
    }

    private func captureScreens() {
        var app = launchApp(reset: true)
        waitFor(app.secureTextFields["login-token-field"])
        snapshotBothAppearances("login")

        submitToken(Fixture.token, in: app)
        waitFor(app.element("login-repository-list"))
        waitFor(app.element("login-repository-row"))
        snapshotBothAppearances("repositories")

        pickRepository(Fixture.notes, in: app)
        waitFor(app.secureTextFields["login-passphrase-field"])
        XCTAssertFalse(app.element("login-public-warning").exists)
        snapshotBothAppearances("unlock")

        app = launchApp(reset: true)
        submitToken(Fixture.token, in: app)
        pickRepository(Fixture.empty, in: app)
        waitFor(app.element("init-description"))
        typeNewPassphrase(app.secureTextFields["init-passphrase-field"], "short passphrase", in: app)
        waitFor(app.element("init-strength"))
        snapshotBothAppearances("initialise")

        app = launchApp(reset: true)
        logInToNotes(in: app)
        expandFolder("Journal", in: app)
        snapshotBothAppearances("tree")

        let welcome = note("Welcome", in: app)
        waitFor(welcome)
        welcome.tap()
        waitFor(app.element("note-editor"))
        if isPad {
            waitFor(app.element("tree-note"))
        }
        snapshotBothAppearances("note")

        captureEditingScreens()

        app = launchApp(reset: true)
        submitToken(Fixture.token, in: app)
        pickRepository(Fixture.newer, in: app)
        waitFor(app.element("login-error"))
        snapshotBothAppearances("newer-format")
    }

    private func captureEditingScreens() {
        var app = resumeNotes()
        openWelcome(in: app)
        focusEditor(in: app)
        snapshotBothAppearances("editor")

        app = resumeNotes()
        hittable(app.buttons.matching(identifier: "new-note-button")).tap()
        waitForFocus(app.element("draft-name-field"))
        snapshotBothAppearances("new-note")

        app = resumeNotes()
        openFolderSheet(in: app)
        waitForFocus(app.element("new-folder-name-field"))
        snapshotBothAppearances("new-folder")

        app = resumeNotes()
        openWelcome(in: app)
        useTestingMenu("testing-fail-saves", in: app)
        typeAtEnd("Not saved yet", in: app)
        waitForValue(syncStatus(in: app), "failed")
        openStatusMenu(in: app)
        waitFor(app.element("sync-status-note-0"))
        snapshotBothAppearances("sync-status")

        app = resumeNotes()
        makeConflict(in: app)
        snapshotBothAppearances("conflict")
        leaveNote(in: app)
        waitFor(app.buttons["notice-action-button"])
        snapshotBothAppearances("notice-action")

        app = resumeNotes()
        openWelcome(in: app)
        useTestingMenu("testing-fail-saves", in: app)
        typeAtEnd("Not saved yet", in: app)
        tapLogOut(in: app)
        waitFor(unsavedAlert(in: app), timeout: 30)
        snapshotBothAppearances("logout-unsaved")

        app = resumeNotes()
        changeKeyWithUnsavedEdit("Not saved yet", in: app)
        waitFor(app.buttons["key-changed-export-button"])
        snapshotBothAppearances("key-changed-export")
    }
}
