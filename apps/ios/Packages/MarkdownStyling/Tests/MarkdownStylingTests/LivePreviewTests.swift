import EditorText
import MarkdownStyling
import XCTest

final class LivePreviewTests: XCTestCase {
    private let id = "abcdefghijklmnopqrstuvwxyz"

    private func render(_ text: String, caret: Int? = nil, selection: [TextSelection]? = nil) -> (
        runs: [StyleRun], placements: [Placement]
    ) {
        let sel = selection ?? caret.map { [TextSelection(location: $0, length: 0)] } ?? []
        return LivePreview.render(MarkdownParser.parse(text), selection: sel)
    }

    private func hidden(_ text: String, caret: Int? = nil, selection: [TextSelection]? = nil) -> [Range<Int>] {
        render(text, caret: caret, selection: selection).runs.filter { $0.style == .hidden }.map(\.range)
    }

    private func styled(_ runs: [StyleRun], _ style: PreviewStyle) -> [Range<Int>] {
        runs.filter { $0.style == style }.map(\.range)
    }

    func testATXHeaderMarkAndSpaceHiddenOffLine() {
        let text = "para\n## Title"
        XCTAssertEqual(hidden(text, caret: 0), [5..<8])
        XCTAssertEqual(hidden(text, caret: 8), [])
        XCTAssertEqual(hidden(text, caret: 5), [])
        XCTAssertEqual(hidden(text), [5..<8])
    }

    func testHeadingStylesByLevel() {
        for level in 1...6 {
            let marks = String(repeating: "#", count: level)
            let runs = render("\(marks) T").runs
            XCTAssertEqual(styled(runs, .heading(level: level)), [0..<(level + 2)])
        }
    }

    func testSetextHeadingStyledAndUnderlineNeverHidden() {
        let text = "Title\n==="
        let runs = render(text, caret: nil).runs
        XCTAssertEqual(styled(runs, .heading(level: 1)), [0..<9])
        XCTAssertEqual(styled(runs, .mutedMarker), [6..<9])
        XCTAssertEqual(hidden(text), [])
        XCTAssertEqual(styled(render("Title\n---").runs, .heading(level: 2)), [0..<9])
    }

    func testQuoteMarkHiddenOffLineWithSpaceAndLinesStyled() {
        let text = "> a\n> b\n\nz"
        let result = render(text, caret: 10)
        XCTAssertEqual(styled(result.runs, .hidden), [0..<2, 4..<6])
        XCTAssertEqual(styled(result.runs, .quoteLine), [0..<3, 4..<7])
        XCTAssertEqual(hidden(text, caret: 1), [4..<6])
        XCTAssertEqual(hidden(text, caret: 5), [0..<2])
    }

    func testEmphasisAndStrikethroughMarksHiddenOffLine() {
        let text = "x\n*a* **b** ~~c~~"
        XCTAssertEqual(hidden(text, caret: 0), [2..<3, 4..<5, 6..<8, 9..<11, 12..<14, 15..<17])
        XCTAssertEqual(hidden(text, caret: 5), [])
        let runs = render(text).runs
        XCTAssertEqual(styled(runs, .emphasis), [2..<5])
        XCTAssertEqual(styled(runs, .strong), [6..<11])
        XCTAssertEqual(styled(runs, .strikethrough), [12..<17])
    }

    func testInlineCodeMarksHiddenButFenceMarksNever() {
        let text = "a `b`\n```\nc\n```"
        let off = render(text, caret: 12)
        XCTAssertEqual(styled(off.runs, .hidden), [2..<3, 4..<5])
        XCTAssertEqual(styled(off.runs, .inlineCode), [2..<5])
        XCTAssertEqual(styled(off.runs, .codeBlockLine), [6..<9, 10..<11, 12..<15])
        XCTAssertEqual(styled(off.runs, .mutedMarker), [6..<9, 12..<15])
        XCTAssertEqual(hidden(text, caret: 3), [])
        XCTAssertEqual(hidden("```\nc\n```", caret: nil), [])
    }

    func testLinkMarksAndDestinationHiddenOffLine() {
        let text = "x\n[label](https://a.b)"
        XCTAssertEqual(hidden(text, caret: 0), [2..<3, 8..<9, 9..<10, 10..<21, 21..<22])
        XCTAssertEqual(hidden(text, caret: 6), [])
        let runs = render(text, caret: 0).runs
        XCTAssertEqual(styled(runs, .link), [3..<8])
    }

    func testBareURLAndAutolinkAreStyledNotHidden() {
        let result = render("see https://a.b and <https://c.d>")
        XCTAssertTrue(styled(result.runs, .url).contains(4..<15))
        XCTAssertTrue(styled(result.runs, .url).contains(21..<32))
        XCTAssertEqual(hidden("see https://a.b and <https://c.d>"), [])
    }

    func testMultiLineSelectionActivatesEveryTouchedLine() {
        let text = "*a*\n*b*\n*c*"
        let selection = [TextSelection(location: 2, length: 3)]
        XCTAssertEqual(hidden(text, selection: selection), [8..<9, 10..<11])
        XCTAssertEqual(hidden(text, selection: [TextSelection(location: 0, length: 11)]), [])
    }

    func testAnyOfSeveralSelectionsActivatesItsLine() {
        let text = "*a*\n*b*\n*c*"
        let selection = [TextSelection(location: 1, length: 0), TextSelection(location: 9, length: 0)]
        XCTAssertEqual(hidden(text, selection: selection), [4..<5, 6..<7])
    }

    func testActivityIsDecidedPerMarkerLine() {
        let text = "**a\nb**\n\nz"
        XCTAssertEqual(hidden(text, caret: 9), [0..<2, 5..<7])
        XCTAssertEqual(hidden(text, caret: 5), [0..<2])
        XCTAssertEqual(hidden(text, caret: 1), [5..<7])
    }

    func testListMarksAreNeverHidden() {
        let text = "- a\n1. b"
        for caret in [0, 5, nil] as [Int?] {
            let runs = render(text, caret: caret).runs
            XCTAssertEqual(styled(runs, .listMark), [0..<1, 4..<6])
            XCTAssertEqual(styled(runs, .hidden), [])
        }
    }

    func testCheckboxPlacementEvenOnActiveLine() {
        let text = "- [ ] a\n- [x] b\n- [X] c"
        for caret in [0, 5, nil] as [Int?] {
            XCTAssertEqual(
                render(text, caret: caret).placements,
                [
                    .checkbox(range: 2..<5, checked: false), .checkbox(range: 10..<13, checked: true),
                    .checkbox(range: 18..<21, checked: true),
                ])
        }
        XCTAssertEqual(hidden(text, caret: 0), [])
    }

    func testHorizontalRuleHiddenWithPlacementOffLine() {
        let text = "a\n\n---\n\nb"
        let off = render(text, caret: 0)
        XCTAssertEqual(styled(off.runs, .hidden), [3..<6])
        XCTAssertEqual(off.placements, [.rule(lineRange: 3..<6)])
        let on = render(text, caret: 4)
        XCTAssertEqual(styled(on.runs, .hidden), [])
        XCTAssertEqual(on.placements, [])
    }

    func testImageReferenceHiddenOffLineAndPlacedEitherWay() {
        let text = "a\n![alt](image:\(id)#10x20)"
        let end = text.utf16.count
        let reference = ImageReference(imageId: id, width: 10, height: 20, alt: "alt", range: 2..<end)
        let off = render(text, caret: 0)
        XCTAssertEqual(styled(off.runs, .hidden), [2..<end])
        XCTAssertEqual(off.placements, [.image(reference: reference, lineRange: 2..<end, sourceVisible: false)])
        let on = render(text, caret: 5)
        XCTAssertEqual(styled(on.runs, .hidden), [])
        XCTAssertEqual(on.placements, [.image(reference: reference, lineRange: 2..<end, sourceVisible: true)])
    }

    func testOrdinaryImageIsNotPlacedOrHidden() {
        let result = render("![a](https://x.y/a.png)", caret: nil)
        XCTAssertEqual(result.placements, [])
        XCTAssertEqual(styled(result.runs, .hidden), [])
    }

    func testRunOrderPutsHiddenLast() {
        let runs = render("# *a*", caret: nil).runs
        XCTAssertEqual(runs.last?.style, .hidden)
        let firstHidden = runs.firstIndex { $0.style == .hidden }!
        XCTAssertTrue(runs[firstHidden...].allSatisfy { $0.style == .hidden })
    }
}
