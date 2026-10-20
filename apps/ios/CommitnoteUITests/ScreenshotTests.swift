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
        waitFor(app.element("note-content"))
        if isPad {
            waitFor(app.element("tree-note"))
        }
        snapshot("note", appearance: appearance)

        app = launchApp(reset: true, appearance: appearance)
        submitToken(Fixture.token, in: app)
        pickRepository(Fixture.newer, in: app)
        waitFor(app.element("login-error"))
        snapshot("newer-format", appearance: appearance)
    }
}
