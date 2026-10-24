import XCTest

final class MediaScreenshotTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testCaptureScreens() {
        let app = launchApp(reset: true, editorHooks: true)
        logInToNotes(in: app)
        captureScreens()
    }

    private func captureScreens() {
        let app = resumeAtTree(editorHooks: true)
        openWelcome(in: app)
        whileMenuIsOpen {
            openMenu(
                app.buttons.matching(identifier: "note-actions-menu"), expecting: "note-insert-image-menu",
                label: "Insert image", in: app)
            hittable(menuItems("note-insert-image-menu", label: "Insert image", in: app)).tap()
            let files = menuItems("insert-image-files", label: "Choose File", in: app).firstMatch
            waitFor(files)
            waitUntilSettled(files)
            snapshotBothAppearances("insert-image-menu")
            closeMenu(showing: files, in: app)
        }

        let editor = pasteAtEnd("Edited for the history screen", in: app)
        waitForSaved(in: app)
        // The editor hooks above the keyboard are not part of the app's screens.
        dismissKeyboard(over: editor, in: app)
        waitUntilGone(app.keyboards.firstMatch)
        openHistoryWithEdit(in: app)
        if let newest = historyRows(in: app).first {
            waitUntilSettled(newest)
        }
        snapshotBothAppearances("history")
        openOldestVersion(in: app)
        waitUntilSettled(app.element("history-preview"))
        snapshotBothAppearances("history-preview")
        tapBack(in: app)
        hittable(app.buttons.matching(identifier: "history-done")).tap()
        waitUntilGone(app.element("history-screen"))

        openShareScreen(in: app)
        waitUntilSettled(app.buttons["share-create-button"])
        snapshotBothAppearances("share")
        let link = createShare(label: "Team notes", password: "pw-1234", in: app)
        waitUntilSettled(link)
        snapshotBothAppearances("share-created")
        closeShareScreen(in: app)

        openSharedLinks(in: app)
        let row = shareRow(containing: "Team notes", in: app)
        waitFor(row, timeout: 30)
        waitUntilSettled(row)
        snapshotBothAppearances("shared-links")
        let content = viewSharedVersion(of: row, in: app)
        waitUntilSettled(content)
        snapshotBothAppearances("shared-version")
        tapBack(in: app)
        waitUntilGone(app.element("shared-version-screen"))
        hittable(app.buttons.matching(identifier: "shared-links-done")).tap()
        waitUntilGone(app.element("shared-links-screen"))

        backToTree(in: app)
        setFolder("Journal", expanded: true, in: app)
        setFolder("2026", expanded: true, in: app)
        openNote(MediaSample.whiteboard, startingWith: MediaSample.whiteboardFirstLine, in: app)
        let image = loadedEditorImages(in: app).firstMatch
        waitFor(image, timeout: 30)
        openImageViewer(hittable(loadedEditorImages(in: app)), in: app)
        snapshotBothAppearances("image-viewer")
        closeImageViewer(in: app)
    }
}
