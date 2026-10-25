import XCTest

final class LoginFlowTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testLogInUnlockBrowseReadAndLogOut() {
        let app = launchApp(reset: true)
        logInToNotes(in: app)

        expandFolder("Journal", in: app)

        let welcome = note("Welcome", in: app)
        waitFor(welcome)
        welcome.tap()
        waitFor(app.element("note-editor"))

        if !isPad {
            app.navigationBars.buttons.element(boundBy: 0).tap()
        }
        let tree = app.element("notes-tree")
        waitFor(tree)
        tree.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15))
            .press(forDuration: 0.1, thenDragTo: tree.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8)))
        waitFor(app.element("notes-tree"))
        waitFor(note("Welcome", in: app))

        app.buttons["notes-menu-button"].tap()
        let logOut = app.buttons["log-out-button"]
        waitFor(logOut)
        logOut.tap()
        waitFor(app.secureTextFields["login-token-field"])
    }

    func testRememberedSessionResumes() {
        let app = launchApp(reset: true)
        logInToNotes(in: app)
        app.terminate()

        let relaunched = launchApp(reset: false)
        waitFor(relaunched.element("notes-tree"), timeout: 60)
        XCTAssertFalse(relaunched.secureTextFields["login-token-field"].exists)
    }

    func testInitialiseEmptyRepository() {
        let app = launchApp(reset: true)
        submitToken(Fixture.token, in: app)
        pickRepository(Fixture.empty, in: app)
        waitFor(app.element("init-description"))

        typeNewPassphrase(app.secureTextFields["init-passphrase-field"], "short passphrase", in: app)
        let strength = app.element("init-strength")
        waitFor(strength)
        XCTAssertTrue(strength.text.contains("Passphrase strength:"), strength.text)

        let repeatField = app.secureTextFields["init-repeat-field"]
        typeNewPassphrase(repeatField, "different", in: app)
        tapRevealed(app.buttons["init-submit-button"], in: app)
        let mismatch = app.staticTexts["Passphrases do not match."]
        waitFor(mismatch)

        typeNewPassphrase(repeatField, "short passphrase", replacing: "different".count, in: app)
        tapRevealed(app.buttons["init-submit-button"], in: app)
        let empty = app.element("notes-empty")
        waitFor(empty)
        XCTAssertEqual(empty.label, "No notes yet, create one")
    }

    func testNewerFormatIsRefused() {
        let app = launchApp(reset: true)
        submitToken(Fixture.token, in: app)
        pickRepository(Fixture.newer, in: app)
        let error = app.element("login-error")
        waitFor(error)
        XCTAssertTrue(error.text.contains("Update the app"), error.text)
    }

    func testPublicRepositoryWarning() {
        let app = launchApp(reset: true)
        submitToken(Fixture.token, in: app)
        pickRepository(Fixture.publicEmpty, in: app)
        waitFor(app.element("login-public-warning"))
    }

    func testInvalidToken() {
        let app = launchApp(reset: true)
        submitToken("invalid-token", in: app)
        waitFor(app.element("login-error"))
    }
}
