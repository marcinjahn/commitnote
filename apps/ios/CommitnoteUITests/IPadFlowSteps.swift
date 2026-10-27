import XCTest

extension XCTestCase {
    func isSearchActive(in app: XCUIApplication) -> Bool {
        app.element("search-results").exists
    }

    /// Where the search bar offers no Cancel or close button, Escape in its field ends the search; a field
    /// that lost its focus is tapped first so the key reaches it.
    func cancelSearch(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let results = app.element("search-results")
        let cancel = app.buttons.matching(
            NSPredicate(format: "label IN %@ OR identifier == %@", ["Cancel", "Close"], "search-close"))
        let field = app.searchFields.firstMatch
        for attempt in 0..<3 where results.exists {
            if attempt > 0, field.exists, field.isHittable, !hasKeyboardFocus(field) {
                field.tap()
                poll(timeout: 5) { self.hasKeyboardFocus(field) }
            }
            if let button = cancel.allElementsBoundByIndex.first(where: { $0.exists && $0.isHittable }) {
                button.tap()
            } else {
                app.typeKey(.escape, modifierFlags: [])
            }
            if poll(timeout: 10, until: { !results.exists }) { break }
        }
        waitUntilGone(results, file: file, line: line)
    }

    /// The regular layout has no way to close a note, so the compact one is forced to go back to
    /// the tree, which leaves the placeholder once the system width returns.
    func showNotePlaceholder(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let placeholder = app.element("note-placeholder")
        if placeholder.exists { return }
        switchWidth(to: "compact", in: app, file: file, line: line)
        let noteView = app.element("note-view")
        let back = app.navigationBars.buttons["BackButton"]
        if appears(noteView, within: 10) {
            waitFor(back, file: file, line: line)
            for _ in 0..<3 where noteView.exists {
                if back.exists, back.isHittable {
                    back.tap()
                }
                if poll(timeout: 10, until: { !noteView.exists }) { break }
            }
            waitUntilGone(noteView, file: file, line: line)
        }
        waitFor(app.element("notes-tree"), file: file, line: line)
        switchWidth(to: "system", in: app, file: file, line: line)
        waitFor(placeholder, file: file, line: line)
    }

    @discardableResult
    func createScratchNote(
        _ name: String, in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line
    ) -> XCUIElement {
        hittable(app.buttons.matching(identifier: "new-note-button"), file: file, line: line).tap()
        let nameField = app.element("draft-name-field")
        waitForFocus(nameField, file: file, line: line)
        nameField.typeText(name + "\n")
        waitForValue(app.textFields["note-title-field"], name, file: file, line: line)
        let editor = self.editor(in: app)
        waitForFocus(editor, file: file, line: line)
        return editor
    }

    func editorText(in app: XCUIApplication) -> String {
        (editor(in: app).value as? String) ?? ""
    }

    /// Types `word` at the end of the note, selects it through the hook, and formats it with the
    /// shortcut until the text ends with `formatted`.
    func formatNewWord(
        _ word: String, after separator: String, key: String,
        modifiers: XCUIElement.KeyModifierFlags = .command, giving formatted: String, in app: XCUIApplication,
        file: StaticString = #filePath, line: UInt = #line
    ) {
        let editor = self.editor(in: app)
        if !hasKeyboardFocus(editor) {
            focusEditor(in: app, file: file, line: line)
        }
        moveCaretToEnd(in: app, file: file, line: line)
        editor.typeText(separator + word)
        waitUntil(editor, NSPredicate(format: "value ENDSWITH %@", separator + word), file: file, line: line)
        hittable(app.buttons.matching(identifier: "testing-select-word"), file: file, line: line).tap()
        waitForSelection(length: word.utf16.count, in: app, file: file, line: line)
        pressShortcut(
            key, modifiers: modifiers, until: { self.editorText(in: app).hasSuffix(formatted) }, file: file,
            line: line)
    }

    func selectionLength(in app: XCUIApplication) -> String? {
        let selection = app.element("testing-editor-selection")
        return selection.exists ? selection.value as? String : nil
    }

    /// The open note after a width switch: same name, same text and the selection it had.
    func waitForSameNote(
        _ name: String, text: String, selection: String, in app: XCUIApplication,
        file: StaticString = #filePath, line: UInt = #line
    ) {
        waitFor(app.element("note-view"), timeout: 30, file: file, line: line)
        waitForValue(app.textFields["note-title-field"], name, file: file, line: line)
        waitForCondition("The note keeps its text", file: file, line: line) {
            self.editorText(in: app) == text
        }
        waitForCondition("The note keeps its selection", file: file, line: line) {
            self.selectionLength(in: app) == selection
        }
    }

    func setTypeToStart(_ on: Bool, in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        openSettings(in: app, file: file, line: line)
        setToggle("settings-type-to-start", on: on, in: app, file: file, line: line)
        closeSettings(in: app, file: file, line: line)
    }
}
