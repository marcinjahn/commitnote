import EditorText
import MarkdownStyling
import XCTest

final class InsertionAnchorRuleTests: XCTestCase {
    func testSameLineageMapsEditsAcrossAReload() {
        let edits = InsertionAnchorRule.edits(
            anchorLineage: 3, currentLineage: 3, anchorText: "Intro", currentText: "Intro more")
        XCTAssertEqual(edits, TextEdits.diff(old: "Intro", new: "Intro more"))
        XCTAssertEqual(edits?.isEmpty, false)
    }

    func testDifferentLineageDiscardsTheAnchor() {
        XCTAssertNil(
            InsertionAnchorRule.edits(
                anchorLineage: 3, currentLineage: 4, anchorText: "Intro", currentText: "Intro"))
    }

    func testUnchangedTextYieldsNoEdits() {
        XCTAssertEqual(
            InsertionAnchorRule.edits(
                anchorLineage: 1, currentLineage: 1, anchorText: "Same", currentText: "Same"),
            [])
    }
}
