public enum SyntaxKind: Sendable, Equatable, Hashable {
    case atxHeading(level: Int)
    case setextHeading(level: Int)
    case headerMark
    case blockquote
    case quoteMark
    case bulletList
    case orderedList
    case listItem
    case listMark
    case task
    case taskMarker(checked: Bool)
    case fencedCode
    case codeMark
    case codeInfo
    case codeText
    case indentedCode
    case horizontalRule
    case paragraph
    case emphasis
    case strongEmphasis
    case emphasisMark
    case strikethrough
    case strikethroughMark
    case inlineCode
    case link
    case linkMark
    case linkLabel
    case url
    case autolink
    case image
    case table
    case hardBreak
}

/// A syntax node; `range` is in UTF-16 code units, like `NSRange`.
public struct SyntaxNode: Sendable, Equatable {
    public var kind: SyntaxKind
    public var range: Range<Int>

    public init(kind: SyntaxKind, range: Range<Int>) {
        self.kind = kind
        self.range = range
    }
}

public struct MarkdownDocument: Sendable {
    public let text: String
    /// Document order, parents before children.
    public let nodes: [SyntaxNode]
    /// UTF-16 offset of the start of each line.
    public let lines: [Int]
    /// Every table, in document order.
    public let tables: [MarkdownTable]
    let length: Int
    let units: [UInt16]

    /// The line around `offset`, without its line break.
    public func line(containing offset: Int) -> Range<Int> {
        let clamped = min(max(offset, 0), length)
        var low = 0
        var high = lines.count - 1
        while low < high {
            let mid = (low + high + 1) / 2
            if lines[mid] <= clamped { low = mid } else { high = mid - 1 }
        }
        let end = low + 1 < lines.count ? lines[low + 1] - 1 : length
        return lines[low]..<end
    }

    /// The first table whose range, ends included, contains `position`.
    public func table(containing position: Int) -> MarkdownTable? {
        tables.first { $0.range.lowerBound <= position && position <= $0.range.upperBound }
    }

    /// Nodes intersecting `range`; an empty range matches nodes that contain or touch its position.
    public func nodes(overlapping range: Range<Int>) -> [SyntaxNode] {
        if range.isEmpty {
            let position = range.lowerBound
            return nodes.filter { $0.range.lowerBound <= position && position <= $0.range.upperBound }
        }
        return nodes.filter {
            $0.range.lowerBound < range.upperBound && range.lowerBound < $0.range.upperBound
        }
    }
}

public enum MarkdownParser {
    public static func parse(_ text: String) -> MarkdownDocument {
        let units = Array(text.utf16)
        let root = BlockParser(units).parse()
        var nodes: [SyntaxNode] = []
        nodes.reserveCapacity(units.count / 4)
        flatten(root, units, into: &nodes)
        var tables: [MarkdownTable] = []
        collectTables(root, topLevel: true, units, into: &tables)
        var lines = [0]
        for (index, unit) in units.enumerated() where unit == 10 {
            lines.append(index + 1)
        }
        return MarkdownDocument(text: text, nodes: nodes, lines: lines, tables: tables, length: units.count, units: units)
    }

    private static func flatten(_ node: Node, _ units: [UInt16], into nodes: inout [SyntaxNode]) {
        if node.from <= node.to, let kind = syntaxKind(node, units) {
            nodes.append(SyntaxNode(kind: kind, range: node.from..<node.to))
        }
        for child in node.children where node.type != .linkReference || child.type == .quoteMark {
            flatten(child, units, into: &nodes)
        }
    }

    private static func collectTables(
        _ node: Node, topLevel: Bool, _ units: [UInt16], into tables: inout [MarkdownTable]
    ) {
        if node.type == .table {
            if let table = MarkdownTable(node, topLevel: topLevel, units: units) { tables.append(table) }
            return
        }
        for child in node.children {
            collectTables(child, topLevel: node.type == .document, units, into: &tables)
        }
    }

    private static func syntaxKind(_ node: Node, _ units: [UInt16]) -> SyntaxKind? {
        switch node.type {
        case .codeBlock: .indentedCode
        case .fencedCode: .fencedCode
        case .blockquote: .blockquote
        case .horizontalRule: .horizontalRule
        case .bulletList: .bulletList
        case .orderedList: .orderedList
        case .listItem: .listItem
        case .atxHeading(let level): .atxHeading(level: level)
        case .setextHeading(let level): .setextHeading(level: level)
        case .paragraph: .paragraph
        case .hardBreak: .hardBreak
        case .emphasis: .emphasis
        case .strongEmphasis: .strongEmphasis
        case .link: .link
        case .image: .image
        case .inlineCode: .inlineCode
        case .autolink: .autolink
        case .headerMark: .headerMark
        case .quoteMark: .quoteMark
        case .listMark: .listMark
        case .linkMark: .linkMark
        case .emphasisMark: .emphasisMark
        case .codeMark: .codeMark
        case .codeText: .codeText
        case .codeInfo: .codeInfo
        case .linkText: .linkLabel
        case .url: .url
        case .table: .table
        case .task: .task
        case .taskMarker:
            .taskMarker(checked: node.from + 1 < units.count && (units[node.from + 1] | 0x20) == 0x78)
        case .strikethrough: .strikethrough
        case .strikethroughMark: .strikethroughMark
        case .document, .htmlBlock, .linkReference, .commentBlock, .processingInstructionBlock,
            .escape, .entity, .htmlTag, .comment, .processingInstruction, .linkTitle, .linkLabel,
            .tableHeader, .tableRow, .tableCell, .tableDelimiter, .subscriptText, .subscriptMark,
            .superscript, .superscriptMark, .emoji, .plainLink:
            nil
        }
    }
}
