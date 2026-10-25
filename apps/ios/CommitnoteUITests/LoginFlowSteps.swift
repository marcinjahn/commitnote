import XCTest

extension XCTestCase {
    func submitToken(_ token: String, in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let field = app.secureTextFields["login-token-field"]
        typeInto(field, token, in: app)
        XCTAssertTrue(
            poll(timeout: 20) { (field.value as? String)?.count == token.count },
            "Typed token length", file: file, line: line)
        tapRevealed(app.buttons["login-continue-button"], in: app)
    }

    /// A tap lost on an overloaded runner leaves the list up, so it is repeated until the list goes.
    func pickRepository(_ label: String, in app: XCUIApplication) {
        let row = app.element("login-repository-row", labelEndingWith: label)
        waitFor(row)
        waitUntilSettled(row)
        for _ in 0..<3 where row.exists {
            row.tap()
            if poll(timeout: 10, until: { !row.exists }) { break }
        }
    }

    func unlock(in app: XCUIApplication) {
        // Keys typed while the keyboard comes up on a busy simulator can be dropped, which would
        // read as a wrong passphrase, so the typed length is checked before unlocking.
        typeNewPassphrase(app.secureTextFields["login-passphrase-field"], Fixture.passphrase, in: app)
        tapRevealed(app.buttons["login-unlock-button"], in: app)
    }

    func logInToNotes(in app: XCUIApplication) {
        submitToken(Fixture.token, in: app)
        pickRepository(Fixture.notes, in: app)
        unlock(in: app)
        // Deriving the keys can take most of a minute on a freshly booted CI simulator.
        waitFor(app.element("notes-tree"), timeout: 60)
    }

    func folder(_ name: String, in app: XCUIApplication) -> XCUIElement {
        app.elements("tree-folder").matching(NSPredicate(format: "label == %@", name)).firstMatch
    }

    func note(_ name: String, in app: XCUIApplication) -> XCUIElement {
        app.elements("tree-note").matching(NSPredicate(format: "label == %@", name)).firstMatch
    }

    func hasCount(beside folder: XCUIElement, in app: XCUIApplication) -> Bool {
        let midY = folder.frame.midY
        return app.elements("tree-folder-count").allElementsBoundByIndex.contains { abs($0.frame.midY - midY) < 8 }
    }

    func expandFolder(_ name: String, in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let folder = folder(name, in: app)
        waitFor(folder, file: file, line: line)
        XCTAssertTrue(hasCount(beside: folder, in: app), "Collapsed folder shows its note count", file: file, line: line)
        folder.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(
            poll(timeout: 20) { !self.hasCount(beside: folder, in: app) }, "Expanded folder hides its note count",
            file: file, line: line)
    }
}
