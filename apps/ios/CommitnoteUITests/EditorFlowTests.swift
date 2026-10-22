import XCTest

final class EditorFlowTests: XCTestCase {
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

    func testLivePreviewKeepsTextAndTogglesCheckbox() {
        let app = openNotes()
        let editor = openWelcome(in: app)
        let status = syncStatus(in: app)
        waitForValue(status, "synced")
        let text = (editor.value as? String) ?? ""
        XCTAssertTrue(text.hasPrefix("# Welcome\n\nThis is your **notes** repo"), "Markers stay in the text")
        XCTAssertTrue(text.contains("[commitnote project](https://github.com/example/commitnote)"))
        XCTAssertTrue(text.contains("- [x] Done task\n- [ ] Open task"))

        // Offline keeps the toggle unsaved until it is checked, however long the tap takes to settle.
        useTestingMenu("testing-offline", in: app)
        waitForValue(status, "offline")
        let checkbox = app.elements("editor-task-checkbox").firstMatch
        revealInEditor(checkbox, editor: editor)
        let task = checkbox.label.replacingOccurrences(of: "Task: ", with: "")
        let wasChecked = (checkbox.value as? String) == "checked"
        checkbox.tap()

        waitForValue(checkbox, wasChecked ? "unchecked" : "checked")
        XCTAssertFalse(hasKeyboardFocus(editor), "Tapping a checkbox leaves the editor unfocused")
        waitForText(editor, containing: (wasChecked ? "- [ ] " : "- [x] ") + task)
        waitUntil(status, NSPredicate(format: "label CONTAINS %@", "Changes will save when you're back online"))

        useTestingMenu("testing-offline", in: app)
        waitForValue(status, "synced")
        XCTAssertFalse(hasKeyboardFocus(editor))
    }

    func testFormatToolbarAndPasteLink() {
        let app = openNotes()
        let editor = openWelcome(in: app)
        typeAtEnd("\nword", in: app)
        waitUntil(editor, NSPredicate(format: "value ENDSWITH %@", "\nword"))

        editor.typeKey(.leftArrow, modifierFlags: [.shift, .option])
        waitForSelection(length: 4, in: app)
        hittable(app.buttons.matching(identifier: "format-bold")).tap()
        waitUntil(editor, NSPredicate(format: "value ENDSWITH %@", "\n**word**"))

        editor.typeKey("z", modifierFlags: .command)
        waitUntil(editor, NSPredicate(format: "value ENDSWITH %@", "\nword"))
        XCTAssertFalse(((editor.value as? String) ?? "").contains("**word**"), "One undo removes the bold markers")

        editor.typeKey(.downArrow, modifierFlags: .command)
        editor.typeText("\n")
        waitUntil(editor, NSPredicate(format: "value ENDSWITH %@", "\nword\n"))
        hittable(app.buttons.matching(identifier: "format-task")).tap()
        waitUntil(editor, NSPredicate(format: "value ENDSWITH %@", "\nword\n- [ ] "))

        editor.typeText("link")
        waitUntil(editor, NSPredicate(format: "value ENDSWITH %@", "- [ ] link"))
        editor.typeKey(.leftArrow, modifierFlags: [.shift, .option])
        waitForSelection(length: 4, in: app)
        hittable(app.buttons.matching(identifier: "format-link")).tap()
        waitUntil(editor, NSPredicate(format: "value ENDSWITH %@", "- [ ] [link]()"))

        editor.typeKey(.downArrow, modifierFlags: .command)
        editor.typeText("\n\npasted")
        waitUntil(editor, NSPredicate(format: "value ENDSWITH %@", "\n\npasted"))
        editor.typeKey(.leftArrow, modifierFlags: [.shift, .option])
        pasteText("https://example.com", into: editor)
        waitUntil(editor, NSPredicate(format: "value ENDSWITH %@", "\n\n[pasted](https://example.com)"))
        waitForValue(syncStatus(in: app), "synced")
    }

    func testLinkOpensSafari() {
        let app = openNotes()
        let editor = openWelcome(in: app)
        XCTAssertFalse(hasKeyboardFocus(editor))
        let link = app.elements("editor-link").firstMatch
        revealInEditor(link, editor: editor)
        link.tap()

        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 30), "The link opens in Safari")
        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 30))
        waitForText(self.editor(in: app), startingWith: SampleNote.welcomeFirstLine)
    }

    func testTitleRename() {
        let app = openNotes()
        openWelcome(in: app)
        renameOpenNote("Welcome renamed", in: app)
        waitForValue(app.textFields["note-title-field"], "Welcome renamed")
        XCTAssertFalse(app.element("note-name-error").exists)
        backToTree(in: app)
        waitFor(note("Welcome renamed", in: app))
        XCTAssertFalse(note(SampleNote.welcome, in: app).exists)

        setFolder("Projects", expanded: true, in: app)
        setFolder("commitnote", expanded: true, in: app)
        openNote("Ideas", startingWith: "# Ideas", in: app)
        renameOpenNote("Roadmap", in: app)
        let error = app.element("note-name-error")
        waitFor(error)
        XCTAssertEqual(error.label, "A note or folder with this name already exists here.")

        renameOpenNote("Ideas/2026", in: app)
        waitUntil(error, NSPredicate(format: "label == %@", "Names can't contain “/”."))
        backToTree(in: app)
        waitFor(note("Ideas", in: app))
    }

    /// XCUITest can only focus the editor with a tap, which moves the caret, so typing proves the
    /// restored caret only where the editor keeps its focus across the note switch; the restored
    /// scroll position is checked on every device.
    func testCaretRestore() {
        let app = openNotes()
        let editor = openWelcome(in: app)
        focusEditor(in: app)
        editor.typeKey(.upArrow, modifierFlags: .command)
        editor.typeKey(.upArrow, modifierFlags: .command)
        editor.typeKey(.rightArrow, modifierFlags: .command)
        let anchor = app.elements("editor-task-checkbox").firstMatch
        let anchorY = revealSettled(anchor, editor: editor)

        if isPad {
            openNote(SampleNote.other, startingWith: "# \(SampleNote.other)", in: app)
            openWelcome(in: app)
            waitFor(anchor)
            XCTAssertEqual(stayingMinY(of: anchor), anchorY, accuracy: 2, "The scroll position is restored")
        } else {
            // Leaving the note closes the keyboard, so the offset scrolled to above it comes back
            // clamped to what the note can scroll without the keyboard; that one must then stay put.
            switchAwayAndBack(in: app)
            waitFor(anchor)
            let clampedY = stayingMinY(of: anchor)
            XCTAssertGreaterThanOrEqual(clampedY, anchorY - 2, "The note does not scroll past its end")
            switchAwayAndBack(in: app)
            waitFor(anchor)
            XCTAssertEqual(stayingMinY(of: anchor), clampedY, accuracy: 2, "The scroll position is restored")
        }
        if hasKeyboardFocus(editor) {
            editor.typeText("!")
            waitForText(editor, startingWith: SampleNote.welcomeFirstLine + "!\n")
        }
    }

    /// Hardware key presses make the simulator hide and show the software keyboard for a while,
    /// and each keyboard change scrolls the caret back into view, so the element is revealed again
    /// until it stays put.
    private func revealSettled(_ element: XCUIElement, editor: XCUIElement) -> CGFloat {
        for _ in 0..<3 {
            revealInEditor(element, editor: editor)
            if let y = settledMinY(of: element) { return y }
        }
        XCTFail("The element does not stay visible")
        return 0
    }

    private func stayingMinY(of element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) -> CGFloat {
        guard let y = settledMinY(of: element, file: file, line: line) else {
            XCTFail("The element scrolled out of view", file: file, line: line)
            return 0
        }
        return y
    }

    /// The element's top once it has stopped moving, or nil when it scrolled out of view.
    private func settledMinY(
        of element: XCUIElement, file: StaticString = #filePath, line: UInt = #line
    ) -> CGFloat? {
        var last = element.exists ? element.frame.minY : 0
        var stableSince = Date()
        var gone = false
        waitForCondition("The editor stops scrolling", file: file, line: line) {
            guard element.exists else {
                gone = true
                return true
            }
            let current = element.frame.minY
            if abs(current - last) > 0.5 {
                last = current
                stableSince = Date()
            }
            return Date().timeIntervalSince(stableSince) >= 2
        }
        return gone ? nil : last
    }

    private func switchAwayAndBack(in app: XCUIApplication) {
        backToTree(in: app)
        openNote(SampleNote.other, startingWith: "# \(SampleNote.other)", in: app)
        backToTree(in: app)
        openWelcome(in: app)
    }

    func testInlineImages() {
        let app = openNotes()
        setFolder("Journal", expanded: true, in: app)
        setFolder("2026", expanded: true, in: app)
        let editor = openNote("Whiteboard", startingWith: "Sketch from the planning session.", in: app)
        let images = app.elements("editor-image")
        waitForValue(images.firstMatch, "loaded")
        XCTAssertEqual(images.count, 1)

        let reference = "![](image:aaaaaaaaaaaaaaaaaaaaaaaaaa#10x10)"
        typeAtEnd("\n", in: app)
        pasteText(reference, into: editor)
        waitForText(editor, containing: reference)
        let unavailable = images.matching(NSPredicate(format: "value == %@", "unavailable")).firstMatch
        waitFor(unavailable)
        XCTAssertEqual(unavailable.label, "Image")
        XCTAssertEqual(images.count, 2)
        XCTAssertEqual(images.matching(NSPredicate(format: "value == %@", "loaded")).count, 1)
    }
}
