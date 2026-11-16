import EditorText

public enum InsertionRule {
    /// Places image references where the web editor's insertion rule does; offsets are UTF-16 code units.
    public static func insertImageReferences(text: String, at position: Int, references: [String]) -> CommandResult {
        let source = Source(text)
        let at = min(max(position, 0), source.units.count)
        let block = Array(references.joined(separator: "\n").utf16)
        let insertion = source.insertImageReferences(at, block, references.map { Array($0.utf16) })
        let insert = String(decoding: insertion.insert, as: UTF16.self)
        return CommandResult(
            edits: [TextEdit(from: insertion.at, to: insertion.at, insert: insert)],
            selection: TextSelection(location: insertion.caret, length: 0))
    }
}

private struct Insertion {
    let at: Int
    let insert: [UInt16]
    let caret: Int
}

private let newline: UInt16 = 10
private let space: UInt16 = 32
private let greaterThan: UInt16 = 62

private func trimEnd(_ units: [UInt16]) -> [UInt16] {
    var end = units.count
    while end > 0, isWhitespace(Int(units[end - 1])) { end -= 1 }
    return Array(units[0..<end])
}

private func isBlankLine(_ units: [UInt16]) -> Bool {
    units.allSatisfy { isWhitespace(Int($0)) }
}

private func prefixLines(_ block: [UInt16], _ prefix: [UInt16]) -> [UInt16] {
    block.split(separator: newline, omittingEmptySubsequences: false)
        .map { prefix + Array($0) }
        .joined(separator: [newline])
        .map { $0 }
}

private func isContainerSeparator(_ line: [UInt16], _ separator: [UInt16]) -> Bool {
    let trimmed = trimEnd(line)
    return trimmed.isEmpty || (trimmed.last == greaterThan && separator.starts(with: trimmed))
}

private func closingSeparator(_ line: [UInt16], _ separator: [UInt16]) -> [UInt16] {
    var closing: [UInt16] = []
    for index in separator.indices {
        let candidate = Array(separator[0...index])
        if separator[index] == greaterThan && line.starts(with: candidate) {
            closing = candidate
        }
    }
    return closing
}

private struct Source {
    let units: [UInt16]
    let document: MarkdownDocument
    let spans: [Range<Int>]

    init(_ text: String) {
        units = Array(text.utf16)
        document = MarkdownParser.parse(text)
        spans = document.tables.map(\.range)
    }

    func lineStart(_ position: Int) -> Int {
        guard position > 0, !units.isEmpty else { return 0 }
        var index = min(position - 1, units.count - 1)
        while index >= 0 {
            if units[index] == newline { return index + 1 }
            index -= 1
        }
        return 0
    }

    func lineEnd(_ position: Int) -> Int {
        var index = min(max(position, 0), units.count)
        while index < units.count, units[index] != newline { index += 1 }
        return index
    }

    func insertImageReferences(_ at: Int, _ block: [UInt16], _ references: [[UInt16]]) -> Insertion {
        guard let table = document.table(containing: at) else { return insertBlock(at, block) }
        let after = { (end: Int) in insertBlockAfterTable(end, block, table.containerPrefix) }

        let lines = table.lines
        let lineIndex = table.cell(at: at).line
        let line = lines[lineIndex]
        if lineIndex == 0 && at <= line.rowStart {
            return insertBlock(line.range.lowerBound, block, Array((table.containerPrefix ?? "").utf16))
        }
        if line.cells.isEmpty {
            if lineIndex == lines.count - 1 && at > line.rowStart {
                return after(line.range.upperBound)
            }
            let point = min(max(at, line.rowStart), line.range.upperBound)
            return insertInline(point, references)
        }
        if lineIndex == lines.count - 1 && line.trailingPipe, let last = line.cells.last {
            if at >= last.range.upperBound + 1 { return after(line.range.upperBound) }
        }
        return insertInline(inlinePoint(table, line, lineIndex, at), references)
    }

    func insertBlock(_ position: Int, _ block: [UInt16], _ prefix: [UInt16] = []) -> Insertion {
        let separator = trimEnd(prefix)
        var at = min(max(position, 0), units.count)
        var from = lineStart(at)
        var to = lineEnd(at)
        if at == to && at != from && to < units.count {
            let nextTo = lineEnd(to + 1)
            if isBlankLine(units.slice(to + 1, nextTo)) {
                at = to + 1
                from = at
                to = nextTo
            }
        }

        var before: [UInt16] = at != from ? [newline] : []
        if at > 0 {
            let previousFrom = lineStart(at - 1)
            let previous = units.slice(previousFrom, at)
            let previousInTable = spans.contains { $0.lowerBound <= previousFrom && previousFrom <= $0.upperBound }
            if !isBlankLine(previous) && previousInTable {
                before += separator + [newline]
            }
        }

        var after: [UInt16] = []
        if !isBlankLine(units.slice(at, to)) {
            let startsTable = at == from && spans.contains { $0.lowerBound == from }
            if startsTable { after = [newline] }
        }

        let prefixed = prefix.isEmpty ? block : prefixLines(block, prefix)
        let insert = before + prefixed + [newline] + (after.isEmpty ? [] : separator + after)
        let caret = at + before.count + prefixed.count + 1 + (after.isEmpty ? 0 : separator.count)
        return Insertion(at: at, insert: insert, caret: caret)
    }

    func insertBlockAfterTable(_ tableEnd: Int, _ block: [UInt16], _ containerPrefix: String?) -> Insertion {
        guard let containerPrefix, !containerPrefix.isEmpty else { return insertBlock(tableEnd, block) }
        let prefix = Array(containerPrefix.utf16)
        let separator = trimEnd(prefix)
        let head = [newline] + separator + [newline] + prefixLines(block, prefix)
        if tableEnd >= units.count {
            let insert = head + [newline]
            return Insertion(at: tableEnd, insert: insert, caret: tableEnd + insert.count)
        }
        let next = units.slice(tableEnd + 1, lineEnd(tableEnd + 1))
        if isContainerSeparator(next, separator) {
            return Insertion(at: tableEnd, insert: head, caret: tableEnd + head.count + 1 + trimEnd(next).count)
        }
        let insert = head + [newline] + closingSeparator(next, separator)
        return Insertion(at: tableEnd, insert: insert, caret: tableEnd + insert.count)
    }

    func insertInline(_ position: Int, _ references: [[UInt16]]) -> Insertion {
        let joined = Array(references.joined(separator: [space]))
        let previous = units.code(position - 1)
        let next = units.code(position)
        let lead: [UInt16] = previous >= 0 && !isWhitespace(previous) ? [space] : []
        let trail: [UInt16] = next >= 0 && !isWhitespace(next) ? [space] : []
        return Insertion(at: position, insert: lead + joined + trail, caret: position + lead.count + joined.count)
    }

    func inlinePoint(_ table: MarkdownTable, _ line: MarkdownTableLine, _ lineIndex: Int, _ position: Int) -> Int {
        if lineIndex == 1 {
            let column = table.cell(at: position).column
            guard column < table.header.cells.count else { return position }
            let header = table.header.cells[column]
            return !header.contentRange.isEmpty
                ? header.contentRange.upperBound
                : min(header.range.lowerBound + 1, header.range.upperBound)
        }
        let cells = line.cells
        guard let first = cells.first, let last = cells.last else { return position }
        let clamped = min(max(position, first.range.lowerBound), last.range.upperBound)
        guard let cell = cells.first(where: { clamped <= $0.range.upperBound }) else { return clamped }
        return max(clamped, cell.range.lowerBound)
    }
}
