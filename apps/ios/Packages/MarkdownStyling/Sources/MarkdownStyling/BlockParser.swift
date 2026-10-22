final class Line {
    private let doc: [UInt16]
    private(set) var start = 0
    private(set) var length = 0
    var baseIndent = 0
    var basePos = 0
    var depth = 0
    var markers: [Node] = []
    var pos = 0
    var indent = 0
    var next = -1

    init(_ doc: [UInt16]) {
        self.doc = doc
    }

    @inline(__always)
    func code(_ index: Int) -> Int {
        index >= 0 && index < length ? Int(doc[start + index]) : -1
    }

    var text: [UInt16] { Array(doc[start..<start + length]) }

    func slice(_ from: Int, _ to: Int? = nil) -> [UInt16] {
        let upper = min(to ?? length, length)
        return from < upper ? Array(doc[start + from..<start + upper]) : []
    }

    func forward() {
        if basePos > pos { forwardInner() }
    }

    private func forwardInner() {
        let newPos = skipSpace(basePos)
        indent = countIndent(newPos, from: pos, indent: indent)
        pos = newPos
        next = newPos == length ? -1 : code(newPos)
    }

    func skipSpace(_ from: Int) -> Int {
        var i = from
        while i < length, isSpace(code(i)) { i += 1 }
        return i
    }

    func skipSpaceBack(_ from: Int, to: Int) -> Int {
        var i = from
        while i > to, isSpace(code(i - 1)) { i -= 1 }
        return i
    }

    func reset(start: Int, length: Int) {
        self.start = start
        self.length = length
        baseIndent = 0
        basePos = 0
        pos = 0
        indent = 0
        forwardInner()
        depth = 1
        markers.removeAll(keepingCapacity: true)
    }

    func moveBase(_ to: Int) {
        basePos = to
        baseIndent = countIndent(to, from: pos, indent: indent)
    }

    func moveBaseColumn(_ column: Int) {
        baseIndent = column
        basePos = findColumn(column)
    }

    func countIndent(_ to: Int, from: Int = 0, indent: Int = 0) -> Int {
        var result = indent
        var i = from
        while i < to {
            result += code(i) == Ch.tab ? 4 - result % 4 : 1
            i += 1
        }
        return result
    }

    func findColumn(_ goal: Int) -> Int {
        var i = 0
        var column = 0
        while i < length, column < goal {
            column += code(i) == Ch.tab ? 4 - column % 4 : 1
            i += 1
        }
        return i
    }

    func scrub() -> [UInt16] {
        if baseIndent == 0 { return text }
        var result = [UInt16](repeating: UInt16(Ch.space), count: basePos)
        result.append(contentsOf: slice(basePos))
        return result
    }
}

final class CompositeBlock {
    let type: NodeType
    let value: Int
    let from: Int
    var end: Int
    var children: [Node] = []

    init(_ type: NodeType, value: Int, from: Int, end: Int) {
        self.type = type
        self.value = value
        self.from = from
        self.end = end
    }

    func toNode(end explicitEnd: Int? = nil) -> Node {
        var end = explicitEnd ?? self.end
        if let last = children.last { end = max(end, last.to) }
        return Node(type, from, end, children)
    }
}

final class LeafBlock {
    let start: Int
    var content: [UInt16]
    var marks: [Node] = []
    var parsers: [LeafParser] = []

    init(start: Int, content: [UInt16]) {
        self.start = start
        self.content = content
    }
}

protocol LeafParser: AnyObject {
    func nextLine(_ cx: BlockParser, _ leaf: LeafBlock) -> Bool
    func finish(_ cx: BlockParser, _ leaf: LeafBlock) -> Bool
}

private enum BlockResult {
    case no
    case leaf
    case composite
}

/// A port of lezer-markdown's block-level parser.
final class BlockParser {
    let doc: [UInt16]
    let line: Line
    private(set) var lineStart = 0
    private var lineEnd = 0
    private var atEnd = false
    private(set) var block: CompositeBlock
    private(set) var stack: [CompositeBlock]

    init(_ doc: [UInt16]) {
        self.doc = doc
        line = Line(doc)
        block = CompositeBlock(.document, value: 0, from: 0, end: 0)
        stack = [block]
        readLine()
    }

    func parse() -> Node {
        while true {
            if let result = advance() { return result }
        }
    }

    private func advance() -> Node? {
        while true {
            var markI = 0
            while true {
                let next: CompositeBlock? = line.depth < stack.count ? stack[stack.count - 1] : nil
                while markI < line.markers.count, next == nil || line.markers[markI].from < next!.end {
                    addNode(line.markers[markI])
                    markI += 1
                }
                if next == nil { break }
                finishContext()
            }
            if line.pos < line.length { break }
            if !nextLine() { return finish() }
        }

        start: while true {
            for parser in 0..<8 {
                switch runBlockParser(parser) {
                case .no: continue
                case .leaf: return nil
                case .composite:
                    line.forward()
                    continue start
                }
            }
            break
        }

        if line.pos == line.length {
            return nextLine() ? nil : finish()
        }

        let leaf = LeafBlock(start: lineStart + line.pos, content: line.slice(line.pos))
        if leaf.content.code(0) == Ch.openBracket {
            leaf.parsers.append(LinkReferenceParser(leaf))
        }
        if hasPipe(leaf.content, 0) {
            leaf.parsers.append(TableParser())
        }
        leaf.parsers.append(SetextHeadingParser())
        if isTaskStart(leaf.content), block.type == .listItem {
            leaf.parsers.append(TaskParser())
        }

        lines: while nextLine() {
            if line.pos == line.length { break }
            if line.indent < line.baseIndent + 4, endsLeaf(leaf) { break lines }
            for parser in leaf.parsers where parser.nextLine(self, leaf) {
                return nil
            }
            leaf.content.append(UInt16(Ch.newline))
            leaf.content.append(contentsOf: line.scrub())
            leaf.marks.append(contentsOf: line.markers)
        }
        finishLeaf(leaf)
        return nil
    }

    @discardableResult
    func nextLine() -> Bool {
        lineStart += line.length
        if lineEnd >= doc.count {
            atEnd = true
            readLine()
            return false
        }
        lineStart += 1
        readLine()
        return true
    }

    func peekLine() -> [UInt16] {
        let start = lineEnd + 1
        if start >= doc.count { return [] }
        return Array(doc[start..<lineBreak(from: start)])
    }

    private func lineBreak(from start: Int) -> Int {
        var end = start
        while end < doc.count, doc[end] != UInt16(Ch.newline) { end += 1 }
        return end
    }

    private func readLine() {
        let start = min(lineStart, doc.count)
        let end = start >= doc.count ? start : lineBreak(from: start)
        lineEnd = end
        line.reset(start: start, length: end - start)
        while line.depth < stack.count {
            let context = stack[line.depth]
            let marks = line.markers.count
            if !skipMarkup(context) {
                if line.markers.count > marks, let last = line.markers.last {
                    context.end = last.to
                }
                line.forward()
                break
            }
            line.forward()
            line.depth += 1
        }
    }

    func prevLineEnd() -> Int {
        atEnd ? lineStart : lineStart - 1
    }

    private func startContext(_ type: NodeType, _ start: Int, _ value: Int = 0) {
        block = CompositeBlock(type, value: value, from: lineStart + start, end: lineStart + line.length)
        stack.append(block)
    }

    func addNode(_ node: Node) {
        block.children.append(node)
    }

    private func addNode(_ type: NodeType, _ from: Int, _ to: Int? = nil) {
        block.children.append(Node(type, from, to ?? prevLineEnd()))
    }

    func addLeafElement(_ leaf: LeafBlock, _ element: Node) {
        addNode(Node(element.type, element.from, element.to, injectMarks(element.children, leaf.marks)))
    }

    private func finishContext() {
        let context = stack.removeLast()
        block = stack[stack.count - 1]
        block.children.append(context.toNode())
    }

    private func finish() -> Node {
        while stack.count > 1 { finishContext() }
        return block.toNode(end: lineStart)
    }

    private func finishLeaf(_ leaf: LeafBlock) {
        for parser in leaf.parsers where parser.finish(self, leaf) {
            return
        }
        let inline = injectMarks(parseInline(leaf.content, offset: leaf.start), leaf.marks)
        addNode(Node(.paragraph, leaf.start, leaf.start + leaf.content.count, inline))
    }

    // MARK: Composite markup

    private func skipMarkup(_ context: CompositeBlock) -> Bool {
        switch context.type {
        case .blockquote:
            if line.next != Ch.greaterThan { return false }
            line.markers.append(Node(.quoteMark, lineStart + line.pos, lineStart + line.pos + 1))
            line.moveBase(line.pos + (isSpace(line.code(line.pos + 1)) ? 2 : 1))
            context.end = lineStart + line.length
            return true
        case .listItem:
            if line.indent < line.baseIndent + context.value, line.next > -1 { return false }
            line.moveBaseColumn(line.baseIndent + context.value)
            return true
        case .bulletList, .orderedList:
            return skipForList(context)
        default:
            return true
        }
    }

    private func skipForList(_ list: CompositeBlock) -> Bool {
        if line.pos == line.length
            || (list !== block && line.indent >= stack[line.depth + 1].value + line.baseIndent)
        {
            return true
        }
        if line.indent >= line.baseIndent + 4 { return false }
        let size = list.type == .orderedList ? isOrderedList(breaking: false) : isBulletList(breaking: false)
        return size > 0
            && (list.type != .bulletList || isHorizontalRule(breaking: false) < 0)
            && line.code(line.pos + size - 1) == list.value
    }

    // MARK: Line classification

    private func isFencedCode() -> Int {
        if line.next != Ch.backtick && line.next != Ch.tilde { return -1 }
        var pos = line.pos + 1
        while pos < line.length, line.code(pos) == line.next { pos += 1 }
        if pos < line.pos + 3 { return -1 }
        if line.next == Ch.backtick {
            for i in pos..<line.length where line.code(i) == Ch.backtick {
                return -1
            }
        }
        return pos
    }

    private func isBlockquote() -> Int {
        line.next != Ch.greaterThan ? -1 : line.code(line.pos + 1) == Ch.space ? 2 : 1
    }

    private func isHorizontalRule(breaking: Bool) -> Int {
        if line.next != Ch.asterisk && line.next != Ch.dash && line.next != Ch.underscore { return -1 }
        var count = 1
        for pos in (line.pos + 1)..<max(line.pos + 1, line.length) {
            let ch = line.code(pos)
            if ch == line.next {
                count += 1
            } else if !isSpace(ch) {
                return -1
            }
        }
        if breaking, line.next == Ch.dash, isSetextUnderline() > -1, line.depth == stack.count {
            return -1
        }
        return count < 3 ? -1 : 1
    }

    private func inList(_ type: NodeType) -> Bool {
        stack.contains { $0.type == type }
    }

    private func isBulletList(breaking: Bool) -> Int {
        let next = line.next
        return (next == Ch.dash || next == Ch.plus || next == Ch.asterisk)
            && (line.pos == line.length - 1 || isSpace(line.code(line.pos + 1)))
            && (!breaking || inList(.bulletList) || line.skipSpace(line.pos + 2) < line.length) ? 1 : -1
    }

    private func isOrderedList(breaking: Bool) -> Int {
        var pos = line.pos
        var next = line.next
        while true {
            if isDigit(next) { pos += 1 } else { break }
            if pos == line.length { return -1 }
            next = line.code(pos)
        }
        if pos == line.pos || pos > line.pos + 9
            || (next != Ch.dot && next != Ch.closeParen)
            || (pos < line.length - 1 && !isSpace(line.code(pos + 1)))
            || breaking && !inList(.orderedList)
            && (line.skipSpace(pos + 1) == line.length || pos > line.pos + 1 || line.next != 49)
        {
            return -1
        }
        return pos + 1 - line.pos
    }

    private func isAtxHeading() -> Int {
        if line.next != Ch.hash { return -1 }
        var pos = line.pos + 1
        while pos < line.length, line.code(pos) == Ch.hash { pos += 1 }
        if pos < line.length, line.code(pos) != Ch.space { return -1 }
        let size = pos - line.pos
        return size > 6 ? -1 : size
    }

    fileprivate func isSetextUnderline() -> Int {
        if line.next != Ch.dash && line.next != Ch.equals || line.indent >= line.baseIndent + 4 { return -1 }
        var pos = line.pos + 1
        while pos < line.length, line.code(pos) == line.next { pos += 1 }
        let end = pos
        while pos < line.length, isSpace(line.code(pos)) { pos += 1 }
        return pos == line.length ? end : -1
    }

    private func isHTMLBlock(breaking: Bool) -> Int {
        if line.next != Ch.lessThan { return -1 }
        return htmlBlockStart(line.slice(line.pos), breaking: breaking)
    }

    private func getListIndent(_ pos: Int) -> Int {
        let indentAfter = line.countIndent(pos, from: line.pos, indent: line.indent)
        let skipped = line.skipSpace(pos)
        let indented = line.countIndent(skipped, from: pos, indent: indentAfter)
        return indented >= indentAfter + 5 || skipped == line.length ? indentAfter + 1 : indented
    }

    private func endsLeaf(_ leaf: LeafBlock) -> Bool {
        if isAtxHeading() >= 0 || isFencedCode() >= 0 || isBlockquote() >= 0
            || isBulletList(breaking: true) >= 0 || isOrderedList(breaking: true) >= 0
            || isHorizontalRule(breaking: true) >= 0 || isHTMLBlock(breaking: true) >= 0
        {
            return true
        }
        if leaf.parsers.contains(where: { $0 is TableParser }) { return false }
        let text = line.text
        if !hasPipe(text, line.basePos) { return false }
        let next = peekLine()
        return isTableDelimiterLine(next)
            && parseRow(text, line.basePos, offset: 0, collect: false).count
                == parseRow(next, line.basePos, offset: 0, collect: false).count
    }

    // MARK: Block parsers

    private func runBlockParser(_ index: Int) -> BlockResult {
        switch index {
        case 0: indentedCode()
        case 1: fencedCode()
        case 2: blockquote()
        case 3: horizontalRule()
        case 4: bulletList()
        case 5: orderedList()
        case 6: atxHeading()
        default: htmlBlock()
        }
    }

    private func indentedCode() -> BlockResult {
        let base = line.baseIndent + 4
        if line.indent < base { return .no }
        let start = line.findColumn(base)
        let from = lineStart + start
        var to = lineStart + line.length
        var marks: [Node] = []
        var pending: [Node] = []
        addCodeText(&marks, from, to)
        while nextLine(), line.depth >= stack.count {
            if line.pos == line.length {
                addCodeText(&pending, lineStart - 1, lineStart)
                pending.append(contentsOf: line.markers)
            } else if line.indent < base {
                break
            } else {
                for mark in pending {
                    if mark.type == .codeText {
                        addCodeText(&marks, mark.from, mark.to)
                    } else {
                        marks.append(mark)
                    }
                }
                pending = []
                addCodeText(&marks, lineStart - 1, lineStart)
                marks.append(contentsOf: line.markers)
                to = lineStart + line.length
                let codeStart = lineStart + line.findColumn(line.baseIndent + 4)
                if codeStart < to { addCodeText(&marks, codeStart, to) }
            }
        }
        let leftover = pending.filter { $0.type != .codeText }
        if !leftover.isEmpty { line.markers = leftover + line.markers }
        addNode(Node(.codeBlock, from, to, marks))
        return .leaf
    }

    private func fencedCode() -> BlockResult {
        let fenceEnd = isFencedCode()
        if fenceEnd < 0 { return .no }
        let from = lineStart + line.pos
        let ch = line.next
        let length = fenceEnd - line.pos
        let infoFrom = line.skipSpace(fenceEnd)
        let infoTo = line.skipSpaceBack(line.length, to: infoFrom)
        var marks = [Node(.codeMark, from, from + length)]
        if infoFrom < infoTo {
            marks.append(Node(.codeInfo, lineStart + infoFrom, lineStart + infoTo))
        }
        var first = true
        var empty = true
        var hasLine = false
        while nextLine(), line.depth >= stack.count {
            var i = line.pos
            if line.indent - line.baseIndent < 4 {
                while i < line.length, line.code(i) == ch { i += 1 }
            }
            if i - line.pos >= length, line.skipSpace(i) == line.length {
                marks.append(contentsOf: line.markers)
                if empty, hasLine { addCodeText(&marks, lineStart - 1, lineStart) }
                marks.append(Node(.codeMark, lineStart + line.pos, lineStart + i))
                nextLine()
                break
            }
            hasLine = true
            if !first {
                addCodeText(&marks, lineStart - 1, lineStart)
                empty = false
            }
            marks.append(contentsOf: line.markers)
            let textStart = lineStart + line.basePos
            let textEnd = lineStart + line.length
            if textStart < textEnd {
                addCodeText(&marks, textStart, textEnd)
                empty = false
            }
            first = false
        }
        addNode(Node(.fencedCode, from, prevLineEnd(), marks))
        return .leaf
    }

    private func blockquote() -> BlockResult {
        let size = isBlockquote()
        if size < 0 { return .no }
        startContext(.blockquote, line.pos)
        addNode(.quoteMark, lineStart + line.pos, lineStart + line.pos + 1)
        line.moveBase(line.pos + size)
        return .composite
    }

    private func horizontalRule() -> BlockResult {
        if isHorizontalRule(breaking: false) < 0 { return .no }
        let from = lineStart + line.pos
        nextLine()
        addNode(.horizontalRule, from)
        return .leaf
    }

    private func bulletList() -> BlockResult {
        let size = isBulletList(breaking: false)
        if size < 0 { return .no }
        if block.type != .bulletList { startContext(.bulletList, line.basePos, line.next) }
        let newBase = getListIndent(line.pos + 1)
        startContext(.listItem, line.basePos, newBase - line.baseIndent)
        addNode(.listMark, lineStart + line.pos, lineStart + line.pos + size)
        line.moveBaseColumn(newBase)
        return .composite
    }

    private func orderedList() -> BlockResult {
        let size = isOrderedList(breaking: false)
        if size < 0 { return .no }
        if block.type != .orderedList {
            startContext(.orderedList, line.basePos, line.code(line.pos + size - 1))
        }
        let newBase = getListIndent(line.pos + size)
        startContext(.listItem, line.basePos, newBase - line.baseIndent)
        addNode(.listMark, lineStart + line.pos, lineStart + line.pos + size)
        line.moveBaseColumn(newBase)
        return .composite
    }

    private func atxHeading() -> BlockResult {
        let size = isAtxHeading()
        if size < 0 { return .no }
        let off = line.pos
        let from = lineStart + off
        let endOfSpace = line.skipSpaceBack(line.length, to: off)
        var after = endOfSpace
        while after > off, line.code(after - 1) == line.next { after -= 1 }
        if after == endOfSpace || after == off || !isSpace(line.code(after - 1)) {
            after = line.length
        }
        var children = [Node(.headerMark, from, from + size)]
        let contentStart = off + size + 1
        children.append(contentsOf: parseInline(line.slice(contentStart, after), offset: lineStart + contentStart))
        if after < line.length {
            children.append(Node(.headerMark, lineStart + after, lineStart + endOfSpace))
        }
        let node = Node(.atxHeading(size), from, lineStart + line.length, children)
        nextLine()
        addNode(node)
        return .leaf
    }

    private func htmlBlock() -> BlockResult {
        let kind = isHTMLBlock(breaking: false)
        if kind < 0 { return .no }
        let from = lineStart + line.pos
        var marks: [Node] = []
        var trailing = !htmlBlockEndsAtEmptyLine(kind)
        while !htmlBlockEnds(kind, line.text), nextLine() {
            if line.depth < stack.count {
                trailing = false
                break
            }
            marks.append(contentsOf: line.markers)
        }
        if trailing { nextLine() }
        let type: NodeType = kind == 1 ? .commentBlock : kind == 2 ? .processingInstructionBlock : .htmlBlock
        addNode(Node(type, from, prevLineEnd(), marks))
        return .leaf
    }
}

private func addCodeText(_ marks: inout [Node], _ from: Int, _ to: Int) {
    if let last = marks.indices.last, marks[last].to == from, marks[last].type == .codeText {
        marks[last].to = to
    } else {
        marks.append(Node(.codeText, from, to))
    }
}

func injectMarks(_ elements: [Node], _ marks: [Node]) -> [Node] {
    if marks.isEmpty { return elements }
    if elements.isEmpty { return marks }
    var result = elements
    var index = 0
    for mark in marks {
        while index < result.count, result[index].to < mark.to { index += 1 }
        if index < result.count, result[index].from < mark.from {
            result[index].children = injectMarks(result[index].children, [mark])
        } else {
            result.insert(mark, at: index)
            index += 1
        }
    }
    return result
}

private func isTaskStart(_ content: [UInt16]) -> Bool {
    let marker = content.code(1)
    let after = content.code(3)
    return content.code(0) == Ch.openBracket
        && (marker == Ch.space || marker == 120 || marker == 88)
        && content.code(2) == Ch.closeBracket
        && (after == Ch.space || after == Ch.tab)
}

// MARK: Leaf parsers

private final class SetextHeadingParser: LeafParser {
    func nextLine(_ cx: BlockParser, _ leaf: LeafBlock) -> Bool {
        let line = cx.line
        let underline = line.depth < cx.stack.count ? -1 : cx.isSetextUnderline()
        if underline < 0 { return false }
        let next = line.next
        let underlineMark = Node(.headerMark, cx.lineStart + line.pos, cx.lineStart + underline)
        cx.nextLine()
        let children = parseInline(leaf.content, offset: leaf.start) + [underlineMark]
        cx.addLeafElement(
            leaf, Node(.setextHeading(next == Ch.equals ? 1 : 2), leaf.start, cx.prevLineEnd(), children))
        return true
    }

    func finish(_ cx: BlockParser, _ leaf: LeafBlock) -> Bool {
        false
    }
}

private final class TaskParser: LeafParser {
    func nextLine(_ cx: BlockParser, _ leaf: LeafBlock) -> Bool {
        false
    }

    func finish(_ cx: BlockParser, _ leaf: LeafBlock) -> Bool {
        let children =
            [Node(.taskMarker, leaf.start, leaf.start + 3)]
            + parseInline(leaf.content.slice(3, leaf.content.count), offset: leaf.start + 3)
        cx.addLeafElement(leaf, Node(.task, leaf.start, leaf.start + leaf.content.count, children))
        return true
    }
}

private final class TableParser: LeafParser {
    private enum State {
        case unknown
        case notTable
        case rows([Node])
    }

    private var state = State.unknown

    func nextLine(_ cx: BlockParser, _ leaf: LeafBlock) -> Bool {
        let line = cx.line
        switch state {
        case .unknown:
            state = .notTable
            let next = line.next
            if next == Ch.dash || next == Ch.colon || next == Ch.pipe {
                let lineText = line.slice(line.pos)
                if isTableDelimiterLine(lineText) {
                    let firstRow = parseRow(leaf.content, 0, offset: leaf.start, collect: true)
                    if firstRow.count == parseRow(lineText, 0, offset: 0, collect: false).count {
                        state = .rows([
                            Node(.tableHeader, leaf.start, leaf.start + leaf.content.count, firstRow.cells),
                            Node(.tableDelimiter, cx.lineStart + line.pos, cx.lineStart + line.length),
                        ])
                    }
                }
            }
        case .rows(var rows):
            let content = parseRow(line.text, line.pos, offset: cx.lineStart, collect: true).cells
            rows.append(Node(.tableRow, cx.lineStart + line.pos, cx.lineStart + line.length, content))
            state = .rows(rows)
        case .notTable:
            break
        }
        return false
    }

    func finish(_ cx: BlockParser, _ leaf: LeafBlock) -> Bool {
        guard case .rows(let rows) = state else { return false }
        cx.addLeafElement(leaf, Node(.table, leaf.start, leaf.start + leaf.content.count, rows))
        return true
    }
}

private final class LinkReferenceParser: LeafParser {
    private var stage = 0
    private var elements: [Node] = []
    private var pos = 0
    private let start: Int

    init(_ leaf: LeafBlock) {
        start = leaf.start
        _ = advance(leaf.content)
    }

    func nextLine(_ cx: BlockParser, _ leaf: LeafBlock) -> Bool {
        if stage == -1 { return false }
        let content = leaf.content + [UInt16(Ch.newline)] + cx.line.scrub()
        let finish = advance(content)
        if finish > -1, finish < content.count {
            return complete(cx, leaf, finish)
        }
        return false
    }

    func finish(_ cx: BlockParser, _ leaf: LeafBlock) -> Bool {
        if stage == 2 || stage == 3, skipSpace(leaf.content, pos) == leaf.content.count {
            return complete(cx, leaf, leaf.content.count)
        }
        return false
    }

    private func complete(_ cx: BlockParser, _ leaf: LeafBlock, _ length: Int) -> Bool {
        cx.addLeafElement(leaf, Node(.linkReference, start, start + length, elements))
        return true
    }

    private func nextStage(_ result: ScanResult) -> Bool {
        switch result {
        case .found(let node):
            pos = node.to - start
            elements.append(node)
            stage += 1
            return true
        case .failed:
            stage = -1
            return false
        case .incomplete:
            return false
        }
    }

    private func advance(_ content: [UInt16]) -> Int {
        while true {
            switch stage {
            case -1:
                return -1
            case 0:
                if !nextStage(parseLinkLabel(content, pos, offset: start, requireNonWhitespace: true)) { return -1 }
                if content.code(pos) != Ch.colon {
                    stage = -1
                    return -1
                }
                elements.append(Node(.linkMark, pos + start, pos + start + 1))
                pos += 1
            case 1:
                if !nextStage(parseURL(content, skipSpace(content, pos), offset: start)) { return -1 }
            case 2:
                let skip = skipSpace(content, pos)
                var end = 0
                if skip > pos, case .found(let title) = parseLinkTitle(content, skip, offset: start) {
                    let titleEnd = lineEnd(content, title.to - start)
                    if titleEnd > 0 {
                        _ = nextStage(.found(title))
                        end = titleEnd
                    }
                }
                if end == 0 { end = lineEnd(content, pos) }
                return end > 0 && end < content.count ? end : -1
            default:
                return lineEnd(content, pos)
            }
        }
    }

    private func lineEnd(_ text: [UInt16], _ from: Int) -> Int {
        var i = from
        while i < text.count {
            let next = Int(text[i])
            if next == Ch.newline { break }
            if !isSpace(next) { return -1 }
            i += 1
        }
        return i
    }
}

// MARK: Tables

func hasPipe(_ text: [UInt16], _ start: Int) -> Bool {
    var i = start
    while i < text.count {
        let next = Int(text[i])
        if next == Ch.pipe { return true }
        if next == Ch.backslash { i += 1 }
        i += 1
    }
    return false
}

/// Matches `^[>\s]*\|?(\s*:?-+:?\s*\|)+(\s*:?-+:?\s*)?$`.
func isTableDelimiterLine(_ text: [UInt16]) -> Bool {
    var i = 0
    while i < text.count, text.code(i) == Ch.greaterThan || isWhitespace(text.code(i)) { i += 1 }
    if text.code(i) == Ch.pipe { i += 1 }
    var cells = 0
    while true {
        if i == text.count, cells > 0 { return true }
        var j = i
        while isWhitespace(text.code(j)) { j += 1 }
        if text.code(j) == Ch.colon { j += 1 }
        let dashes = j
        while text.code(j) == Ch.dash { j += 1 }
        if j == dashes { return false }
        if text.code(j) == Ch.colon { j += 1 }
        while isWhitespace(text.code(j)) { j += 1 }
        if text.code(j) == Ch.pipe {
            cells += 1
            i = j + 1
            continue
        }
        return j == text.count && cells > 0
    }
}

func parseRow(_ text: [UInt16], _ startIndex: Int, offset: Int, collect: Bool) -> (count: Int, cells: [Node]) {
    var count = 0
    var cells: [Node] = []
    var first = true
    var cellStart = -1
    var cellEnd = -1
    var escaped = false
    func parseCell() {
        cells.append(
            Node(
                .tableCell, offset + cellStart, offset + cellEnd,
                parseInline(text.slice(cellStart, cellEnd), offset: offset + cellStart)))
    }
    var i = startIndex
    while i < text.count {
        let next = Int(text[i])
        if next == Ch.pipe, !escaped {
            if !first || cellStart > -1 { count += 1 }
            first = false
            if collect {
                if cellStart > -1 { parseCell() }
                cells.append(Node(.tableDelimiter, i + offset, i + offset + 1))
            }
            cellStart = -1
            cellEnd = -1
        } else if escaped || (next != Ch.space && next != Ch.tab) {
            if cellStart < 0 { cellStart = i }
            cellEnd = i + 1
        }
        escaped = !escaped && next == Ch.backslash
        i += 1
    }
    if cellStart > -1 {
        count += 1
        if collect { parseCell() }
    }
    return (count, cells)
}
