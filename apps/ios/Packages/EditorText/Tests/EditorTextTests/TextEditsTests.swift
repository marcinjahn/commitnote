import EditorText
import XCTest

final class TextEditsTests: XCTestCase {
    private func edit(_ from: Int, _ to: Int, _ insert: String) -> TextEdit {
        TextEdit(from: from, to: to, insert: insert)
    }

    private func selection(_ location: Int, _ length: Int) -> TextSelection {
        TextSelection(location: location, length: length)
    }

    func testApplyUsesUTF16Offsets() {
        let text = "héllo 😀 世界"
        let edits = [edit(1, 2, "e"), edit(6, 8, "🙂"), edit(9, 11, "中文"), edit(11, 11, "!")]
        XCTAssertEqual(TextEdits.apply(edits, to: text), "hello 🙂 中文!")
    }

    func testApplyWithNoEditsKeepsTheText() {
        XCTAssertEqual(TextEdits.apply([], to: "same"), "same")
    }

    func testApplyMatchesTypeScriptMinimalChanges() {
        let cases: [(old: String, new: String, edits: [TextEdit])] = [
            ("a\nc\n", "a\nb\nc\n", [edit(2, 2, "b\n")]),
            ("a\nb\nc\n", "a\nc\n", [edit(2, 4, "")]),
            ("hello world\nx\n", "hello brave world\nx\n", [edit(6, 6, "brave ")]),
            (
                "a\nb\nc\nd\ne\nf\ng\n", "a\nB\nB2\nc\nd\ne\nF\ng\nh\n",
                [edit(2, 4, "B\nB2\n"), edit(10, 13, "F\ng\nh")]
            ),
            ("abcdef\nxyz\n", "abXYef\nxyz\n", [edit(2, 4, "XY")]),
        ]
        for (old, new, edits) in cases {
            XCTAssertEqual(TextEdits.apply(edits, to: old), new)
        }
    }

    func testMapPositionAroundAReplacement() {
        let edits = [edit(2, 4, "XYZ")]
        XCTAssertEqual(TextEdits.mapPosition(1, through: edits, assoc: .after), 1)
        XCTAssertEqual(TextEdits.mapPosition(2, through: edits, assoc: .after), 2)
        XCTAssertEqual(TextEdits.mapPosition(3, through: edits, assoc: .before), 2)
        XCTAssertEqual(TextEdits.mapPosition(3, through: edits, assoc: .after), 5)
        XCTAssertEqual(TextEdits.mapPosition(4, through: edits, assoc: .before), 5)
        XCTAssertEqual(TextEdits.mapPosition(6, through: edits, assoc: .before), 7)
    }

    func testMapPositionAtAnInsertionPoint() {
        let edits = [edit(3, 3, "ab")]
        XCTAssertEqual(TextEdits.mapPosition(3, through: edits, assoc: .before), 3)
        XCTAssertEqual(TextEdits.mapPosition(3, through: edits, assoc: .after), 5)
    }

    func testMapPositionThroughSeveralEdits() {
        let edits = [edit(0, 0, "😀"), edit(2, 5, ""), edit(8, 8, "xyz")]
        XCTAssertEqual(TextEdits.mapPosition(6, through: edits, assoc: .before), 5)
        XCTAssertEqual(TextEdits.mapPosition(9, through: edits, assoc: .before), 11)
    }

    func testCaretStaysBeforeRemoteTextInsertedAtIt() {
        XCTAssertEqual(TextEdits.mapSelection(selection(3, 0), through: [edit(3, 3, "ab")]), selection(3, 0))
    }

    func testCaretAfterAnEditShifts() {
        XCTAssertEqual(TextEdits.mapSelection(selection(6, 0), through: [edit(0, 2, "abcd")]), selection(8, 0))
    }

    func testSelectionSpanningAReplacedRangeGrows() {
        XCTAssertEqual(TextEdits.mapSelection(selection(1, 4), through: [edit(2, 4, "XYZ")]), selection(1, 5))
    }

    func testSelectionExcludesTextInsertedAtItsEdges() {
        let edits = [edit(2, 2, "x"), edit(4, 4, "y")]
        XCTAssertEqual(TextEdits.mapSelection(selection(2, 2), through: edits), selection(3, 2))
    }

    func testSelectionInsideAReplacedRangeCollapses() {
        XCTAssertEqual(TextEdits.mapSelection(selection(2, 2), through: [edit(1, 5, "Q")]), selection(2, 0))
    }

    func testDiffOfEqualTextsIsEmpty() {
        XCTAssertEqual(TextEdits.diff(old: "same", new: "same"), [])
        XCTAssertEqual(TextEdits.diff(old: "", new: ""), [])
    }

    func testDiffTrimsCommonPrefixAndSuffix() {
        XCTAssertEqual(TextEdits.diff(old: "abc", new: "abXc"), [edit(2, 2, "X")])
        XCTAssertEqual(TextEdits.diff(old: "abXc", new: "abc"), [edit(2, 3, "")])
        XCTAssertEqual(TextEdits.diff(old: "hello world", new: "hello there"), [edit(6, 11, "there")])
        XCTAssertEqual(TextEdits.diff(old: "", new: "new"), [edit(0, 0, "new")])
        XCTAssertEqual(TextEdits.diff(old: "old", new: ""), [edit(0, 3, "")])
    }

    func testDiffSuffixNeverOverlapsThePrefix() {
        XCTAssertEqual(TextEdits.diff(old: "aaa", new: "aaaa"), [edit(3, 3, "a")])
        XCTAssertEqual(TextEdits.diff(old: "abab", new: "ab"), [edit(2, 4, "")])
    }

    func testDiffNeverSplitsASurrogatePair() {
        XCTAssertEqual(TextEdits.diff(old: "😀", new: "😁"), [edit(0, 2, "😁")])
        XCTAssertEqual(TextEdits.diff(old: "a😀x", new: "a🙂x"), [edit(1, 3, "🙂")])
        XCTAssertEqual(TextEdits.diff(old: "x😀", new: "x\u{10600}"), [edit(1, 3, "\u{10600}")])
    }

    func testDiffRoundTrips() {
        let pairs: [(String, String)] = [
            ("", "a"), ("a", ""), ("abc", "abc!"), ("abc", "!abc"), ("aaa", "aaaa"), ("aaaa", "aa"),
            ("héllo", "hello"), ("😀😀", "😀😁😀"), ("x😀y", "x\u{10600}y"), ("世界", "世間界"),
            ("line 1\nline 2\n", "line 1\nline 1.5\nline 2\n"),
        ]
        for (old, new) in pairs {
            XCTAssertEqual(TextEdits.apply(TextEdits.diff(old: old, new: new), to: old), new, "\(old) -> \(new)")
        }
    }
}
