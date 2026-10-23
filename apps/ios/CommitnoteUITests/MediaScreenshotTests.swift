import XCTest

final class MediaScreenshotTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testCaptureScreens() {
        let app = launchApp(reset: true)
        logInToNotes(in: app)
        for appearance in [Appearance.light, Appearance.dark] {
            captureScreens(appearance)
        }
    }

    private func captureScreens(_ appearance: Appearance) {
        let app = resumeAtTree(appearance: appearance)
        openWelcome(in: app)
        whileMenuIsOpen {
            openMenu(
                app.buttons.matching(identifier: "note-actions-menu"), expecting: "note-insert-image-menu",
                label: "Insert image", in: app)
            hittable(menuItems("note-insert-image-menu", label: "Insert image", in: app)).tap()
            let files = menuItems("insert-image-files", label: "Choose File", in: app).firstMatch
            waitFor(files)
            waitUntilSettled(files)
            snapshot("insert-image-menu", appearance: appearance)
            closeMenu(showing: files, in: app)
        }

        pasteAtEnd("Edited for the history screen", in: app)
        waitForSaved(in: app)
        openHistoryWithEdit(in: app)
        if let newest = historyRows(in: app).first {
            waitUntilSettled(newest)
        }
        snapshot("history", appearance: appearance)
        openOldestVersion(in: app)
        waitUntilSettled(app.element("history-preview"))
        snapshot("history-preview", appearance: appearance)
        tapBack(in: app)
        hittable(app.buttons.matching(identifier: "history-done")).tap()
        waitUntilGone(app.element("history-screen"))

        openShareScreen(in: app)
        waitUntilSettled(app.buttons["share-create-button"])
        snapshot("share", appearance: appearance)
        let link = createShare(label: "Team notes", password: "pw-1234", in: app)
        waitUntilSettled(link)
        snapshot("share-created", appearance: appearance)
        closeShareScreen(in: app)

        openSharedLinks(in: app)
        let row = shareRow(containing: "Team notes", in: app)
        waitFor(row, timeout: 30)
        waitUntilSettled(row)
        snapshot("shared-links", appearance: appearance)
        let content = viewSharedVersion(of: row, in: app)
        waitUntilSettled(content)
        snapshot("shared-version", appearance: appearance)
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
        snapshot("image-viewer", appearance: appearance)
        closeImageViewer(in: app)
    }
}
