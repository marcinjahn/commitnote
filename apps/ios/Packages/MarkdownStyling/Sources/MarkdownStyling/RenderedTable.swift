public struct TableCellPosition: Sendable, Hashable, Comparable {
    /// 0 is the header, then the body rows; the delimiter row is not counted.
    public var row: Int
    public var column: Int

    public init(row: Int, column: Int) {
        self.row = row
        self.column = column
    }

    public static func < (lhs: TableCellPosition, rhs: TableCellPosition) -> Bool {
        (lhs.row, lhs.column) < (rhs.row, rhs.column)
    }
}

public enum TableCellPiece: Sendable, Equatable {
    /// `text.utf16.count == source.count`: one piece never spans a dropped character.
    case text(String, source: Range<Int>, styles: [PreviewStyle])
    case image(ImageReference)
}

public struct TableCellContent: Sendable, Equatable {
    /// The cell's segment between pipes; nil for a cell padding a short row.
    public var range: Range<Int>?
    public var caret: Int
    public var pieces: [TableCellPiece]
    /// The text pieces' text, an image contributing its alt text.
    public var plainText: String
    /// `plainText` with an image contributing its alt text or "Image"; "empty" when only whitespace remains.
    public var spokenText: String
}

public struct RenderedTable: Sendable, Equatable {
    public var table: MarkdownTable
    /// The header first, then the body rows; each holds exactly `table.columnCount` cells.
    public var rows: [[TableCellContent]]
    /// The container prefix without its quote marks, each with one following space or tab.
    public var indentText: String
    public var quoteLevels: Int

    /// The cells between two positions in row-major order, tab-separated within a row and line-separated between rows.
    public func copyText(from: TableCellPosition, to: TableCellPosition) -> String {
        guard !rows.isEmpty, table.columnCount > 0 else { return "" }
        let start = clamped(min(from, to))
        let end = clamped(max(from, to))
        var lines: [String] = []
        for row in start.row...end.row {
            let first = row == start.row ? start.column : 0
            let last = row == end.row ? end.column : table.columnCount - 1
            lines.append(rows[row][first...last].map(\.plainText).joined(separator: "\t"))
        }
        return lines.joined(separator: "\n")
    }

    private func clamped(_ position: TableCellPosition) -> TableCellPosition {
        TableCellPosition(
            row: min(max(position.row, 0), rows.count - 1),
            column: min(max(position.column, 0), table.columnCount - 1))
    }
}

struct TableCellSources {
    /// Emphasis, strong, strikethrough, inline code, link and URL runs, in the renderer's order.
    var styled: [StyleRun] = []
    /// Hidden and muted-marker runs.
    var dropped: [StyleRun] = []
    var images: [(node: SyntaxNode, reference: ImageReference?)] = []
}

extension RenderedTable {
    init(_ table: MarkdownTable, units: [UInt16], sources: TableCellSources) {
        let reader = TableCellReader(range: table.range, units: units, sources: sources)
        self.table = table
        rows = ([table.header] + table.rows).map { line in
            (0..<table.columnCount).map { column in
                column < line.cells.count ? reader.content(line.cells[column]) : Self.padding(line)
            }
        }
        var indent = ""
        var levels = 0
        var afterMark = false
        for character in table.containerPrefix ?? "" {
            if character == ">" {
                levels += 1
                afterMark = true
                continue
            }
            if afterMark && (character == " " || character == "\t") {
                afterMark = false
                continue
            }
            afterMark = false
            indent.append(character)
        }
        indentText = indent
        quoteLevels = levels
    }

    private static func padding(_ line: MarkdownTableLine) -> TableCellContent {
        TableCellContent(range: nil, caret: line.range.upperBound, pieces: [], plainText: "", spokenText: "empty")
    }
}

private struct TableCellReader {
    let units: [UInt16]
    let base: Int
    var dropped: [Bool]
    var verbatim: [Bool]
    var styles: [[PreviewStyle]]
    var references: [Int: ImageReference] = [:]

    init(range: Range<Int>, units: [UInt16], sources: TableCellSources) {
        self.units = units
        base = range.lowerBound
        dropped = Array(repeating: false, count: range.count)
        verbatim = Array(repeating: false, count: range.count)
        styles = Array(repeating: [], count: range.count)
        for run in sources.dropped {
            for index in run.range.clamped(to: range) { dropped[index - base] = true }
        }
        for run in sources.styled {
            let isVerbatim = run.style == .inlineCode || run.style == .url
            for index in run.range.clamped(to: range) {
                if isVerbatim { verbatim[index - base] = true }
                if !styles[index - base].contains(run.style) { styles[index - base].append(run.style) }
            }
        }
        for image in sources.images {
            for index in image.node.range.clamped(to: range) { verbatim[index - base] = true }
            if let reference = image.reference { references[reference.range.lowerBound] = reference }
        }
    }

    func content(_ cell: MarkdownTableCell) -> TableCellContent {
        let content = cell.contentRange
        var pieces: [TableCellPiece] = []
        var pending: Range<Int>?
        var pendingStyles: [PreviewStyle] = []

        func flush() {
            guard let range = pending else { return }
            pieces.append(
                .text(String(decoding: units[range], as: UTF16.self), source: range, styles: pendingStyles))
            pending = nil
        }

        var index = content.lowerBound
        var literal = false
        while index < content.upperBound {
            let local = index - base
            if let reference = references[index], reference.range.upperBound <= content.upperBound {
                flush()
                pieces.append(.image(reference))
                index = reference.range.upperBound
                literal = false
                continue
            }
            let escapes = !literal && units[index] == 92 && !verbatim[local] && index + 1 < content.upperBound
                && ImageReference.isEscapable(units[index + 1])
            if dropped[local] || escapes {
                flush()
                literal = escapes && !dropped[local]
                index += 1
                continue
            }
            literal = false
            if let range = pending, pendingStyles == styles[local] {
                pending = range.lowerBound..<(index + 1)
            } else {
                flush()
                pending = index..<(index + 1)
                pendingStyles = styles[local]
            }
            index += 1
        }
        flush()

        var plainText = ""
        var spokenText = ""
        for piece in pieces {
            switch piece {
            case .text(let text, _, _):
                plainText += text
                spokenText += text
            case .image(let reference):
                plainText += reference.alt
                spokenText += reference.alt.isEmpty ? "Image" : reference.alt
            }
        }
        if spokenText.allSatisfy(\.isWhitespace) { spokenText = "empty" }
        return TableCellContent(
            range: cell.range, caret: caret(cell), pieces: pieces, plainText: plainText, spokenText: spokenText)
    }

    private func caret(_ cell: MarkdownTableCell) -> Int {
        if !cell.contentRange.isEmpty { return cell.contentRange.upperBound }
        if cell.range.isEmpty { return cell.range.lowerBound }
        return units[cell.range.lowerBound] == 32 ? cell.range.lowerBound + 1 : cell.range.lowerBound
    }
}
