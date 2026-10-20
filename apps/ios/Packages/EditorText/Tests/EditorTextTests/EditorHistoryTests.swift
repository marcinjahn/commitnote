import EditorText
import XCTest

final class EditorHistoryTests: XCTestCase {
    private struct Editor {
        var text: String
        var selection: TextSelection
        var history = EditorHistory()

        init(_ text: String) {
            self.text = text
            selection = TextSelection(location: text.utf16.count, length: 0)
        }

        mutating func replace(_ from: Int, _ to: Int, with insert: String, at time: Double, join: Bool = false) {
            let edit = TextEdit(from: from, to: to, insert: insert)
            let after = TextSelection(location: from + insert.utf16.count, length: 0)
            history.recordLocal(
                edit, in: text, selectionBefore: selection, selectionAfter: after, at: time, joinCurrentGroup: join)
            text = TextEdits.apply([edit], to: text)
            selection = after
        }

        mutating func type(_ insert: String, at time: Double) {
            replace(selection.location, selection.location + selection.length, with: insert, at: time)
        }

        mutating func remote(_ edits: [TextEdit]) {
            text = TextEdits.apply(edits, to: text)
            selection = TextEdits.mapSelection(selection, through: edits)
            history.mapThroughRemote(edits)
        }

        @discardableResult
        mutating func undo() -> Bool { perform(history.undo()) }

        @discardableResult
        mutating func redo() -> Bool { perform(history.redo()) }

        private mutating func perform(_ step: HistoryStep?) -> Bool {
            guard let step else { return false }
            for edit in step.edits { text = TextEdits.apply([edit], to: text) }
            selection = step.selection
            return true
        }
    }

    private func caret(_ location: Int) -> TextSelection {
        TextSelection(location: location, length: 0)
    }

    func testTypingWithinTheGroupingIntervalFormsOneGroup() {
        var editor = Editor("")
        editor.type("a", at: 0)
        editor.type("b", at: 0.5)
        editor.type("c", at: 1.4)
        XCTAssertEqual(editor.text, "abc")

        editor.undo()
        XCTAssertEqual(editor.text, "")
        XCTAssertEqual(editor.selection, caret(0))
        XCTAssertFalse(editor.history.canUndo)
    }

    func testAPauseStartsANewGroup() {
        var editor = Editor("")
        editor.type("a", at: 0)
        editor.type("b", at: 2.5)

        editor.undo()
        XCTAssertEqual(editor.text, "a")
        XCTAssertTrue(editor.history.canUndo)
    }

    func testBreakGroupStartsANewGroup() {
        var editor = Editor("")
        editor.type("a", at: 0)
        editor.history.breakGroup()
        editor.type("b", at: 0.1)

        editor.undo()
        XCTAssertEqual(editor.text, "a")
    }

    func testANonAdjacentEditStartsANewGroup() {
        var editor = Editor("hello")
        editor.type("X", at: 0)
        editor.selection = caret(0)
        editor.type("Y", at: 0.1)
        XCTAssertEqual(editor.text, "YhelloX")

        editor.undo()
        XCTAssertEqual(editor.text, "helloX")
    }

    func testJoinCurrentGroupJoinsACompositionReplacingItsMarkedRange() {
        var editor = Editor("ab")
        editor.type("n", at: 0)
        editor.replace(2, 3, with: "に", at: 5, join: true)
        editor.replace(2, 3, with: "日", at: 10, join: true)
        XCTAssertEqual(editor.text, "ab日")

        editor.undo()
        XCTAssertEqual(editor.text, "ab")
        XCTAssertFalse(editor.history.canUndo)
    }

    func testUndoAndRedoRestoreTextAndSelections() {
        var editor = Editor("hello world")
        editor.selection = TextSelection(location: 0, length: 5)
        editor.type("bye", at: 0)
        XCTAssertEqual(editor.text, "bye world")

        XCTAssertTrue(editor.undo())
        XCTAssertEqual(editor.text, "hello world")
        XCTAssertEqual(editor.selection, TextSelection(location: 0, length: 5))
        XCTAssertFalse(editor.undo())

        XCTAssertTrue(editor.redo())
        XCTAssertEqual(editor.text, "bye world")
        XCTAssertEqual(editor.selection, caret(3))
        XCTAssertFalse(editor.redo())
    }

    func testUndoRevertsAMultiEditGroupInReverseOrder() {
        var editor = Editor("abc")
        editor.replace(1, 2, with: "😀", at: 0)
        editor.replace(3, 4, with: "", at: 0, join: true)
        editor.replace(0, 1, with: "xyz", at: 0, join: true)
        XCTAssertEqual(editor.text, "xyz😀")

        editor.undo()
        XCTAssertEqual(editor.text, "abc")
        editor.redo()
        XCTAssertEqual(editor.text, "xyz😀")
    }

    func testANewEditClearsRedo() {
        var editor = Editor("")
        editor.type("a", at: 0)
        editor.undo()
        XCTAssertTrue(editor.history.canRedo)

        editor.type("b", at: 5)
        XCTAssertFalse(editor.history.canRedo)
    }

    func testUndoAfterARemoteEditElsewhereKeepsTheRemoteEdit() {
        var editor = Editor("hello")
        editor.type(" world", at: 0)
        editor.remote([TextEdit(from: 0, to: 0, insert: "X")])
        XCTAssertEqual(editor.text, "Xhello world")

        editor.undo()
        XCTAssertEqual(editor.text, "Xhello")
        XCTAssertEqual(editor.selection, caret(6))

        editor.redo()
        XCTAssertEqual(editor.text, "Xhello world")
        XCTAssertEqual(editor.selection, caret(12))
    }

    func testRemoteTextAdjacentToALocalEditSurvivesUndo() {
        var editor = Editor("hello")
        editor.type(" world", at: 0)
        editor.remote([TextEdit(from: 5, to: 5, insert: ","), TextEdit(from: 11, to: 11, insert: "!")])
        XCTAssertEqual(editor.text, "hello, world!")

        editor.undo()
        XCTAssertEqual(editor.text, "hello,!")
    }

    func testRemoteEditBetweenGroupsKeepsBothGroups() {
        var editor = Editor("--------")
        editor.selection = caret(0)
        editor.type("A", at: 0)
        editor.selection = caret(9)
        editor.type("B", at: 5)
        editor.remote([TextEdit(from: 5, to: 5, insert: "R")])
        XCTAssertEqual(editor.text, "A----R----B")

        editor.undo()
        XCTAssertEqual(editor.text, "A----R----")
        editor.undo()
        XCTAssertEqual(editor.text, "----R----")
        XCTAssertEqual(editor.selection, caret(0))
    }

    func testRemoteEditOverlappingAGroupDropsItAndOlderGroups() {
        var editor = Editor("0123456789")
        editor.replace(0, 1, with: "A", at: 0)
        editor.replace(5, 5, with: "B", at: 5)
        editor.replace(11, 11, with: "C", at: 10)
        XCTAssertEqual(editor.text, "A1234B56789C")

        editor.remote([TextEdit(from: 4, to: 7, insert: "z")])
        XCTAssertEqual(editor.text, "A123z6789C")

        XCTAssertTrue(editor.undo())
        XCTAssertEqual(editor.text, "A123z6789")
        XCTAssertFalse(editor.history.canUndo)
    }

    func testRemoteEditDeletingAroundALocalDeletionDropsIt() {
        var editor = Editor("abcdef")
        editor.replace(2, 4, with: "", at: 0)
        editor.remote([TextEdit(from: 1, to: 3, insert: "")])
        XCTAssertEqual(editor.text, "af")
        XCTAssertFalse(editor.history.canUndo)
    }

    func testRedoIsMappedThroughRemoteEdits() {
        var editor = Editor("hello")
        editor.type(" world", at: 0)
        editor.undo()
        editor.remote([TextEdit(from: 0, to: 1, insert: "J")])
        XCTAssertEqual(editor.text, "Jello")

        editor.redo()
        XCTAssertEqual(editor.text, "Jello world")
        editor.undo()
        XCTAssertEqual(editor.text, "Jello")
    }

    func testRemoteEditOverlappingARedoGroupDropsIt() {
        var editor = Editor("hello")
        editor.replace(0, 5, with: "bye", at: 0)
        editor.undo()
        editor.remote([TextEdit(from: 1, to: 2, insert: "a")])
        XCTAssertEqual(editor.text, "hallo")
        XCTAssertFalse(editor.history.canRedo)
    }

    func testResetEmptiesBothStacks() {
        var editor = Editor("")
        editor.type("a", at: 0)
        editor.type("b", at: 5)
        editor.undo()
        editor.history.reset()
        XCTAssertFalse(editor.history.canUndo)
        XCTAssertFalse(editor.history.canRedo)
        XCTAssertNil(editor.history.undo())
    }
}
