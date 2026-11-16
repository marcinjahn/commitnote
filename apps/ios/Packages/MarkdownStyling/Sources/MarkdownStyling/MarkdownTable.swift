public enum TableAlignment: Sendable, Equatable {
    case unspecified, left, center, right
}

public struct MarkdownTableCell: Sendable, Equatable {
    /// The segment between two pipes (or a line edge), untrimmed.
    public let range: Range<Int>
    /// `range` without the spaces and tabs at both ends; empty at `range.lowerBound` for a blank segment.
    public let contentRange: Range<Int>
}

public struct MarkdownTableLine: Sendable, Equatable {
    /// The whole source line, from its start (including any container prefix) to its end without the line break.
    public let range: Range<Int>
    /// Where the line's table syntax starts, after any container prefix.
    public let rowStart: Int
    public let cells: [MarkdownTableCell]
    public let trailingPipe: Bool
}

public struct MarkdownTable: Sendable, Equatable {
    /// From the start of the header's line to the end of the last line.
    public let range: Range<Int>
    /// The text before the table syntax on every line: `""` at top level, `nil` when a nested table's
    /// lines do not all share one prefix of spaces, tabs and `>`.
    public let containerPrefix: String?
    public let columnCount: Int
    public let alignments: [TableAlignment]
    public let header: MarkdownTableLine
    public let delimiter: MarkdownTableLine
    public let rows: [MarkdownTableLine]

    public var lines: [MarkdownTableLine] { [header, delimiter] + rows }

    public func cell(at position: Int) -> (line: Int, column: Int) {
        let all = lines
        let line = all.firstIndex { position <= $0.range.upperBound } ?? all.count - 1
        let cells = all[line].cells
        let column = cells.firstIndex { position <= $0.range.upperBound } ?? max(cells.count - 1, 0)
        return (line, max(min(column, columnCount - 1), 0))
    }
}

extension MarkdownTable {
    init?(_ node: Node, topLevel: Bool, units: [UInt16]) {
        let lineNodes = node.children.filter {
            $0.type == .tableHeader || $0.type == .tableDelimiter || $0.type == .tableRow
        }
        guard lineNodes.count >= 2, let last = lineNodes.last else { return nil }
        let lines = lineNodes.map { Self.line($0, units) }
        let columnCount = lines[0].cells.count
        self.init(
            range: Self.lineStart(units, lineNodes[0].from)..<Self.lineEnd(units, last.from),
            containerPrefix: topLevel ? "" : Self.prefix(node, lineNodes, units),
            columnCount: columnCount,
            alignments: Self.alignments(lineNodes[1], columnCount, units),
            header: lines[0],
            delimiter: lines[1],
            rows: Array(lines.dropFirst(2)))
    }

    private static func lineStart(_ units: [UInt16], _ position: Int) -> Int {
        var index = min(position, units.count)
        while index > 0, units[index - 1] != 10 { index -= 1 }
        return index
    }

    private static func lineEnd(_ units: [UInt16], _ position: Int) -> Int {
        var index = position
        while index < units.count, units[index] != 10 { index += 1 }
        return index
    }

    private static func isBlank(_ unit: UInt16) -> Bool {
        unit == 32 || unit == 9
    }

    private static func isBlankText(_ units: [UInt16], _ from: Int, _ to: Int) -> Bool {
        (from..<to).allSatisfy { isWhitespace(Int(units[$0])) }
    }

    private static func cell(_ units: [UInt16], _ from: Int, _ to: Int) -> MarkdownTableCell {
        var contentTo = to
        while contentTo > from, isBlank(units[contentTo - 1]) { contentTo -= 1 }
        var contentFrom = from
        while contentFrom < contentTo, isBlank(units[contentFrom]) { contentFrom += 1 }
        return MarkdownTableCell(range: from..<to, contentRange: contentFrom..<contentTo)
    }

    private static func line(_ node: Node, _ units: [UInt16]) -> MarkdownTableLine {
        let rowStart = node.from
        let rowEnd = node.to
        var pipes: [Range<Int>]
        if node.type == .tableDelimiter {
            pipes = (rowStart..<rowEnd).filter { units[$0] == 124 }.map { $0..<$0 + 1 }
        } else {
            pipes = node.children.filter { $0.type == .tableDelimiter }.map { $0.from..<$0.to }
        }
        var segments: [Range<Int>] = []
        var start = rowStart
        for pipe in pipes {
            segments.append(start..<pipe.lowerBound)
            start = pipe.upperBound
        }
        segments.append(start..<rowEnd)
        if pipes.first?.lowerBound == rowStart { segments.removeFirst() }
        if pipes.last?.upperBound == rowEnd { segments.removeLast() }
        let lastPipe = pipes.last
        var trailingPipe = lastPipe?.upperBound == rowEnd
        if !trailingPipe, let lastPipe, let lastSegment = segments.last,
            lastSegment.lowerBound == lastPipe.upperBound,
            isBlankText(units, lastSegment.lowerBound, lastSegment.upperBound)
        {
            segments.removeLast()
            trailingPipe = true
        }
        return MarkdownTableLine(
            range: lineStart(units, rowStart)..<lineEnd(units, rowStart),
            rowStart: rowStart,
            cells: segments.map { cell(units, $0.lowerBound, $0.upperBound) },
            trailingPipe: trailingPipe)
    }

    private static func trimmed(_ units: ArraySlice<UInt16>) -> ArraySlice<UInt16> {
        var slice = units
        while let first = slice.first, isWhitespace(Int(first)) { slice.removeFirst() }
        while let last = slice.last, isWhitespace(Int(last)) { slice.removeLast() }
        return slice
    }

    private static func alignments(_ node: Node, _ columnCount: Int, _ units: [UInt16]) -> [TableAlignment] {
        var text = trimmed(units[node.from..<node.to])
        if text.first == 124 { text.removeFirst() }
        if text.last == 124 { text.removeLast() }
        var result = text.split(separator: 124, omittingEmptySubsequences: false).map { part -> TableAlignment in
            let spec = trimmed(part)
            switch (spec.first == 58, spec.last == 58) {
            case (true, true): return .center
            case (true, false): return .left
            case (false, true): return .right
            case (false, false): return .unspecified
            }
        }
        if result.count > columnCount { result.removeLast(result.count - columnCount) }
        while result.count < columnCount { result.append(.unspecified) }
        return result
    }

    private static func prefix(_ node: Node, _ lineNodes: [Node], _ units: [UInt16]) -> String? {
        let newlines = units[node.from..<node.to].reduce(0) { $0 + ($1 == 10 ? 1 : 0) }
        guard lineNodes.count == newlines + 1 else { return nil }
        let prefixes = lineNodes.map { Array(units[lineStart(units, $0.from)..<$0.from]) }
        guard let first = prefixes.first, prefixes.allSatisfy({ $0 == first }),
            first.allSatisfy({ $0 == 32 || $0 == 9 || $0 == 62 })
        else { return nil }
        return String(decoding: first, as: UTF16.self)
    }
}
