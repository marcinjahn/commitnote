import Foundation
import MarkdownStyling
import XCTest

final class MarkdownTableTests: XCTestCase {
    private func parseTable(_ text: String, file: StaticString = #filePath, line: UInt = #line) throws -> MarkdownTable {
        let tables = MarkdownParser.parse(text).tables
        XCTAssertEqual(tables.count, 1, file: file, line: line)
        return try XCTUnwrap(tables.first, file: file, line: line)
    }

    private func cells(_ line: MarkdownTableLine) -> [[Int]] {
        line.cells.map { [$0.range.lowerBound, $0.range.upperBound, $0.contentRange.lowerBound, $0.contentRange.upperBound] }
    }

    private func position(_ table: MarkdownTable, _ offset: Int) -> [Int] {
        let result = table.cell(at: offset)
        return [result.line, result.column]
    }

    func testBasicTable() throws {
        let table = try parseTable("| a | b |\n| :-- | --: |\n| 1 | 2 |")
        XCTAssertEqual(table.range, 0..<33)
        XCTAssertEqual(table.containerPrefix, "")
        XCTAssertEqual(table.columnCount, 2)
        XCTAssertEqual(table.alignments, [.left, .right])
        XCTAssertEqual(table.header.range, 0..<9)
        XCTAssertEqual(table.header.rowStart, 0)
        XCTAssertTrue(table.header.trailingPipe)
        XCTAssertEqual(cells(table.header), [[1, 4, 2, 3], [5, 8, 6, 7]])
        XCTAssertEqual(table.delimiter.range, 10..<23)
        XCTAssertEqual(table.delimiter.rowStart, 10)
        XCTAssertEqual(cells(table.delimiter), [[11, 16, 12, 15], [17, 22, 18, 21]])
        XCTAssertEqual(table.rows.count, 1)
        XCTAssertEqual(table.rows[0].range, 24..<33)
        XCTAssertEqual(table.rows[0].rowStart, 24)
        XCTAssertEqual(cells(table.rows[0]), [[25, 28, 26, 27], [29, 32, 30, 31]])
        XCTAssertEqual(table.lines, [table.header, table.delimiter, table.rows[0]])
    }

    func testTableWithoutOuterPipes() throws {
        let table = try parseTable("a | b\n--- | :-:\n1 | 2")
        XCTAssertEqual(table.range, 0..<21)
        XCTAssertEqual(table.alignments, [.unspecified, .center])
        XCTAssertEqual(table.lines.map(\.trailingPipe), [false, false, false])
        XCTAssertEqual(cells(table.header), [[0, 2, 0, 1], [3, 5, 4, 5]])
        XCTAssertEqual(cells(table.delimiter), [[6, 10, 6, 9], [11, 15, 12, 15]])
        XCTAssertEqual(cells(table.rows[0]), [[16, 18, 16, 17], [19, 21, 20, 21]])
    }

    func testRowWithMoreCellsThanColumns() throws {
        let table = try parseTable("| a | b |\n| - | - |\n| 1 | 2 | 3 |")
        XCTAssertEqual(table.columnCount, 2)
        XCTAssertEqual(table.alignments, [.unspecified, .unspecified])
        XCTAssertEqual(table.rows[0].cells.count, 3)
        XCTAssertEqual(cells(table.rows[0])[2], [29, 32, 30, 31])
    }

    func testRowOfOnePipe() throws {
        let table = try parseTable("| a | b |\n| - | - |\n|")
        XCTAssertEqual(table.range, 0..<21)
        XCTAssertEqual(table.rows[0].range, 20..<21)
        XCTAssertEqual(table.rows[0].rowStart, 20)
        XCTAssertTrue(table.rows[0].cells.isEmpty)
        XCTAssertTrue(table.rows[0].trailingPipe)
    }

    func testEscapedPipeStaysInTheCell() throws {
        let table = try parseTable("| a \\| x | b |\n| - | - |")
        XCTAssertEqual(cells(table.header), [[1, 9, 2, 8], [10, 13, 11, 12]])
    }

    func testPipeInsideCodeSpanSplitsTheCell() throws {
        let table = try parseTable("| `a|b` | c |\n| - | - | - |")
        XCTAssertEqual(table.columnCount, 3)
        XCTAssertEqual(cells(table.header), [[1, 4, 2, 4], [5, 8, 5, 7], [9, 12, 10, 11]])
    }

    func testBlankCellHasEmptyContentAtItsStart() throws {
        let table = try parseTable("| a |   | c |\n| - | - | - |")
        XCTAssertEqual(cells(table.header), [[1, 4, 2, 3], [5, 8, 5, 5], [9, 12, 10, 11]])
    }

    func testTableInBlockquote() throws {
        let table = try parseTable("> | a | b |\n> | - | - |\n> | 1 | 2 |")
        XCTAssertEqual(table.range, 0..<35)
        XCTAssertEqual(table.containerPrefix, "> ")
        XCTAssertEqual(table.header.range, 0..<11)
        XCTAssertEqual(table.header.rowStart, 2)
        XCTAssertEqual(cells(table.header).map { Array($0.prefix(2)) }, [[3, 6], [7, 10]])
        XCTAssertEqual(table.delimiter.range, 12..<23)
        XCTAssertEqual(table.delimiter.rowStart, 14)
        XCTAssertEqual(table.rows[0].range, 24..<35)
        XCTAssertEqual(table.rows[0].rowStart, 26)
    }

    func testTableInNestedBlockquote() throws {
        let table = try parseTable("> > | a |\n> > | - |")
        XCTAssertEqual(table.range, 0..<19)
        XCTAssertEqual(table.containerPrefix, "> > ")
        XCTAssertEqual(table.columnCount, 1)
        XCTAssertEqual(table.header.rowStart, 4)
        XCTAssertEqual(cells(table.header), [[5, 8, 6, 7]])
    }

    func testTableInListItem() throws {
        let table = try parseTable("- item\n\n  | a | b |\n  | - | - |\n  | 1 | 2 |")
        XCTAssertEqual(table.range, 8..<43)
        XCTAssertEqual(table.containerPrefix, "  ")
        XCTAssertEqual(table.header.range, 8..<19)
        XCTAssertEqual(table.header.rowStart, 10)
    }

    func testIrregularNestedTableHasNoPrefix() throws {
        let table = try parseTable("> | a | b |\n> | - | - |\n| 1 | 2 |")
        XCTAssertEqual(table.range, 0..<33)
        XCTAssertNil(table.containerPrefix)
        XCTAssertEqual(table.rows[0].range, 24..<33)
        XCTAssertEqual(table.rows[0].rowStart, 24)
    }

    func testTableRightAfterParagraphLine() throws {
        let table = try parseTable("text\n| a | b |\n| - | - |")
        XCTAssertEqual(table.range, 5..<24)
        XCTAssertEqual(table.containerPrefix, "")
    }

    func testBlankAfterHeaderLastPipeIsDropped() throws {
        let table = try parseTable("| a | b | \n| - | - |\n| 1 | 2 |")
        XCTAssertEqual(table.range, 0..<30)
        XCTAssertEqual(table.columnCount, 2)
        XCTAssertTrue(table.header.trailingPipe)
        XCTAssertEqual(table.alignments.count, 2)
    }

    func testOffsetsAreUTF16() throws {
        let table = try parseTable("| 😀 | é |\n| - | - |")
        XCTAssertEqual(table.range, 0..<20)
        XCTAssertEqual(cells(table.header), [[1, 5, 2, 4], [6, 9, 7, 8]])
    }

    func testTwoTablesAndLookup() {
        let document = MarkdownParser.parse("| a |\n| - |\n\n| b |\n| - |")
        XCTAssertEqual(document.tables.map(\.range), [0..<11, 13..<24])
        XCTAssertEqual(document.table(containing: 0)?.range, 0..<11)
        XCTAssertEqual(document.table(containing: 11)?.range, 0..<11)
        XCTAssertNil(document.table(containing: 12))
        XCTAssertEqual(document.table(containing: 13)?.range, 13..<24)
        XCTAssertEqual(document.table(containing: 24)?.range, 13..<24)
        XCTAssertNil(document.table(containing: 25))
    }

    func testAllAlignments() throws {
        let table = try parseTable("| a | b | c | d |\n|:-:|:--|--:|---|")
        XCTAssertEqual(table.alignments, [.center, .left, .right, .unspecified])
        XCTAssertEqual(
            cells(table.delimiter), [[19, 22, 19, 22], [23, 26, 23, 26], [27, 30, 27, 30], [31, 34, 31, 34]])
    }

    func testColumnCountMismatchIsNotATable() {
        XCTAssertEqual(MarkdownParser.parse("a | b | c\n- | :-").tables, [])
    }

    func testNoTable() {
        let document = MarkdownParser.parse("plain text")
        XCTAssertEqual(document.tables, [])
        XCTAssertNil(document.table(containing: 0))
    }

    func testCellAtPosition() throws {
        let table = try parseTable("| a | b |\n| :-- | --: |\n| 1 | 2 |")
        let expected: [(Int, [Int])] = [
            (0, [0, 0]), (3, [0, 0]), (5, [0, 1]), (9, [0, 1]), (10, [1, 0]), (25, [2, 0]), (35, [2, 1]), (36, [2, 1]),
        ]
        for (offset, result) in expected {
            XCTAssertEqual(position(table, offset), result, "offset \(offset)")
        }
    }

    func testCellAtClampsToColumnCount() throws {
        let table = try parseTable("| a | b |\n| - | - |\n| 1 | 2 | 3 |")
        XCTAssertEqual(position(table, 32), [2, 1])
        XCTAssertEqual(position(table, 33), [2, 1])
    }
}
