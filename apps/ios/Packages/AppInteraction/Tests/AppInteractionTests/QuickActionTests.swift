import AppInteraction
import NativeCoreAPI
import XCTest

final class QuickActionTests: XCTestCase {
    func testRoundTrip() {
        for action in LaunchAction.allCases {
            XCTAssertEqual(QuickAction.action(forType: QuickAction.type(for: action)), action)
        }
    }

    func testTypes() {
        XCTAssertEqual(QuickAction.type(for: .newNote), "io.github.marcinjahn.commitnote.new-note")
        XCTAssertEqual(QuickAction.type(for: .search), "io.github.marcinjahn.commitnote.search")
    }

    func testUnknownTypeIsIgnored() {
        XCTAssertNil(QuickAction.action(forType: "other"))
        XCTAssertNil(QuickAction.action(forType: ""))
    }
}
