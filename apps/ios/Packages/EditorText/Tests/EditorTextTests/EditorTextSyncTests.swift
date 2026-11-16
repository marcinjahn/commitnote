import EditorText
import XCTest

final class EditorTextSyncTests: XCTestCase {
    private func decide(
        noteSwitch: Int = 1, appliedSwitch: Int = 1, text: String = "b", doc: String = "a", base: String = "a",
        echo: Bool = false
    ) -> EditorTextSync {
        EditorTextSync.decide(
            noteSwitch: noteSwitch, appliedSwitch: appliedSwitch, text: text, doc: doc, base: base, echo: echo)
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

    func testALateReportOfUndoneTypingIsAcceptedAsAnEcho() {
        var sent = SentTexts()
        sent.record("T0 typed")
        sent.record("T0")
        let echo = sent.takeEcho("T0 typed")
        XCTAssertEqual(decide(text: "T0 typed", doc: "T0", base: "T0", echo: echo), .accept)
    }

    func testAcceptsALateEchoEvenWhenTheDocumentIsBackAtTheEngineText() {
        XCTAssertEqual(decide(echo: true), .accept)
    }

    func testReplacesTheDocumentOnANoteSwitchEvenForAnEcho() {
        XCTAssertEqual(decide(noteSwitch: 2, echo: true), .set)
    }

    func testASentTextReportedBackIsAnEchoAndEarlierSendsAreForgotten() {
        var sent = SentTexts()
        for text in ["a", "b", "c", "b"] {
            sent.record(text)
        }

        XCTAssertFalse(sent.takeEcho("never sent"))
        XCTAssertTrue(sent.takeEcho("c"))
        XCTAssertFalse(sent.takeEcho("a"))
        XCTAssertTrue(sent.takeEcho("b"))
        XCTAssertFalse(sent.takeEcho("b"))
    }

    func testOnlyTheLatestSendsAreRemembered() {
        var sent = SentTexts()
        for index in 0...SentTexts.limit {
            sent.record(String(index))
        }

        XCTAssertFalse(sent.takeEcho("0"))
        XCTAssertTrue(sent.takeEcho("1"))
    }

    func testNothingIsAnEchoAfterClearing() {
        var sent = SentTexts()
        sent.record("a")
        sent.clear()

        XCTAssertFalse(sent.takeEcho("a"))
    }
}
