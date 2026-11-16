import AppInteraction
import Foundation
import NativeCoreAPI
import XCTest

final class LaunchLinkTests: XCTestCase {
    private func action(_ string: String) -> LaunchAction? {
        LaunchLink.action(from: URL(string: string)!)
    }

    func testHostSelectsAction() {
        XCTAssertEqual(action("commitnote://new-note"), .newNote)
        XCTAssertEqual(action("commitnote://search"), .search)
        XCTAssertEqual(action("commitnote://SEARCH"), .search)
        XCTAssertEqual(action("COMMITNOTE://search"), .search)
        XCTAssertEqual(action("commitnote://new-note/extra"), .newNote)
    }

    func testQueryItemSelectsAction() {
        XCTAssertEqual(action("commitnote://?action=search"), .search)
        XCTAssertEqual(action("commitnote://open?action=new-note"), .newNote)
        XCTAssertEqual(action("commitnote://open?x=1&action=search"), .search)
    }

    func testFirstActionItemWins() {
        XCTAssertNil(action("commitnote://open?action=bogus&action=search"))
    }

    func testUnknownLinksAreIgnored() {
        XCTAssertNil(action("commitnote://"))
        XCTAssertNil(action("commitnote://other"))
        XCTAssertNil(action("commitnote://?action=New-Note"))
        XCTAssertNil(action("https://example.com/?action=search"))
        XCTAssertNil(action("https://search"))
    }
}
