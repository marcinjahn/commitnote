import XCTest

final class AccessibilityScreenshotTests: XCTestCase {
    private static let contentSize = "UICTContentSizeCategoryAccessibilityL"
    private static let auditTypes: XCUIAccessibilityAuditType = [
        .sufficientElementDescription, .dynamicType, .textClipped,
    ]

    override func setUp() {
        continueAfterFailure = false
    }

    /// Each screen is audited before its screenshots: switching the appearance for them redraws
    /// the iPad sidebar, and an audit right after that can report its rows as clipped.
    func testLargeTextScreens() throws {
        let app = launchApp(reset: true, contentSize: Self.contentSize)
        logInToNotes(in: app)

        let tree = app.element("notes-tree")
        waitFor(tree)
        waitUntilSettled(note(SampleNote.welcome, in: app))
        try audit(app, "tree")
        snapshotBothAppearances("large-text-tree")

        openWelcome(in: app)
        waitUntilSettled(editor(in: app))
        if isPad {
            waitUntilSettled(note(SampleNote.welcome, in: app))
        }
        try audit(app, "note")
        snapshotBothAppearances("large-text-note")

        openSettings(in: app)
        let save = app.element("settings-save-status")
        waitFor(save)
        waitUntilSettled(save)
        try audit(app, "settings")
        snapshotBothAppearances("large-text-settings")
    }

    /// An audit started while a slow runner is still busy can run out of time; it is retried once.
    private func audit(_ app: XCUIApplication, _ screen: String) throws {
        do {
            try auditOnce(app, screen)
        } catch let error as NSError where error.domain == "com.apple.xcode.xctest.accessibilityAudit" && error.code == -56 {
            try auditOnce(app, screen)
        }
    }

    private func auditOnce(_ app: XCUIApplication, _ screen: String) throws {
        var failures: [String] = []
        try app.performAccessibilityAudit(for: Self.auditTypes) { issue in
            guard let element = issue.element else {
                self.logIgnored(issue, screen: screen)
                return true
            }
            if self.isIgnorable(element, in: app) {
                self.logIgnored(issue, screen: screen)
                return true
            }
            failures.append(
                "\(issue.compactDescription): \(issue.detailedDescription) "
                    + "(identifier: \"\(element.identifier)\", label: \"\(element.label)\", "
                    + "type: \(element.elementType.rawValue), frame: \(element.frame))")
            return true
        }
        XCTAssertTrue(
            failures.isEmpty, "Accessibility audit of the \(screen) found:\n" + failures.joined(separator: "\n"))
    }

    private func isIgnorable(_ element: XCUIElement, in app: XCUIApplication) -> Bool {
        if element.elementType == .keyboard || element.elementType == .key {
            return true
        }
        let identifier = element.identifier
        if identifier.hasPrefix("testing-") {
            return true
        }
        guard identifier.isEmpty else { return false }
        return element.elementType == .searchField || isInsideSystemBar(element, in: app)
    }

    private func isInsideSystemBar(_ element: XCUIElement, in app: XCUIApplication) -> Bool {
        let frame = element.frame
        let bars = app.navigationBars.allElementsBoundByIndex + app.toolbars.allElementsBoundByIndex
        return bars.contains { $0.frame.contains(frame) }
    }

    private func logIgnored(_ issue: XCUIAccessibilityAuditIssue, screen: String) {
        let element = issue.element
        XCTContext.runActivity(named: "Ignored audit issue on \(screen)") { activity in
            let type = element.map { String($0.elementType.rawValue) } ?? "none"
            let label = element?.label ?? ""
            activity.add(
                XCTAttachment(
                    string: "element type: \(type)\nlabel: \(label)\n\(issue.compactDescription)"))
        }
    }
}
