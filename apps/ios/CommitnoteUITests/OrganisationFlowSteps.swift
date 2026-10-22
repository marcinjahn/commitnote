import UIKit
import XCTest

enum RowEdge {
    case leading
    case trailing
}

extension XCTestCase {
    /// Relaunches with the remembered session and a fresh fake forge, then returns to the tree.
    /// The last view reopens the previously open note shortly after the tree loads, so a note
    /// that appears within a few seconds is closed again on iPhone.
    func resumeAtTree(
        appearance: Appearance = .light, file: StaticString = #filePath, line: UInt = #line
    ) -> XCUIApplication {
        let app = launchApp(reset: false, appearance: appearance)
        let tree = app.element("notes-tree")
        let noteView = app.element("note-view")
        let tokenField = app.secureTextFields["login-token-field"]
        waitForCondition("Notes or login screen appears", timeout: 30, file: file, line: line) {
            tree.exists || noteView.exists || tokenField.exists
        }
        if tokenField.exists {
            logInToNotes(in: app)
            return app
        }
        if appears(noteView, within: 3) {
            backToTree(in: app, file: file, line: line)
        }
        waitFor(tree, file: file, line: line)
        return app
    }

    func backToTree(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        if !isPad, app.element("note-view").exists {
            let back = app.navigationBars.buttons["BackButton"]
            waitFor(back, file: file, line: line)
            back.tap()
        }
        waitFor(app.element("notes-tree"), file: file, line: line)
    }

    func waitForCondition(
        _ message: String, timeout: TimeInterval = 20, file: StaticString = #filePath, line: UInt = #line,
        _ condition: @escaping () -> Bool
    ) {
        XCTAssertTrue(poll(timeout: timeout, until: condition), message, file: file, line: line)
    }

    func setFolder(
        _ name: String, expanded: Bool, in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line
    ) {
        let folder = folder(name, in: app)
        waitFor(folder, file: file, line: line)
        scrollToReveal(folder, in: app)
        guard hasCount(beside: folder, in: app) == expanded else { return }
        folder.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        waitForCondition("Folder \(expanded ? "expands" : "collapses")", file: file, line: line) {
            self.hasCount(beside: folder, in: app) != expanded
        }
    }

    func folderCount(_ name: String, in app: XCUIApplication) -> String? {
        let folder = folder(name, in: app)
        guard folder.exists else { return nil }
        let midY = folder.frame.midY
        return app.elements("tree-folder-count").allElementsBoundByIndex
            .first { abs($0.frame.midY - midY) < 8 }?.label
    }

    func treeNoteLabels(in app: XCUIApplication) -> [String] {
        app.elements("tree-note").allElementsBoundByIndex.map(\.label)
    }

    /// Labels of the visible tree rows from top to bottom; with every folder collapsed these are
    /// exactly the top-level items in their order.
    func visibleTreeLabels(in app: XCUIApplication) -> [String] {
        app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier IN %@", ["tree-folder", "tree-note"]))
            .allElementsBoundByIndex
            .sorted { $0.frame.minY < $1.frame.minY }
            .map(\.label)
    }

    /// Menu, swipe and dialog buttons are matched by label as well, since UIKit does not always
    /// carry SwiftUI identifiers over to them.
    func actionButton(
        _ identifier: String, label: String, in app: XCUIApplication,
        file: StaticString = #filePath, line: UInt = #line
    ) -> XCUIElement {
        hittable(actionButtons(identifier, label: label, in: app), file: file, line: line)
    }

    private func actionButtons(_ identifier: String, label: String, in app: XCUIApplication) -> XCUIElementQuery {
        app.buttons.matching(
            NSPredicate(
                format: "identifier == %@ OR (label == %@ AND identifier != %@)", identifier, label,
                "note-color-tag-menu"))
    }

    func chooseFromContextMenu(
        on element: XCUIElement, _ identifier: String, label: String, opensSubmenu: Bool = false,
        in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line
    ) {
        waitFor(element, file: file, line: line)
        scrollToReveal(element, in: app)
        whileMenuIsOpen {
            openContextMenu(on: element, expecting: identifier, label: label, in: app, file: file, line: line)
            if opensSubmenu {
                actionButton(identifier, label: label, in: app, file: file, line: line).tap()
            } else {
                tapMenuAction(identifier, label: label, reopening: element, in: app, file: file, line: line)
            }
        }
    }

    /// A long press that lands while a row is still settling after navigation opens no menu, so it
    /// is pressed again; one the simulator delivers as a tap opens the note, so it backs out first.
    /// Call it inside `whileMenuIsOpen`.
    func openContextMenu(
        on element: XCUIElement, expecting identifier: String, label: String, in app: XCUIApplication,
        file: StaticString = #filePath, line: UInt = #line
    ) {
        let items = actionButtons(identifier, label: label, in: app)
        for _ in 0..<3 {
            waitFullyBeforeNextMenuEvent()
            if !element.exists {
                backToTree(in: app, file: file, line: line)
            }
            waitUntilSettled(element, file: file, line: line)
            element.press(forDuration: 1.0)
            if appears(items.firstMatch, within: 5) { return }
        }
        XCTFail("No context menu with \(label)", file: file, line: line)
    }

    /// A menu item tap is sometimes ignored while the menu stays open, so it is tapped again, and
    /// then the menu is closed and opened again from `element`. Menus can take a few seconds to
    /// close, so an item that is gone by the time of a retry counts as chosen.
    func tapMenuAction(
        _ identifier: String, label: String, reopening element: XCUIElement, in app: XCUIApplication,
        file: StaticString = #filePath, line: UInt = #line
    ) {
        whileMenuIsOpen {
            var action = actionButton(identifier, label: label, in: app, file: file, line: line)
            for attempt in 0..<3 {
                action.tap()
                if poll(timeout: 10, until: { !action.exists }) { return }
                if attempt > 0 {
                    app.coordinate(withNormalizedOffset: CGVector(dx: 0.99, dy: 0.01)).tap()
                    waitUntilGone(action, file: file, line: line)
                    waitFullyBeforeNextMenuEvent()
                    element.press(forDuration: 1.0)
                }
                let query = actionButtons(identifier, label: label, in: app)
                guard appears(query.firstMatch, within: 5) else { return }
                action = query.allElementsBoundByIndex.first { $0.exists && $0.isHittable } ?? query.firstMatch
            }
            XCTFail("The menu ignores \(label)", file: file, line: line)
        }
    }

    func swipeRow(
        _ element: XCUIElement, edge: RowEdge, to identifier: String, label: String, in app: XCUIApplication,
        file: StaticString = #filePath, line: UInt = #line
    ) {
        waitFor(element, file: file, line: line)
        scrollToReveal(element, in: app)
        let cell = app.cells
            .containing(NSPredicate(format: "identifier == %@ AND label == %@", element.identifier, element.label))
            .firstMatch
        let row = cell.exists ? cell : element
        switch edge {
        case .leading: row.swipeRight()
        case .trailing: row.swipeLeft()
        }
        actionButton(identifier, label: label, in: app, file: file, line: line).tap()
    }

    func tapButton(labeled label: String, in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        hittable(app.buttons.matching(NSPredicate(format: "label == %@", label)), file: file, line: line).tap()
    }

    func text(containing fragment: String, in app: XCUIApplication) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", fragment)).firstMatch
    }

    func trash(
        _ element: XCUIElement, confirm: String = "Move to trash", in app: XCUIApplication,
        file: StaticString = #filePath, line: UInt = #line
    ) {
        swipeRow(element, edge: .trailing, to: "swipe-delete", label: "Delete", in: app, file: file, line: line)
        tapButton(labeled: confirm, in: app, file: file, line: line)
        waitUntilGone(element, file: file, line: line)
    }

    func tapUndo(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let undo = app.buttons.matching(
            NSPredicate(format: "identifier == %@ AND label == %@", "notice-action-button", "Undo"))
        hittable(undo, file: file, line: line).tap()
    }

    func dismissNotice(in app: XCUIApplication) {
        let dismiss = app.element("notice-banner").buttons["Dismiss"]
        if appears(dismiss, within: 5) {
            dismiss.tap()
            waitUntilGone(app.element("notice-banner"))
        }
    }

    func openTrash(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        hittable(app.buttons.matching(identifier: "notes-menu-button"), file: file, line: line).tap()
        let button = app.buttons["trash-button"]
        waitFor(button, file: file, line: line)
        button.tap()
        waitFor(app.element("trash-done"), file: file, line: line)
    }

    func pickFolder(_ label: String, in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let row = app.elements("folder-picker-row").matching(NSPredicate(format: "label == %@", label)).firstMatch
        waitFor(row, file: file, line: line)
        row.tap()
        waitUntilGone(row, file: file, line: line)
    }

    /// Tree rows also open a context menu on a long press, which can swallow a synthesized drag,
    /// so a few press timings are tried, closing the menu in between.
    func drag(
        _ source: XCUIElement, onto target: XCUIElement, in app: XCUIApplication,
        until dropped: @escaping () -> Bool, file: StaticString = #filePath, line: UInt = #line
    ) {
        let attempts: [(press: TimeInterval, velocity: XCUIGestureVelocity)] = [
            (0.5, .fast), (0.8, .default), (1.2, .slow),
        ]
        for attempt in attempts {
            let start = source.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            let end = target.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            start.press(
                forDuration: attempt.press, thenDragTo: end, withVelocity: attempt.velocity,
                thenHoldForDuration: 1.0)
            if poll(timeout: 5, until: dropped) { return }
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.99, dy: 0.01)).tap()
        }
        XCTFail("The drag was not dropped", file: file, line: line)
    }

    /// A selection made with keys reaches the editor a moment after the key event, while toolbar
    /// buttons act on the selection at once, so a toolbar tap waits for the editor to report it.
    func waitForSelection(
        length: Int, in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line
    ) {
        let selection = app.element("testing-editor-selection")
        waitForCondition("The editor selects \(length) characters", file: file, line: line) {
            selection.exists && (selection.value as? String) == "\(length)"
        }
    }

    func hasKeyboardFocus(_ element: XCUIElement) -> Bool {
        (element.value(forKey: "hasKeyboardFocus") as? Bool) ?? false
    }

    /// Preview elements exist only for the visible part of the editor, so it is scrolled
    /// without a tap, which would focus it.
    func revealInEditor(
        _ element: XCUIElement, editor: XCUIElement, file: StaticString = #filePath, line: UInt = #line
    ) {
        var attempts = 0
        while !element.exists && attempts < 4 {
            editor.swipeUp()
            attempts += 1
        }
        waitFor(element, file: file, line: line)
    }

    func pasteText(_ text: String, into editor: XCUIElement) {
        UIPasteboard.general.string = text
        editor.typeKey("v", modifierFlags: .command)
    }

    /// Sent twice: the simulator drops the first hardware key after a tap brings up the keyboard.
    func selectAll(in field: XCUIElement) {
        field.typeKey("a", modifierFlags: .command)
        field.typeKey("a", modifierFlags: .command)
    }

    /// Keys sent while the keyboard is still coming up can all be dropped, so the text is typed
    /// over the field again until it holds exactly `text`.
    func replaceText(
        in field: XCUIElement, with text: String, file: StaticString = #filePath, line: UInt = #line
    ) {
        for _ in 0..<3 {
            selectAll(in: field)
            field.typeText(text)
            if poll(timeout: 2, until: { (field.value as? String) == text }) { return }
        }
        XCTFail("Expected \(field) to hold \(text)", file: file, line: line)
    }

    func renameOpenNote(_ name: String, in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let title = app.textFields["note-title-field"]
        waitFor(title, file: file, line: line)
        title.tap()
        waitForFocus(title, file: file, line: line)
        replaceText(in: title, with: name, file: file, line: line)
        title.typeText("\n")
    }

    func noteDetailsText(containing fragment: String, in app: XCUIApplication) -> XCUIElement {
        app.element("note-details").staticTexts.matching(NSPredicate(format: "label CONTAINS %@", fragment))
            .firstMatch
    }
}
