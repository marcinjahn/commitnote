import XCTest

final class IPadFlowTests: XCTestCase {
    private static var loggedIn = false

    override func setUp() {
        continueAfterFailure = false
    }

    private func openNotes() throws -> XCUIApplication {
        try XCTSkipUnless(isPad, "iPad stories")
        let app: XCUIApplication
        if Self.loggedIn {
            app = resumeAtTree(editorHooks: true)
        } else {
            app = launchApp(reset: true, editorHooks: true)
            logInToNotes(in: app)
            Self.loggedIn = true
        }
        switchWidth(to: "system", in: app)
        return app
    }

    func testAMenuShortcuts() throws {
        let app = try openNotes()
        let nameField = app.element("draft-name-field")

        pressShortcut("n", until: { nameField.exists })
        waitForFocus(nameField)
        openWelcome(in: app)
        waitUntilGone(nameField)

        pressShortcut("f", until: { self.isSearchActive(in: app) })
        cancelSearch(in: app)

        XCTAssertFalse(hasKeyboardFocus(editor(in: app)))
        pressShortcut("k", until: { self.isSearchActive(in: app) })
        cancelSearch(in: app)
    }

    func testBFormatShortcuts() throws {
        let app = try openNotes()
        let editor = createScratchNote("Shortcut scratch", in: app)

        formatNewWord("Alpha", after: "", key: "b", giving: "**Alpha**", in: app)
        formatNewWord("beta", after: " ", key: "i", giving: "**Alpha** *beta*", in: app)
        formatNewWord(
            "gamma", after: " ", key: "x", modifiers: [.command, .shift], giving: " *beta* ~~gamma~~", in: app)
        formatNewWord("delta", after: " ", key: "k", giving: " ~~gamma~~ [delta]()", in: app)

        if !hasKeyboardFocus(editor) {
            focusEditor(in: app)
        }
        moveCaretToEnd(in: app)
        editor.typeText("\nList")
        waitUntil(editor, NSPredicate(format: "value ENDSWITH %@", "[delta]()\nList"))
        // Return goes as "\n", as typeText sends it; a "\r" press leaves the editor unchanged.
        pressShortcut("\n", until: { self.editorText(in: app).hasSuffix("\n- [ ] List") })

        if !hasKeyboardFocus(editor) {
            focusEditor(in: app)
        }
        pressShortcut("f", until: { self.isSearchActive(in: app) })
        XCTAssertTrue(editor.exists, "The note stays open beside the search")
        cancelSearch(in: app)

        let status = syncStatus(in: app)
        pressShortcut("s", until: { status.exists && (status.value as? String) == "synced" })
        waitForSaved(in: app)
        XCTAssertEqual(editorText(in: app), "**Alpha** *beta* ~~gamma~~ [delta]()\n- [ ] List")
    }

    func testCTypeToStart() throws {
        let app = try openNotes()
        let state = app.element("testing-type-to-start")
        let editor = self.editor(in: app)
        let nameField = app.element("draft-name-field")
        showNotePlaceholder(in: app)

        waitForTypeToStartReady(in: app)
        typeKeys("Hi", until: { editor.exists && (editor.value as? String) == "Hi" })
        waitUntilGone(app.element("note-placeholder"))
        showNotePlaceholder(in: app)

        setTypeToStart(false, in: app)
        waitForValue(state, "idle")
        for character in "No" {
            app.typeKey(String(character), modifierFlags: [])
        }
        XCTAssertFalse(
            poll(timeout: 3) { editor.exists || nameField.exists }, "Typing starts no note while type-to-start is off")
        XCTAssertTrue(app.element("note-placeholder").exists)

        setTypeToStart(true, in: app)
        waitForTypeToStartReady(in: app)
    }

    func testDWidthSwitch() throws {
        let app = try openNotes()
        openWelcome(in: app)
        focusEditor(in: app)
        moveCaretToEnd(in: app)
        hittable(app.buttons.matching(identifier: "testing-select-word")).tap()
        var selection = "0"
        waitForCondition("The last word is selected") {
            selection = self.selectionLength(in: app) ?? "0"
            return selection != "0"
        }
        let text = editorText(in: app)

        switchWidth(to: "compact", in: app)
        waitFor(app.navigationBars.buttons["BackButton"])
        waitForSameNote(SampleNote.welcome, text: text, selection: selection, in: app)
        switchWidth(to: "regular", in: app)
        waitFor(app.element("notes-tree"))
        waitForSameNote(SampleNote.welcome, text: text, selection: selection, in: app)

        hittable(app.buttons.matching(identifier: "new-note-button")).tap()
        let nameField = app.textFields["draft-name-field"]
        waitForFocus(nameField)
        nameField.typeText("Width draft")
        waitForValue(nameField, "Width draft")
        switchWidth(to: "compact", in: app)
        waitFor(app.navigationBars.buttons["BackButton"])
        waitForValue(nameField, "Width draft")
        switchWidth(to: "regular", in: app)
        waitFor(app.element("notes-tree"))
        waitForValue(nameField, "Width draft")

        showNotePlaceholder(in: app)
        let field = app.searchFields.firstMatch
        typeInto(field, "Roadmap", in: app)
        let roadmap = app.elements("search-name-row").matching(NSPredicate(format: "label CONTAINS %@", "Roadmap"))
            .firstMatch
        waitFor(roadmap, timeout: 30)
        // An active search hides the compact navigation bar and with it the Testing menu, so the
        // search ends there before the width goes back.
        switchWidth(to: "compact", in: app)
        waitUntilGone(app.element("note-placeholder"))
        waitForCondition("Search stays active in the compact layout") { self.isSearchActive(in: app) }
        waitForValue(app.searchFields.firstMatch, "Roadmap")
        waitFor(roadmap)
        cancelSearch(in: app)
        switchWidth(to: "system", in: app)
        waitFor(app.element("note-placeholder"))
    }
}
