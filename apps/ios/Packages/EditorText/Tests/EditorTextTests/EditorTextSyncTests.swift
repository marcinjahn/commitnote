import EditorText
import XCTest

final class EditorTextSyncTests: XCTestCase {
    private func decide(
        noteSwitch: Int = 1, appliedSwitch: Int = 1, text: String = "b", doc: String = "a", base: String = "a"
    ) -> EditorTextSync {
        EditorTextSync.decide(noteSwitch: noteSwitch, appliedSwitch: appliedSwitch, text: text, doc: doc, base: base)
    }

    func testReplacesTheDocumentOnANoteSwitchEvenOverTypedText() {
        XCTAssertEqual(decide(noteSwitch: 2, doc: "typed"), .set)
    }

    func testAcceptsTheTextWhenTheEngineCaughtUpWithTheDocument() {
        XCTAssertEqual(decide(text: "a", doc: "a", base: "x"), .accept)
    }

    func testUpdatesInPlaceWhenTheDocumentIsUntouchedSinceTheLastEngineText() {
        XCTAssertEqual(decide(), .update)
    }

    func testSkipsWhenTheUserTypedSinceTheLastEngineText() {
        XCTAssertEqual(decide(doc: "a!"), .skip)
    }
}
