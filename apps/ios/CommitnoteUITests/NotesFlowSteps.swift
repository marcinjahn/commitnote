import XCTest

enum SampleNote {
    static let welcome = "Welcome"
    static let welcomeFirstLine = "# Welcome"
    static let welcomeAfterFirstLine = "\n\nThis is your **notes** repo"
    static let other = "Zażółć gęślą jaźń"
}

extension XCTestCase {
    func resumeNotes(appearance: Appearance = .light) -> XCUIApplication {
        resumeAtTree(appearance: appearance)
    }

    func waitUntil(
        _ element: XCUIElement, _ predicate: NSPredicate, timeout: TimeInterval = 30,
        file: StaticString = #filePath, line: UInt = #line
    ) {
        let expectation = XCTNSPredicateExpectation(predicate: predicate, object: element)
        XCTAssertEqual(
            XCTWaiter().wait(for: [expectation], timeout: timeout), .completed,
            "Expected \(element) to match \(predicate.predicateFormat)", file: file, line: line)
    }

    func waitForValue(
        _ element: XCUIElement, _ value: String, timeout: TimeInterval = 30,
        file: StaticString = #filePath, line: UInt = #line
    ) {
        waitFor(element, file: file, line: line)
        waitUntil(element, NSPredicate(format: "value == %@", value), timeout: timeout, file: file, line: line)
    }

    func waitForText(
        _ editor: XCUIElement, containing text: String, file: StaticString = #filePath, line: UInt = #line
    ) {
        waitFor(editor, file: file, line: line)
        waitUntil(editor, NSPredicate(format: "value CONTAINS %@", text), file: file, line: line)
    }

    func waitForText(
        _ editor: XCUIElement, startingWith text: String, timeout: TimeInterval? = nil,
        file: StaticString = #filePath, line: UInt = #line
    ) {
        waitFor(editor, timeout: timeout ?? 20, file: file, line: line)
        waitUntil(
            editor, NSPredicate(format: "value BEGINSWITH %@", text), timeout: timeout ?? 30, file: file, line: line)
    }

    /// On a slow simulator a single focus check can take several seconds, and focus the app moves
    /// itself, as from a draft's name to its editor, follows a save.
    func waitForFocus(
        _ element: XCUIElement, timeout: TimeInterval = 30, file: StaticString = #filePath, line: UInt = #line
    ) {
        waitFor(element, file: file, line: line)
        waitUntil(
            element, NSPredicate(format: "hasKeyboardFocus == true"), timeout: timeout, file: file, line: line)
    }

    func waitUntilGone(
        _ element: XCUIElement, timeout: TimeInterval = 20, file: StaticString = #filePath, line: UInt = #line
    ) {
        waitUntil(element, NSPredicate(format: "exists == false"), timeout: timeout, file: file, line: line)
    }

    func hittable(_ query: XCUIElementQuery, file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        waitFor(query.firstMatch, file: file, line: line)
        var found: XCUIElement?
        poll(timeout: 10) {
            found = query.allElementsBoundByIndex.first { $0.exists && $0.isHittable }
            return found != nil
        }
        return found ?? query.firstMatch
    }

    func syncStatus(in app: XCUIApplication) -> XCUIElement {
        app.element("sync-status-button")
    }

    func editor(in app: XCUIApplication) -> XCUIElement {
        app.element("note-editor")
    }

    func useTestingMenu(_ item: String, in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let button = app.buttons[item]
        // A tap while another menu is still closing finds no hit point and opens nothing.
        for _ in 0..<3 {
            hittable(app.buttons.matching(identifier: "testing-menu"), file: file, line: line).tap()
            if appears(button, within: 5) { break }
        }
        waitFor(button, file: file, line: line)
        button.tap()
        waitUntilGone(button, file: file, line: line)
    }

    func openStatusMenu(in app: XCUIApplication) {
        hittable(app.elements("sync-status-button")).tap()
    }

    func openStatusMenuWithRetry(
        in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line
    ) -> XCUIElement {
        let retry = app.buttons["sync-status-retry"]
        for _ in 0..<3 {
            openStatusMenu(in: app)
            if appears(retry, within: 5) { break }
        }
        waitFor(retry, file: file, line: line)
        return retry
    }

    @discardableResult
    func openNote(
        _ name: String, startingWith firstLine: String, in app: XCUIApplication,
        file: StaticString = #filePath, line: UInt = #line
    ) -> XCUIElement {
        let row = note(name, in: app)
        tapRevealed(row, in: app)
        let editor = self.editor(in: app)
        // A tap that lands while the tree redraws, as right after a sync, opens nothing.
        if !poll(timeout: 10, until: { (editor.value as? String)?.hasPrefix(firstLine) == true }), row.exists {
            tapRevealed(row, in: app)
        }
        waitForText(editor, startingWith: firstLine, file: file, line: line)
        return editor
    }

    @discardableResult
    func openWelcome(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        openNote(SampleNote.welcome, startingWith: SampleNote.welcomeFirstLine, in: app, file: file, line: line)
    }

    func leaveNote(in app: XCUIApplication) {
        guard !isPad else { return }
        let back = app.navigationBars.buttons["BackButton"]
        if back.exists {
            back.tap()
        }
        waitFor(app.element("notes-tree"))
        waitFor(note(SampleNote.welcome, in: app))
    }

    @discardableResult
    func focusEditor(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        let editor = self.editor(in: app)
        waitFor(editor, file: file, line: line)
        // A tap that lands while the editor is still being set up does not focus it.
        for _ in 0..<2 where !hasKeyboardFocus(editor) {
            editor.tap()
            if poll(timeout: 15, until: { self.hasKeyboardFocus(editor) }) { break }
        }
        waitForFocus(editor, file: file, line: line)
        // Key events sent while the keyboard is still sliding in can time out in XCTest.
        let keyboard = app.keyboards.firstMatch
        if keyboard.exists {
            waitUntilSettled(keyboard, file: file, line: line)
        }
        return editor
    }

    func typeAtEnd(_ text: String, in app: XCUIApplication) {
        var editor = focusEditor(in: app)
        moveCaret(.downArrow, in: editor)
        if !hasKeyboardFocus(editor) {
            editor = focusEditor(in: app)
            moveCaret(.downArrow, in: editor)
        }
        editor.typeText(text)
    }

    @discardableResult
    func selectFirstLine(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        let selection = app.element("testing-editor-selection")
        for _ in 0..<3 {
            let editor = focusEditor(in: app, file: file, line: line)
            moveCaret(.upArrow, in: editor)
            editor.typeKey(.rightArrow, modifierFlags: [.command, .shift])
            // A dropped key can leave the caret in place, so the selection length must match the first line.
            let selected = poll(timeout: 20) {
                let text = (editor.value as? String) ?? ""
                let firstLine = text.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false)
                    .first.map(String.init) ?? ""
                return selection.exists && (selection.value as? String) == "\(firstLine.utf16.count)"
                    && self.hasKeyboardFocus(editor)
            }
            if selected { return editor }
        }
        XCTFail("Expected the editor to select its first line", file: file, line: line)
        return editor(in: app)
    }

    func replaceFirstLine(with text: String, in app: XCUIApplication) {
        selectFirstLine(in: app).typeText(text)
    }

    /// The simulator drops hardware keys for a moment after a tap brings up the keyboard, so the
    /// idempotent move to the start or end of the text is sent three times.
    private func moveCaret(_ key: XCUIKeyboardKey, in editor: XCUIElement) {
        for _ in 0..<3 {
            editor.typeKey(key, modifierFlags: .command)
        }
    }

    /// Leaves an unsaved edit of Welcome behind a passphrase change made on another device. Going
    /// offline first keeps any refresh from noticing the change before the edit exists.
    func changeKeyWithUnsavedEdit(_ text: String, in app: XCUIApplication) {
        openWelcome(in: app)
        useTestingMenu("testing-offline", in: app)
        waitForValue(syncStatus(in: app), "offline")
        typeAtEnd(text, in: app)
        useTestingMenu("testing-change-key", in: app)
        useTestingMenu("testing-offline", in: app)
        waitFor(app.element("key-changed-screen"), timeout: 30)
    }

    func openFolderSheet(in app: XCUIApplication) {
        hittable(app.buttons.matching(identifier: "notes-menu-button")).tap()
        let button = app.buttons["new-folder-button"]
        waitFor(button)
        button.tap()
        waitFor(app.element("new-folder-name-field"))
    }

    func tapLogOut(in app: XCUIApplication) {
        leaveNote(in: app)
        hittable(app.buttons.matching(identifier: "notes-menu-button")).tap()
        let logOut = app.buttons["log-out-button"]
        waitFor(logOut)
        logOut.tap()
    }

    func unsavedAlert(in app: XCUIApplication) -> XCUIElement {
        app.alerts["Some changes are not saved"]
    }

    /// Leaves Welcome with a conflict between "Edited on this device" and the remote
    /// "Edited on another device" first line, showing the conflict view. Offline keeps a refresh
    /// from pulling the remote edit into the editor before the local edit is made.
    func makeConflict(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        openWelcome(in: app, file: file, line: line)
        useTestingMenu("testing-offline", in: app, file: file, line: line)
        waitForValue(syncStatus(in: app), "offline", file: file, line: line)
        useTestingMenu("testing-remote-edit", in: app, file: file, line: line)
        replaceFirstLine(with: "Edited on this device", in: app)
        useTestingMenu("testing-offline", in: app, file: file, line: line)
        waitFor(app.element("conflict-view"), timeout: 30, file: file, line: line)
        waitForValue(syncStatus(in: app), "conflict", file: file, line: line)
    }

    /// A dismissal that lands while the sheet is still coming up is ignored, so it is repeated.
    func dismissShareSheet(in app: XCUIApplication) {
        let sheet = app.element("ActivityListView")
        waitFor(sheet)
        waitUntilSettled(sheet)
        let dismissRegion = app.element("PopoverDismissRegion")
        let close = app.buttons["Close"]
        for _ in 0..<3 where sheet.exists {
            if dismissRegion.exists {
                dismissRegion.tap()
            } else if appears(close, within: 5), close.isHittable {
                close.tap()
            } else {
                sheet.swipeDown(velocity: .fast)
            }
            if poll(timeout: 5, until: { !sheet.exists }) { break }
        }
        waitUntilGone(sheet)
    }
}
