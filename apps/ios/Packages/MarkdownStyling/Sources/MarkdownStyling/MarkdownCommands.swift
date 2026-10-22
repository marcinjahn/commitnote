import EditorText
import Foundation

public struct CommandResult: Sendable, Equatable {
    public var edits: [TextEdit]
    public var selection: TextSelection

    public init(edits: [TextEdit], selection: TextSelection) {
        self.edits = edits
        self.selection = selection
    }
}

public enum MarkdownCommands {
    public static func toggleBold(_ text: String, _ selection: TextSelection) -> CommandResult? {
        toggleMarker(text, selection, marker: "**")
    }

    public static func toggleItalic(_ text: String, _ selection: TextSelection) -> CommandResult? {
        toggleMarker(text, selection, marker: "*")
    }

    public static func toggleStrikethrough(_ text: String, _ selection: TextSelection) -> CommandResult? {
        toggleMarker(text, selection, marker: "~~")
    }

    public static func insertLink(_ text: String, _ selection: TextSelection) -> CommandResult? {
        let context = Context(text, selection)
        let (from, to) = (context.from, context.to)
        if context.overlaps(codeKinds) || context.overlaps(linkKinds) { return nil }
        if from == to {
            return CommandResult(
                edits: [TextEdit(from: from, to: to, insert: "[]()")],
                selection: TextSelection(location: from + 1, length: 0))
        }
        if context.spansLines { return nil }
        let label = escapeLinkLabel(context.slice(from, to))
        return CommandResult(
            edits: [TextEdit(from: from, to: to, insert: "[\(label)]()")],
            selection: TextSelection(location: from + label.utf16.count + 3, length: 0))
    }

    public static func toggleCheckbox(_ text: String, markerRange: Range<Int>) -> CommandResult {
        let units = Array(text.utf16)
        let lower = max(0, min(markerRange.lowerBound, units.count))
        let upper = max(lower, min(markerRange.upperBound, units.count))
        let current = String(decoding: units[lower..<upper], as: UTF16.self)
        let checked = current == "[x]" || current == "[X]"
        return CommandResult(
            edits: [TextEdit(from: lower, to: upper, insert: checked ? "[ ]" : "[x]")],
            selection: TextSelection(location: upper, length: 0))
    }

    public static func toggleTask(_ text: String, _ selection: TextSelection) -> CommandResult? {
        let context = Context(text, selection)
        let document = context.document
        let firstLine = lineIndex(document, context.from)
        let lastLine = lineIndex(document, context.to)
        var edits: [TextEdit] = []
        for index in firstLine...lastLine {
            edits.append(contentsOf: taskEdits(for: index, context: context))
        }
        if edits.isEmpty { return nil }
        let mapped: TextSelection
        if selection.length == 0 {
            mapped = TextSelection(
                location: TextEdits.mapPosition(context.from, through: edits, assoc: .after), length: 0)
        } else {
            mapped = TextEdits.mapSelection(
                TextSelection(location: context.from, length: context.to - context.from), through: edits)
        }
        return CommandResult(edits: edits, selection: mapped)
    }

    public static func pasteLink(_ text: String, _ selection: TextSelection, _ pasted: String) -> CommandResult? {
        let context = Context(text, selection)
        let (from, to) = (context.from, context.to)
        if from == to || context.spansLines { return nil }
        let token = pasted.trimmingCharacters(in: .whitespacesAndNewlines)
        if token.isEmpty || token.unicodeScalars.contains(where: { isWhitespace(Int($0.value)) }) { return nil }
        guard let destination = destination(for: token) else { return nil }
        if context.overlaps(codeKinds) || context.overlaps(linkKinds) { return nil }
        let label = escapeLinkLabel(context.slice(from, to))
        let insert = "[\(label)](\(destination))"
        return CommandResult(
            edits: [TextEdit(from: from, to: to, insert: insert)],
            selection: TextSelection(location: from + insert.utf16.count, length: 0))
    }

    /// The openable destination of the link, autolink or bare URL at `offset`.
    public static func linkURL(in document: MarkdownDocument, at offset: Int) -> URL? {
        for forward in [true, false] {
            let chain = document.nodes.filter { node in
                forward
                    ? node.range.lowerBound <= offset && offset < node.range.upperBound
                    : node.range.lowerBound < offset && offset <= node.range.upperBound
            }
            guard let url = urlNode(in: chain, document: document) else { continue }
            if let openable = openableURL(unwrapDestination(document.slice(url.range).trimmingCharacters(in: .whitespaces)))
            {
                return openable
            }
        }
        return nil
    }

    public static func openableURL(_ raw: String) -> URL? {
        guard let string = openableString(raw) else { return nil }
        return URL(string: string)
    }

    // MARK: Formatting

    private static let codeKinds: Set<SyntaxKind> = [.inlineCode, .fencedCode, .indentedCode]
    private static let linkKinds: Set<SyntaxKind> = [.link, .image, .autolink, .url]

    private struct Context {
        let document: MarkdownDocument
        let units: [UInt16]
        let from: Int
        let to: Int

        init(_ text: String, _ selection: TextSelection) {
            document = MarkdownParser.parse(text)
            units = document.units
            let start = max(0, min(selection.location, units.count))
            let end = max(start, min(selection.location + selection.length, units.count))
            from = start
            to = end
        }

        var spansLines: Bool {
            document.line(containing: from) != document.line(containing: to)
        }

        func slice(_ lower: Int, _ upper: Int) -> String {
            String(decoding: units[lower..<upper], as: UTF16.self)
        }

        func overlaps(_ kinds: Set<SyntaxKind>) -> Bool {
            document.nodes.contains { node in
                guard kinds.contains(node.kind) else { return false }
                return from == to
                    ? node.range.lowerBound < from && node.range.upperBound > from
                    : node.range.lowerBound < to && node.range.upperBound > from
            }
        }
    }

    private static func escapeLinkLabel(_ text: String) -> String {
        var result = ""
        for scalar in text.unicodeScalars {
            if scalar == "[" || scalar == "]" { result.append("\\") }
            result.unicodeScalars.append(scalar)
        }
        return result
    }

    private static func runLength(_ units: [UInt16], _ index: Int, step: Int) -> Int {
        var count = 0
        var position = index
        while position >= 0, position < units.count, units[position] == 42 {
            count += 1
            position += step
        }
        return count
    }

    private static func hasMarker(_ units: [UInt16], _ marker: [UInt16], at index: Int) -> Bool {
        index >= 0 && index + marker.count <= units.count && Array(units[index..<(index + marker.count)]) == marker
    }

    private static func toggleMarker(_ text: String, _ selection: TextSelection, marker: String) -> CommandResult? {
        let context = Context(text, selection)
        let (from, to) = (context.from, context.to)
        let markerUnits = Array(marker.utf16)
        let m = markerUnits.count
        if context.overlaps(codeKinds) { return nil }
        if from == to {
            return CommandResult(
                edits: [TextEdit(from: from, to: to, insert: marker + marker)],
                selection: TextSelection(location: from + m, length: 0))
        }
        if context.spansLines { return nil }

        let selected = Array(context.units[from..<to])
        let isItalic = marker == "*"
        let present =
            isItalic
            ? runLength(selected, 0, step: 1) % 2 == 1 && runLength(selected, selected.count - 1, step: -1) % 2 == 1
            : hasMarker(selected, markerUnits, at: 0) && hasMarker(selected, markerUnits, at: selected.count - m)
        if selected.count > 2 * m && present {
            return CommandResult(
                edits: [
                    TextEdit(from: from, to: from + m, insert: ""),
                    TextEdit(from: to - m, to: to, insert: ""),
                ],
                selection: TextSelection(location: from, length: to - from - 2 * m))
        }

        let line = context.document.line(containing: from)
        let lineUnits = Array(context.units[line.lowerBound..<line.upperBound])
        let lineFrom = from - line.lowerBound
        let lineTo = to - line.lowerBound
        let outside =
            lineFrom >= m && lineTo + m <= lineUnits.count
            && (isItalic
                ? runLength(lineUnits, lineFrom - 1, step: -1) % 2 == 1 && runLength(lineUnits, lineTo, step: 1) % 2 == 1
                : hasMarker(lineUnits, markerUnits, at: lineFrom - m) && hasMarker(lineUnits, markerUnits, at: lineTo))
        if outside {
            return CommandResult(
                edits: [
                    TextEdit(from: from - m, to: from, insert: ""),
                    TextEdit(from: to, to: to + m, insert: ""),
                ],
                selection: TextSelection(location: from - m, length: to - from))
        }
        return CommandResult(
            edits: [
                TextEdit(from: from, to: from, insert: marker),
                TextEdit(from: to, to: to, insert: marker),
            ],
            selection: TextSelection(location: from + m, length: to - from))
    }

    // MARK: Tasks

    private static func lineIndex(_ document: MarkdownDocument, _ offset: Int) -> Int {
        let start = document.line(containing: offset).lowerBound
        return document.lines.lastIndex(where: { $0 <= start }) ?? 0
    }

    private static func taskEdits(for index: Int, context: Context) -> [TextEdit] {
        let document = context.document
        let units = context.units
        let lineStart = document.lines[index]
        let line = document.line(containing: lineStart)
        var marker: SyntaxNode?
        var listMark: SyntaxNode?
        for node in document.nodes where line.contains(node.range.lowerBound) || node.range.lowerBound == line.upperBound {
            if case .taskMarker = node.kind {
                marker = node
            } else if node.kind == .listMark {
                listMark = node
            }
        }

        if let marker, case .taskMarker(let checked) = marker.kind {
            let at = marker.range.lowerBound + 1
            return [TextEdit(from: at, to: at + 1, insert: checked ? " " : "x")]
        }
        if let listMark {
            let end = listMark.range.upperBound
            if end < units.count && units[end] == 32 {
                return [TextEdit(from: end + 1, to: end + 1, insert: "[ ] ")]
            }
            return [TextEdit(from: end, to: end, insert: " [ ] ")]
        }

        var indent = 0
        while line.lowerBound + indent < line.upperBound, isWhitespace(Int(units[line.lowerBound + indent])) {
            indent += 1
        }
        let length = line.count
        if length > 0 && indent == length { return [] }
        let position = line.lowerBound + indent
        let top = topLevelNode(containing: position, in: document)
        if length == 0 {
            return top == nil ? [TextEdit(from: position, to: position, insert: "- [ ] ")] : []
        }
        return top?.kind == .paragraph ? [TextEdit(from: position, to: position, insert: "- [ ] ")] : []
    }

    private static func topLevelNode(containing position: Int, in document: MarkdownDocument) -> SyntaxNode? {
        var end = -1
        for node in document.nodes where node.range.lowerBound >= end {
            end = node.range.upperBound
            if node.range.lowerBound <= position && position < node.range.upperBound { return node }
        }
        return nil
    }

    // MARK: URLs

    private static func openableString(_ raw: String) -> String? {
        let url: String
        if hasPrefixIgnoringCase(raw, "www.") {
            url = "https://" + raw
        } else if isEmail(raw) {
            url = "mailto:" + raw
        } else {
            url = raw
        }
        guard let scheme = scheme(of: url), ["http", "https", "mailto"].contains(scheme), URL(string: url) != nil
        else { return nil }
        return url
    }

    private static func scheme(of url: String) -> String? {
        var result = ""
        for (index, scalar) in url.unicodeScalars.enumerated() {
            if scalar == ":" { return index > 0 ? result.lowercased() : nil }
            let isLetter = scalar.isASCII && scalar.properties.isAlphabetic
            let isDigit = scalar.value >= 48 && scalar.value <= 57
            let isMark = scalar == "+" || scalar == "-" || scalar == "."
            if index == 0 ? !isLetter : !(isLetter || isDigit || isMark) { return nil }
            result.unicodeScalars.append(scalar)
        }
        return nil
    }

    private static func hasPrefixIgnoringCase(_ string: String, _ prefix: String) -> Bool {
        string.lowercased().hasPrefix(prefix)
    }

    private static func isEmail(_ string: String) -> Bool {
        let units = Array(string.utf16).map(Int.init)
        guard let at = units.firstIndex(of: 64) else { return false }
        let local = units[..<at]
        let domain = units[(at + 1)...]
        if local.isEmpty || !local.allSatisfy({ isWordChar($0) || $0 == 46 || $0 == 43 || $0 == 45 }) { return false }
        let labels = domain.split(separator: 46, omittingEmptySubsequences: false)
        if labels.count < 2 { return false }
        return labels.allSatisfy { !$0.isEmpty && $0.allSatisfy { isWordChar($0) || $0 == 45 } }
    }

    private static func destination(for token: String) -> String? {
        guard let openable = openableString(token) else { return nil }
        var destination = token
        if hasPrefixIgnoringCase(token, "www.") {
            destination = "https://" + token
        } else if hasPrefixIgnoringCase(openable, "mailto:") && !hasPrefixIgnoringCase(token, "mailto:") {
            destination = "mailto:" + token
        }
        if destination.contains("<") || destination.contains(">") { return nil }
        return destination.contains("(") || destination.contains(")") ? "<\(destination)>" : destination
    }

    private static func unwrapDestination(_ raw: String) -> String {
        raw.count >= 2 && raw.hasPrefix("<") && raw.hasSuffix(">") ? String(raw.dropFirst().dropLast()) : raw
    }

    private static func urlNode(in chain: [SyntaxNode], document: MarkdownDocument) -> SyntaxNode? {
        let ordered = Array(chain.reversed())
        for (index, node) in ordered.enumerated() {
            switch node.kind {
            case .link:
                return destination(of: node, document: document)
            case .autolink:
                return document.nodes.first { $0.kind == .url && node.range.contains($0.range.lowerBound) }
            case .url:
                let parent = index + 1 < ordered.count ? ordered[index + 1] : nil
                if parent?.kind == .link { return node }
                if parent?.kind == .linkLabel { continue }
                return node
            default:
                continue
            }
        }
        return nil
    }

    private static func destination(of link: SyntaxNode, document: MarkdownDocument) -> SyntaxNode? {
        let units = document.units
        return document.nodes.first { node in
            node.kind == .url && link.range.contains(node.range.lowerBound)
                && node.range.lowerBound > 0 && units[node.range.lowerBound - 1] == 40
                && !document.nodes.contains { $0.kind == .linkLabel && $0.range.contains(node.range.lowerBound) && link.range.contains($0.range.lowerBound) }
        }
    }
}
