import EditorText
import MarkdownStyling
import XCTest

final class RenderedTableTests: XCTestCase {
    private let id = "abcdefghijklmnopqrstuvwxyz"

    private func render(_ text: String, caret: Int? = nil, selection: [TextSelection]? = nil) -> (
        runs: [StyleRun], placements: [Placement]
    ) {
        let sel = selection ?? caret.map { [TextSelection(location: $0, length: 0)] } ?? []
        return LivePreview.render(MarkdownParser.parse(text), selection: sel)
    }

    private func tables(_ placements: [Placement]) -> [RenderedTable] {
        placements.compactMap { if case .table(let table) = $0 { table } else { nil } }
    }

    private func images(_ placements: [Placement]) -> [ImageReference] {
        placements.compactMap { if case .image(let reference, _, _) = $0 { reference } else { nil } }
    }

    private func table(
        _ text: String, caret: Int? = nil, file: StaticString = #filePath, line: UInt = #line
    ) throws -> RenderedTable {
        let found = tables(render(text, caret: caret).placements)
        XCTAssertEqual(found.count, 1, file: file, line: line)
        return try XCTUnwrap(found.first, file: file, line: line)
    }

    private func hidden(_ runs: [StyleRun]) -> [Range<Int>] {
        runs.filter { $0.style == .hidden }.map(\.range)
    }

    func testInactiveTableRendersWithStyledCells() throws {
        let text = "| a | b |\n| - | :-: |\n| *x* | `y` |\n\nend"
        let result = render(text, caret: 39)
        XCTAssertTrue(hidden(result.runs).contains(0..<35))
        let rendered = try XCTUnwrap(tables(result.placements).first)
        XCTAssertEqual(tables(result.placements).count, 1)
        XCTAssertEqual(rendered.table.alignments, [.unspecified, .center])
        XCTAssertEqual(rendered.rows.count, 2)
        XCTAssertEqual(rendered.rows[0].map(\.pieces), [
            [.text("a", source: 2..<3, styles: [])], [.text("b", source: 6..<7, styles: [])],
        ])
        XCTAssertEqual(rendered.rows[0].map(\.caret), [3, 7])
        XCTAssertEqual(rendered.rows[1].map(\.pieces), [
            [.text("x", source: 25..<26, styles: [.emphasis])], [.text("y", source: 31..<32, styles: [.inlineCode])],
        ])
        XCTAssertEqual(rendered.rows[1].map(\.caret), [27, 33])
        XCTAssertEqual(rendered.rows[1].map(\.range), [23..<28, 29..<34])
        XCTAssertEqual(rendered.indentText, "")
        XCTAssertEqual(rendered.quoteLevels, 0)
    }

    func testTouchedTableShowsItsSource() {
        let text = "| a | b |\n| - | :-: |\n| *x* | `y` |\n\nend"
        let selections: [[TextSelection]] = [
            [TextSelection(location: 3, length: 0)], [TextSelection(location: 22, length: 0)],
            [TextSelection(location: 35, length: 0)], [TextSelection(location: 30, length: 9)],
        ]
        for selection in selections {
            let result = render(text, selection: selection)
            XCTAssertTrue(tables(result.placements).isEmpty, "\(selection)")
            XCTAssertFalse(hidden(result.runs).contains(0..<35), "\(selection)")
        }
    }

    func testTableRendersWithoutSelection() throws {
        let rendered = try table("| a | b |\n| - | :-: |\n| *x* | `y` |\n\nend")
        XCTAssertEqual(rendered.rows.count, 2)
    }

    func testEscapesDropTheirBackslash() throws {
        let rendered = try table("| a \\| b | c\\*d |\n| - | - |")
        let header = rendered.rows[0]
        XCTAssertEqual(header[0].pieces, [
            .text("a ", source: 2..<4, styles: []), .text("| b", source: 5..<8, styles: []),
        ])
        XCTAssertEqual(header[0].plainText, "a | b")
        XCTAssertEqual(header[1].pieces, [
            .text("c", source: 11..<12, styles: []), .text("*d", source: 13..<15, styles: []),
        ])
        XCTAssertEqual(header[1].plainText, "c*d")
    }

    func testEscapedBackslashKeepsTheNextBackslashLiteral() throws {
        let rendered = try table("| a\\\\\\* |\n| - |")
        XCTAssertEqual(rendered.rows[0][0].plainText, "a\\*")
    }

    func testImageLabelAndAutolinkKeepBackslashes() throws {
        let rendered = try table("| ![a\\*b](https://e.com/p.png) | <https://e.com/a\\*b> |\n| - | - |")
        XCTAssertEqual(rendered.rows[0][0].plainText, "a\\*b")
        XCTAssertEqual(rendered.rows[0][1].plainText, "https://e.com/a\\*b")
    }

    func testInlineCodeKeepsBackslash() throws {
        let rendered = try table("| `a\\|b` |\n| - |")
        XCTAssertEqual(rendered.rows[0].map(\.pieces), [[.text("a\\|b", source: 3..<7, styles: [.inlineCode])]])
    }

    func testLinkLabelOnly() throws {
        let cell = try table("| [t](https://e.com) |\n| - |").rows[0][0]
        XCTAssertEqual(cell.pieces, [.text("t", source: 3..<4, styles: [.link])])
        XCTAssertEqual(cell.caret, 20)
    }

    func testReferenceImageBecomesCellPiece() throws {
        let text = "| ![cat](image:\(id)) |\n| - |"
        let result = render(text)
        let rendered = try XCTUnwrap(tables(result.placements).first)
        let cell = rendered.rows[0][0]
        XCTAssertEqual(
            cell.pieces, [.image(ImageReference(imageId: id, width: nil, height: nil, alt: "cat", range: 2..<42))])
        XCTAssertEqual(cell.plainText, "cat")
        XCTAssertEqual(cell.spokenText, "cat")
        XCTAssertTrue(images(result.placements).isEmpty)

        let active = render(text, caret: 0)
        XCTAssertTrue(tables(active.placements).isEmpty)
        XCTAssertEqual(images(active.placements).map(\.range), [2..<42])
    }

    func testStrongAutolinkAndPlainImage() throws {
        let rendered = try table("| **H** | x |\n| --- | ---: |\n| <https://e.com> | ![p](https://e.com/p.png) |")
        XCTAssertEqual(rendered.table.alignments, [.unspecified, .right])
        XCTAssertEqual(rendered.rows[0][0].pieces, [.text("H", source: 4..<5, styles: [.strong])])
        XCTAssertEqual(rendered.rows[1][0].pieces, [.text("https://e.com", source: 32..<45, styles: [.url])])
        XCTAssertEqual(rendered.rows[1][1].pieces, [.text("p", source: 51..<52, styles: [])])
    }

    func testShortRowIsPadded() throws {
        let row = try table("| a | b |\n| - | - |\n| 1 |").rows[1]
        XCTAssertEqual(row.count, 2)
        XCTAssertEqual(row[0].caret, 23)
        XCTAssertNil(row[1].range)
        XCTAssertEqual(row[1].caret, 25)
        XCTAssertEqual(row[1].pieces, [])
        XCTAssertEqual(row[1].plainText, "")
        XCTAssertEqual(row[1].spokenText, "empty")
    }

    func testBlankCell() throws {
        let cell = try table("| a | |\n| - | - |").rows[0][1]
        XCTAssertEqual(cell.range, 5..<6)
        XCTAssertEqual(cell.caret, 6)
        XCTAssertEqual(cell.pieces, [])
        XCTAssertEqual(cell.spokenText, "empty")
    }

    func testQuotedTableKeepsQuoteLines() throws {
        let result = render("> | a |\n> | - |\n> | 1 |")
        let rendered = try XCTUnwrap(tables(result.placements).first)
        XCTAssertEqual(rendered.quoteLevels, 1)
        XCTAssertEqual(rendered.indentText, "")
        XCTAssertEqual(rendered.rows[1][0].caret, 21)
        XCTAssertTrue(hidden(result.runs).contains(0..<23))
        XCTAssertEqual(result.runs.filter { $0.style == .quoteLine }.map(\.range), [0..<7, 8..<15, 16..<23])
    }

    func testListNestedTable() throws {
        let rendered = try table("- x\n\n  | a |\n  | - |")
        XCTAssertEqual(rendered.table.range, 5..<20)
        XCTAssertEqual(rendered.indentText, "  ")
        XCTAssertEqual(rendered.quoteLevels, 0)
    }

    func testCopyText() throws {
        let rendered = try table("| a | b | c |\n| - | - | - |\n| d | e | f |")
        XCTAssertEqual(
            rendered.copyText(from: TableCellPosition(row: 0, column: 1), to: TableCellPosition(row: 1, column: 0)),
            "b\tc\nd")
        XCTAssertEqual(
            rendered.copyText(from: TableCellPosition(row: 1, column: 0), to: TableCellPosition(row: 0, column: 1)),
            "b\tc\nd")
        XCTAssertEqual(
            rendered.copyText(from: TableCellPosition(row: 1, column: 2), to: TableCellPosition(row: 1, column: 2)),
            "f")
        XCTAssertEqual(
            rendered.copyText(from: TableCellPosition(row: 0, column: 0), to: TableCellPosition(row: 5, column: 9)),
            "a\tb\tc\nd\te\tf")
    }

    func testImageWithoutAltIsSpokenAsImage() throws {
        let cell = try table("| ![](image:\(id)) |\n| - |").rows[0][0]
        XCTAssertEqual(cell.plainText, "")
        XCTAssertEqual(cell.spokenText, "Image")
    }
}
