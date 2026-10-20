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

func launchApp(reset: Bool, appearance: Appearance = .light) -> XCUIApplication {
    let app = XCUIApplication()
    if reset {
        app.launchEnvironment["COMMITNOTE_UI_TEST_RESET"] = "1"
    }
    app.launchEnvironment["COMMITNOTE_UI_APPEARANCE"] = appearance.rawValue
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
    func waitFor(_ element: XCUIElement, timeout: TimeInterval = 20, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(
            element.waitForExistence(timeout: timeout), "Expected \(element) to exist", file: file, line: line)
    }

    func scrollToReveal(_ element: XCUIElement, in app: XCUIApplication) {
        var attempts = 0
        while !element.isHittable && attempts < 6 {
            app.swipeUp()
            attempts += 1
        }
    }

    func tapRevealed(_ element: XCUIElement, in app: XCUIApplication) {
        waitFor(element)
        scrollToReveal(element, in: app)
        element.tap()
    }

    func typeInto(_ field: XCUIElement, _ text: String, in app: XCUIApplication) {
        waitFor(field)
        scrollToReveal(field, in: app)
        field.tap()
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
