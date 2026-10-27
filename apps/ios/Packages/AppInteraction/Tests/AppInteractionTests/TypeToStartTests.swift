import AppInteraction
import XCTest

final class TypeToStartTests: XCTestCase {
    private let ready = TypeToStartContext(
        enabled: true, treeLoaded: true, editorOpen: false, placeholderVisible: true,
        modalPresented: false, searchActive: false, textInputFocused: false)

    private func start(
        _ characters: String, _ modifiers: KeyModifiers = [], isRepeat: Bool = false,
        context: TypeToStartContext? = nil
    ) -> Bool {
        TypeToStart.shouldStart(
            characters: characters, modifiers: modifiers, isRepeat: isRepeat,
            context: context ?? ready)
    }

    func testAcceptsPrintableCharacters() {
        for characters in ["a", "Z", "7", ".", "#", "é", "ł", "😀"] {
            XCTAssertTrue(start(characters), characters)
        }
        XCTAssertTrue(start("A", .shift))
    }

    func testRejectsNonPrintableInput() {
        for characters in [
            "", " ", "\t", "\n", "\r", "ab", "e\u{301}", "\u{1B}", "\u{7F}", "\u{F700}", "\u{F8FF}",
        ] {
            XCTAssertFalse(start(characters), characters.debugDescription)
        }
    }

    func testRejectsCommandControlOption() {
        XCTAssertFalse(start("a", .command))
        XCTAssertFalse(start("a", .control))
        XCTAssertFalse(start("a", .option))
        XCTAssertFalse(start("a", [.shift, .command]))
    }

    func testRejectsRepeats() {
        XCTAssertFalse(start("a", isRepeat: true))
    }

    func testEachContextFlagBlocks() {
        var context = ready
        context.enabled = false
        XCTAssertFalse(start("a", context: context))
        context = ready
        context.treeLoaded = false
        XCTAssertFalse(start("a", context: context))
        context = ready
        context.editorOpen = true
        XCTAssertFalse(start("a", context: context))
        context = ready
        context.placeholderVisible = false
        XCTAssertFalse(start("a", context: context))
        context = ready
        context.modalPresented = true
        XCTAssertFalse(start("a", context: context))
        context = ready
        context.searchActive = true
        XCTAssertFalse(start("a", context: context))
        context = ready
        context.textInputFocused = true
        XCTAssertFalse(start("a", context: context))
    }

    func testBufferAppendsAndDrains() {
        var buffer = TypeToStartBuffer()
        buffer.append(.text("h"))
        buffer.append(.text("i"))
        buffer.append(.enter)
        buffer.append(.text("x"))
        XCTAssertEqual(buffer.text, "hi\nx")
        XCTAssertEqual(buffer.drain(), "hi\nx")
        XCTAssertEqual(buffer.text, "")
        XCTAssertEqual(buffer.drain(), "")
    }

    func testBackspaceRemovesLastCharacter() {
        var buffer = TypeToStartBuffer()
        buffer.append(.backspace)
        XCTAssertEqual(buffer.text, "")
        buffer.append(.text("ae\u{301}"))
        buffer.append(.backspace)
        XCTAssertEqual(buffer.text, "a")
        buffer.append(.other)
        XCTAssertEqual(buffer.text, "a")
    }
}
