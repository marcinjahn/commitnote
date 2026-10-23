import XCTest

final class OrganisationFlowTests: XCTestCase {
    private static var loggedIn = false
    private static let timestampName = "^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}.*"
    /// Loading the tree and then saving the early draft as a note takes over 20 seconds on a slow
    /// simulator.
    private static let loadingTimeout: TimeInterval = 45

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

    private func launchHoldingLoading() -> XCUIApplication {
        if !Self.loggedIn {
            _ = openNotes()
        }
        let app = launchApp(reset: false, holdLoading: true)
        waitFor(app.element("loading-screen"), timeout: 30)
        waitFor(app.element("early-draft-name"))
        return app
    }

    func testRenameMoveAndReorder() {
        let app = openNotes()
        chooseFromContextMenu(on: folder("Empty folder", in: app), "tree-action-rename", label: "Rename…", in: app)
        let field = app.textFields["rename-field"]
        waitForFocus(field)
        replaceText(in: field, with: "Archive")
        app.buttons["rename-save-button"].tap()
        waitUntilGone(field)
        waitFor(folder("Archive", in: app))
        XCTAssertFalse(folder("Empty folder", in: app).exists)

        chooseFromContextMenu(on: folder("Archive", in: app), "tree-action-rename", label: "Rename…", in: app)
        waitForFocus(field)
        replaceText(in: field, with: "Journal")
        app.buttons["rename-save-button"].tap()
        waitFor(app.element("rename-error"))
        app.buttons["rename-cancel-button"].tap()
        waitUntilGone(field)
        waitFor(folder("Archive", in: app))

        setFolder("Journal", expanded: true, in: app)
        setFolder("2026", expanded: true, in: app)
        swipeRow(note("January", in: app), edge: .trailing, to: "swipe-move", label: "Move", in: app)
        pickFolder("Projects", in: app)
        setFolder("Journal", expanded: false, in: app)
        setFolder("Projects", expanded: true, in: app)
        waitFor(note("January", in: app))

        for name in ["Projects", "Journal"] {
            setFolder(name, expanded: false, in: app)
        }
        let order = visibleTreeLabels(in: app)
        guard let index = order.firstIndex(of: SampleNote.welcome) else {
            return XCTFail("Welcome is a top-level row in \(order)")
        }
        var swapped = order
        if index + 1 < order.count {
            swapped.swapAt(index, index + 1)
            moveSibling(SampleNote.welcome, "tree-action-move-down", label: "Move down", expecting: swapped, in: app)
            moveSibling(SampleNote.welcome, "tree-action-move-up", label: "Move up", expecting: order, in: app)
        } else {
            swapped.swapAt(index, index - 1)
            moveSibling(SampleNote.welcome, "tree-action-move-up", label: "Move up", expecting: swapped, in: app)
            moveSibling(SampleNote.welcome, "tree-action-move-down", label: "Move down", expecting: order, in: app)
        }
    }

    func testDragAndDropWithUndo() {
        let app = openNotes()
        if isPad {
            // Moving the open note expands its new folder, so another note is opened instead.
            openNote(SampleNote.other, startingWith: "# \(SampleNote.other)", in: app)
        }
        setFolder("Projects", expanded: false, in: app)
        let countBefore = folderCount("Projects", in: app)
        XCTAssertNotNil(countBefore)
        let welcome = note(SampleNote.welcome, in: app)
        waitFor(welcome)

        drag(welcome, onto: folder("Projects", in: app), in: app) { !welcome.exists }
        waitForCondition("Projects counts the dropped note") {
            self.folderCount("Projects", in: app) != countBefore
        }

        tapUndo(in: app)
        waitFor(note(SampleNote.welcome, in: app))
        waitForCondition("Undo moves the note back to the top level") {
            self.folderCount("Projects", in: app) == countBefore
        }
    }

    func testDeleteWithUndo() {
        let app = openNotes()
        trash(note(SampleNote.other, in: app), in: app)
        waitFor(text(containing: "“\(SampleNote.other)” moved to trash", in: app))

        tapUndo(in: app)
        waitFor(note(SampleNote.other, in: app))
    }

    func testSharedNoteWarning() {
        let app = openNotes()
        useTestingMenu("testing-share-note", in: app)
        waitFor(app.element("tree-note-shared"))

        let welcome = note(SampleNote.welcome, in: app)
        chooseFromContextMenu(on: welcome, "tree-action-delete", label: "Delete", in: app)
        waitFor(text(containing: "active share link", in: app))
        tapButton(labeled: "Revoke links and move to trash", in: app)
        waitUntilGone(welcome)
        waitFor(text(containing: "moved to trash", in: app))
        XCTAssertFalse(app.element("tree-note-shared").exists)
    }

    func testTrashScreen() {
        let app = openNotes()
        chooseFromContextMenu(on: folder("Projects", in: app), "tree-action-delete", label: "Delete", in: app)
        tapButton(labeled: "Move to trash", in: app)
        waitUntilGone(folder("Projects", in: app))

        openTrash(in: app)
        let entry = app.elements("trash-entry").matching(NSPredicate(format: "label == %@", "Projects")).firstMatch
        waitFor(entry)
        waitFor(text(containing: "days left", in: app))

        expandTrashRow(entry, revealing: trashItem("commitnote", in: app), in: app)
        let ideas = trashItem("Ideas", in: app)
        expandTrashRow(trashItem("commitnote", in: app), revealing: ideas, in: app)
        chooseFromContextMenu(on: ideas, "trash-restore", label: "Restore to…", in: app)
        pickFolder("Notes (top level)", in: app)
        waitUntilGone(ideas)

        hittable(app.buttons.matching(identifier: "trash-entry-menu")).tap()
        actionButton("trash-delete", label: "Delete permanently", in: app).tap()
        waitFor(text(containing: "Delete permanently?", in: app))
        tapButton(labeled: "Delete permanently", in: app)
        waitFor(app.element("trash-empty"))
        app.buttons["trash-done"].tap()
        waitUntilGone(app.element("trash-done"))
        waitFor(note("Ideas", in: app))

        trash(note(SampleNote.other, in: app), in: app)
        openTrash(in: app)
        waitFor(app.elements("trash-entry").matching(NSPredicate(format: "label == %@", SampleNote.other)).firstMatch)
        app.buttons["trash-empty-button"].tap()
        waitFor(text(containing: "will be deleted permanently", in: app))
        hittable(
            app.buttons.matching(
                NSPredicate(format: "label == %@ AND identifier != %@", "Empty trash", "trash-empty-button"))
        ).tap()
        waitFor(app.element("trash-empty"))
        XCTAssertFalse(app.elements("trash-entry").firstMatch.exists)
        app.buttons["trash-done"].tap()
    }

    func testColorTagsAndFilter() {
        let app = openNotes()
        let welcome = note(SampleNote.welcome, in: app)
        whileMenuIsOpen {
            chooseFromContextMenu(
                on: welcome, "tree-action-color-tag", label: "Color tag", opensSubmenu: true, in: app)
            let red = app.buttons.matching(NSPredicate(format: "label == %@", "Red")).firstMatch
            if !appears(red, within: 5) {
                // The submenu sometimes ignores a tap that lands while the menu is still settling.
                actionButton("tree-action-color-tag", label: "Color tag", in: app).tap()
            }
            tapButton(labeled: "Red", in: app)
        }
        waitFor(tagDot("Red", in: app))

        // A menu tap that lands while the menu is still settling is ignored, so the choice is
        // repeated until the tree shows it.
        for _ in 0..<3 where tagDot("Purple", in: app).exists {
            openNote(SampleNote.other, startingWith: "# \(SampleNote.other)", in: app)
            hittable(app.buttons.matching(identifier: "note-color-tag-menu")).tap()
            tapButton(labeled: "Blue", in: app)
            backToTree(in: app)
            if poll(timeout: 10, until: { !self.tagDot("Purple", in: app).exists }) { break }
        }
        waitUntilGone(tagDot("Purple", in: app))

        hittable(app.buttons.matching(identifier: "tag-filter-menu")).tap()
        tapButton(labeled: "Red", in: app)
        waitForCondition("The filter shows only the red note") {
            self.treeNoteLabels(in: app) == [SampleNote.welcome]
        }

        hittable(app.buttons.matching(identifier: "tag-filter-menu")).tap()
        tapButton(labeled: "All notes", in: app)
        waitFor(note(SampleNote.other, in: app))
        waitFor(tagDot("Blue", in: app))
    }

    func testSearch() {
        let app = openNotes()
        openNote(SampleNote.other, startingWith: "# \(SampleNote.other)", in: app)
        if isPad {
            openWelcome(in: app)
        } else {
            backToTree(in: app)
        }

        let field = app.searchFields.firstMatch
        waitFor(field)
        field.tap()
        let recent = app.elements("search-recent-row")
            .matching(NSPredicate(format: "label CONTAINS %@", SampleNote.other)).firstMatch
        waitFor(recent)

        field.typeText("Roadmap")
        waitFor(
            app.elements("search-name-row").matching(NSPredicate(format: "label CONTAINS %@", "Roadmap"))
                .firstMatch)

        // ⌘A does not select the search field's text on iPad.
        field.buttons["Clear text"].tap()
        field.typeText("encrypted")
        let content = app.elements("search-content-row")
            .matching(NSPredicate(format: "label CONTAINS %@", SampleNote.welcome)).firstMatch
        waitFor(content, timeout: 30)
        XCTAssertTrue(content.label.contains("encrypted"), "The row shows the matching snippet")
        XCTAssertFalse(app.elements("search-name-row").firstMatch.exists)

        content.tap()
        waitForText(editor(in: app), startingWith: SampleNote.welcomeFirstLine)
        waitUntilGone(app.element("search-results"))
    }

    func testLastView() {
        var app = launchApp(reset: true)
        logInToNotes(in: app)
        setFolder("Journal", expanded: true, in: app)
        setFolder("2026", expanded: true, in: app)
        openNote("January", startingWith: "# January", in: app)
        waitForLastViewSave()

        app = launchApp(reset: false)
        Self.loggedIn = true
        waitForText(editor(in: app), startingWith: "# January")
        waitForValue(app.textFields["note-title-field"], "January")
        backToTree(in: app)
        waitFor(folder("2026", in: app))
        XCTAssertFalse(hasCount(beside: folder("Journal", in: app), in: app), "Journal is expanded")
    }

    func testMetadata() {
        let app = openNotes()
        openWelcome(in: app)
        waitFor(noteDetailsText(containing: "words", in: app))
        waitFor(noteDetailsText(containing: "tasks done", in: app))

        if !isPad {
            backToTree(in: app)
        }
        hittable(app.buttons.matching(identifier: "new-note-button")).tap()
        let nameField = app.element("draft-name-field")
        waitForFocus(nameField)
        let notSaved = noteDetailsText(containing: "Not saved yet", in: app)
        waitFor(notSaved)

        nameField.typeText("Details note\n")
        let editor = self.editor(in: app)
        waitForFocus(editor)
        editor.typeText("Counted words here")
        let status = syncStatus(in: app)
        waitUntil(status, NSPredicate(format: "value == %@", "pending"), timeout: 5)
        waitForValue(status, "synced")

        if isPad {
            openWelcome(in: app)
        } else {
            backToTree(in: app)
        }
        openNote("Details note", startingWith: "Counted words here", in: app)
        waitFor(noteDetailsText(containing: "words", in: app))
        waitUntilGone(notSaved)
    }

    func testEarlyDraftNamed() {
        let app = launchHoldingLoading()
        typeInto(app.element("early-draft-name"), "Groceries\n", in: app)
        let body = app.element("early-draft-body")
        waitForFocus(body)
        body.typeText("Milk and eggs")
        waitForValue(body, "Milk and eggs")

        tapRevealed(app.buttons["testing-finish-loading"], in: app)
        waitForText(editor(in: app), startingWith: "Milk and eggs", timeout: Self.loadingTimeout)
        waitForValue(app.textFields["note-title-field"], "Groceries")
        waitForValue(syncStatus(in: app), "synced")
    }

    func testEarlyDraftAfterFailedLoading() {
        let app = launchHoldingLoading()
        let body = app.element("early-draft-body")
        typeInto(body, "Written while loading", in: app)
        waitForValue(body, "Written while loading")

        tapRevealed(app.buttons["testing-fail-loading"], in: app)
        waitFor(app.element("loading-error"), timeout: 30)
        XCTAssertEqual(body.value as? String, "Written while loading", "The draft survives the failure")

        tapRevealed(app.buttons["testing-stop-failing-loading"], in: app)
        tapRevealed(app.buttons["loading-try-again-button"], in: app)
        waitForText(editor(in: app), startingWith: "Written while loading", timeout: Self.loadingTimeout)
        waitUntil(
            app.textFields["note-title-field"], NSPredicate(format: "value MATCHES %@", Self.timestampName))
    }

    private func moveSibling(
        _ name: String, _ identifier: String, label: String, expecting order: [String], in app: XCUIApplication,
        file: StaticString = #filePath, line: UInt = #line
    ) {
        chooseFromContextMenu(
            on: note(name, in: app), identifier, label: label, in: app, file: file, line: line)
        waitForCondition("\(label) reorders the siblings", file: file, line: line) {
            self.visibleTreeLabels(in: app) == order
        }
    }

    private func trashItem(_ name: String, in app: XCUIApplication) -> XCUIElement {
        app.elements("trash-item").matching(NSPredicate(format: "label == %@", name)).firstMatch
    }

    private func tagDot(_ label: String, in app: XCUIApplication) -> XCUIElement {
        app.elements("tree-note-tag").matching(NSPredicate(format: "label == %@", "\(label) tag")).firstMatch
    }

    /// Tapping the label expands a disclosure row in most list styles; the trailing chevron is the
    /// fallback.
    private func expandTrashRow(_ row: XCUIElement, revealing child: XCUIElement, in app: XCUIApplication) {
        waitFor(row)
        row.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.5)).tap()
        if appears(child, within: 5) { return }
        let cell = app.cells
            .containing(NSPredicate(format: "identifier == %@ AND label == %@", row.identifier, row.label))
            .firstMatch
        cell.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.5)).tap()
        waitFor(child)
    }

    /// The last view is written half a second after the last change and nothing on screen
    /// reflects the write, so this waits out that delay before the app is terminated.
    private func waitForLastViewSave() {
        let saved = expectation(description: "Last view saved")
        saved.isInverted = true
        wait(for: [saved], timeout: 1.5)
    }
}
