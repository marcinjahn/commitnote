import XCTest

enum ImportSample {
    static let fileName = "sample-import.zip"
    static let folder = "sample-import"
    static let plan = "Imported plan"
    static let planFirstLine = "# Imported plan"
    static let renamedWelcome = "Welcome (2)"
}

extension XCTestCase {
    func openSettings(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        backToTree(in: app, file: file, line: line)
        let button = app.buttons["settings-button"]
        for _ in 0..<3 {
            hittable(app.buttons.matching(identifier: "notes-menu-button"), file: file, line: line).tap()
            if appears(button, within: 5) { break }
        }
        waitFor(button, file: file, line: line)
        button.tap()
        waitFor(app.element("settings-screen"), timeout: 30, file: file, line: line)
    }

    func closeSettings(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        hittable(app.buttons.matching(identifier: "settings-done"), file: file, line: line).tap()
        waitUntilGone(app.element("settings-screen"), file: file, line: line)
    }

    /// Form and list rows exist only once scrolled into view, so the form is swiped until the row can be
    /// tapped, towards the end unless the row lies above the ones looked for before it. A row that
    /// only groups text is never hittable, so for it being on screen is enough.
    @discardableResult
    func revealInSettings(
        _ element: XCUIElement, upward: Bool = false, tappable: Bool = true, within container: String = "settings-screen",
        in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line
    ) -> XCUIElement {
        let form = app.element(container)
        waitFor(form, file: file, line: line)
        // A row that still sits under the navigation bar counts as hittable, but a tap on it lands on the bar.
        let underBar: () -> Bool = { element.exists && element.frame.minY < form.frame.minY + 56 }
        let revealed: () -> Bool = {
            guard element.exists else { return false }
            if tappable { return element.isHittable && !underBar() }
            let frame = element.frame
            return form.frame.contains(CGPoint(x: frame.midX, y: frame.midY))
        }
        for _ in 0..<8 {
            if poll(timeout: 1, until: revealed) { return element }
            if upward || underBar() {
                form.swipeDown(velocity: .slow)
            } else {
                form.swipeUp()
            }
        }
        if tappable, element.exists, element.isHittable { return element }
        XCTAssertTrue(revealed(), "Expected \(element) in Settings", file: file, line: line)
        return element
    }

    func isOn(_ toggle: XCUIElement) -> Bool {
        ["on", "1"].contains((toggle.value as? String) ?? "")
    }

    /// The switch follows the core's answer rather than the tap, so a tap is repeated only once
    /// the previous one has had time to come back.
    func setToggle(
        _ identifier: String, on: Bool, in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line
    ) {
        let toggle = revealInSettings(app.switches[identifier], in: app, file: file, line: line)
        for _ in 0..<3 where isOn(toggle) != on {
            let knob = toggle.switches.firstMatch
            if knob.exists {
                knob.tap()
            } else {
                toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
            }
            if poll(timeout: 10, until: { self.isOn(toggle) == on }) { break }
        }
        XCTAssertEqual(isOn(toggle), on, "\(identifier) is \(on ? "on" : "off")", file: file, line: line)
    }

    func isSelected(_ element: XCUIElement) -> Bool {
        element.exists && element.isSelected
    }

    /// Menu picker options carry no identifiers of their own, and the closed picker shows its
    /// current option as part of its own label.
    func choosePickerOption(
        _ identifier: String, label: String, value: String, in app: XCUIApplication,
        file: StaticString = #filePath, line: UInt = #line
    ) {
        let picker = revealInSettings(app.element(identifier), in: app, file: file, line: line)
        let options = app.buttons.matching(
            NSPredicate(format: "label == %@ AND NOT (identifier BEGINSWITH %@)", label, "settings-"))
        whileMenuIsOpen {
            for _ in 0..<3 {
                waitFullyBeforeNextMenuEvent()
                picker.tap()
                if appears(options.firstMatch, within: 5) { break }
            }
            hittable(options, file: file, line: line).tap()
        }
        waitForCondition("\(identifier) shows \(label)", file: file, line: line) {
            (picker.value as? String) == value || picker.text.contains(label)
        }
    }

    func chooseExport(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let button = revealInSettings(app.buttons["settings-export-button"], in: app, file: file, line: line)
        waitUntil(button, NSPredicate(format: "enabled == true"), file: file, line: line)
        whileMenuIsOpen {
            openMenu(
                app.buttons.matching(identifier: "settings-export-button"), expecting: "settings-export-share",
                label: "Share", in: app, file: file, line: line)
            tapMenuItem("settings-export-share", label: "Share", in: app, file: file, line: line)
        }
    }

    func openSampleImport(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        backToTree(in: app, file: file, line: line)
        useTestingMenu("testing-import-archive", in: app, file: file, line: line)
        waitFor(app.element("import-screen"), timeout: 30, file: file, line: line)
    }

    func waitForImportPreview(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let preview = app.element("import-preview")
        waitFor(preview, timeout: 30, file: file, line: line)
        waitUntil(preview, NSPredicate(format: "label CONTAINS %@", "3 notes"), file: file, line: line)
    }

    func openChangePassphrase(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let button = revealInSettings(
            app.buttons["settings-change-passphrase-button"], in: app, file: file, line: line)
        waitUntil(button, NSPredicate(format: "enabled == true"), file: file, line: line)
        button.tap()
        waitFor(app.element("change-passphrase-screen"), timeout: 30, file: file, line: line)
        waitFor(app.secureTextFields["change-passphrase-new"], timeout: 30, file: file, line: line)
    }
}
