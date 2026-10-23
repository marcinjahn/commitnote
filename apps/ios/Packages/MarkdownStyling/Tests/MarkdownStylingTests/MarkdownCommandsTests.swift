import EditorText
import Foundation
import MarkdownStyling
import XCTest

final class MarkdownCommandsTests: XCTestCase {
    private typealias Command = (String, TextSelection) -> CommandResult?

    private func select(_ text: String, _ word: String) -> TextSelection {
        let from = (text as NSString).range(of: word).location
        return TextSelection(location: from, length: word.utf16.count)
    }

    private func caret(_ at: Int) -> TextSelection { TextSelection(location: at, length: 0) }

    private func run(_ command: Command, _ text: String, _ selection: TextSelection) -> (String, TextSelection)? {
        guard let result = command(text, selection) else { return nil }
        return (TextEdits.apply(result.edits, to: text), result.selection)
    }

    private func selectedText(_ text: String, _ selection: TextSelection) -> String {
        let units = Array(text.utf16)
        return String(decoding: units[selection.location..<(selection.location + selection.length)], as: UTF16.self)
    }

    private let formats: [(String, Command, String)] = [
        ("bold", MarkdownCommands.toggleBold, "**"),
        ("italic", MarkdownCommands.toggleItalic, "*"),
        ("strikethrough", MarkdownCommands.toggleStrikethrough, "~~"),
    ]

    // MARK: Formatting

    func testFormatWrapsAndKeepsSelection() {
        for (name, command, marker) in formats {
            let text = "a word b"
            let result = run(command, text, select(text, "word"))
            XCTAssertEqual(result?.0, "a \(marker)word\(marker) b", name)
            XCTAssertEqual(selectedText(result!.0, result!.1), "word", name)
        }
    }

    func testFormatUnwrapsMarkersInsideSelection() {
        for (name, command, marker) in formats {
            let text = "a \(marker)word\(marker) b"
            let result = run(command, text, select(text, "\(marker)word\(marker)"))
            XCTAssertEqual(result?.0, "a word b", name)
            XCTAssertEqual(selectedText(result!.0, result!.1), "word", name)
        }
    }

    func testFormatRemovesMarkersOutsideSelection() {
        for (name, command, marker) in formats {
            let text = "a \(marker)word\(marker) b"
            let result = run(command, text, select(text, "word"))
            XCTAssertEqual(result?.0, "a word b", name)
            XCTAssertEqual(selectedText(result!.0, result!.1), "word", name)
        }
    }

    func testFormatEmptySelectionInsertsPair() {
        for (name, command, marker) in formats {
            let result = run(command, "ab", caret(1))
            XCTAssertEqual(result?.0, "a\(marker)\(marker)b", name)
            XCTAssertEqual(result?.1, caret(1 + marker.utf16.count), name)
        }
    }

    func testFormatSkipsMultiLineAndCode() {
        for (name, command, _) in formats {
            XCTAssertNil(command("one\ntwo", TextSelection(location: 1, length: 5)), name)
            XCTAssertNil(command("a `word` b", select("a `word` b", "word")), name)
            XCTAssertNil(command("```\nword\n```", select("```\nword\n```", "word")), name)
            XCTAssertNil(command("a `b` c", caret(4)), name)
        }
    }

    func testFormatLinkText() {
        for (name, command, marker) in formats {
            let text = "[word](https://x.y)"
            XCTAssertEqual(run(command, text, select(text, "word"))?.0, "[\(marker)word\(marker)](https://x.y)", name)
        }
    }

    func testItalicVersusBold() {
        XCTAssertEqual(run(MarkdownCommands.toggleItalic, "a **word** b", select("a **word** b", "word"))?.0, "a ***word*** b")
        XCTAssertEqual(run(MarkdownCommands.toggleItalic, "a ***word*** b", select("a ***word*** b", "word"))?.0, "a **word** b")
        XCTAssertEqual(
            run(MarkdownCommands.toggleItalic, "a ***word*** b", select("a ***word*** b", "***word***"))?.0, "a **word** b")
        XCTAssertEqual(run(MarkdownCommands.toggleBold, "a ***word*** b", select("a ***word*** b", "word"))?.0, "a *word* b")
        XCTAssertEqual(
            run(MarkdownCommands.toggleItalic, "a **word** b", select("a **word** b", "**word**"))?.0, "a ***word*** b")
    }

    func testFormatClampsOutOfRangeSelection() {
        XCTAssertEqual(run(MarkdownCommands.toggleBold, "ab", TextSelection(location: 1, length: 10))?.0, "a**b**")
    }

    // MARK: Link insert

    func testInsertLinkWrapsSelectionWithCaretInParentheses() {
        let text = "a word b"
        let result = run(MarkdownCommands.insertLink, text, select(text, "word"))
        XCTAssertEqual(result?.0, "a [word]() b")
        XCTAssertEqual(result?.1, caret("a [word](".utf16.count))
    }

    func testInsertLinkEscapesBrackets() {
        let text = "a x] b"
        XCTAssertEqual(run(MarkdownCommands.insertLink, text, select(text, "x]"))?.0, "a [x\\]]() b")
    }

    func testInsertLinkEmptySelection() {
        let result = run(MarkdownCommands.insertLink, "ab", caret(1))
        XCTAssertEqual(result?.0, "a[]()b")
        XCTAssertEqual(result?.1, caret(2))
    }

    func testInsertLinkSkippedOverLinksCodeAndMultipleLines() {
        let link = "[word](https://x.y)"
        XCTAssertNil(MarkdownCommands.insertLink(link, select(link, "word")))
        let bare = "see https://x.y now"
        XCTAssertNil(MarkdownCommands.insertLink(bare, select(bare, "https://x.y")))
        XCTAssertNil(MarkdownCommands.insertLink("one\ntwo", TextSelection(location: 1, length: 5)))
        XCTAssertNil(MarkdownCommands.insertLink("a `word` b", select("a `word` b", "word")))
        XCTAssertNil(MarkdownCommands.insertLink(link, caret(3)))
    }

    // MARK: Tasks

    private func toggled(_ text: String, _ at: Int, _ length: Int = 0) -> (String, TextSelection)? {
        run(MarkdownCommands.toggleTask, text, TextSelection(location: at, length: length))
    }

    func testTaskFlipsMarker() {
        XCTAssertEqual(toggled("- [ ] milk", 3)?.0, "- [x] milk")
        XCTAssertEqual(toggled("- [x] milk", 3)?.0, "- [ ] milk")
        XCTAssertEqual(toggled("- [X] milk", 3)?.0, "- [ ] milk")
    }

    func testTaskAddsCheckboxToListItems() {
        XCTAssertEqual(toggled("- milk", 4)?.0, "- [ ] milk")
        XCTAssertEqual(toggled("1. milk", 5)?.0, "1. [ ] milk")
        XCTAssertEqual(toggled("-", 0)?.0, "- [ ] ")
    }

    func testTaskTurnsParagraphAndEmptyLinesIntoTasks() {
        XCTAssertEqual(toggled("milk", 2)?.0, "- [ ] milk")
        XCTAssertEqual(toggled("", 0)?.0, "- [ ] ")
        XCTAssertEqual(toggled("# t\n\nmilk", 5)?.0, "# t\n\n- [ ] milk")
        XCTAssertEqual(toggled("  milk", 3)?.0, "  - [ ] milk")
        XCTAssertEqual(toggled("a\n", 2)?.0, "a\n- [ ] ")
    }

    func testTaskSkipsHeadingsCodeTablesQuotesAndBlankLines() {
        let skipped: [(String, Int)] = [
            ("# title", 3), ("```\ncode\n```", 5), ("| a | b |\n| - | - |\n| 1 | 2 |", 3),
            ("- item\n  more", 10), ("> quote", 4), ("---", 1), ("    indented", 6), ("a\n   \nb", 3),
            ("Title\n===", 1),
        ]
        for (text, at) in skipped { XCTAssertNil(toggled(text, at), text) }
    }

    func testTaskTogglesEveryTouchedLine() {
        let text = "- [ ] a\n# h\nplain\n- b"
        XCTAssertEqual(toggled(text, 3, text.utf16.count - 3)?.0, "- [x] a\n# h\n- [ ] plain\n- [ ] b")
    }

    func testTaskMapsSelectionThroughEdits() {
        XCTAssertEqual(toggled("- [ ] milk", 8)?.1, caret(8))
        XCTAssertEqual(toggled("- milk", 4)?.1, caret(8))
        XCTAssertEqual(toggled("milk", 0)?.1, caret(6))
        let ranged = toggled("a\nb", 0, 3)
        XCTAssertEqual(ranged?.0, "- [ ] a\n- [ ] b")
        XCTAssertEqual(ranged?.1, TextSelection(location: 6, length: 9))
    }

    func testTaskDoesNotAddBlankLine() {
        XCTAssertEqual(toggled("a\nb", 1)?.0.split(separator: "\n", omittingEmptySubsequences: false).count, 2)
    }

    func testToggleCheckboxWritesLowercaseMarker() {
        let text = "- [ ] a\n- [x] b\n- [X] c"
        XCTAssertEqual(apply(MarkdownCommands.toggleCheckbox(text, markerRange: 2..<5), text), "- [x] a\n- [x] b\n- [X] c")
        XCTAssertEqual(apply(MarkdownCommands.toggleCheckbox(text, markerRange: 10..<13), text), "- [ ] a\n- [ ] b\n- [X] c")
        XCTAssertEqual(apply(MarkdownCommands.toggleCheckbox(text, markerRange: 18..<21), text), "- [ ] a\n- [x] b\n- [ ] c")
    }

    private func apply(_ result: CommandResult, _ text: String) -> String {
        TextEdits.apply(result.edits, to: text)
    }

    // MARK: Openable URLs

    func testOpenableURL() {
        XCTAssertEqual(MarkdownCommands.openableURL("https://a.b/c")?.absoluteString, "https://a.b/c")
        XCTAssertEqual(MarkdownCommands.openableURL("http://a.b")?.absoluteString, "http://a.b")
        XCTAssertEqual(MarkdownCommands.openableURL("www.a.b")?.absoluteString, "https://www.a.b")
        XCTAssertEqual(MarkdownCommands.openableURL("WWW.A.B")?.absoluteString, "https://WWW.A.B")
        XCTAssertEqual(MarkdownCommands.openableURL("me+x@a-b.co.uk")?.absoluteString, "mailto:me+x@a-b.co.uk")
        XCTAssertEqual(MarkdownCommands.openableURL("mailto:me@a.b")?.absoluteString, "mailto:me@a.b")
        XCTAssertEqual(MarkdownCommands.openableURL("HTTPS://a.b")?.absoluteString, "HTTPS://a.b")
    }

    func testOpenableURLRejectsOtherSchemesAndText() {
        for raw in ["javascript:alert(1)", "ftp://a.b", "file:///etc/passwd", "image:abc", "foo", "a@b", "relative/path", "", "@a.b"] {
            XCTAssertNil(MarkdownCommands.openableURL(raw), raw)
        }
    }

    // MARK: Link at position

    private func linkURL(_ text: String, at offset: Int) -> String? {
        MarkdownCommands.linkURL(in: MarkdownParser.parse(text), at: offset)?.absoluteString
    }

    func testLinkURLForInlineLinkAtAnyPart() {
        let text = "x [label](https://a.b/c) y"
        for offset in [3, 5, 8, 9, 12, 20, 23] { XCTAssertEqual(linkURL(text, at: offset), "https://a.b/c", "\(offset)") }
        XCTAssertNil(linkURL(text, at: 0))
        XCTAssertNil(linkURL(text, at: 25))
    }

    func testLinkURLForAutolinkAndBareURLs() {
        XCTAssertEqual(linkURL("a <https://a.b> b", at: 5), "https://a.b")
        XCTAssertEqual(linkURL("see https://a.b now", at: 6), "https://a.b")
        XCTAssertEqual(linkURL("see www.a.b now", at: 6), "https://www.a.b")
        XCTAssertEqual(linkURL("mail a@b.co now", at: 6), "mailto:a@b.co")
    }

    func testLinkURLNormalisesAndRejects() {
        XCTAssertEqual(linkURL("[a](www.a.b)", at: 1), "https://www.a.b")
        XCTAssertNil(linkURL("[a](javascript:alert(1))", at: 1))
        XCTAssertNil(linkURL("[a](relative/path)", at: 1))
        XCTAssertNil(linkURL("[a]()", at: 1))
        XCTAssertNil(linkURL("![a](image:abcdefghijklmnopqrstuvwxyz)", at: 5))
        XCTAssertEqual(linkURL("[a](<https://a.b/(x)>)", at: 1), "https://a.b/(x)")
    }

    func testLinkURLOfURLLabelOpensDestination() {
        XCTAssertEqual(linkURL("[https://a.b](https://c.d)", at: 4), "https://c.d")
    }

    // MARK: Paste link

    private func paste(_ text: String, _ selected: String, _ pasted: String) -> (String, TextSelection)? {
        guard let result = MarkdownCommands.pasteLink(text, select(text, selected), pasted) else { return nil }
        return (TextEdits.apply(result.edits, to: text), result.selection)
    }

    func testPasteURLOverSelectionMakesLink() {
        let result = paste("see docs now", "docs", "https://a.b/c")
        XCTAssertEqual(result?.0, "see [docs](https://a.b/c) now")
        XCTAssertEqual(result?.1, caret("see [docs](https://a.b/c)".utf16.count))
        XCTAssertEqual(paste("a b", "b", "  https://a.b\n")?.0, "a [b](https://a.b)")
    }

    func testPasteNormalisesWwwAndEmail() {
        XCTAssertEqual(paste("a b", "b", "www.a.b")?.0, "a [b](https://www.a.b)")
        XCTAssertEqual(paste("a b", "b", "WWW.a.b")?.0, "a [b](https://WWW.a.b)")
        XCTAssertEqual(paste("a b", "b", "me@a.b")?.0, "a [b](mailto:me@a.b)")
        XCTAssertEqual(paste("a b", "b", "mailto:me@a.b")?.0, "a [b](mailto:me@a.b)")
    }

    func testPasteWrapsParenthesesAndRejectsAngleBrackets() {
        XCTAssertEqual(paste("a b", "b", "https://a.b/x_(y)")?.0, "a [b](<https://a.b/x_(y)>)")
        XCTAssertNil(paste("a b", "b", "https://a.b/<x>"))
    }

    func testPasteEscapesLabelBrackets() {
        XCTAssertEqual(paste("a [x] b", "[x]", "https://a.b")?.0, "a [\\[x\\]](https://a.b) b")
    }

    func testPasteRejectsNonURLsAndWhitespace() {
        for pasted in ["hello", "two words", "https://a.b and more", "", "   ", "ftp://a.b", "javascript:alert(1)"] {
            XCTAssertNil(paste("a b", "b", pasted), pasted)
        }
    }

    func testPasteRequiresOneNonEmptySingleLineSelection() {
        XCTAssertNil(MarkdownCommands.pasteLink("a b", caret(1), "https://a.b"))
        XCTAssertNil(MarkdownCommands.pasteLink("a\nb", TextSelection(location: 0, length: 3), "https://a.b"))
    }

    func testPasteRejectedOverCodeAndLinks() {
        XCTAssertNil(paste("a `code` b", "code", "https://a.b"))
        XCTAssertNil(paste("```\ncode\n```", "code", "https://a.b"))
        XCTAssertNil(paste("    code", "code", "https://a.b"))
        XCTAssertNil(paste("[word](https://x.y)", "word", "https://a.b"))
        XCTAssertNil(paste("see https://x.y now", "https://x.y", "https://a.b"))
        XCTAssertNil(paste("<https://x.y>", "https://x.y", "https://a.b"))
        XCTAssertNil(paste("![alt](image:abcdefghijklmnopqrstuvwxyz)", "alt", "https://a.b"))
    }

    func testPasteAllowedAdjacentToCode() {
        XCTAssertEqual(paste("`c` word", "word", "https://a.b")?.0, "`c` [word](https://a.b)")
    }

    private func insertImages(
        _ text: String, at position: Int, _ selection: TextSelection, _ references: [String] = ["![a](image:x)"]
    ) -> (String, TextSelection)? {
        guard
            let result = MarkdownCommands.insertImageReferences(
                text: text, at: position, selection: selection, references: references)
        else { return nil }
        return (TextEdits.apply(result.edits, to: text), result.selection)
    }

    func testInsertImageReferencesMidLineCaret() {
        let result = insertImages("hello world", at: 5, caret(5))
        XCTAssertEqual(result?.0, "hello\n![a](image:x)\n world")
        XCTAssertEqual(result?.1, caret(5 + 15))
    }

    func testInsertImageReferencesAtLineStart() {
        let result = insertImages("one\ntwo", at: 4, caret(4))
        XCTAssertEqual(result?.0, "one\n![a](image:x)\ntwo")
        XCTAssertEqual(result?.1, caret(4 + 14))
    }

    func testInsertImageReferencesAtEndOfLastLine() {
        let result = insertImages("one", at: 3, caret(3))
        XCTAssertEqual(result?.0, "one\n![a](image:x)\n")
        XCTAssertEqual(result?.1, caret(3 + 15))
    }

    func testInsertImageReferencesAtEndWithoutCaretAnchor() {
        let result = insertImages("one", at: 3, caret(0))
        XCTAssertEqual(result?.0, "one\n![a](image:x)")
        XCTAssertEqual(result?.1, caret(0))
    }

    func testInsertImageReferencesIntoEmptyDocument() {
        let result = insertImages("", at: 0, caret(0))
        XCTAssertEqual(result?.0, "![a](image:x)\n")
        XCTAssertEqual(result?.1, caret(14))
    }

    func testInsertImageReferencesJoinsMultiple() {
        let result = insertImages("ab", at: 1, caret(1), ["R1", "R2"])
        XCTAssertEqual(result?.0, "a\nR1\nR2\nb")
        XCTAssertEqual(result?.1, caret(1 + 7))
    }

    func testInsertImageReferencesMapsSelectionElsewhere() {
        let result = insertImages("hello world", at: 0, TextSelection(location: 6, length: 5), ["R"])
        XCTAssertEqual(result?.0, "R\nhello world")
        XCTAssertEqual(result?.1, TextSelection(location: 8, length: 5))
    }

    func testInsertImageReferencesKeepsSelectionBeforeAnchor() {
        let result = insertImages("hello world", at: 8, TextSelection(location: 1, length: 3), ["R"])
        XCTAssertEqual(result?.0, "hello wo\nR\nrld")
        XCTAssertEqual(result?.1, TextSelection(location: 1, length: 3))
    }

    func testInsertImageReferencesSelectionEndingAtAnchorStays() {
        let result = insertImages("hello world", at: 5, TextSelection(location: 1, length: 4), ["R"])
        XCTAssertEqual(result?.1, TextSelection(location: 1, length: 4))
    }

    func testInsertImageReferencesSelectionStartingAtAnchorShifts() {
        let result = insertImages("hello world", at: 5, TextSelection(location: 5, length: 3), ["R"])
        XCTAssertEqual(result?.1, TextSelection(location: 5 + 3, length: 3))
    }

    func testInsertImageReferencesSelectionSpanningAnchorGrows() {
        let result = insertImages("hello world", at: 5, TextSelection(location: 2, length: 6), ["R"])
        XCTAssertEqual(result?.1, TextSelection(location: 2, length: 6 + 3))
    }

    func testInsertImageReferencesEmptyReferences() {
        XCTAssertNil(insertImages("abc", at: 1, caret(1), []))
    }

    func testInsertImageReferencesUsesUTF16Offsets() {
        let text = "😀é\nline two"
        let position = "😀é\nline".utf16.count
        let result = insertImages(text, at: position, caret(position), ["R"])
        XCTAssertEqual(result?.0, "😀é\nline\nR\n two")
        XCTAssertEqual(result?.1, caret(position + 3))
    }
}
