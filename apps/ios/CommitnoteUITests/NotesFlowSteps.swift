import XCTest

enum SampleNote {
    static let welcome = "Welcome"
    static let welcomeFirstLine = "# Welcome"
    static let welcomeAfterFirstLine = "\n\nThis is your **notes** repo"
    static let other = "Zażółć gęślą jaźń"
}

extension XCTestCase {
    func resumeNotes(appearance: Appearance = .light) -> XCUIApplication {
        let app = launchApp(reset: false, appearance: appearance)
        let tree = app.element("notes-tree")
        let tokenField = app.secureTextFields["login-token-field"]
        let ready = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in tree.exists || tokenField.exists }, object: nil)
        XCTAssertEqual(XCTWaiter().wait(for: [ready], timeout: 30), .completed, "Notes or login screen appears")
        if !tree.exists {
            logInToNotes(in: app)
        }
        return app
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
        _ editor: XCUIElement, startingWith text: String, file: StaticString = #filePath, line: UInt = #line
    ) {
        waitFor(editor, file: file, line: line)
        waitUntil(editor, NSPredicate(format: "value BEGINSWITH %@", text), file: file, line: line)
    }

    func waitForFocus(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        waitFor(element, file: file, line: line)
        waitUntil(element, NSPredicate(format: "hasKeyboardFocus == true"), timeout: 10, file: file, line: line)
    }

    func waitUntilGone(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        waitUntil(element, NSPredicate(format: "exists == false"), timeout: 20, file: file, line: line)
    }

    func hittable(_ query: XCUIElementQuery, file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        waitFor(query.firstMatch, file: file, line: line)
        return query.allElementsBoundByIndex.first { $0.exists && $0.isHittable } ?? query.firstMatch
    }

    func syncStatus(in app: XCUIApplication) -> XCUIElement {
        app.element("sync-status-button")
    }

    func editor(in app: XCUIApplication) -> XCUIElement {
        app.element("note-editor")
    }

    func useTestingMenu(_ item: String, in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        hittable(app.buttons.matching(identifier: "testing-menu"), file: file, line: line).tap()
        let button = app.buttons[item]
        waitFor(button, file: file, line: line)
        button.tap()
        waitUntilGone(button, file: file, line: line)
    }

    func openStatusMenu(in app: XCUIApplication) {
        hittable(app.elements("sync-status-button")).tap()
    }

    @discardableResult
    func openNote(
        _ name: String, startingWith firstLine: String, in app: XCUIApplication,
        file: StaticString = #filePath, line: UInt = #line
    ) -> XCUIElement {
        tapRevealed(note(name, in: app), in: app)
        let editor = self.editor(in: app)
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
        if !((editor.value(forKey: "hasKeyboardFocus") as? Bool) ?? false) {
            editor.tap()
        }
        waitForFocus(editor, file: file, line: line)
        return editor
    }

    func typeAtEnd(_ text: String, in app: XCUIApplication) {
        let editor = focusEditor(in: app)
        moveCaret(.downArrow, in: editor)
        editor.typeText(text)
    }

    @discardableResult
    func selectFirstLine(in app: XCUIApplication) -> XCUIElement {
        let editor = focusEditor(in: app)
        moveCaret(.upArrow, in: editor)
        editor.typeKey(.rightArrow, modifierFlags: [.command, .shift])
        return editor
    }

    func replaceFirstLine(with text: String, in app: XCUIApplication) {
        selectFirstLine(in: app).typeText(text)
    }

    /// The simulator drops the first hardware key after a tap brings up the keyboard, so the
    /// idempotent move to the start or end of the text is sent twice.
    private func moveCaret(_ key: XCUIKeyboardKey, in editor: XCUIElement) {
        editor.typeKey(key, modifierFlags: .command)
        editor.typeKey(key, modifierFlags: .command)
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

    func dismissShareSheet(in app: XCUIApplication) {
        let sheet = app.element("ActivityListView")
        waitFor(sheet)
        let dismissRegion = app.element("PopoverDismissRegion")
        let close = app.buttons["Close"]
        if dismissRegion.exists {
            dismissRegion.tap()
        } else if close.waitForExistence(timeout: 5), close.isHittable {
            close.tap()
        } else {
            sheet.swipeDown(velocity: .fast)
        }
        waitUntilGone(sheet)
    }
}
