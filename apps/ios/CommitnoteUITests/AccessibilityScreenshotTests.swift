import XCTest

final class AccessibilityScreenshotTests: XCTestCase {
    private enum Screen: String, CaseIterable {
        case tree
        case settings
        case note
    }

    private static let contentSize = "UICTContentSizeCategoryAccessibilityL"
    private static let auditTypes: XCUIAccessibilityAuditType = [
        .sufficientElementDescription, .dynamicType, .textClipped,
    ]
    private static let auditErrorDomain = "com.apple.xcode.xctest.accessibilityAudit"
    private static let attempts = 3

    override func setUp() {
        continueAfterFailure = false
    }

    /// Each screen is captured in each appearance from its own launch, which sets the appearance,
    /// so no screen is switched to dark while shown and no audit runs in an app an earlier audit
    /// went through. Screens are audited in light. Settings come before the note: the app reopens
    /// the last note when launched, and on iPad laying its editor out again behind the settings
    /// sheet at every text size the audit tries can take the audit past its time limit.
    func testLargeTextScreens() throws {
        logInToNotes(in: launchApp(reset: true, contentSize: Self.contentSize))
        for screen in Screen.allCases {
            try capture(screen, appearance: .light)
            try capture(screen, appearance: .dark)
        }
    }

    /// On a slow runner an audit can run out of its fixed time limit, or the app can stop inside
    /// the system's own text size checks; the screen is then captured again from a fresh launch.
    private func capture(_ screen: Screen, appearance: Appearance) throws {
        for attempt in 1...Self.attempts {
            let app = resumeAtTree(appearance: appearance, contentSize: Self.contentSize, relaunch: true)
            show(screen, in: app)
            if appearance == .light {
                do {
                    try audit(app, screen)
                } catch let error as NSError where attempt < Self.attempts {
                    guard let reason = Self.retryReason(error) else { throw error }
                    logRetry(of: screen, after: attempt, reason: reason, error: error)
                    continue
                }
            }
            XCTAssertEqual(app.state, .runningForeground, "The app is running on the \(screen.rawValue) screen")
            snapshot("large-text-\(screen.rawValue)", appearance: appearance)
            return
        }
    }

    private func show(_ screen: Screen, in app: XCUIApplication) {
        switch screen {
        case .tree:
            waitFor(app.element("notes-tree"))
            waitUntilSettled(note(SampleNote.welcome, in: app))
        case .settings:
            openSettings(in: app)
            let save = app.element("settings-save-status")
            waitFor(save)
            waitUntilSettled(save)
        case .note:
            openWelcome(in: app)
            waitUntilSettled(editor(in: app))
            if isPad {
                waitUntilSettled(note(SampleNote.welcome, in: app))
            }
        }
    }

    private static func retryReason(_ error: NSError) -> String? {
        guard error.domain == auditErrorDomain else { return nil }
        switch error.code {
        case -56: return "the audit ran out of time"
        case -51: return "the app stopped during the audit"
        default: return nil
        }
    }

    private func logRetry(of screen: Screen, after attempt: Int, reason: String, error: NSError) {
        XCTContext.runActivity(
            named: "Capturing the \(screen.rawValue) screen again after attempt \(attempt): \(reason)"
        ) { activity in
            let attachment = XCTAttachment(string: "\(error)")
            attachment.name = "large-text-\(screen.rawValue)-retry-\(attempt)"
            attachment.lifetime = .keepAlways
            activity.add(attachment)
        }
    }

    /// Issues reported before an audit fails still fail the test.
    private func audit(_ app: XCUIApplication, _ screen: Screen) throws {
        var failures: [String] = []
        var auditError: Error?
        do {
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
        } catch {
            auditError = error
        }
        XCTAssertTrue(
            failures.isEmpty,
            "Accessibility audit of the \(screen.rawValue) found:\n" + failures.joined(separator: "\n"))
        if let auditError {
            throw auditError
        }
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

    private func logIgnored(_ issue: XCUIAccessibilityAuditIssue, screen: Screen) {
        let element = issue.element
        XCTContext.runActivity(named: "Ignored audit issue on \(screen.rawValue)") { activity in
            let type = element.map { String($0.elementType.rawValue) } ?? "none"
            let label = element?.label ?? ""
            activity.add(
                XCTAttachment(
                    string: "element type: \(type)\nlabel: \(label)\n\(issue.compactDescription)"))
        }
    }
}
