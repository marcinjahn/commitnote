import UIKit
import XCTest

final class MediaFlowTests: XCTestCase {
    private static var loggedIn = false

    override func setUp() {
        continueAfterFailure = false
    }

    private func openNotes() -> XCUIApplication {
        guard Self.loggedIn else {
            let app = launchApp(reset: true, editorHooks: true)
            logInToNotes(in: app)
            Self.loggedIn = true
            return app
        }
        return resumeAtTree(editorHooks: true)
    }

    func testPasteImageAndOpenViewer() {
        let app = openNotes()
        let editor = openWelcome(in: app)
        // A hardware key can be dropped on a loaded runner, and can take the editor's focus with it, so
        // the paste is repeated from a focused editor until the editor has taken it. The image itself
        // takes far longer to land in the text.
        let png = Self.largePNG()
        let pastes = app.element("testing-editor-image-pastes")
        waitFor(pastes)
        let pastesBefore = Int((pastes.value as? String) ?? "") ?? 0
        for _ in 0..<4 {
            focusEditor(in: app)
            moveCaretToEnd(in: app)
            UIPasteboard.general.setData(png, forPasteboardType: "public.png")
            editor.typeKey("v", modifierFlags: .command)
            if poll(timeout: 10, until: { (Int((pastes.value as? String) ?? "") ?? 0) > pastesBefore }) { break }
        }
        waitUntil(
            editor, NSPredicate(format: "value MATCHES %@", "(?s).*image:[a-z2-7]{26}#[0-9]+x[0-9]+.*"),
            timeout: 60)
        let image = app.elements("editor-image").firstMatch
        revealInEditor(image, editor: editor)
        waitForValue(image, "loaded", timeout: 60)

        waitForFocus(editor)
        pasteText("\n" + MediaSample.imageReference, into: editor)
        waitForCondition("The pasted reference points to a clone of the image", timeout: 30) {
            let text = (editor.value as? String) ?? ""
            return text.range(of: "image:[a-z2-7]{26}#64x48", options: .regularExpression) != nil
                && !text.contains(MediaSample.imageId)
        }
        waitForSaved(in: app)
        XCTAssertFalse(((editor.value as? String) ?? "").contains(MediaSample.imageId))

        dismissKeyboard(over: editor, in: app)
        let pasted = largestLoadedImage(editor: editor, in: app)
        let viewer = openImageViewer(pasted, in: app)
        viewer.doubleTap()
        XCTAssertTrue(viewer.exists)
        closeImageViewer(in: app)
    }

    func testRestoreVersionWithUndo() {
        let app = openNotes()
        openWelcome(in: app)
        let marker = "Restore marker \(UUID().uuidString.prefix(8))"
        let editor = pasteAtEnd(marker, in: app)
        waitForSaved(in: app)

        openHistoryWithEdit(in: app)
        openOldestVersion(in: app)
        let restore = app.buttons["history-restore-button"]
        waitFor(restore)
        waitUntil(restore, NSPredicate(format: "enabled == true"))
        restore.tap()

        waitUntilGone(app.element("history-screen"))
        waitFor(editor)
        waitUntil(editor, NSPredicate(format: "NOT (value CONTAINS %@)", marker))
        waitFor(app.element("notice-banner"), timeout: 30)
        tapUndo(in: app)
        waitForText(editor, containing: marker)
    }

    func testShareManageAndRevoke() {
        let app = openNotes()
        openWelcome(in: app)
        openShareScreen(in: app)
        createShare(label: "Team notes", password: "pw-1234", in: app)
        hittable(app.buttons.matching(identifier: "share-link-button")).tap()
        dismissShareSheet(in: app)
        closeShareScreen(in: app)

        openSharedLinks(in: app)
        let row = shareRow(containing: "Team notes", in: app)
        waitFor(row, timeout: 30)

        let notice = app.element("notice-banner")
        chooseShareAction("update", label: "Update to current version", on: row, in: app, until: { notice.exists })

        viewSharedVersion(of: row, in: app)
        tapBack(in: app)
        waitUntilGone(app.element("shared-version-screen"))

        chooseShareAction("revoke", label: "Revoke…", on: row, in: app)
        actionButton("share-revoke-confirm", label: "Revoke", in: app).tap()
        waitFor(app.element("shared-links-empty"), timeout: 30)
    }

    func testSharePermissionError() {
        let app = openNotes()
        useTestingMenu("testing-share-permission", in: app)
        openWelcome(in: app)
        openShareScreen(in: app)
        tapRevealed(app.buttons["share-create-button"], in: app)
        let error = app.element("share-error")
        waitFor(error, timeout: 30)
        waitUntil(error, NSPredicate(format: "label CONTAINS %@", "permission to create gists"))
    }

    /// The pasted photo is drawn far larger than the 64×48 clone below it.
    private func largestLoadedImage(editor: XCUIElement, in app: XCUIApplication) -> XCUIElement {
        let images = loadedEditorImages(in: app)
        var found: XCUIElement?
        for _ in 0..<5 {
            let largest = images.allElementsBoundByIndex
                .filter { $0.exists }
                .max { $0.frame.height < $1.frame.height }
            if let largest, largest.frame.height > 100, largest.isHittable {
                found = largest
                break
            }
            editor.swipeUp()
        }
        XCTAssertNotNil(found, "The pasted image can be tapped")
        return found ?? images.firstMatch
    }

    private static func largePNG() -> Data {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let size = CGSize(width: 3000, height: 2000)
        return UIGraphicsImageRenderer(size: size, format: format).pngData { context in
            UIColor.systemTeal.setFill()
            context.fill(CGRect(origin: .zero, size: size))
            UIColor.white.setFill()
            context.fill(CGRect(x: 600, y: 400, width: 1800, height: 1200))
        }
    }
}
