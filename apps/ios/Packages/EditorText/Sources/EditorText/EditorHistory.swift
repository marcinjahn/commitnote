public struct HistoryStep: Equatable, Sendable {
    public let edits: [TextEdit]
    public let selection: TextSelection

    public init(edits: [TextEdit], selection: TextSelection) {
        self.edits = edits
        self.selection = selection
    }
}

public struct EditorHistory: Sendable {
    private struct Change: Sendable {
        var edit: TextEdit
        let removed: String

        var inverse: TextEdit {
            TextEdit(from: edit.from, to: edit.from + edit.insertLength, insert: removed)
        }
    }

    private struct Group: Sendable {
        var changes: [Change]
        var selectionBefore: TextSelection
        var selectionAfter: TextSelection
    }

    private let groupingInterval: Double
    private var undoStack: [Group] = []
    private var redoStack: [Group] = []
    private var lastTime: Double = 0
    private var canJoin = false

    public init(groupingInterval: Double = 1.0) {
        self.groupingInterval = groupingInterval
    }

    public var canUndo: Bool { !undoStack.isEmpty }
    public var canRedo: Bool { !redoStack.isEmpty }

    public mutating func recordLocal(
        _ edit: TextEdit, in oldText: String, selectionBefore: TextSelection,
        selectionAfter: TextSelection, at time: Double, joinCurrentGroup: Bool = false
    ) {
        if edit.from == edit.to && edit.insert.isEmpty { return }
        let units = Array(oldText.utf16)
        let from = max(0, min(edit.from, units.count))
        let to = max(from, min(edit.to, units.count))
        let change = Change(
            edit: TextEdit(from: from, to: to, insert: edit.insert),
            removed: String(decoding: units[from..<to], as: UTF16.self))

        redoStack.removeAll()
        if canJoin, var group = undoStack.last, shouldJoin(group, change, time, joinCurrentGroup) {
            group.changes.append(change)
            group.selectionAfter = selectionAfter
            undoStack[undoStack.count - 1] = group
        } else {
            undoStack.append(
                Group(changes: [change], selectionBefore: selectionBefore, selectionAfter: selectionAfter))
        }
        lastTime = time
        canJoin = true
    }

    private func shouldJoin(_ group: Group, _ change: Change, _ time: Double, _ joinCurrentGroup: Bool) -> Bool {
        if joinCurrentGroup { return true }
        guard let last = group.changes.last?.edit else { return false }
        return time - lastTime <= groupingInterval && change.edit.from == last.from + last.insertLength
    }

    public mutating func breakGroup() {
        canJoin = false
    }

    public mutating func undo() -> HistoryStep? {
        guard let group = undoStack.popLast() else { return nil }
        redoStack.append(group)
        canJoin = false
        return HistoryStep(edits: group.changes.reversed().map(\.inverse), selection: group.selectionBefore)
    }

    public mutating func redo() -> HistoryStep? {
        guard let group = redoStack.popLast() else { return nil }
        undoStack.append(group)
        canJoin = false
        return HistoryStep(edits: group.changes.map(\.edit), selection: group.selectionAfter)
    }

    public mutating func reset() {
        undoStack.removeAll()
        redoStack.removeAll()
        canJoin = false
    }

    public mutating func mapThroughRemote(_ edits: [TextEdit]) {
        if edits.isEmpty { return }

        var remote = edits
        for index in undoStack.indices.reversed() {
            guard let mapped = Self.mapBackward(undoStack[index], through: &remote) else {
                undoStack.removeSubrange(0...index)
                break
            }
            undoStack[index] = mapped
        }

        remote = edits
        for index in redoStack.indices.reversed() {
            guard let mapped = Self.mapForward(redoStack[index], through: &remote) else {
                redoStack.removeSubrange(0...index)
                break
            }
            redoStack[index] = mapped
        }
    }

    /// `remote` arrives in the coordinates of the text after `group` and leaves in the
    /// coordinates of the text before it.
    private static func mapBackward(_ group: Group, through remote: inout [TextEdit]) -> Group? {
        var mapped = group
        mapped.selectionAfter = TextEdits.mapSelection(group.selectionAfter, through: remote)
        for index in group.changes.indices.reversed() {
            let edit = group.changes[index].edit
            let insertEnd = edit.from + edit.insertLength
            var shift = 0
            var previous: [TextEdit] = []
            for r in remote {
                if r.to <= edit.from {
                    previous.append(r)
                    shift += r.lengthChange
                } else if r.from >= insertEnd {
                    previous.append(
                        TextEdit(from: r.from - edit.lengthChange, to: r.to - edit.lengthChange, insert: r.insert))
                } else {
                    return nil
                }
            }
            mapped.changes[index].edit = TextEdit(
                from: edit.from + shift, to: edit.to + shift, insert: edit.insert)
            remote = previous
        }
        mapped.selectionBefore = TextEdits.mapSelection(group.selectionBefore, through: remote)
        return mapped
    }

    /// `remote` arrives in the coordinates of the text before `group` and leaves in the
    /// coordinates of the text after it.
    private static func mapForward(_ group: Group, through remote: inout [TextEdit]) -> Group? {
        var mapped = group
        mapped.selectionBefore = TextEdits.mapSelection(group.selectionBefore, through: remote)
        for index in group.changes.indices {
            let edit = group.changes[index].edit
            var shift = 0
            var next: [TextEdit] = []
            for r in remote {
                if r.to <= edit.from {
                    next.append(r)
                    shift += r.lengthChange
                } else if r.from >= edit.to {
                    next.append(
                        TextEdit(from: r.from + edit.lengthChange, to: r.to + edit.lengthChange, insert: r.insert))
                } else {
                    return nil
                }
            }
            mapped.changes[index].edit = TextEdit(
                from: edit.from + shift, to: edit.to + shift, insert: edit.insert)
            remote = next
        }
        mapped.selectionAfter = TextEdits.mapSelection(group.selectionAfter, through: remote)
        return mapped
    }
}
