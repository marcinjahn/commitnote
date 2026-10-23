import XCTest

final class OrganisationScreenshotTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testCaptureScreens() {
        let app = launchApp(reset: true)
        logInToNotes(in: app)
        captureScreens()
    }

    private func captureScreens() {
        var app = resumeAtTree()
        let editor = openWelcome(in: app)
        XCTAssertFalse(hasKeyboardFocus(editor))
        snapshotBothAppearances("live-preview")

        focusEditor(in: app)
        waitFor(app.buttons["format-bold"])
        snapshotBothAppearances("keyboard-toolbar")

        backToTree(in: app)
        setFolder("Journal", expanded: true, in: app)
        setFolder("2026", expanded: true, in: app)
        openNote("Whiteboard", startingWith: "Sketch from the planning session.", in: app)
        waitForValue(app.elements("editor-image").firstMatch, "loaded")
        snapshotBothAppearances("inline-image")

        backToTree(in: app)
        openNote(SampleNote.other, startingWith: "# \(SampleNote.other)", in: app)
        waitFor(noteDetailsText(containing: "words", in: app))
        waitFor(app.buttons["note-color-tag-menu"])
        snapshotBothAppearances("note-details")

        backToTree(in: app)
        let welcome = note(SampleNote.welcome, in: app)
        waitFor(welcome)
        whileMenuIsOpen {
            openContextMenu(on: welcome, expecting: "tree-action-move", label: "Move to…", in: app)
            waitUntilSettled(actionButton("tree-action-move", label: "Move to…", in: app))
            snapshotBothAppearances("tree-actions")
            tapMenuAction("tree-action-move", label: "Move to…", reopening: welcome, in: app)
        }
        let projects = app.elements("folder-picker-row").matching(NSPredicate(format: "label == %@", "Projects"))
            .firstMatch
        waitFor(projects)
        waitUntilSettled(projects)
        snapshot("move-to", appearance: .light)
        app.buttons["folder-picker-cancel-button"].tap()
        waitUntilGone(app.elements("folder-picker-row").firstMatch)
        // The picker sheet keeps the appearance it was presented with, so it is opened again in dark.
        switchAppearance(.dark)
        chooseFromContextMenu(on: welcome, "tree-action-move", label: "Move to…", in: app)
        waitFor(projects)
        waitUntilSettled(projects)
        snapshot("move-to", appearance: .dark)
        app.buttons["folder-picker-cancel-button"].tap()
        waitUntilGone(app.elements("folder-picker-row").firstMatch)
        switchAppearance(.light)

        useTestingMenu("testing-share-note", in: app)
        waitFor(app.element("tree-note-shared"))
        chooseFromContextMenu(on: welcome, "tree-action-delete", label: "Delete", in: app)
        let warning = text(containing: "active share link", in: app)
        waitFor(warning)
        waitUntilSettled(warning)
        snapshotBothAppearances("delete-shared")
        // The dialog is a popover without a Cancel button, dismissed by tapping outside it; a tap
        // that lands while it is still appearing is ignored.
        for _ in 0..<3 where warning.exists {
            app.otherElements["PopoverDismissRegion"].firstMatch.tap()
            poll(timeout: 5) { !warning.exists }
        }
        waitUntilGone(warning)

        chooseFromContextMenu(on: folder("Projects", in: app), "tree-action-delete", label: "Delete", in: app)
        tapButton(labeled: "Move to trash", in: app)
        waitUntilGone(folder("Projects", in: app))
        trash(note(SampleNote.other, in: app), in: app)
        dismissNotice(in: app)
        openTrash(in: app)
        waitFor(app.elements("trash-entry").matching(NSPredicate(format: "label == %@", "Projects")).firstMatch)
        snapshotBothAppearances("trash")
        app.buttons["trash-done"].tap()
        waitUntilGone(app.element("trash-done"))

        hittable(app.buttons.matching(identifier: "tag-filter-menu")).tap()
        tapButton(labeled: "Orange", in: app)
        waitForCondition("The filter shows only the orange note") {
            self.treeNoteLabels(in: app) == ["January"]
        }
        snapshotBothAppearances("tag-filter")
        hittable(app.buttons.matching(identifier: "tag-filter-menu")).tap()
        tapButton(labeled: "All notes", in: app)
        waitFor(note(SampleNote.welcome, in: app))

        let field = app.searchFields.firstMatch
        waitFor(field)
        field.tap()
        field.typeText("encrypted")
        waitFor(app.elements("search-content-row").firstMatch, timeout: 30)
        snapshotBothAppearances("search")

        app = launchApp(reset: false, holdLoading: true)
        typeInto(app.element("early-draft-name"), "Shopping list\n", in: app)
        let body = app.element("early-draft-body")
        waitForFocus(body)
        body.typeText("Milk, eggs and bread")
        waitForValue(body, "Milk, eggs and bread")
        snapshotBothAppearances("early-draft")
    }
}
