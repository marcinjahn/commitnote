import UIKit
import XCTest

enum Appearance: String {
    case light
    case dark
}

enum Fixture {
    static let token = "test-token"
    static let passphrase = "sample notes repo passphrase"
    static let notes = "sample/notes"
    static let empty = "sample/empty"
    static let newer = "sample/newer"
    static let publicEmpty = "sample/public-empty"
}

var isPad: Bool {
    UIDevice.current.userInterfaceIdiom == .pad
}

private struct LaunchOptions: Equatable {
    let appearance: Appearance
    let editorHooks: Bool
    let contentSize: String?
}

/// What the running app was launched with, while the tests can restart it in its process.
private nonisolated(unsafe) var runningLaunch: LaunchOptions?
private nonisolated(unsafe) var appReady = false

private let appReadyCallback: CFNotificationCallback = { _, _, _, _, _ in
    appReady = true
}

private let appReadyObserver: Void = {
    CFNotificationCenterAddObserver(
        CFNotificationCenterGetDarwinNotifyCenter(), nil, appReadyCallback,
        "io.github.marcinjahn.commitnote.testing.ready" as CFString, nil, .deliverImmediately)
}()

func launchApp(
    reset: Bool, appearance: Appearance = .light, holdLoading: Bool = false, editorHooks: Bool = false,
    contentSize: String? = nil
) -> XCUIApplication {
    runningLaunch =
        holdLoading
        ? nil : LaunchOptions(appearance: appearance, editorHooks: editorHooks, contentSize: contentSize)
    let app = XCUIApplication()
    if let contentSize {
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", contentSize]
    }
    if reset {
        app.launchEnvironment["COMMITNOTE_UI_TEST_RESET"] = "1"
    }
    app.launchEnvironment["COMMITNOTE_UI_APPEARANCE"] = appearance.rawValue
    app.launchEnvironment["COMMITNOTE_UI_ANIMATION_SPEED"] = "5"
    if holdLoading {
        app.launchEnvironment["COMMITNOTE_UI_HOLD_LOADING"] = "1"
    }
    if editorHooks {
        app.launchEnvironment["COMMITNOTE_UI_EDITOR_HOOKS"] = "1"
    }
    prepareAnimationIdleForLaunch()
    app.launch()
    return app
}

extension XCUIApplication {
    func element(_ identifier: String) -> XCUIElement {
        descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    func elements(_ identifier: String) -> XCUIElementQuery {
        descendants(matching: .any).matching(identifier: identifier)
    }

    func element(_ identifier: String, labelEndingWith suffix: String) -> XCUIElement {
        elements(identifier).matching(NSPredicate(format: "label ENDSWITH %@", suffix)).firstMatch
    }
}

extension XCUIElement {
    var text: String {
        let value = (self.value as? String) ?? ""
        return "\(label) \(value)"
    }
}

extension XCTestCase {
    /// Restarts the running app's model and core in place, as a relaunch without a reset would,
    /// and waits until it has settled. False when the app runs with other launch options or does
    /// not settle, so the caller relaunches it instead.
    func restartInProcess(
        appearance: Appearance, editorHooks: Bool, contentSize: String? = nil
    ) -> XCUIApplication? {
        _ = appReadyObserver
        let app = XCUIApplication()
        guard
            runningLaunch
                == LaunchOptions(appearance: appearance, editorHooks: editorHooks, contentSize: contentSize),
            app.state == .runningForeground
        else { return nil }
        appReady = false
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(),
            CFNotificationName("io.github.marcinjahn.commitnote.testing.relaunch" as CFString), nil, nil, true)
        return poll(timeout: 30, until: { appReady }) ? app : nil
    }

    /// XCTest's own waits first look a second after they start and then once a second, which adds
    /// up to minutes over a suite, so conditions are checked at once and then every quarter second.
    @discardableResult
    func poll(timeout: TimeInterval, until condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition() {
            if Date() >= deadline {
                return condition()
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return true
    }

    func openLink(_ link: String, file: StaticString = #filePath, line: UInt = #line) {
        guard let url = URL(string: link) else {
            XCTFail("Not a valid link", file: file, line: line)
            return
        }
        // XCUIApplication.open relaunches the app with the link; the system hands it to the running one.
        XCUIDevice.shared.system.open(url)
        let confirm = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Open"]
        if confirm.waitForExistence(timeout: 2) {
            confirm.tap()
        }
        let app = XCUIApplication()
        XCTAssertTrue(
            poll(timeout: 20) { app.state == .runningForeground }, "App did not come to the foreground",
            file: file, line: line)
    }

    /// The system launches the app without any of the test's launch options, so the next test
    /// launches it afresh instead of restarting it in its process.
    func launchThroughLink(_ link: String, file: StaticString = #filePath, line: UInt = #line) -> XCUIApplication {
        runningLaunch = nil
        prepareAnimationIdleForLaunch()
        openLink(link, file: file, line: line)
        return XCUIApplication()
    }

    func pressShortcut(
        _ key: String, modifiers: XCUIElement.KeyModifierFlags = .command, until effect: () -> Bool,
        file: StaticString = #filePath, line: UInt = #line
    ) {
        let app = XCUIApplication()
        let focused = app.descendants(matching: .any).matching(NSPredicate(format: "hasKeyboardFocus == true"))
            .firstMatch
        // The simulator sometimes loses a modified key press, mostly the first one after other
        // input, so the shortcut is sent until its effect shows.
        for _ in 0..<3 {
            if focused.exists {
                focused.typeKey(key, modifierFlags: modifiers)
            } else {
                app.typeKey(key, modifierFlags: modifiers)
            }
            if poll(timeout: 10, until: effect) { return }
        }
        XCTFail("Shortcut had no effect after three attempts", file: file, line: line)
    }

    /// Never resends: a key that landed late would type its character twice.
    func typeKeys(
        _ text: String, until effect: () -> Bool, file: StaticString = #filePath, line: UInt = #line
    ) {
        let app = XCUIApplication()
        for character in text {
            app.typeKey(String(character), modifierFlags: [])
        }
        XCTAssertTrue(poll(timeout: 10, until: effect), "Typed keys had no effect", file: file, line: line)
    }

    func switchWidth(
        to value: String, in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line
    ) {
        let width = app.element("testing-width")
        for _ in 0..<3 {
            if width.exists && (width.value as? String) == value { return }
            useTestingMenu("testing-switch-width", in: app, file: file, line: line)
            if poll(timeout: 5, until: { (width.value as? String) == value }) { return }
        }
        XCTAssertEqual(width.value as? String, value, "Forced width", file: file, line: line)
    }

    func waitForTypeToStartReady(
        in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line
    ) {
        let state = app.element("testing-type-to-start")
        XCTAssertTrue(
            poll(timeout: 20) { (state.value as? String) == "ready" }, "Type-to-start was not ready",
            file: file, line: line)
    }

    func appears(_ element: XCUIElement, within timeout: TimeInterval) -> Bool {
        poll(timeout: timeout) { element.exists }
    }

    func waitFor(_ element: XCUIElement, timeout: TimeInterval = 20, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(appears(element, within: timeout), "Expected \(element) to exist", file: file, line: line)
    }

    func scrollToReveal(_ element: XCUIElement, in app: XCUIApplication) {
        var attempts = 0
        while (!element.isHittable || isUnderKeyboard(element, in: app)) && attempts < 6 {
            app.swipeUp()
            attempts += 1
        }
    }

    /// The keyboard lives in another process, so `isHittable` still holds for an element it covers,
    /// and a tap there presses a key instead.
    func isUnderKeyboard(_ element: XCUIElement, in app: XCUIApplication) -> Bool {
        let keyboard = app.keyboards.firstMatch
        return keyboard.exists && element.frame.maxY > keyboard.frame.minY
    }

    func tapRevealed(_ element: XCUIElement, in app: XCUIApplication) {
        // A form leaves rows scrolled out of view out of the hierarchy, as at large text sizes.
        if !appears(element, within: 10) {
            for _ in 0..<6 where !element.exists {
                let start = revealDragStart(in: app)
                start.press(
                    forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: -0.25 * app.frame.height)))
                _ = appears(element, within: 2)
            }
        }
        waitFor(element)
        scrollToReveal(element, in: app)
        element.tap()
    }

    /// Above the keyboard, which would take a swipe through the middle of the screen, and off the
    /// focused field, where a drag moves the caret and opens the edit menu instead of scrolling.
    private func revealDragStart(in app: XCUIApplication) -> XCUICoordinate {
        let height = app.frame.height
        var y = 0.4 * height
        let focused = app.descendants(matching: .any).matching(NSPredicate(format: "hasKeyboardFocus == true"))
            .firstMatch
        if focused.exists {
            let field = focused.frame.insetBy(dx: 0, dy: -16)
            if field.minY <= y, y <= field.maxY {
                let keyboard = app.keyboards.firstMatch
                let keyboardTop = keyboard.exists ? keyboard.frame.minY : height
                y = field.maxY + 8 < keyboardTop - 16 ? field.maxY + 8 : field.minY - 8
            }
        }
        return app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: app.frame.width / 2, dy: y))
    }

    func typeInto(_ field: XCUIElement, _ text: String, in app: XCUIApplication) {
        waitFor(field)
        scrollToReveal(field, in: app)
        for _ in 0..<3 {
            field.tap()
            if poll(timeout: 5, until: { hasKeyboardFocus(field) }) { break }
        }
        field.typeText(text)
    }

    func typeNewPassphrase(
        _ field: XCUIElement, _ text: String, replacing existing: Int = 0, in app: XCUIApplication,
        file: StaticString = #filePath, line: UInt = #line
    ) {
        typeInto(field, String(repeating: XCUIKeyboardKey.delete.rawValue, count: existing) + text, in: app)
        for _ in 0..<2 where (field.value as? String)?.count != text.count {
            let current = (field.value as? String)?.count ?? 0
            field.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.5)).tap()
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current) + text)
        }
        XCTAssertEqual((field.value as? String)?.count, text.count, "Typed passphrase length", file: file, line: line)
    }
}
