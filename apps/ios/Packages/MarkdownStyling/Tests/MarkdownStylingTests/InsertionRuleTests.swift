import EditorText
import Foundation
import MarkdownStyling
import XCTest

private struct VectorFile: Decodable {
    let format: Int
    let insertions: [Vector]
}

private struct Vector: Decodable {
    let name: String
    let text: String
    let selection: Selection
    let command: String
    let argument: [String]
    let expected: Expected
}

private struct Selection: Decodable {
    let anchor: Int
    let head: Int
}

private struct Expected: Decodable {
    let text: String
    let selection: Selection
}

final class InsertionRuleTests: XCTestCase {
    private func vectorFile() throws -> VectorFile {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<7 { url.deleteLastPathComponent() }
        url.appendPathComponent("apps/test-vectors/image-insertion.json")
        return try JSONDecoder().decode(VectorFile.self, from: Data(contentsOf: url))
    }

    private func assertInsertion(
        _ text: String, at position: Int, _ references: [String], text expectedText: String, caret: Int,
        file: StaticString = #filePath, line: UInt = #line
    ) {
        let result = InsertionRule.insertImageReferences(text: text, at: position, references: references)
        XCTAssertEqual(result.edits.count, 1, file: file, line: line)
        XCTAssertEqual(result.edits.first?.from, result.edits.first?.to, file: file, line: line)
        XCTAssertEqual(TextEdits.apply(result.edits, to: text), expectedText, file: file, line: line)
        XCTAssertEqual(result.selection, TextSelection(location: caret, length: 0), file: file, line: line)
    }

    func testVectors() throws {
        let vectors = try vectorFile()
        XCTAssertEqual(vectors.format, 1)
        XCTAssertFalse(vectors.insertions.isEmpty)
        for vector in vectors.insertions {
            XCTAssertEqual(vector.command, "insert-image-references", vector.name)
            XCTAssertEqual(vector.expected.selection.anchor, vector.expected.selection.head, vector.name)
            let result = InsertionRule.insertImageReferences(
                text: vector.text, at: vector.selection.head, references: vector.argument)
            XCTAssertEqual(result.edits.count, 1, vector.name)
            XCTAssertEqual(TextEdits.apply(result.edits, to: vector.text), vector.expected.text, vector.name)
            XCTAssertEqual(
                result.selection, TextSelection(location: vector.expected.selection.head, length: 0), vector.name)
        }
    }

    func testInsideLastCellGoesInline() {
        assertInsertion(
            "| a | b |\n| - | - |\n| 1 | 2 |", at: 27, ["R"], text: "| a | b |\n| - | - |\n| 1 | 2 R |", caret: 29)
    }

    func testAfterTableReusesBlankLine() {
        assertInsertion(
            "| a |\n| - |\n| 1 |\n\nafter", at: 17, ["R"], text: "| a |\n| - |\n| 1 |\n\nR\n\nafter", caret: 21)
    }

    func testBeforeHeaderGoesAboveTable() {
        assertInsertion("| a |\n| - |", at: 0, ["R"], text: "R\n\n| a |\n| - |", caret: 2)
    }

    func testPositionPastEndIsClamped() {
        assertInsertion(
            "| a | b |\n| - | - |\n| 1 | 2 |", at: 99, ["R"], text: "| a | b |\n| - | - |\n| 1 | 2 |\n\nR\n", caret: 33)
    }

    func testSeveralReferencesFormOneBlock() {
        assertInsertion("one", at: 3, ["R1", "R2"], text: "one\nR1\nR2\n", caret: 10)
    }
}
