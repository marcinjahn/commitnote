import EditorText

public enum PreviewStyle: Sendable, Equatable {
    case heading(level: Int)
    case emphasis
    case strong
    case strikethrough
    case inlineCode
    case codeBlockLine
    case quoteLine
    case link
    case url
    case listMark
    case mutedMarker
    case hidden
}

public struct StyleRun: Sendable, Equatable {
    public var range: Range<Int>
    public var style: PreviewStyle

    public init(range: Range<Int>, style: PreviewStyle) {
        self.range = range
        self.style = style
    }
}

public enum Placement: Sendable, Equatable {
    case checkbox(range: Range<Int>, checked: Bool)
    case rule(lineRange: Range<Int>)
    case image(reference: ImageReference, lineRange: Range<Int>, sourceVisible: Bool)
}

public enum LivePreview {
    /// Runs may overlap: apply block line styles first, inline styles next and `hidden` last.
    public static func render(
        _ document: MarkdownDocument, selection: [TextSelection]
    ) -> (runs: [StyleRun], placements: [Placement]) {
        var renderer = Renderer(document: document, selection: selection)
        renderer.run()
        return (renderer.block + renderer.inline + renderer.hidden, renderer.placements)
    }
}

private struct Renderer {
    let document: MarkdownDocument
    let selection: [TextSelection]
    var block: [StyleRun] = []
    var inline: [StyleRun] = []
    var hidden: [StyleRun] = []
    var placements: [Placement] = []

    init(document: MarkdownDocument, selection: [TextSelection]) {
        self.document = document
        self.selection = selection
    }

    func linesActive(_ range: Range<Int>) -> Bool {
        let lineStart = document.line(containing: range.lowerBound).lowerBound
        let lineEnd = document.line(containing: range.upperBound).upperBound
        return selection.contains {
            $0.location <= lineEnd && $0.location + $0.length >= lineStart
        }
    }

    func withTrailingSpace(_ range: Range<Int>) -> Range<Int> {
        let next = range.upperBound
        return next < document.units.count && document.units[next] == 32 ? range.lowerBound..<(next + 1) : range
    }

    mutating func addLines(_ range: Range<Int>, _ style: PreviewStyle) {
        let first = document.line(containing: range.lowerBound)
        let last = document.line(containing: max(range.lowerBound, range.upperBound - 1))
        var start = first.lowerBound
        while start <= last.lowerBound {
            let line = document.line(containing: start)
            block.append(StyleRun(range: line, style: style))
            if line.upperBound >= document.units.count { break }
            start = line.upperBound + 1
        }
    }

    mutating func hideUnlessActive(_ range: Range<Int>, extendingSpace: Bool = false) {
        if linesActive(range) {
            inline.append(StyleRun(range: range, style: .mutedMarker))
        } else {
            hidden.append(StyleRun(range: extendingSpace ? withTrailingSpace(range) : range, style: .hidden))
        }
    }

    mutating func run() {
        var ancestors: [SyntaxNode] = []
        for node in document.nodes {
            while let top = ancestors.last,
                !(top.range.lowerBound <= node.range.lowerBound && node.range.upperBound <= top.range.upperBound)
            {
                ancestors.removeLast()
            }
            let parent = ancestors.last?.kind
            ancestors.append(node)
            visit(node, parent: parent)
        }
    }

    mutating func visit(_ node: SyntaxNode, parent: SyntaxKind?) {
        let range = node.range
        switch node.kind {
        case .atxHeading(let level), .setextHeading(let level):
            block.append(StyleRun(range: range, style: .heading(level: level)))
        case .headerMark:
            if case .some(.atxHeading) = parent {
                hideUnlessActive(range, extendingSpace: true)
            } else {
                inline.append(StyleRun(range: range, style: .mutedMarker))
            }
        case .blockquote:
            addLines(range, .quoteLine)
        case .quoteMark:
            hideUnlessActive(range, extendingSpace: true)
        case .fencedCode, .indentedCode:
            addLines(range, .codeBlockLine)
        case .listMark:
            inline.append(StyleRun(range: range, style: .listMark))
        case .emphasis:
            inline.append(StyleRun(range: range, style: .emphasis))
        case .strongEmphasis:
            inline.append(StyleRun(range: range, style: .strong))
        case .strikethrough:
            inline.append(StyleRun(range: range, style: .strikethrough))
        case .emphasisMark, .strikethroughMark:
            hideUnlessActive(range)
        case .inlineCode:
            inline.append(StyleRun(range: range, style: .inlineCode))
        case .codeMark:
            if parent == .inlineCode {
                hideUnlessActive(range)
            } else {
                inline.append(StyleRun(range: range, style: .mutedMarker))
            }
        case .linkLabel:
            if parent == .link { inline.append(StyleRun(range: range, style: .link)) }
        case .linkMark:
            if parent == .link {
                hideUnlessActive(range)
            } else {
                inline.append(StyleRun(range: range, style: .mutedMarker))
            }
        case .url:
            visitURL(node, parent: parent)
        case .autolink:
            inline.append(StyleRun(range: range, style: .url))
        case .image:
            visitImage(node)
        case .taskMarker(let checked):
            placements.append(.checkbox(range: range, checked: checked))
        case .horizontalRule:
            if !linesActive(range) {
                hidden.append(StyleRun(range: range, style: .hidden))
                placements.append(.rule(lineRange: document.line(containing: range.lowerBound)))
            }
        case .codeInfo, .codeText, .task, .link, .bulletList, .orderedList, .listItem, .paragraph, .table, .hardBreak:
            break
        }
    }

    mutating func visitURL(_ node: SyntaxNode, parent: SyntaxKind?) {
        if parent == .link, isDestination(node) {
            hideUnlessActive(node.range)
        } else if parent == .image, isDestination(node) {
            inline.append(StyleRun(range: node.range, style: .mutedMarker))
        } else {
            inline.append(StyleRun(range: node.range, style: .url))
        }
    }

    func isDestination(_ url: SyntaxNode) -> Bool {
        url.range.lowerBound > 0 && document.units[url.range.lowerBound - 1] == 40
    }

    mutating func visitImage(_ node: SyntaxNode) {
        guard let reference = ImageReference.reference(for: node, in: document) else { return }
        let active = linesActive(node.range)
        if !active { hidden.append(StyleRun(range: node.range, style: .hidden)) }
        placements.append(
            .image(
                reference: reference, lineRange: document.line(containing: node.range.lowerBound),
                sourceVisible: active))
    }
}
