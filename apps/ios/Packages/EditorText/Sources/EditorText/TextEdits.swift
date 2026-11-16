public struct TextEdit: Equatable, Sendable {
    public var from: Int
    public var to: Int
    public var insert: String

    public init(from: Int, to: Int, insert: String) {
        self.from = from
        self.to = to
        self.insert = insert
    }

    var insertLength: Int { insert.utf16.count }
    var lengthChange: Int { insertLength - (to - from) }
}

public struct TextSelection: Equatable, Sendable {
    public var location: Int
    public var length: Int

    public init(location: Int, length: Int) {
        self.location = location
        self.length = length
    }
}

public enum TextEdits {
    public enum Assoc: Sendable { case before, after }

    public static func apply(_ edits: [TextEdit], to text: String) -> String {
        if edits.isEmpty { return text }
        let units = Array(text.utf16)
        var result: [UInt16] = []
        result.reserveCapacity(units.count)
        var cursor = 0
        for edit in edits {
            let from = max(cursor, min(edit.from, units.count))
            let to = max(from, min(edit.to, units.count))
            result.append(contentsOf: units[cursor..<from])
            result.append(contentsOf: edit.insert.utf16)
            cursor = to
        }
        result.append(contentsOf: units[cursor...])
        return String(decoding: result, as: UTF16.self)
    }

    public static func mapPosition(_ position: Int, through edits: [TextEdit], assoc: Assoc) -> Int {
        var delta = 0
        for edit in edits {
            if edit.from == edit.to {
                if position < edit.from || (position == edit.from && assoc == .before) { break }
                delta += edit.insertLength
                continue
            }
            if position <= edit.from { break }
            if position < edit.to {
                return edit.from + delta + (assoc == .before ? 0 : edit.insertLength)
            }
            delta += edit.lengthChange
        }
        return position + delta
    }

    public static func mapSelection(_ selection: TextSelection, through edits: [TextEdit]) -> TextSelection {
        if selection.length == 0 {
            return TextSelection(
                location: mapPosition(selection.location, through: edits, assoc: .before), length: 0)
        }
        let start = mapPosition(selection.location, through: edits, assoc: .after)
        let end = max(start, mapPosition(selection.location + selection.length, through: edits, assoc: .before))
        return TextSelection(location: start, length: end - start)
    }

    public static func diff(old: String, new: String) -> [TextEdit] {
        if old == new { return [] }
        let a = Array(old.utf16)
        let b = Array(new.utf16)

        var prefix = 0
        let maxPrefix = min(a.count, b.count)
        while prefix < maxPrefix && a[prefix] == b[prefix] { prefix += 1 }
        if prefix > 0 && UTF16.isLeadSurrogate(a[prefix - 1]) { prefix -= 1 }

        var suffix = 0
        let maxSuffix = min(a.count, b.count) - prefix
        while suffix < maxSuffix && a[a.count - 1 - suffix] == b[b.count - 1 - suffix] { suffix += 1 }
        if suffix > 0 && UTF16.isTrailSurrogate(a[a.count - suffix]) { suffix -= 1 }

        let insert = String(decoding: b[prefix..<(b.count - suffix)], as: UTF16.self)
        return [TextEdit(from: prefix, to: a.count - suffix, insert: insert)]
    }
}
