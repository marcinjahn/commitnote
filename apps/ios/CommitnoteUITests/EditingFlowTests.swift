import XCTest

final class EditingFlowTests: XCTestCase {
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
        return resumeNotes()
    }

    func testEditAutosaves() {
        let app = openNotes()
        openWelcome(in: app)
        let status = syncStatus(in: app)
        waitForValue(status, "synced")
        typeAtEnd("Typed on this device", in: app)

        // Reading the status can take longer than the 2 s autosave delay on a slow simulator, so each
        // further keystroke reopens the delay for another look at the pending state.
        let pending = NSPredicate(format: "value == %@", "pending")
        var sawPending = false
        for attempt in 0..<4 where !sawPending {
            if attempt > 0 { editor(in: app).typeText(".") }
            sawPending = poll(timeout: 3) { pending.evaluate(with: status) }
        }
        XCTAssertTrue(sawPending, "Expected \(status) to hold the typed text as pending before saving it")
        waitForValue(status, "synced")
        waitForText(editor(in: app), containing: "Typed on this device")
    }

    func testRemoteEditKeepsCaretAndUndo() {
        let app = openNotes()
        let editor = openWelcome(in: app)
        let status = syncStatus(in: app)

        // Offline keeps the local edit unsaved until the remote edit is in, so the save merges both
        // instead of the remote full-text edit overwriting an already saved local edit.
        runTestingAction("testing-offline")
        waitForValue(status, "offline")
        focusEditor(in: app)
        editor.typeKey(.upArrow, modifierFlags: .command)
        editor.typeText("local text")
        waitForUnsavedWhileOffline(in: app)
        runTestingAction("testing-remote-edit-refresh")
        runTestingAction("testing-offline")

        waitForText(editor, containing: "Appended on another device")
        waitForValue(status, "synced")
        waitForText(editor, startingWith: "local text")

        waitForFocus(editor)
        editor.typeText("!")
        waitForText(editor, startingWith: "local text!")

        var undos = 0
        while ((editor.value as? String) ?? "").contains("local text"), undos < 6 {
            editor.typeKey("z", modifierFlags: .command)
            undos += 1
        }
        waitForText(editor, startingWith: SampleNote.welcomeFirstLine)
        let text = (editor.value as? String) ?? ""
        XCTAssertFalse(text.contains("local text"), "Undo reverts the local edits")
        XCTAssertTrue(text.hasSuffix("Appended on another device"), "Undo keeps the remote edit")
    }

    func testRemoteEditOverSelection() {
        let app = openNotes()
        let editor = openWelcome(in: app)
        let status = syncStatus(in: app)
        waitForValue(status, "synced")

        selectFirstLine(in: app)
        runTestingAction("testing-remote-edit-refresh")
        waitForText(editor, containing: "Appended on another device")
        waitForFocus(editor)

        editor.typeText("Replaced")
        waitForText(editor, startingWith: "Replaced")
        let text = (editor.value as? String) ?? ""
        XCTAssertTrue(
            text.hasPrefix("Replaced" + SampleNote.welcomeAfterFirstLine),
            "Typing replaces exactly the selected first line")
        XCTAssertTrue(text.hasSuffix("Appended on another device"), "The remote edit stays")
        waitForValue(status, "synced")
    }

    func testNewNoteDrafts() {
        let app = openNotes()
        let newNote = app.buttons.matching(identifier: "new-note-button")
        let nameField = app.element("draft-name-field")

        hittable(newNote).tap()
        waitForFocus(nameField)
        nameField.typeText("Plans\n")
        let editor = self.editor(in: app)
        waitForFocus(editor)
        editor.typeText("Plans body")
        waitForValue(syncStatus(in: app), "synced")
        leaveNote(in: app)
        waitFor(note("Plans", in: app))

        hittable(newNote).tap()
        waitForFocus(nameField)
        focusEditor(in: app).typeText("Timestamped body")
        let timestamped = app.elements("tree-note")
            .matching(NSPredicate(format: "label MATCHES %@", "\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}.*"))
            .firstMatch
        waitForValue(syncStatus(in: app), "synced")
        leaveNote(in: app)
        waitFor(timestamped)

        let labelsBefore = sortedTreeNoteLabels(in: app)
        hittable(newNote).tap()
        waitForFocus(nameField)
        if isPad {
            openWelcome(in: app)
        } else {
            leaveNote(in: app)
        }
        waitUntilGone(nameField)
        XCTAssertEqual(sortedTreeNoteLabels(in: app), labelsBefore, "An untouched draft leaves no note")

        hittable(newNote).tap()
        waitForFocus(nameField)
        nameField.typeText("Welcome\n")
        waitFor(app.element("draft-name-error"))
    }

    func testNewFolder() {
        let app = openNotes()
        openFolderSheet(in: app)
        typeInto(app.element("new-folder-name-field"), "Recipes", in: app)
        app.buttons["new-folder-create-button"].tap()
        waitFor(folder("Recipes", in: app))
        waitUntilGone(app.element("new-folder-name-field"))

        openFolderSheet(in: app)
        typeInto(app.element("new-folder-name-field"), "Recipes", in: app)
        app.buttons["new-folder-create-button"].tap()
        waitFor(app.element("new-folder-error"))
        app.buttons["new-folder-cancel-button"].tap()
        waitUntilGone(app.element("new-folder-name-field"))
    }

    func testFailedSaveAndRetryNow() {
        let app = openNotes()
        openWelcome(in: app)
        runTestingAction("testing-fail-saves")
        typeAtEnd("Saved after retry", in: app)
        let status = syncStatus(in: app)
        waitForValue(status, "failed")

        let retry = openStatusMenuWithRetry(in: app)
        waitFor(app.element("sync-status-note-0"))
        retry.tap()
        waitForValue(status, "failed")

        // Each failed save doubles the back-off. After four failures the automatic retry waits
        // 40 s, so it cannot save before the manual retry once saves stop failing.
        for _ in 0..<2 {
            openStatusMenuWithRetry(in: app).tap()
            waitForValue(status, "failed")
        }

        runTestingAction("testing-stop-failing")
        openStatusMenuWithRetry(in: app).tap()
        waitForValue(status, "synced")
    }

    func testOfflineEditSavesWhenOnline() {
        let app = openNotes()
        openWelcome(in: app)
        runTestingAction("testing-offline")
        let status = syncStatus(in: app)
        waitForValue(status, "offline")
        typeAtEnd("Written offline", in: app)
        waitForUnsavedWhileOffline(in: app)

        runTestingAction("testing-offline")
        waitForValue(status, "synced")

        if isPad {
            openNote(SampleNote.other, startingWith: "# \(SampleNote.other)", in: app)
        } else {
            leaveNote(in: app)
        }
        waitForText(openWelcome(in: app), containing: "Written offline")
    }

    func testConflictKeepThisDevice() {
        let app = openNotes()
        makeConflict(in: app)
        let action = app.buttons["notice-action-button"]
        waitFor(action)
        XCTAssertEqual(action.label, "Open note")
        XCTAssertTrue(app.buttons["conflict-keep-other"].label.contains("Other iPhone"))

        app.buttons["conflict-keep-this"].tap()
        let editor = self.editor(in: app)
        waitForText(editor, startingWith: "Edited on this device")
        waitForValue(syncStatus(in: app), "synced")
        XCTAssertFalse(((editor.value as? String) ?? "").contains("Edited on another device"))
    }

    func testConflictKeepOtherDevice() {
        let app = openNotes()
        makeConflict(in: app)
        app.buttons["conflict-keep-other"].tap()
        let editor = self.editor(in: app)
        waitForText(editor, startingWith: "Edited on another device")
        waitForValue(syncStatus(in: app), "synced")
        XCTAssertFalse(((editor.value as? String) ?? "").contains("Edited on this device"))
    }

    func testConflictEditMerged() {
        let app = openNotes()
        makeConflict(in: app)
        app.buttons["conflict-edit-merged"].tap()
        waitFor(app.element("conflict-edit-hint"))
        let editor = self.editor(in: app)
        waitForText(editor, containing: "<<<<<<<")

        selectAllText(in: app)
        editor.typeText("Merged by hand")
        waitForValue(syncStatus(in: app), "synced")
        waitUntilGone(app.element("conflict-edit-hint"))
        XCTAssertEqual(editor.value as? String, "Merged by hand")
    }

    func testLogOutAnywayWithUnsavedChanges() {
        let app = openNotes()
        openWelcome(in: app)
        runTestingAction("testing-fail-saves")
        typeAtEnd("Never saved", in: app)
        tapLogOut(in: app)

        let alert = unsavedAlert(in: app)
        waitFor(alert, timeout: 30)
        alert.buttons["Log out anyway"].tap()
        waitFor(app.secureTextFields["login-token-field"])
    }

    func testLogOutKeepTryingThenSaved() {
        let app = openNotes()
        openWelcome(in: app)
        runTestingAction("testing-fail-saves")
        typeAtEnd("Saved before logout", in: app)
        tapLogOut(in: app)

        let alert = unsavedAlert(in: app)
        waitFor(alert, timeout: 30)
        alert.buttons["Keep trying"].tap()
        let cancel = alert.buttons["Cancel"]
        waitFor(cancel, timeout: 30)
        waitUntil(cancel, NSPredicate(format: "hittable == true"))
        cancel.tap()
        waitUntilGone(alert)

        runTestingAction("testing-stop-failing")
        tapLogOut(in: app)
        waitFor(app.secureTextFields["login-token-field"], timeout: 30)
        XCTAssertFalse(alert.exists)
    }

    func testKeyChangedExport() {
        let app = openNotes()
        changeKeyWithUnsavedEdit("Lost unless exported", in: app)
        let unsaved = app.staticTexts
            .matching(NSPredicate(format: "label CONTAINS %@", "1 note or folder was not saved")).firstMatch
        waitFor(unsaved)
        let export = app.buttons["key-changed-export-button"]
        waitFor(export)
        XCTAssertEqual(export.label, "Export unsaved notes")

        export.tap()
        dismissShareSheet(in: app)
        XCTAssertFalse(app.element("key-changed-export-error").exists)
    }

    private func sortedTreeNoteLabels(in app: XCUIApplication) -> [String] {
        app.elements("tree-note").allElementsBoundByIndex.map(\.label).sorted()
    }
}
