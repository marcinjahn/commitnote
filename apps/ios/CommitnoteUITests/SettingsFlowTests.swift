import XCTest

final class SettingsFlowTests: XCTestCase {
    private static var loggedIn = false

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

    func testAppearanceScopeAndPlacement() {
        let app = openNotes()
        openSettings(in: app)

        let colorMode = app.element("settings-color-mode")
        let dark = hittable(app.buttons.matching(NSPredicate(format: "label == %@", "Dark")))
        dark.tap()
        waitForCondition("Dark is the color mode") {
            (colorMode.value as? String) == "dark" || self.isSelected(dark)
        }

        let scope = app.element("settings-scope-accentColor")
        waitForValue(scope, "synced")
        scope.tap()
        waitForValue(scope, "device")
        let green = app.element("settings-accent-green")
        waitFor(green)
        green.tap()
        waitForCondition("Green is the accent color") { self.isSelected(green) }

        let font = app.element("settings-note-font")
        waitFor(font)
        font.tap()
        waitFor(app.element("settings-font-list"))
        let literata = app.element("settings-font-literata")
        revealInSettings(literata, within: "settings-font-list", in: app).tap()
        waitForCondition("The checkmark moves to Literata") {
            self.isSelected(literata) && !self.isSelected(app.element("settings-font-inter"))
        }
        tapBack(in: app)
        waitForValue(font, "literata")

        choosePickerOption("settings-new-note-placement", label: "At the end", value: "end", in: app)
        let save = revealInSettings(app.element("settings-save-status"), upward: true, tappable: false, in: app)
        waitForValue(save, "synced", timeout: 60)
        closeSettings(in: app)

        hittable(app.buttons.matching(identifier: "new-note-button")).tap()
        let nameField = app.element("draft-name-field")
        waitForFocus(nameField)
        nameField.typeText("Placed last\n")
        let editor = self.editor(in: app)
        waitForFocus(editor)
        editor.typeText("Created after the placement setting")
        waitForSaved(in: app)
        backToTree(in: app)
        waitFor(note("Placed last", in: app))
        waitForCondition("The new note is the last top-level row") {
            self.visibleTreeLabels(in: app).last == "Placed last"
        }
    }

    func testThisDevicePersists() {
        var app = openNotes()
        openSettings(in: app)
        let name = revealInSettings(app.textFields["settings-device-name"], in: app)
        typeInto(name, "Test device\n", in: app)
        setToggle("settings-reopen-last-view", on: false, in: app)
        setToggle("settings-analytics", on: false, in: app)
        closeSettings(in: app)
        openWelcome(in: app)
        waitForValue(syncStatus(in: app), "synced")

        app = relaunchWithoutReopening()
        openSettings(in: app)
        waitForValue(revealInSettings(app.textFields["settings-device-name"], in: app), "Test device")
        XCTAssertFalse(isOn(revealInSettings(app.switches["settings-reopen-last-view"], in: app)))
        XCTAssertFalse(isOn(revealInSettings(app.switches["settings-analytics"], in: app)))
        setToggle("settings-analytics", on: true, in: app)
        closeSettings(in: app)

        app = relaunchWithoutReopening()
        openSettings(in: app)
        XCTAssertFalse(isOn(revealInSettings(app.switches["settings-reopen-last-view"], in: app)))
        XCTAssertTrue(isOn(revealInSettings(app.switches["settings-analytics"], in: app)))
    }

    func testTypeToStartToggleAndScope() {
        let app = openNotes()
        openSettings(in: app)
        let toggle = revealInSettings(app.switches["settings-type-to-start"], in: app)
        XCTAssertTrue(isOn(toggle), "Type-to-start is on by default")
        revealInSettings(app.element("settings-editor-note"), tappable: false, in: app)

        setToggle("settings-type-to-start", on: false, in: app)
        setToggle("settings-type-to-start", on: true, in: app)

        let scope = app.buttons["settings-scope-typeToStart"]
        waitForValue(revealInSettings(scope, in: app), "device")
        XCTAssertTrue(scope.label.contains("This device"), "The scope reads This device")
        setScope("typeToStart", to: "synced", in: app)
        waitUntil(scope, NSPredicate(format: "label CONTAINS %@", "All devices"))
        waitForSettingsSaved(in: app)

        setScope("typeToStart", to: "device", in: app)
        waitUntil(scope, NSPredicate(format: "label CONTAINS %@", "This device"))
        XCTAssertTrue(isOn(revealInSettings(app.switches["settings-type-to-start"], in: app)))
        waitForSettingsSaved(in: app)
        closeSettings(in: app)
    }

    private func relaunchWithoutReopening() -> XCUIApplication {
        let app = launchApp(reset: false)
        waitFor(app.element("notes-tree"), timeout: 30)
        waitForValue(syncStatus(in: app), "synced")
        if isPad {
            waitFor(app.element("note-placeholder"))
        } else {
            XCTAssertFalse(app.element("note-view").exists, "No note is reopened")
        }
        XCTAssertFalse(editor(in: app).exists, "No note is reopened")
        return app
    }
}
