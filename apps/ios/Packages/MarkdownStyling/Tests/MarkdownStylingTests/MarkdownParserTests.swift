import Foundation
import MarkdownStyling
import XCTest

final class MarkdownParserTests: XCTestCase {
    private func parse(_ text: String) -> [SyntaxNode] {
        MarkdownParser.parse(text).nodes
    }

    private func n(_ kind: SyntaxKind, _ from: Int, _ to: Int) -> SyntaxNode {
        SyntaxNode(kind: kind, range: from..<to)
    }

    // MARK: Headings

    func testATXHeadingLevels() {
        for level in 1...6 {
            let marks = String(repeating: "#", count: level)
            XCTAssertEqual(
                parse("\(marks) Title"),
                [n(.atxHeading(level: level), 0, level + 6), n(.headerMark, 0, level)])
        }
        XCTAssertEqual(parse("####### Title"), [n(.paragraph, 0, 13)])
    }

    func testHashtagIsNotAHeading() {
        XCTAssertEqual(parse("#hashtag"), [n(.paragraph, 0, 8)])
    }

    func testATXHeadingClosingSequenceIsAHeaderMark() {
        XCTAssertEqual(
            parse("# Title ##"),
            [n(.atxHeading(level: 1), 0, 10), n(.headerMark, 0, 1), n(.headerMark, 8, 10)])
    }

    func testSetextHeadings() {
        XCTAssertEqual(parse("Title\n==="), [n(.setextHeading(level: 1), 0, 9), n(.headerMark, 6, 9)])
        XCTAssertEqual(parse("Title\n---"), [n(.setextHeading(level: 2), 0, 9), n(.headerMark, 6, 9)])
    }

    func testDashesAfterABlankLineOrANonParagraphBlockAreARule() {
        XCTAssertEqual(parse("Title\n\n---"), [n(.paragraph, 0, 5), n(.horizontalRule, 7, 10)])
        XCTAssertEqual(
            parse("# H\n---"),
            [n(.atxHeading(level: 1), 0, 3), n(.headerMark, 0, 1), n(.horizontalRule, 4, 7)])
        XCTAssertEqual(parse("* * *"), [n(.horizontalRule, 0, 5)])
    }

    // MARK: Containers

    func testNestedBlockquoteWithLazyContinuation() {
        XCTAssertEqual(
            parse("> a\n> > b\nlazy"),
            [
                n(.blockquote, 0, 14), n(.quoteMark, 0, 1), n(.paragraph, 2, 3), n(.quoteMark, 4, 5),
                n(.blockquote, 6, 14), n(.quoteMark, 6, 7), n(.paragraph, 8, 14),
            ])
    }

    func testNestedBulletList() {
        XCTAssertEqual(
            parse("- a\n  - b\n- c"),
            [
                n(.bulletList, 0, 13), n(.listItem, 0, 9), n(.listMark, 0, 1), n(.paragraph, 2, 3),
                n(.bulletList, 6, 9), n(.listItem, 6, 9), n(.listMark, 6, 7), n(.paragraph, 8, 9),
                n(.listItem, 10, 13), n(.listMark, 10, 11), n(.paragraph, 12, 13),
            ])
    }

    func testNestedOrderedList() {
        XCTAssertEqual(
            parse("1. a\n2. b\n   1) c"),
            [
                n(.orderedList, 0, 17), n(.listItem, 0, 4), n(.listMark, 0, 2), n(.paragraph, 3, 4),
                n(.listItem, 5, 17), n(.listMark, 5, 7), n(.paragraph, 8, 9),
                n(.orderedList, 13, 17), n(.listItem, 13, 17), n(.listMark, 13, 15), n(.paragraph, 16, 17),
            ])
    }

    func testTaskItems() {
        XCTAssertEqual(
            parse("- [ ] task\n- [x] done\n* [X] Done\n1. [ ] numbered"),
            [
                n(.bulletList, 0, 21),
                n(.listItem, 0, 10), n(.listMark, 0, 1), n(.task, 2, 10), n(.taskMarker(checked: false), 2, 5),
                n(.listItem, 11, 21), n(.listMark, 11, 12), n(.task, 13, 21), n(.taskMarker(checked: true), 13, 16),
                n(.bulletList, 22, 32),
                n(.listItem, 22, 32), n(.listMark, 22, 23), n(.task, 24, 32), n(.taskMarker(checked: true), 24, 27),
                n(.orderedList, 33, 48),
                n(.listItem, 33, 48), n(.listMark, 33, 35), n(.task, 36, 48), n(.taskMarker(checked: false), 36, 39),
            ])
    }

    func testMarkerWithoutSpaceIsNotATask() {
        XCTAssertEqual(parse("-[ ] no"), [n(.paragraph, 0, 7)])
    }

    // MARK: Code

    func testFencedCodeWithInfo() {
        XCTAssertEqual(
            parse("```swift\nlet x = 1\n```"),
            [n(.fencedCode, 0, 22), n(.codeMark, 0, 3), n(.codeInfo, 3, 8), n(.codeText, 9, 18), n(.codeMark, 19, 22)])
    }

    func testUnclosedFenceRunsToTheEnd() {
        XCTAssertEqual(
            parse("~~~\nopen\n**still**"),
            [n(.fencedCode, 0, 18), n(.codeMark, 0, 3), n(.codeText, 4, 18)])
    }

    func testIndentedCode() {
        XCTAssertEqual(
            parse("    code\n    more"),
            [n(.indentedCode, 4, 17), n(.codeText, 4, 9), n(.codeText, 13, 17)])
        XCTAssertEqual(parse("para\n    not code"), [n(.paragraph, 0, 17)])
    }

    func testInlineCodeContentIsNotParsed() {
        XCTAssertEqual(
            parse("`a*b*`"),
            [n(.paragraph, 0, 6), n(.inlineCode, 0, 6), n(.codeMark, 0, 1), n(.codeMark, 5, 6)])
        XCTAssertEqual(
            parse("``a ` b``"),
            [n(.paragraph, 0, 9), n(.inlineCode, 0, 9), n(.codeMark, 0, 2), n(.codeMark, 7, 9)])
        XCTAssertEqual(parse("`open"), [n(.paragraph, 0, 5)])
    }

    // MARK: Emphasis

    func testStrongAndEmphasis() {
        XCTAssertEqual(
            parse("**bold** *italic* _italic_"),
            [
                n(.paragraph, 0, 26),
                n(.strongEmphasis, 0, 8), n(.emphasisMark, 0, 2), n(.emphasisMark, 6, 8),
                n(.emphasis, 9, 17), n(.emphasisMark, 9, 10), n(.emphasisMark, 16, 17),
                n(.emphasis, 18, 26), n(.emphasisMark, 18, 19), n(.emphasisMark, 25, 26),
            ])
    }

    func testIntrawordUnderscoresAreNotEmphasis() {
        XCTAssertEqual(parse("snake_case_word"), [n(.paragraph, 0, 15)])
    }

    func testTripleDelimitersNestStrongInsideEmphasis() {
        XCTAssertEqual(
            parse("***both***"),
            [
                n(.paragraph, 0, 10), n(.emphasis, 0, 10), n(.emphasisMark, 0, 1),
                n(.strongEmphasis, 1, 9), n(.emphasisMark, 1, 3), n(.emphasisMark, 7, 9), n(.emphasisMark, 9, 10),
            ])
    }

    func testStrikethroughNeedsTwoTildes() {
        XCTAssertEqual(
            parse("~~strike~~ ~single~"),
            [n(.paragraph, 0, 19), n(.strikethrough, 0, 10), n(.strikethroughMark, 0, 2), n(.strikethroughMark, 8, 10)])
    }

    func testEscapedDelimitersAreLiteral() {
        XCTAssertEqual(parse("\\*not\\*"), [n(.paragraph, 0, 7)])
    }

    // MARK: Links

    func testLinkWithTitle() {
        XCTAssertEqual(
            parse("[link](https://x.com \"title\")"),
            [
                n(.paragraph, 0, 29), n(.link, 0, 29), n(.linkMark, 0, 1), n(.linkLabel, 1, 5), n(.linkMark, 5, 6),
                n(.linkMark, 6, 7), n(.url, 7, 20), n(.linkMark, 28, 29),
            ])
    }

    func testLinkWithAngleBracketDestination() {
        XCTAssertEqual(
            parse("[link](<a b>)"),
            [
                n(.paragraph, 0, 13), n(.link, 0, 13), n(.linkMark, 0, 1), n(.linkLabel, 1, 5), n(.linkMark, 5, 6),
                n(.linkMark, 6, 7), n(.url, 7, 12), n(.linkMark, 12, 13),
            ])
    }

    func testBareDestinationKeepsBalancedParentheses() {
        let nodes = parse("[a](b(c)d) x")
        XCTAssertTrue(nodes.contains(n(.link, 0, 10)))
        XCTAssertTrue(nodes.contains(n(.url, 4, 9)))
    }

    func testImageURLRangeIsExactlyTheDestination() {
        let text = "![alt](image:abcdefghijklmnopqrstuvwxyz#640x480)"
        XCTAssertEqual(
            parse(text),
            [
                n(.paragraph, 0, 48), n(.image, 0, 48), n(.linkMark, 0, 2), n(.linkLabel, 2, 5), n(.linkMark, 5, 6),
                n(.linkMark, 6, 7), n(.url, 7, 47), n(.linkMark, 47, 48),
            ])
        let url = (text as NSString).substring(with: NSRange(location: 7, length: 40))
        XCTAssertEqual(url, "image:abcdefghijklmnopqrstuvwxyz#640x480")
    }

    func testReferenceStyleLinksArePlainText() {
        XCTAssertEqual(parse("[ref]\n\n[ref]: /url"), [n(.paragraph, 0, 5)])
        XCTAssertEqual(parse("[a][ref]"), [n(.paragraph, 0, 8)])
    }

    func testAutolink() {
        XCTAssertEqual(
            parse("<https://example.com>"),
            [n(.paragraph, 0, 21), n(.autolink, 0, 21), n(.linkMark, 0, 1), n(.url, 1, 20), n(.linkMark, 20, 21)])
    }

    func testExtendedAutolinkLiterals() {
        XCTAssertEqual(parse("see www.example.com."), [n(.paragraph, 0, 20), n(.url, 4, 19)])
        XCTAssertEqual(parse("https://a.b/c?"), [n(.paragraph, 0, 14), n(.url, 0, 13)])
        XCTAssertEqual(parse("a@b.co"), [n(.paragraph, 0, 6), n(.url, 0, 6)])
    }

    // MARK: Other blocks and inlines

    func testTable() {
        XCTAssertEqual(
            parse("| a | b |\n| - | - |\n| *1* | 2 |"),
            [n(.table, 0, 31), n(.emphasis, 22, 25), n(.emphasisMark, 22, 23), n(.emphasisMark, 24, 25)])
    }

    func testHardBreak() {
        XCTAssertEqual(parse("a  \nb"), [n(.paragraph, 0, 5), n(.hardBreak, 1, 4)])
    }

    func testHTMLIsPlainText() {
        XCTAssertEqual(
            parse("<div>\n*x*\n</div>\n\n*y*"),
            [n(.paragraph, 18, 21), n(.emphasis, 18, 21), n(.emphasisMark, 18, 19), n(.emphasisMark, 20, 21)])
    }

    func testOffsetsAreUTF16() {
        XCTAssertEqual(
            parse("😀 **b**"),
            [n(.paragraph, 0, 8), n(.strongEmphasis, 3, 8), n(.emphasisMark, 3, 5), n(.emphasisMark, 6, 8)])
        let nodes = parse("# 𝄞 é *x*")
        XCTAssertTrue(nodes.contains(n(.emphasis, 7, 10)))
    }

    // MARK: Document

    func testLines() {
        let document = MarkdownParser.parse("ab\n😀\n\nlast")
        XCTAssertEqual(document.lines, [0, 3, 6, 7])
        XCTAssertEqual(document.line(containing: 0), 0..<2)
        XCTAssertEqual(document.line(containing: 2), 0..<2)
        XCTAssertEqual(document.line(containing: 4), 3..<5)
        XCTAssertEqual(document.line(containing: 6), 6..<6)
        XCTAssertEqual(document.line(containing: 11), 7..<11)
        XCTAssertEqual(MarkdownParser.parse("").line(containing: 0), 0..<0)
    }

    func testNodesOverlapping() {
        let document = MarkdownParser.parse("# A\n\n**b** c")
        XCTAssertEqual(document.nodes(overlapping: 0..<1).map(\.kind), [.atxHeading(level: 1), .headerMark])
        XCTAssertEqual(
            document.nodes(overlapping: 7..<8).map(\.kind), [.paragraph, .strongEmphasis])
        XCTAssertEqual(
            document.nodes(overlapping: 10..<10).map(\.kind), [.paragraph, .strongEmphasis, .emphasisMark])
        XCTAssertEqual(document.nodes(overlapping: 4..<5), [])
    }

    func testNodesAreInDocumentOrderWithParentsFirst() {
        let nodes = parse(Self.generatedNote(lines: 300))
        for (previous, next) in zip(nodes, nodes.dropFirst()) {
            XCTAssertLessThanOrEqual(previous.range.lowerBound, next.range.lowerBound)
            if previous.range.lowerBound == next.range.lowerBound {
                XCTAssertGreaterThanOrEqual(previous.range.upperBound, next.range.upperBound)
            }
        }
    }

    func testLargeNoteParsesQuickly() {
        let text = Self.generatedNote(lines: 2_000)
        let start = Date()
        let document = MarkdownParser.parse(text)
        let elapsed = Date().timeIntervalSince(start)
        XCTAssertEqual(document.lines.count, 2_000)
        XCTAssertTrue(document.nodes.contains { $0.kind == .taskMarker(checked: true) })
        XCTAssertTrue(document.nodes.contains { $0.kind == .fencedCode })
        XCTAssertLessThan(elapsed, 0.5)
    }

    private static func generatedNote(lines count: Int) -> String {
        let patterns = [
            "# Heading with *emphasis*",
            "Some paragraph text with **bold**, _italic_ and `code` and a [link](https://example.com).",
            "- [ ] open task with ~~strike~~",
            "- [x] done task",
            "  - nested item www.example.com",
            "1. ordered item <https://example.com/a>",
            "> quoted text with ![image](image:abcdefghijklmnopqrstuvwxyz#640x480)",
            "```swift",
            "let value = items.map { $0 * 2 }",
            "```",
            "",
            "## Second *level* heading",
            "Plain text 😀 continues here with mail@example.com",
            "",
        ]
        return (0..<count).map { patterns[$0 % patterns.count] }.joined(separator: "\n")
    }
}
