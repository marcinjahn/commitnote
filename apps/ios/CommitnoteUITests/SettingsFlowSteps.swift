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

    /// A tap on Done while a sheet over Settings is still going away is ignored, so it is repeated.
    func closeSettings(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let screen = app.element("settings-screen")
        for _ in 0..<3 where screen.exists {
            let done = app.buttons.matching(identifier: "settings-done")
            guard done.firstMatch.exists else { break }
            hittable(done, file: file, line: line).tap()
            if poll(timeout: 10, until: { !screen.exists }) { break }
        }
        waitUntilGone(screen, file: file, line: line)
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
        // A row still under the navigation bar or the keyboard counts as hittable, but a tap on it lands on them.
        let underBar: () -> Bool = { element.exists && element.frame.minY < form.frame.minY + 56 }
        let keyboard = app.keyboards.firstMatch
        let underKeyboard: () -> Bool = { keyboard.exists && keyboard.frame.intersects(element.frame) }
        let revealed: () -> Bool = {
            guard element.exists else { return false }
            if tappable { return element.isHittable && !underBar() && !underKeyboard() }
            let frame = element.frame
            return form.frame.contains(CGPoint(x: frame.midX, y: frame.midY))
        }
        // Drags stay in the form's upper part, which the keyboard never covers.
        let upper = form.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15))
        let lower = form.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.45))
        for _ in 0..<8 {
            if poll(timeout: 1, until: revealed) { return element }
            if upward || underBar() {
                upper.press(forDuration: 0.05, thenDragTo: lower)
            } else {
                lower.press(forDuration: 0.05, thenDragTo: upper)
            }
        }
        if tappable, element.exists, element.isHittable { return element }
        XCTAssertTrue(revealed(), "Expected \(element) in Settings", file: file, line: line)
        return element
    }

    func isOn(_ toggle: XCUIElement) -> Bool {
        toggle.exists && ["on", "1"].contains((toggle.value as? String) ?? "")
    }

    /// The switch follows the core's answer rather than the tap, so a tap is repeated only once
    /// the previous one has had time to come back.
    func setToggle(
        _ identifier: String, on: Bool, in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line
    ) {
        // The form can rebuild the row after a tap, so the switch is found again before each read.
        let toggle = app.switches[identifier]
        for _ in 0..<3 where !(toggle.exists && isOn(toggle) == on) {
            revealInSettings(toggle, in: app, file: file, line: line)
            let knob = toggle.switches.firstMatch
            if knob.exists {
                knob.tap()
            } else {
                toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
            }
            if poll(timeout: 10, until: { toggle.exists && self.isOn(toggle) == on }) { break }
        }
        revealInSettings(toggle, in: app, file: file, line: line)
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
