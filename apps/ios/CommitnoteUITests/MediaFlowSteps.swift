import UIKit
import XCTest

enum MediaSample {
    static let imageId = "s4u5q5zr4xaec3jewbaixgwlou"
    static let imageReference = "![](image:s4u5q5zr4xaec3jewbaixgwlou#64x48)"
    static let whiteboard = "Whiteboard"
    static let whiteboardFirstLine = "Sketch from the planning session."
    static let welcomeBody = "This is your **notes** repo"
    static let linkPrefix = "https://commitnote.eu/app/#share=1.gh."
}

extension XCTestCase {
    /// SwiftUI menu items are matched by label as well, since UIKit does not always carry their
    /// identifiers over; the editor's own Insert image toolbar button shares a label with the menu's.
    func menuItems(_ identifier: String, label: String, in app: XCUIApplication) -> XCUIElementQuery {
        app.buttons.matching(
            NSPredicate(
                format: "(identifier == %@ OR label == %@) AND identifier != %@", identifier, label, "format-image"))
    }

    /// A tap that lands while another menu or sheet is still closing opens nothing, so the button
    /// is tapped again. Call it inside `whileMenuIsOpen`.
    func openMenu(
        _ button: XCUIElementQuery, expecting identifier: String, label: String, in app: XCUIApplication,
        file: StaticString = #filePath, line: UInt = #line
    ) {
        let items = menuItems(identifier, label: label, in: app)
        for _ in 0..<3 {
            waitFullyBeforeNextMenuEvent()
            hittable(button, file: file, line: line).tap()
            if appears(items.firstMatch, within: 5) { return }
        }
        XCTFail("No menu with \(label)", file: file, line: line)
    }

    /// A menu item tap is sometimes ignored while the menu stays open, so it is tapped again; an
    /// item that is gone by then counts as chosen unless `chosen` says otherwise.
    func tapMenuItem(
        _ identifier: String, label: String, in app: XCUIApplication, until chosen: (() -> Bool)? = nil,
        file: StaticString = #filePath, line: UInt = #line
    ) {
        let items = menuItems(identifier, label: label, in: app)
        for _ in 0..<3 {
            let item = hittable(items, file: file, line: line)
            item.tap()
            let condition: () -> Bool = chosen ?? { !item.exists }
            if poll(timeout: 10, until: condition) { return }
            if !items.firstMatch.exists { break }
        }
        XCTFail("The menu ignores \(label)", file: file, line: line)
    }

    func chooseNoteAction(
        _ identifier: String, label: String, in app: XCUIApplication,
        file: StaticString = #filePath, line: UInt = #line
    ) {
        whileMenuIsOpen {
            openMenu(
                app.buttons.matching(identifier: "note-actions-menu"), expecting: identifier, label: label, in: app,
                file: file, line: line)
            tapMenuItem(identifier, label: label, in: app, file: file, line: line)
        }
    }

    func chooseShareAction(
        _ action: String, label: String, on row: XCUIElement, in app: XCUIApplication,
        until chosen: (() -> Bool)? = nil, file: StaticString = #filePath, line: UInt = #line
    ) {
        let identifier = "share-action-\(action)"
        waitFor(row, file: file, line: line)
        whileMenuIsOpen {
            openMenu(
                row.descendants(matching: .any).matching(identifier: "share-row-menu"), expecting: identifier,
                label: label, in: app, file: file, line: line)
            tapMenuItem(identifier, label: label, in: app, until: chosen, file: file, line: line)
        }
    }

    /// A tap on the backdrop closes a menu, but on a busy runner it can reach the view below. The
    /// editor there would bring up a keyboard that takes the next taps as key presses, so the tap
    /// goes to the start of the note's details line, plain text left of the menu.
    func closeMenu(showing item: XCUIElement, in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let editor = app.element("note-editor")
        let text = editor.exists ? editor.value as? String : nil
        let details = app.element("note-details")
        waitFor(details, file: file, line: line)
        let backdrop = details.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0.5)).withOffset(CGVector(dx: 4, dy: 0))
        XCTAssertFalse(item.frame.contains(backdrop.screenPoint), "The menu covers the details line", file: file, line: line)
        for _ in 0..<3 where item.exists {
            backdrop.tap()
            poll(timeout: 5) { !item.exists }
        }
        waitUntilGone(item, file: file, line: line)
        if let text {
            XCTAssertEqual(editor.value as? String, text, "Closing the menu changed the note", file: file, line: line)
        }
    }

    /// Pastes `text` at the end of the open note as one edit, so an autosave never holds part of it.
    /// The caret is moved through the editor hooks, so the app must run with them.
    @discardableResult
    func pasteAtEnd(_ text: String, in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line)
        -> XCUIElement
    {
        let pasted = NSPredicate(format: "value CONTAINS %@", text)
        var editor = focusEditor(in: app, file: file, line: line)
        for attempt in 0..<4 {
            // After a menu closes the simulator can drop every ⌘V until the editor is focused anew.
            if attempt > 0 {
                hideKeyboardThroughHooks(in: app, file: file, line: line)
            }
            editor = focusEditor(in: app, file: file, line: line)
            moveCaretToEnd(in: app, file: file, line: line)
            pasteText(text, into: editor)
            if poll(timeout: 10, until: { pasted.evaluate(with: editor) }) { break }
        }
        waitUntil(editor, pasted, file: file, line: line)
        return editor
    }

    /// The editor hides its keyboard when dragged down; iPad keyboards also offer a key for it.
    func dismissKeyboard(over editor: XCUIElement, in app: XCUIApplication) {
        let keyboard = app.keyboards.firstMatch
        for _ in 0..<3 where keyboard.exists {
            let hide = keyboard.buttons["Hide keyboard"]
            if hide.exists, hide.isHittable {
                hide.tap()
            } else {
                editor.swipeDown(velocity: .fast)
            }
            poll(timeout: 5) { !keyboard.exists }
        }
    }

    func hideKeyboardThroughHooks(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        hittable(app.buttons.matching(identifier: "testing-hide-keyboard"), file: file, line: line).tap()
        waitUntilGone(app.keyboards.firstMatch, file: file, line: line)
    }

    func moveCaretToEnd(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        hittable(app.buttons.matching(identifier: "testing-caret-end"), file: file, line: line).tap()
    }

    /// The edit is in the editor's text before the app marks it pending, so the pending state is
    /// looked for first; a save that is already through by then is fine. A save carrying a large
    /// image can take most of a minute on a busy CI simulator.
    func waitForSaved(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let status = syncStatus(in: app)
        waitFor(status, file: file, line: line)
        poll(timeout: 5) { (status.value as? String) != "synced" }
        waitForValue(status, "synced", timeout: 90, file: file, line: line)
    }

    /// One element per version row, top to bottom, should a row's parts carry its identifier too.
    func historyRows(in app: XCUIApplication) -> [XCUIElement] {
        let matches = app.elements("history-version").allElementsBoundByIndex
            .filter { $0.exists }
            .map { (element: $0, frame: $0.frame) }
            .filter { !$0.frame.isEmpty }
        var rows: [(element: XCUIElement, frame: CGRect)] = []
        for match in matches
        where !matches.contains(where: { $0.frame != match.frame && $0.frame.contains(match.frame) })
            && !rows.contains(where: { $0.frame == match.frame })
        {
            rows.append(match)
        }
        return rows.sorted { $0.frame.minY < $1.frame.minY }.map { $0.element }
    }

    func openHistoryWithEdit(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        chooseNoteAction("note-history-button", label: "Version history", in: app, file: file, line: line)
        waitFor(app.element("history-screen"), timeout: 30, file: file, line: line)
        waitForCondition("History lists the edit and the original version", timeout: 30, file: file, line: line) {
            self.historyRows(in: app).count >= 2
        }
        _ = appears(app.element("history-end"), within: 10)
    }

    /// The oldest version is the sample's Created one, a row of its own because it carries an event.
    func openOldestVersion(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        var found: XCUIElement?
        waitForCondition("History shows its oldest version", timeout: 30, file: file, line: line) {
            found = self.historyRows(in: app).last
            return found != nil
        }
        guard let oldest = found else { return }
        waitUntilSettled(oldest, file: file, line: line)
        scrollToReveal(oldest, in: app)
        oldest.tap()
        waitFor(app.element("history-preview"), timeout: 30, file: file, line: line)
        let removed = app.elements("history-diff-line").matching(NSPredicate(format: "value == %@", "removed"))
            .firstMatch
        waitFor(removed, timeout: 30, file: file, line: line)
    }

    func tapBack(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        hittable(app.navigationBars.buttons.matching(identifier: "BackButton"), file: file, line: line).tap()
    }

    func fillField(
        _ identifier: String, with text: String, in app: XCUIApplication,
        file: StaticString = #filePath, line: UInt = #line
    ) {
        let field = app.textFields[identifier]
        waitFor(field, file: file, line: line)
        scrollToReveal(field, in: app)
        field.tap()
        waitForFocus(field, file: file, line: line)
        replaceText(in: field, with: text, file: file, line: line)
    }

    func openShareScreen(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        chooseNoteAction("note-share-button", label: "Share", in: app, file: file, line: line)
        waitFor(app.element("share-screen"), timeout: 30, file: file, line: line)
        waitFor(app.buttons["share-create-button"], file: file, line: line)
    }

    @discardableResult
    func createShare(
        label: String, password: String, in app: XCUIApplication,
        file: StaticString = #filePath, line: UInt = #line
    ) -> XCUIElement {
        fillField("share-label-field", with: label, in: app, file: file, line: line)
        fillField("share-password-field", with: password, in: app, file: file, line: line)
        tapRevealed(app.buttons["share-create-button"], in: app)
        let link = app.element("share-created-link")
        waitFor(link, timeout: 30, file: file, line: line)
        waitUntil(link, NSPredicate(format: "label BEGINSWITH %@", MediaSample.linkPrefix), file: file, line: line)
        return link
    }

    /// A tap on Done can show its highlight and still be cancelled without running the button,
    /// leaving the sheet up, so Done is tapped again while the sheet stays.
    func closeShareScreen(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let screen = app.element("share-screen")
        let done = app.buttons.matching(identifier: "share-done")
        for attempt in 0..<3 where screen.exists {
            if attempt == 0 {
                hittable(done, file: file, line: line).tap()
            } else if let button = done.allElementsBoundByIndex.first(where: { $0.exists && $0.isHittable }) {
                button.tap()
            }
            if poll(timeout: 10, until: { !screen.exists }) { break }
        }
        waitUntilGone(screen, file: file, line: line)
    }

    func openSharedLinks(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        backToTree(in: app, file: file, line: line)
        hittable(app.buttons.matching(identifier: "notes-menu-button"), file: file, line: line).tap()
        let button = app.buttons["shared-links-button"]
        waitFor(button, file: file, line: line)
        button.tap()
        waitFor(app.element("shared-links-screen"), timeout: 30, file: file, line: line)
    }

    func shareRow(containing text: String, in app: XCUIApplication) -> XCUIElement {
        app.elements("share-row").containing(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }

    @discardableResult
    func viewSharedVersion(
        of row: XCUIElement, in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line
    ) -> XCUIElement {
        chooseShareAction("view", label: "View shared version", on: row, in: app, file: file, line: line)
        waitFor(app.element("shared-version-screen"), timeout: 30, file: file, line: line)
        let content = app.element("shared-version-content")
        waitFor(content, timeout: 30, file: file, line: line)
        waitForText(content, containing: MediaSample.welcomeBody, file: file, line: line)
        return content
    }

    func loadedEditorImages(in app: XCUIApplication) -> XCUIElementQuery {
        app.elements("editor-image").matching(NSPredicate(format: "value == %@", "loaded"))
    }

    @discardableResult
    func openImageViewer(
        _ image: XCUIElement, in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line
    ) -> XCUIElement {
        image.tap()
        let viewer = app.element("image-viewer")
        waitFor(viewer, timeout: 30, file: file, line: line)
        waitUntilSettled(viewer, file: file, line: line)
        return viewer
    }

    func closeImageViewer(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        hittable(app.buttons.matching(identifier: "image-viewer-done"), file: file, line: line).tap()
        waitUntilGone(app.element("image-viewer"), file: file, line: line)
    }
}
