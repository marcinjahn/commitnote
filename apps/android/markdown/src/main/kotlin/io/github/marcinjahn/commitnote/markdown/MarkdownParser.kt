package io.github.marcinjahn.commitnote.markdown

import org.commonmark.ext.gfm.strikethrough.Strikethrough
import org.commonmark.ext.gfm.strikethrough.StrikethroughExtension
import org.commonmark.ext.gfm.tables.TableBlock
import org.commonmark.ext.gfm.tables.TableCell
import org.commonmark.ext.gfm.tables.TablesExtension
import org.commonmark.ext.task.list.items.TaskListItemMarker
import org.commonmark.ext.task.list.items.TaskListItemsExtension
import org.commonmark.node.BlockQuote
import org.commonmark.node.BulletList
import org.commonmark.node.Code
import org.commonmark.node.Emphasis
import org.commonmark.node.FencedCodeBlock
import org.commonmark.node.HardLineBreak
import org.commonmark.node.Heading
import org.commonmark.node.Image
import org.commonmark.node.IndentedCodeBlock
import org.commonmark.node.Link
import org.commonmark.node.ListItem
import org.commonmark.node.Node
import org.commonmark.node.OrderedList
import org.commonmark.node.Paragraph
import org.commonmark.node.SourceSpan
import org.commonmark.node.StrongEmphasis
import org.commonmark.node.Text
import org.commonmark.node.ThematicBreak
import org.commonmark.parser.IncludeSourceSpans
import org.commonmark.parser.Parser

/** Parses markdown into the lezer node vocabulary, deriving the marker nodes from the source text. */
object MarkdownParser {
    private val parser: Parser =
        Parser
            .builder()
            .extensions(
                listOf(
                    TablesExtension.create(),
                    StrikethroughExtension.create(),
                    TaskListItemsExtension.create(),
                ),
            ).includeSourceSpans(IncludeSourceSpans.BLOCKS_AND_INLINES)
            .build()

    fun parse(text: String): MarkdownDocument =
        MarkdownDocument.fromNodes(text, NodeBuilder(text).build(parser.parse(text)))
}

/** A node under construction; `depth` orders nodes that share a range. */
private class RawNode(
    var kind: NodeKind,
    var start: Int,
    var end: Int,
    val depth: Int,
    val level: Int? = null,
    val checked: Boolean? = null,
)

private val NODE_ORDER =
    compareBy<RawNode> { it.start }.thenByDescending { it.end }.thenBy { it.depth }

/** What the children of a node inherit. */
private data class Scope(
    val childDepth: Int,
    val openLink: Boolean = false,
    val scan: Boolean = true,
)

private enum class ContainerKind { Quote, Item }

/** A blockquote or list item, whose markers are found by walking its lines. */
private class Container(
    val kind: ContainerKind,
    val rawStart: Int,
    val rawEnd: Int,
    val node: Int,
    val list: Int?,
) {
    var contentOffset = 0
}

private class CodeBlock(
    val node: Int,
    val rawStart: Int,
    val rawEnd: Int,
    val fenced: Boolean,
    val inQuote: Boolean,
    val containers: List<Int>,
)

/** Adjacent text, scanned for GFM autolink literals once it ends. */
private class TextRun(
    val start: Int,
    var end: Int,
    val depth: Int,
    val openLink: Boolean,
)

private val Node.spanStart: Int? get() = sourceSpans.firstOrNull()?.inputIndex

private val Node.spanEnd: Int? get() = sourceSpans.lastOrNull()?.let { it.inputIndex + it.length }

/**
 * GFM tables hand a cell's `\|` to the inline parser as a bare `|`, so the spans of the inline
 * nodes after one fall a unit short of the source; this shifts them back.
 */
private fun restoreEscapedPipeSpans(
    cell: TableCell,
    text: String,
) {
    val span = cell.sourceSpans.firstOrNull() ?: return
    val cellStart = span.inputIndex
    val cellEnd = minOf(cellStart + span.length, text.length)
    val escapes = mutableListOf<Int>()
    var index = cellStart
    while (index < cellEnd) {
        if (text[index] == '\\' && index + 1 < cellEnd && text[index + 1] == '|') {
            escapes += index - cellStart - escapes.size
            index++
        }
        index++
    }
    if (escapes.isEmpty()) return

    fun source(contentIndex: Int) = cellStart + contentIndex + escapes.count { it < contentIndex }

    fun remap(node: Node) {
        node.sourceSpans =
            node.sourceSpans.map {
                val from = source(it.inputIndex - cellStart)
                val to = source(it.inputIndex - cellStart + it.length)
                SourceSpan.of(it.lineIndex, it.columnIndex + from - it.inputIndex, from, to - from)
            }
        generateSequence(node.firstChild) { it.next }.forEach(::remap)
    }
    generateSequence(cell.firstChild) { it.next }.forEach(::remap)
}

private class NodeBuilder(
    private val text: String,
) {
    private val lineStarts: IntArray =
        IntArray(text.count { it == '\n' } + 1).also { starts ->
            var line = 1
            text.forEachIndexed { index, unit -> if (unit == '\n') starts[line++] = index + 1 }
        }
    private val nodes = ArrayList<RawNode>(text.length / 4)
    private val urls = ArrayList<RawNode>()
    private val containers = ArrayList<Container>()
    private val codeBlocks = ArrayList<CodeBlock>()
    private val openContainers = ArrayList<Int>()
    private var run: TextRun? = null
    private var pendingList: Int? = null
    private var quotes = 0
    private var brackets = 0
    private var textFloor = 0

    fun build(document: Node): List<MarkdownNode> {
        visitChildren(document, Scope(childDepth = 0))
        flushRun()
        val bases = walkContainers()
        finishCodeBlocks(bases)
        return finish()
    }

    private fun finish(): List<MarkdownNode> =
        (nodes.filter { it.start <= it.end } + urls)
            .sortedWith(NODE_ORDER)
            .map { MarkdownNode(it.kind, it.start, it.end, it.level, it.checked) }

    private fun push(
        kind: NodeKind,
        start: Int,
        end: Int,
        depth: Int,
        level: Int? = null,
        checked: Boolean? = null,
    ): Int {
        nodes += RawNode(kind, start, end, depth, level, checked)
        return nodes.lastIndex
    }

    private fun visitChildren(
        node: Node,
        scope: Scope,
    ) {
        var child = node.firstChild
        while (child != null) {
            visit(child, scope)
            child = child.next
        }
    }

    private fun visit(
        node: Node,
        scope: Scope,
    ) {
        if (node is Text) {
            text(node, scope)
            return
        }
        flushRun()
        when (node) {
            is Paragraph -> {
                paragraph(node, scope)
            }

            is Heading -> {
                heading(node, scope)
            }

            is BlockQuote -> {
                blockquote(node, scope)
            }

            is BulletList, is OrderedList -> {
                list(node, scope)
            }

            is ListItem -> {
                listItem(node, scope)
            }

            is FencedCodeBlock, is IndentedCodeBlock -> {
                codeBlock(node, scope)
            }

            is ThematicBreak -> {
                thematicBreak(node, scope)
            }

            is TableBlock -> {
                table(node, scope)
            }

            is TableCell -> {
                brackets = 0
                restoreEscapedPipeSpans(node, text)
                visitChildren(node, scope)
            }

            is Emphasis -> {
                emphasis(node, NodeKind.Emphasis, 1, scope)
            }

            is StrongEmphasis -> {
                emphasis(node, NodeKind.StrongEmphasis, 2, scope)
            }

            is Strikethrough -> {
                strikethrough(node, scope)
            }

            is Code -> {
                inlineCode(node, scope)
            }

            is Link, is Image -> {
                link(node, node is Image, scope)
            }

            is HardLineBreak -> {
                hardBreak(node, scope)
            }

            is TaskListItemMarker -> {
                Unit
            }

            else -> {
                visitChildren(node, scope)
            }
        }
        flushRun()
    }

    private fun paragraph(
        node: Paragraph,
        scope: Scope,
    ) {
        val first = node.sourceSpans.firstOrNull() ?: return
        val start = text.skipBlanks(first.inputIndex, first.inputIndex + first.length)
        val depth = scope.childDepth
        val index = push(NodeKind.Paragraph, start, start, depth)
        val isTask = node.parent is ListItem && isTaskMarkerAt(start)
        brackets = 0
        textFloor = if (isTask && node.previous is TaskListItemMarker) start + 3 else 0
        visitChildren(node, Scope(depth + 1))
        flushRun()
        textFloor = 0
        val contentEnd = node.spanEnd ?: start
        nodes[index].end = if (contentEnd > start) lineEndAt(contentEnd - 1) else start
        if (isTask) {
            nodes[index].kind = NodeKind.Task
            val checked = (text[start + 1].code or 0x20) == 'x'.code
            push(NodeKind.TaskMarker, start, start + 3, depth + 1, checked = checked)
        }
    }

    private fun isTaskMarkerAt(start: Int): Boolean =
        start + 4 <= text.length &&
            text[start] == '[' &&
            text[start + 1] in " xX" &&
            text[start + 2] == ']' &&
            isBlankUnit(text[start + 3])

    private fun heading(
        node: Heading,
        scope: Scope,
    ) {
        val spanStart = node.spanStart ?: return
        val rawEnd = node.spanEnd ?: return
        val depth = scope.childDepth
        val start = text.skipSpaces(spanStart, rawEnd)
        val setext = node.sourceSpans.size > 1
        val kind = if (setext) NodeKind.SetextHeading else NodeKind.AtxHeading
        val index = push(kind, start, start, depth, level = node.level)
        brackets = 0
        visitChildren(node, Scope(depth + 1))
        flushRun()
        if (setext) finishSetextHeading(index, start, rawEnd) else finishAtxHeading(index, start)
    }

    private fun finishAtxHeading(
        index: Int,
        start: Int,
    ) {
        val depth = nodes[index].depth + 1
        val lineEnd = lineEndAt(start)
        nodes[index].end = lineEnd
        push(NodeKind.HeaderMark, start, start + runLength(start, lineEnd, '#'), depth)
        val endOfSpace = skipSpacesBack(lineEnd, start)
        var after = endOfSpace
        while (after > start && text[after - 1] == '#') after--
        if (after != endOfSpace && after != start && isSpaceUnit(text[after - 1])) {
            push(NodeKind.HeaderMark, after, endOfSpace, depth)
        }
    }

    private fun finishSetextHeading(
        index: Int,
        start: Int,
        rawEnd: Int,
    ) {
        val depth = nodes[index].depth + 1
        val end = lineEndAt(maxOf(rawEnd - 1, start))
        nodes[index].end = end
        val markEnd = skipSpacesBack(end, start)
        if (markEnd > start) {
            val mark = text[markEnd - 1]
            var markStart = markEnd
            while (markStart > start && text[markStart - 1] == mark) markStart--
            push(NodeKind.HeaderMark, markStart, markEnd, depth)
        }
    }

    private fun blockquote(
        node: BlockQuote,
        scope: Scope,
    ) {
        val rawStart = node.spanStart ?: return
        val rawEnd = node.spanEnd ?: return
        val depth = scope.childDepth
        val index =
            push(NodeKind.Blockquote, rawStart, compositeEnd(rawStart, rawEnd, false), depth)
        containers += Container(ContainerKind.Quote, rawStart, rawEnd, index, null)
        quotes++
        withOpenContainer(index) { visitChildren(node, Scope(depth + 1)) }
        quotes--
    }

    private fun list(
        node: Node,
        scope: Scope,
    ) {
        val rawStart = node.spanStart ?: return
        val rawEnd = node.spanEnd ?: return
        val depth = scope.childDepth
        val kind = if (node is OrderedList) NodeKind.OrderedList else NodeKind.BulletList
        val index = push(kind, rawStart, compositeEnd(rawStart, rawEnd, quotes > 0), depth)
        pendingList = index
        withOpenContainer(index) { visitChildren(node, Scope(depth + 1)) }
    }

    private fun listItem(
        node: ListItem,
        scope: Scope,
    ) {
        val rawStart = node.spanStart ?: return
        val rawEnd = node.spanEnd ?: return
        val depth = scope.childDepth
        val index =
            push(NodeKind.ListItem, rawStart, compositeEnd(rawStart, rawEnd, quotes > 0), depth)
        containers += Container(ContainerKind.Item, rawStart, rawEnd, index, pendingList)
        pendingList = null
        withOpenContainer(index) { visitChildren(node, Scope(depth + 1)) }
    }

    private inline fun withOpenContainer(
        node: Int,
        body: () -> Unit,
    ) {
        openContainers += node
        body()
        openContainers.removeAt(openContainers.lastIndex)
    }

    private fun codeBlock(
        node: Node,
        scope: Scope,
    ) {
        val spanStart = node.spanStart ?: return
        val spanEnd = node.spanEnd ?: return
        val fenced = node is FencedCodeBlock
        val rawStart: Int
        val rawEnd: Int
        if (node is FencedCodeBlock) {
            rawStart = spanStart
            val unclosedAtEnd =
                node.closingFenceLength == null && quotes == 0 && isLastInDocument(node)
            rawEnd = if (unclosedAtEnd) text.length else spanEnd
        } else {
            val lineStart = text.lineStartAt(spanStart)
            rawStart =
                text.findColumn(
                    lineStart,
                    text.lineEndAt(spanStart),
                    text.column(lineStart, spanStart) + 4,
                )
            rawEnd = spanEnd
        }
        val kind = if (fenced) NodeKind.FencedCode else NodeKind.IndentedCode
        val index = push(kind, rawStart, rawEnd, scope.childDepth)
        codeBlocks +=
            CodeBlock(index, rawStart, rawEnd, fenced, quotes > 0, openContainers.toList())
    }

    private fun isLastInDocument(node: Node): Boolean =
        generateSequence(node) { it.parent }.all { it.next == null }

    private fun thematicBreak(
        node: ThematicBreak,
        scope: Scope,
    ) {
        val spanStart = node.spanStart ?: return
        val spanEnd = node.spanEnd ?: return
        push(
            NodeKind.HorizontalRule,
            text.skipSpaces(spanStart, spanEnd),
            spanEnd,
            scope.childDepth,
        )
    }

    private fun table(
        node: TableBlock,
        scope: Scope,
    ) {
        val start = node.spanStart ?: return
        val end = node.spanEnd ?: return
        push(NodeKind.Table, start, end, scope.childDepth)
        visitChildren(node, Scope(scope.childDepth + 1, scope.openLink, scope.scan))
    }

    private fun emphasis(
        node: Node,
        kind: NodeKind,
        size: Int,
        scope: Scope,
    ) {
        val start = node.spanStart ?: return visitChildren(node, scope)
        val end = node.spanEnd ?: return visitChildren(node, scope)
        val depth = scope.childDepth
        push(kind, start, end, depth)
        push(NodeKind.EmphasisMark, start, start + size, depth + 1)
        push(NodeKind.EmphasisMark, end - size, end, depth + 1)
        visitChildren(node, scope.copy(childDepth = depth + 1))
    }

    private fun strikethrough(
        node: Strikethrough,
        scope: Scope,
    ) {
        val start = node.spanStart ?: return visitChildren(node, scope)
        val end = node.spanEnd ?: return visitChildren(node, scope)
        val depth = scope.childDepth
        val valid =
            end - start >= 4 &&
                text.startsWith("~~", start) &&
                text[start + 2] != '~' &&
                text.startsWith("~~", end - 2) &&
                text[end - 3] != '~'
        if (!valid) return visitChildren(node, scope)
        push(NodeKind.Strikethrough, start, end, depth)
        push(NodeKind.StrikethroughMark, start, start + 2, depth + 1)
        push(NodeKind.StrikethroughMark, end - 2, end, depth + 1)
        visitChildren(node, scope.copy(childDepth = depth + 1))
    }

    private fun inlineCode(
        node: Code,
        scope: Scope,
    ) {
        val start = node.spanStart ?: return
        val end = node.spanEnd ?: return
        val depth = scope.childDepth
        val size = runLength(start, end, '`')
        push(NodeKind.InlineCode, start, end, depth)
        push(NodeKind.CodeMark, start, start + size, depth + 1)
        push(NodeKind.CodeMark, end - size, end, depth + 1)
    }

    private fun link(
        node: Node,
        image: Boolean,
        scope: Scope,
    ) {
        val start = node.spanStart ?: return visitChildren(node, scope)
        val end = node.spanEnd ?: return visitChildren(node, scope)
        val depth = scope.childDepth
        when {
            !image && text[start] == '<' -> {
                if (end > start + 1 && autolinkLength(text, start + 1) == end - start - 1) {
                    push(NodeKind.Autolink, start, end, depth)
                    push(NodeKind.LinkMark, start, start + 1, depth + 1)
                    push(NodeKind.Url, start + 1, end - 1, depth + 1)
                    push(NodeKind.LinkMark, end - 1, end, depth + 1)
                }
                visitChildren(node, scope.copy(childDepth = depth + 1, scan = false))
            }

            text[end - 1] == ')' -> {
                val index = push(if (image) NodeKind.Image else NodeKind.Link, start, end, depth)
                visitChildren(node, scope.copy(childDepth = depth + 2, openLink = true))
                flushRun()
                val contentEnd = childrenEnd(node) ?: start
                finishLink(index, start, end, image, contentEnd)
            }

            else -> {
                visitChildren(node, scope.copy(openLink = true))
            }
        }
    }

    private fun childrenEnd(node: Node): Int? =
        generateSequence(node.firstChild) { it.next }.mapNotNull { it.spanEnd }.maxOrNull()

    private fun finishLink(
        index: Int,
        start: Int,
        end: Int,
        image: Boolean,
        contentEnd: Int,
    ) {
        val depth = nodes[index].depth + 1
        val openEnd = start + if (image) 2 else 1
        val close = (maxOf(openEnd, contentEnd) until end).firstOrNull { text[it] == ']' } ?: return
        push(NodeKind.LinkMark, start, openEnd, depth)
        if (openEnd < close) push(NodeKind.LinkLabel, openEnd, close, depth)
        push(NodeKind.LinkMark, close, close + 1, depth)
        push(NodeKind.LinkMark, close + 1, close + 2, depth)
        val destination = text.skipSpaces(close + 2, end - 1)
        val url = linkDestination(destination, end - 1)
        if (url != null) push(NodeKind.Url, url.first, url.last + 1, depth)
        push(NodeKind.LinkMark, end - 1, end, depth)
    }

    private fun linkDestination(
        start: Int,
        limit: Int,
    ): IntRange? {
        if (start >= limit) return null
        if (text[start] == '<') {
            for (position in start + 1 until limit) {
                when (text[position]) {
                    '>' -> return start..position
                    '<', '\n' -> return null
                }
            }
            return null
        }
        var depth = 0
        var escaped = false
        var position = start
        while (position < limit) {
            val unit = text[position]
            if (isSpaceUnit(unit)) {
                break
            } else if (escaped) {
                escaped = false
            } else if (unit == '(') {
                depth++
            } else if (unit == ')') {
                if (depth == 0) break
                depth--
            } else if (unit == '\\') {
                escaped = true
            }
            position++
        }
        return if (position > start) start until position else null
    }

    private fun hardBreak(
        node: HardLineBreak,
        scope: Scope,
    ) {
        val depth = scope.childDepth
        val start = node.spanStart
        if (start != null && text[start] == '\\') {
            push(NodeKind.HardBreak, start, minOf(lineEndAt(start) + 1, text.length), depth)
            return
        }
        val searchFrom = node.previous?.spanEnd ?: node.parent?.spanStart ?: return
        val newline = text.indexOf('\n', searchFrom).takeIf { it >= 0 } ?: return
        val lineStart = text.lineStartAt(newline)
        var spaces = 0
        while (newline - spaces > lineStart && text[newline - spaces - 1] == ' ') spaces++
        if (spaces >= 2) push(NodeKind.HardBreak, newline - spaces, newline + 1, depth)
    }

    /** Pulldown-style text runs: an escape starts a new run at the escaped character. */
    private fun text(
        node: Text,
        scope: Scope,
    ) {
        if (!scope.scan) return
        val spanStart = node.spanStart ?: return
        val spanEnd = node.spanEnd ?: return
        var segmentStart = maxOf(spanStart, textFloor)
        var index = segmentStart
        while (index < spanEnd) {
            if (text[index] == '\\' && index + 1 < spanEnd && isAsciiPunctuation(text[index + 1])) {
                addText(segmentStart, index, scope)
                segmentStart = index + 1
                index += 2
            } else {
                index++
            }
        }
        addText(segmentStart, spanEnd, scope)
    }

    private fun addText(
        start: Int,
        end: Int,
        scope: Scope,
    ) {
        if (start >= end) return
        val current = run
        if (current != null && current.end == start) {
            current.end = end
        } else {
            flushRun()
            run = TextRun(start, end, scope.childDepth, scope.openLink)
        }
    }

    private fun flushRun() {
        val current = run ?: return
        run = null
        val runText = text.substring(0, current.end)
        var position = current.start
        while (position < current.end) {
            val unit = runText[position]
            if (unit == '[') {
                if (!(position > 0 && runText[position - 1] == '\\')) brackets++
            } else if (unit == ']') {
                brackets = (brackets - 1).coerceAtLeast(0)
            } else {
                val linkEnd = autolinkLiteral(runText, position, current.openLink)
                if (linkEnd != null) {
                    urls += RawNode(NodeKind.Url, position, linkEnd, current.depth)
                    position = linkEnd
                    continue
                }
            }
            position++
        }
    }

    /** Matches inside the run only, but rejects a link the whole text would not accept. */
    private fun autolinkLiteral(
        runText: String,
        position: Int,
        openLink: Boolean,
    ): Int? {
        val unit = runText[position]
        val escaped = position > 0 && runText[position - 1] == '\\' && isAsciiPunctuation(unit)
        if (unit == '_' || escaped) return null
        val hasOpenLink = openLink || brackets > 0
        val end = autolinkLiteralEnd(runText, position, hasOpenLink) ?: return null
        autolinkLiteralEnd(text, position, hasOpenLink) ?: return null
        return end
    }

    /** Adds quote and list markers and fixes container starts; returns each line's content start. */
    private fun walkContainers(): IntArray {
        val bases = IntArray(lineStarts.size)
        val stack = ArrayList<Int>()
        var next = 0
        for (line in lineStarts.indices) {
            val lineStart = lineStarts[line]
            val lineEnd = lineEnd(line)
            stack.retainAll { containers[it].rawEnd > lineStart }
            while (next < containers.size && containers[next].rawStart <= lineEnd) stack += next++
            var position = lineStart
            for (index in stack) {
                val container = containers[index]
                val first = container.rawStart >= lineStart
                val node = nodes[container.node]
                val depth = node.depth + 1
                if (container.kind == ContainerKind.Quote) {
                    val mark = text.skipSpaces(position, lineEnd)
                    if (mark >= lineEnd ||
                        text[mark] != '>' ||
                        text.column(lineStart, mark) - text.column(lineStart, position) >= 4
                    ) {
                        break
                    }
                    if (first) node.start = mark
                    push(NodeKind.QuoteMark, mark, mark + 1, depth)
                    position = mark + 1
                    if (position < lineEnd && isBlankUnit(text[position])) position++
                } else {
                    val baseColumn = text.column(lineStart, position)
                    if (first) {
                        node.start = position
                        container.list?.let { nodes[it].start = position }
                        val marker = text.skipSpaces(position, lineEnd)
                        val markerEnd = listMarkerEnd(marker, lineEnd)
                        push(NodeKind.ListMark, marker, markerEnd, depth)
                        val indentAfter = text.column(lineStart, markerEnd)
                        val content = text.skipSpaces(markerEnd, lineEnd)
                        val contentColumn = text.column(lineStart, content)
                        val column =
                            if (content == lineEnd || contentColumn >= indentAfter + 5) {
                                indentAfter + 1
                            } else {
                                contentColumn
                            }
                        container.contentOffset = column - baseColumn
                        position = text.findColumn(lineStart, lineEnd, column)
                    } else {
                        val target = baseColumn + container.contentOffset
                        val content = text.skipSpaces(position, lineEnd)
                        if (content < lineEnd && text.column(lineStart, content) < target) break
                        position = text.findColumn(lineStart, lineEnd, target)
                    }
                }
            }
            bases[line] = position
        }
        return bases
    }

    private fun listMarkerEnd(
        marker: Int,
        lineEnd: Int,
    ): Int {
        if (marker >= lineEnd) return marker
        if (text[marker] in "-+*") return marker + 1
        var digits = marker
        while (digits < lineEnd && text[digits] in '0'..'9') digits++
        return if (digits > marker && digits < lineEnd && text[digits] in ".)") {
            digits + 1
        } else {
            marker + 1
        }
    }

    private fun finishCodeBlocks(bases: IntArray) {
        for (block in codeBlocks) {
            if (block.fenced) finishFencedCode(block, bases) else finishIndentedCode(block, bases)
            val end = nodes[block.node].end
            for (container in block.containers) {
                nodes[container].end = maxOf(nodes[container].end, end)
            }
        }
    }

    private fun finishFencedCode(
        block: CodeBlock,
        bases: IntArray,
    ) {
        val depth = nodes[block.node].depth + 1
        val start = text.skipSpaces(block.rawStart, block.rawEnd)
        if (start >= text.length) return
        val fence = text[start]
        val openLine = lineIndex(start)
        val openLineEnd = lineEnd(openLine)
        val fenceLength = runLength(start, openLineEnd, fence)
        push(NodeKind.CodeMark, start, start + fenceLength, depth)
        val infoFrom = text.skipSpaces(start + fenceLength, openLineEnd)
        val infoTo = skipSpacesBack(openLineEnd, infoFrom)
        if (infoFrom < infoTo) push(NodeKind.CodeInfo, infoFrom, infoTo, depth)
        val rawLast = lineIndex(trimNewline(start, block.rawEnd))
        val closing =
            if (rawLast > openLine) {
                closingFence(rawLast, bases[rawLast], fence, fenceLength)
            } else {
                null
            }
        val lastContent =
            when {
                closing != null -> rawLast - 1
                block.rawEnd >= text.length && !block.inQuote -> lineStarts.lastIndex
                else -> rawLast
            }
        val segments = Segments()
        var empty = true
        var hasLine = false
        for (line in openLine + 1..lastContent) {
            val lineStart = lineStarts[line]
            val lineEnd = lineEnd(line)
            if (hasLine) {
                segments.add(lineStart - 1, lineStart)
                empty = false
            }
            hasLine = true
            val base = minOf(bases[line], lineEnd)
            if (base < lineEnd) {
                segments.add(base, lineEnd)
                empty = false
            }
        }
        val end =
            if (closing != null) {
                val closingStart = lineStarts[rawLast]
                if (empty && hasLine) segments.add(closingStart - 1, closingStart)
                push(NodeKind.CodeMark, closing.first, closing.last + 1, depth)
                lineEnd(rawLast)
            } else if (hasLine) {
                lineEnd(lastContent)
            } else {
                openLineEnd
            }
        nodes[block.node].start = start
        nodes[block.node].end = end
        segments.forEach { from, to -> push(NodeKind.CodeText, from, to, depth) }
    }

    private fun closingFence(
        line: Int,
        lineBase: Int,
        fence: Char,
        length: Int,
    ): IntRange? {
        val lineStart = lineStarts[line]
        val lineEnd = lineEnd(line)
        val base = minOf(lineBase, lineEnd)
        val mark = text.skipSpaces(base, lineEnd)
        if (text.column(lineStart, mark) - text.column(lineStart, base) >= 4) return null
        val markEnd = mark + runLength(mark, lineEnd, fence)
        return if (markEnd - mark >= length && text.skipSpaces(markEnd, lineEnd) == lineEnd) {
            mark until markEnd
        } else {
            null
        }
    }

    private fun finishIndentedCode(
        block: CodeBlock,
        bases: IntArray,
    ) {
        val depth = nodes[block.node].depth + 1
        val start = block.rawStart
        val first = lineIndex(start)
        val last = lineIndex(trimNewline(start, block.rawEnd))
        var end = lineEnd(first)
        val segments = Segments()
        segments.add(start, end)
        val pending = ArrayList<Int>()
        for (line in first + 1..last) {
            val lineStart = lineStarts[line]
            val lineEnd = lineEnd(line)
            val base = minOf(bases[line], lineEnd)
            if (text.skipSpaces(base, lineEnd) == lineEnd) {
                pending += lineStart
                continue
            }
            pending.forEach { segments.add(it - 1, it) }
            pending.clear()
            segments.add(lineStart - 1, lineStart)
            end = lineEnd
            val codeStart = text.findColumn(lineStart, lineEnd, text.column(lineStart, base) + 4)
            if (codeStart < lineEnd) segments.add(codeStart, lineEnd)
        }
        nodes[block.node].end = end
        segments.forEach { from, to -> push(NodeKind.CodeText, from, to, depth) }
    }

    /** The end of a container without its trailing line break and blank lines; `quoted` treats `>`-only lines as blank. */
    private fun compositeEnd(
        start: Int,
        rawEnd: Int,
        quoted: Boolean,
    ): Int {
        var end = rawEnd
        while (true) {
            end = trimNewline(start, end)
            val lineStart = lineStarts[lineIndex(end)]
            val blank =
                (lineStart until end).all { isSpaceUnit(text[it]) || (quoted && text[it] == '>') }
            if (lineStart > start && blank) end = lineStart else return end
        }
    }

    private fun trimNewline(
        start: Int,
        end: Int,
    ): Int = if (end > start && text[end - 1] == '\n') end - 1 else end

    private fun skipSpacesBack(
        from: Int,
        to: Int,
    ): Int {
        var position = from
        while (position > to && isSpaceUnit(text[position - 1])) position--
        return position
    }

    private fun runLength(
        from: Int,
        to: Int,
        unit: Char,
    ): Int {
        var position = from
        while (position < to && text[position] == unit) position++
        return position - from
    }

    private fun lineIndex(position: Int): Int {
        var low = 0
        var high = lineStarts.size
        while (low < high) {
            val middle = (low + high) ushr 1
            if (lineStarts[middle] <= position) low = middle + 1 else high = middle
        }
        return low - 1
    }

    private fun lineEnd(line: Int): Int =
        if (line + 1 < lineStarts.size) {
            lineStarts[line + 1] - 1
        } else {
            text.length
        }

    private fun lineEndAt(position: Int): Int = lineEnd(lineIndex(position))
}

/** Ranges where each one starting at the previous end extends it. */
private class Segments {
    private val starts = ArrayList<Int>()
    private val ends = ArrayList<Int>()

    fun add(
        from: Int,
        to: Int,
    ) {
        if (ends.isNotEmpty() && ends.last() == from) {
            ends[ends.lastIndex] = to
        } else {
            starts += from
            ends += to
        }
    }

    fun forEach(action: (Int, Int) -> Unit) {
        for (index in starts.indices) action(starts[index], ends[index])
    }
}
