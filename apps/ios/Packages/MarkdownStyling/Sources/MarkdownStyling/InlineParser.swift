private enum DelimiterType: Equatable {
    case emphasisUnderscore
    case emphasisAsterisk
    case strikethrough
    case linkStart
    case imageStart

    var isEmphasis: Bool { self == .emphasisUnderscore || self == .emphasisAsterisk }
    var resolves: Bool { self != .linkStart && self != .imageStart }
}

private let openSide = 1
private let closeSide = 2

private struct Delimiter {
    var type: DelimiterType
    var from: Int
    var to: Int
    var side: Int
}

private enum Part {
    case node(Node)
    case delimiter(Delimiter)
}

enum ScanResult {
    case found(Node)
    case incomplete
    case failed
}

private let escapable = Set("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~".utf16.map { Int($0) })

/// A port of lezer-markdown's inline parser; `offset` is the document position of `text`.
func parseInline(_ text: [UInt16], offset: Int) -> [Node] {
    let cx = InlineContext(text, offset: offset)
    var pos = offset
    outer: while pos < cx.end {
        let next = cx.char(pos)
        for parser in 0..<14 {
            let result = cx.run(parser, next, pos)
            if result >= 0 {
                pos = result
                continue outer
            }
        }
        pos += 1
    }
    return cx.resolveMarkers(0)
}

private final class InlineContext {
    let text: [UInt16]
    let offset: Int
    let end: Int
    var parts: [Part?] = []

    init(_ text: [UInt16], offset: Int) {
        self.text = text
        self.offset = offset
        end = offset + text.count
    }

    @inline(__always)
    func char(_ pos: Int) -> Int {
        pos >= end || pos < offset ? -1 : Int(text[pos - offset])
    }

    func append(_ node: Node) -> Int {
        parts.append(.node(node))
        return node.to
    }

    func append(_ delimiter: Delimiter) -> Int {
        parts.append(.delimiter(delimiter))
        return delimiter.to
    }

    func skipSpace(_ from: Int) -> Int {
        MarkdownStyling.skipSpace(text, from - offset) + offset
    }

    var hasOpenLink: Bool {
        parts.contains {
            if case .delimiter(let delimiter)? = $0 {
                return delimiter.type == .linkStart || delimiter.type == .imageStart
            }
            return false
        }
    }

    func run(_ parser: Int, _ next: Int, _ pos: Int) -> Int {
        switch parser {
        case 0: escape(next, pos)
        case 1: entity(next, pos)
        case 2: inlineCode(next, pos)
        case 3: htmlTag(next, pos)
        case 4: emphasis(next, pos)
        case 5: strikethrough(next, pos)
        case 6: hardBreak(next, pos)
        case 7: next == Ch.openBracket ? append(Delimiter(type: .linkStart, from: pos, to: pos + 1, side: openSide)) : -1
        case 8:
            next == Ch.bang && char(pos + 1) == Ch.openBracket
                ? append(Delimiter(type: .imageStart, from: pos, to: pos + 2, side: openSide)) : -1
        case 9: autolink(pos)
        case 10: subOrSuperscript(next, pos, marker: Ch.tilde, node: .subscriptText, mark: .subscriptMark)
        case 11: subOrSuperscript(next, pos, marker: Ch.caret, node: .superscript, mark: .superscriptMark)
        case 12: emoji(next, pos)
        default: linkEnd(next, pos)
        }
    }

    private func escape(_ next: Int, _ start: Int) -> Int {
        if next != Ch.backslash || start == end - 1 { return -1 }
        return escapable.contains(char(start + 1)) ? append(Node(.escape, start, start + 2)) : -1
    }

    private func entity(_ next: Int, _ start: Int) -> Int {
        if next != Ch.ampersand { return -1 }
        let windowEnd = min(text.count, start - offset + 31)
        let window = text.slice(start - offset + 1, windowEnd)
        guard let length = entityLength(window, 0, hexCaseInsensitive: true) else { return -1 }
        return append(Node(.entity, start, start + 1 + length))
    }

    private func inlineCode(_ next: Int, _ start: Int) -> Int {
        if next != Ch.backtick || char(start - 1) == Ch.backtick { return -1 }
        var pos = start + 1
        while pos < end, char(pos) == Ch.backtick { pos += 1 }
        let size = pos - start
        var current = 0
        while pos < end {
            if char(pos) == Ch.backtick {
                current += 1
                if current == size, char(pos + 1) != Ch.backtick {
                    return append(
                        Node(
                            .inlineCode, start, pos + 1,
                            [Node(.codeMark, start, start + size), Node(.codeMark, pos + 1 - size, pos + 1)]))
                }
            } else {
                current = 0
            }
            pos += 1
        }
        return -1
    }

    private func htmlTag(_ next: Int, _ start: Int) -> Int {
        if next != Ch.lessThan || start == end - 1 { return -1 }
        let after = start - offset + 1
        if let length = autolinkLength(text, after) {
            return append(
                Node(
                    .autolink, start, start + 1 + length,
                    [
                        Node(.linkMark, start, start + 1),
                        Node(.url, start + 1, start + length),
                        Node(.linkMark, start + length, start + 1 + length),
                    ]))
        }
        if let length = htmlCommentLength(text, after) {
            return append(Node(.comment, start, start + 1 + length))
        }
        if let length = processingInstructionLength(text, after) {
            return append(Node(.processingInstruction, start, start + 1 + length))
        }
        guard let length = inlineHTMLTagLength(text, after) else { return -1 }
        return append(Node(.htmlTag, start, start + 1 + length))
    }

    private func flanking(before: Int, after: Int) -> (left: Bool, right: Bool, pBefore: Bool, pAfter: Bool) {
        let pBefore = isPunctuation(before)
        let pAfter = isPunctuation(after)
        let sBefore = before < 0 || isWhitespace(before)
        let sAfter = after < 0 || isWhitespace(after)
        let left = !sAfter && (!pAfter || sBefore || pBefore)
        let right = !sBefore && (!pBefore || sAfter || pAfter)
        return (left, right, pBefore, pAfter)
    }

    private func emphasis(_ next: Int, _ start: Int) -> Int {
        if next != Ch.underscore && next != Ch.asterisk { return -1 }
        var pos = start + 1
        while char(pos) == next { pos += 1 }
        let f = flanking(before: char(start - 1), after: char(pos))
        let canOpen = f.left && (next == Ch.asterisk || !f.right || f.pBefore)
        let canClose = f.right && (next == Ch.asterisk || !f.left || f.pAfter)
        return append(
            Delimiter(
                type: next == Ch.underscore ? .emphasisUnderscore : .emphasisAsterisk, from: start, to: pos,
                side: (canOpen ? openSide : 0) | (canClose ? closeSide : 0)))
    }

    private func strikethrough(_ next: Int, _ pos: Int) -> Int {
        if next != Ch.tilde || char(pos + 1) != Ch.tilde || char(pos + 2) == Ch.tilde { return -1 }
        let f = flanking(before: char(pos - 1), after: char(pos + 2))
        return append(
            Delimiter(
                type: .strikethrough, from: pos, to: pos + 2,
                side: (f.left ? openSide : 0) | (f.right ? closeSide : 0)))
    }

    private func hardBreak(_ next: Int, _ start: Int) -> Int {
        if next == Ch.backslash, char(start + 1) == Ch.newline {
            return append(Node(.hardBreak, start, start + 2))
        }
        if next == Ch.space {
            var pos = start + 1
            while char(pos) == Ch.space { pos += 1 }
            if char(pos) == Ch.newline, pos >= start + 2 {
                return append(Node(.hardBreak, start, pos + 1))
            }
        }
        return -1
    }

    private func autolink(_ absolute: Int) -> Int {
        let pos = absolute - offset
        if pos > 0, isWordChar(text.code(pos - 1)) { return -1 }
        var end = -1
        if text.hasPrefix("www.", at: pos) || text.hasPrefix("http://", at: pos) || text.hasPrefix("https://", at: pos) {
            let prefix = text.hasPrefix("www.", at: pos) ? 4 : text.hasPrefix("http://", at: pos) ? 7 : 8
            end = autolinkURLEnd(text, pos + prefix)
            if end > -1, hasOpenLink {
                end = pos + bracketBalancedLength(text, pos, end)
            }
        } else if isEmailPrefix(text, pos) {
            end = autolinkEmailEnd(text, pos)
        } else if text.hasPrefix("mailto:", at: pos) || text.hasPrefix("xmpp:", at: pos) {
            let xmpp = text.hasPrefix("xmpp:", at: pos)
            end = autolinkEmailEnd(text, pos + (xmpp ? 5 : 7))
            if end > -1, xmpp, text.code(end) == Ch.slash {
                var i = end + 1
                while isAlphanumeric(text.code(i)) || text.code(i) == Ch.at || text.code(i) == Ch.dot { i += 1 }
                if i > end + 1 { end = i }
            }
        } else {
            return -1
        }
        if end < 0 { return -1 }
        _ = append(Node(.url, absolute, end + offset))
        return end + offset
    }

    private func subOrSuperscript(_ next: Int, _ pos: Int, marker: Int, node: NodeType, mark: NodeType) -> Int {
        if next != marker || char(pos + 1) == marker { return -1 }
        var children = [Node(mark, pos, pos + 1)]
        var i = pos + 1
        while i < end {
            let c = char(i)
            if c == marker {
                children.append(Node(mark, i, i + 1))
                return append(Node(node, pos, i + 1, children))
            }
            if c == Ch.backslash {
                children.append(Node(.escape, i, i + 2))
                i += 1
            }
            if isSpace(c) { break }
            i += 1
        }
        return -1
    }

    private func emoji(_ next: Int, _ pos: Int) -> Int {
        if next != Ch.colon { return -1 }
        var i = pos + 1
        while isWordChar(char(i)) { i += 1 }
        if i == pos + 1 || char(i) != Ch.colon { return -1 }
        return append(Node(.emoji, pos, i + 1))
    }

    private func linkEnd(_ next: Int, _ start: Int) -> Int {
        if next != Ch.closeBracket { return -1 }
        var i = parts.count - 1
        while i >= 0 {
            if case .delimiter(let part)? = parts[i], part.type == .linkStart || part.type == .imageStart {
                let following = char(start + 1)
                if part.side == 0
                    || skipSpace(part.to) == start && following != Ch.openParen && following != Ch.openBracket
                {
                    parts[i] = nil
                    return -1
                }
                let content = takeContent(i)
                let link = finishLink(content, image: part.type == .imageStart, start: part.from, startPos: start + 1)
                parts.append(.node(link))
                if part.type == .linkStart {
                    for j in 0..<i {
                        if case .delimiter(var other)? = parts[j], other.type == .linkStart {
                            other.side = 0
                            parts[j] = .delimiter(other)
                        }
                    }
                }
                return link.to
            }
            i -= 1
        }
        return -1
    }

    private func finishLink(_ content: [Node], image: Bool, start: Int, startPos: Int) -> Node {
        let next = char(startPos)
        let open = Node(.linkMark, start, start + (image ? 2 : 1))
        let close = Node(.linkMark, startPos - 1, startPos)
        if next == Ch.openParen {
            var pos = skipSpace(startPos + 1)
            var destination: Node?
            var title: Node?
            if case .found(let found) = parseURL(text, pos - offset, offset: offset) {
                destination = found
                pos = skipSpace(found.to)
                if pos != found.to, case .found(let foundTitle) = parseLinkTitle(text, pos - offset, offset: offset) {
                    title = foundTitle
                    pos = skipSpace(foundTitle.to)
                }
            }
            if char(pos) == Ch.closeParen {
                let labelFrom = open.to
                let labelTo = close.from
                var children = [open]
                if labelFrom < labelTo {
                    children.append(Node(.linkText, labelFrom, labelTo, content))
                } else {
                    children.append(contentsOf: content)
                }
                children.append(close)
                children.append(Node(.linkMark, startPos, startPos + 1))
                if let destination { children.append(destination) }
                if let title { children.append(title) }
                children.append(Node(.linkMark, pos, pos + 1))
                return Node(image ? .image : .link, start, pos + 1, children)
            }
        } else if next == Ch.openBracket,
            case .found(let label) = parseLinkLabel(text, startPos - offset, offset: offset, requireNonWhitespace: false)
        {
            return Node(.plainLink, start, label.to, content)
        }
        return Node(.plainLink, start, startPos, content)
    }

    func takeContent(_ startIndex: Int) -> [Node] {
        let content = resolveMarkers(startIndex)
        parts.removeSubrange(startIndex...)
        return content
    }

    func resolveMarkers(_ from: Int) -> [Node] {
        var i = from
        while i < parts.count {
            defer { i += 1 }
            guard case .delimiter(let close)? = parts[i], close.type.resolves, close.side & closeSide != 0 else {
                continue
            }
            let isEmphasis = close.type.isEmphasis
            let closeSize = close.to - close.from
            var open: Delimiter?
            var j = i - 1
            while j >= from {
                if case .delimiter(let part)? = parts[j], part.side & openSide != 0, part.type == close.type {
                    let openSize = part.to - part.from
                    let ruleOfThree =
                        isEmphasis && (close.side & openSide != 0 || part.side & closeSide != 0)
                        && (openSize + closeSize) % 3 == 0 && (openSize % 3 != 0 || closeSize % 3 != 0)
                    if !ruleOfThree {
                        open = part
                        break
                    }
                }
                j -= 1
            }
            guard let open else { continue }

            var type: NodeType = .strikethrough
            let markType: NodeType = isEmphasis ? .emphasisMark : .strikethroughMark
            var start = open.from
            var end = close.to
            if isEmphasis {
                let size = min(2, open.to - open.from, closeSize)
                start = open.to - size
                end = close.from + size
                type = size == 1 ? .emphasis : .strongEmphasis
            }
            var content = [Node(markType, start, open.to)]
            for k in (j + 1)..<i {
                if case .node(let node)? = parts[k] { content.append(node) }
                parts[k] = nil
            }
            content.append(Node(markType, close.from, end))
            let element = Node(type, start, end, content)
            parts[j] =
                isEmphasis && open.from != start
                ? .delimiter(Delimiter(type: open.type, from: open.from, to: start, side: open.side)) : nil
            if isEmphasis, close.to != end {
                parts[i] = .delimiter(Delimiter(type: close.type, from: end, to: close.to, side: close.side))
                parts.insert(.node(element), at: i)
            } else {
                parts[i] = .node(element)
            }
        }
        var result: [Node] = []
        for index in from..<max(from, parts.count) {
            if case .node(let node)? = parts[index] { result.append(node) }
        }
        return result
    }
}

// MARK: Link pieces

func parseURL(_ text: [UInt16], _ start: Int, offset: Int) -> ScanResult {
    if text.code(start) == Ch.lessThan {
        var pos = start + 1
        while pos < text.count {
            let ch = Int(text[pos])
            if ch == Ch.greaterThan { return .found(Node(.url, start + offset, pos + 1 + offset)) }
            if ch == Ch.lessThan || ch == Ch.newline { return .failed }
            pos += 1
        }
        return .incomplete
    }
    var depth = 0
    var pos = start
    var escaped = false
    while pos < text.count {
        let ch = Int(text[pos])
        if isSpace(ch) {
            break
        } else if escaped {
            escaped = false
        } else if ch == Ch.openParen {
            depth += 1
        } else if ch == Ch.closeParen {
            if depth == 0 { break }
            depth -= 1
        } else if ch == Ch.backslash {
            escaped = true
        }
        pos += 1
    }
    if pos > start { return .found(Node(.url, start + offset, pos + offset)) }
    return pos == text.count ? .incomplete : .failed
}

func parseLinkTitle(_ text: [UInt16], _ start: Int, offset: Int) -> ScanResult {
    let next = text.code(start)
    if next != Ch.singleQuote && next != Ch.doubleQuote && next != Ch.openParen { return .failed }
    let end = next == Ch.openParen ? Ch.closeParen : next
    var pos = start + 1
    var escaped = false
    while pos < text.count {
        let ch = Int(text[pos])
        if escaped {
            escaped = false
        } else if ch == end {
            return .found(Node(.linkTitle, start + offset, pos + 1 + offset))
        } else if ch == Ch.backslash {
            escaped = true
        }
        pos += 1
    }
    return .incomplete
}

func parseLinkLabel(_ text: [UInt16], _ start: Int, offset: Int, requireNonWhitespace: Bool) -> ScanResult {
    var requireNonWhitespace = requireNonWhitespace
    var escaped = false
    var pos = start + 1
    let end = min(text.count, pos + 999)
    while pos < end {
        let ch = Int(text[pos])
        if escaped {
            escaped = false
        } else if ch == Ch.closeBracket {
            return requireNonWhitespace ? .failed : .found(Node(.linkLabel, start + offset, pos + 1 + offset))
        } else {
            if requireNonWhitespace, !isSpace(ch) { requireNonWhitespace = false }
            if ch == Ch.openBracket {
                return .failed
            } else if ch == Ch.backslash {
                escaped = true
            }
        }
        pos += 1
    }
    return .incomplete
}
