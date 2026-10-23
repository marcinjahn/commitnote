import XCTest

final class DataFlowTests: XCTestCase {
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

    func testExportAndPrint() {
        let app = openNotes()
        openSettings(in: app)
        chooseExport(in: app)
        waitFor(app.element("ActivityListView"), timeout: 60)
        dismissShareSheet(in: app)
        closeSettings(in: app)

        openWelcome(in: app)
        chooseNoteAction("note-print-button", label: "Print", in: app)
        let sheet = app.element("ActivityListView")
        waitFor(sheet, timeout: 60)
        let printAction = sheet.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", "Print")).firstMatch
        if !appears(printAction, within: 10) {
            sheet.swipeUp()
        }
        waitFor(printAction)
        dismissShareSheet(in: app)
    }

    func testImportSampleArchive() {
        let app = openNotes()
        openSampleImport(in: app)
        waitForValue(app.textFields["import-folder-name"], ImportSample.folder)
        waitForImportPreview(in: app)
        tapRevealed(app.buttons["import-confirm"], in: app)
        waitUntilGone(app.element("import-screen"), timeout: 60)
        closeSettings(in: app)

        waitFor(folder(ImportSample.folder, in: app), timeout: 30)
        let editor = openNote(ImportSample.plan, startingWith: ImportSample.planFirstLine, in: app)
        let image = app.elements("editor-image").firstMatch
        revealInEditor(image, editor: editor)
        waitForValue(image, "loaded", timeout: 60)

        openSampleImport(in: app)
        hittable(app.buttons.matching(NSPredicate(format: "label == %@", "An existing folder"))).tap()
        let root = app.element("import-folder-root")
        tapRevealed(root, in: app)
        waitForCondition("The root folder is the destination") { self.isSelected(root) }
        waitForImportPreview(in: app)
        tapRevealed(app.buttons["import-confirm"], in: app)
        let message = app.element("import-message")
        waitFor(message, timeout: 30)
        waitUntil(message, NSPredicate(format: "label CONTAINS %@", "same name"))
        tapRevealed(app.buttons["import-rename"], in: app)
        waitUntilGone(app.element("import-screen"), timeout: 60)
        closeSettings(in: app)
        waitFor(note(ImportSample.renamedWelcome, in: app), timeout: 30)
        XCTAssertTrue(note(SampleNote.welcome, in: app).exists)
    }

    /// Runs last: the new key lives only in this launch, since a relaunch starts a fresh fake forge
    /// that still holds the old one, so any later test logs in again.
    func testZChangePassphrase() {
        let app = openNotes()
        Self.loggedIn = false
        openSettings(in: app)
        openChangePassphrase(in: app)
        let done = app.buttons["settings-done"]
        waitForCondition("Settings cannot be closed from the passphrase screen") {
            !done.exists || !done.isHittable
        }

        let newPassphrase = "a much longer replacement passphrase"
        let mismatch = "a different passphrase"
        typeNewPassphrase(passphraseField("change-passphrase-current", in: app), Fixture.passphrase, in: app)
        typeNewPassphrase(passphraseField("change-passphrase-new", in: app), newPassphrase, in: app)
        typeNewPassphrase(passphraseField("change-passphrase-repeat", in: app), mismatch, in: app)
        let continueButton = app.buttons["change-passphrase-continue"]
        revealInSettings(continueButton, within: "change-passphrase-screen", in: app).tap()
        let error = app.element("change-passphrase-error")
        waitFor(error)
        waitUntil(error, NSPredicate(format: "label CONTAINS %@", "do not match"))

        typeNewPassphrase(
            passphraseField("change-passphrase-repeat", in: app), newPassphrase, replacing: mismatch.count, in: app)
        waitFor(app.element("change-passphrase-strength"))
        revealInSettings(continueButton, within: "change-passphrase-screen", in: app).tap()
        waitFor(app.element("change-passphrase-summary"), timeout: 120)
        let confirm = app.buttons["change-passphrase-confirm"]
        revealInSettings(confirm, within: "change-passphrase-screen", in: app).tap()

        let notice = text(containing: "Passphrase changed", in: app)
        waitForCondition("The change is reported", timeout: 120) { notice.exists }
        waitUntilGone(app.element("settings-screen"))
        waitFor(app.element("notes-tree"), timeout: 60)
        openWelcome(in: app)
        typeAtEnd("\nWritten with the new key", in: app)
        waitForSaved(in: app)
    }

    private func passphraseField(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        revealInSettings(app.secureTextFields[identifier], within: "change-passphrase-screen", in: app)
    }
}
