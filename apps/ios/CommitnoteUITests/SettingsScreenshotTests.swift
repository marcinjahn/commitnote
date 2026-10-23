import XCTest

final class SettingsScreenshotTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testCaptureScreens() {
        let app = launchApp(reset: true, appearance: .light)
        logInToNotes(in: app)
        captureScreens(app)
    }

    private func captureScreens(_ app: XCUIApplication) {
        openSettings(in: app)
        let save = app.element("settings-save-status")
        waitFor(save)
        waitUntilSettled(save)
        snapshotBothAppearances("settings")

        let font = app.element("settings-note-font")
        waitFor(font)
        font.tap()
        let preview = app.element("settings-font-preview")
        waitFor(preview)
        waitUntilSettled(preview)
        snapshotBothAppearances("settings-fonts")
        tapBack(in: app)
        waitUntilGone(app.element("settings-font-list"))

        let passphrase = revealInSettings(app.buttons["settings-change-passphrase-button"], in: app)
        waitUntilSettled(passphrase)
        snapshotBothAppearances("settings-data")

        openChangePassphrase(in: app)
        typeNewPassphrase(app.secureTextFields["change-passphrase-new"], "short passphrase", in: app)
        let strength = app.element("change-passphrase-strength")
        waitFor(strength)
        waitUntilSettled(strength)
        snapshotBothAppearances("change-passphrase")
        tapBack(in: app)
        waitUntilGone(app.element("change-passphrase-screen"))
        closeSettings(in: app)

        openSampleImport(in: app)
        waitForImportPreview(in: app)
        waitUntilSettled(app.element("import-preview"))
        snapshotBothAppearances("import")
        hittable(app.buttons.matching(identifier: "import-cancel")).tap()
        waitUntilGone(app.element("import-screen"))
        closeSettings(in: app)
    }
}
