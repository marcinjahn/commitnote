package io.github.marcinjahn.commitnote.markdown

import io.github.marcinjahn.commitnote.markdown.Placement.Checkbox
import io.github.marcinjahn.commitnote.markdown.PreviewStyle.Heading

sealed interface PreviewStyle {
    data class Heading(
        val level: Int,
    ) : PreviewStyle

    data object Emphasis : PreviewStyle

    data object Strong : PreviewStyle

    data object Strikethrough : PreviewStyle

    data object InlineCode : PreviewStyle

    data object CodeBlockLine : PreviewStyle

    data object TableSourceLine : PreviewStyle

    data object QuoteLine : PreviewStyle

    data object Link : PreviewStyle

    data object Url : PreviewStyle

    data object ListMark : PreviewStyle

    data object MutedMarker : PreviewStyle

    data object Hidden : PreviewStyle
}

data class StyleRun(
    val range: TextRange,
    val style: PreviewStyle,
)

/** Something drawn in place of, or next to, source text. */
sealed interface Placement {
    data class Checkbox(
        val range: TextRange,
        val checked: Boolean,
    ) : Placement

    data class Rule(
        val lineRange: TextRange,
    ) : Placement

    data class Image(
        val reference: ImageReference,
        val lineRange: TextRange,
        val sourceVisible: Boolean,
    ) : Placement

    data class Table(
        val table: RenderedTable,
    ) : Placement
}

/** Whether the text can be edited, which decides if a selection reveals a table's source. */
enum class RenderMode { Editable, ReadOnly }

/**
 * Runs may overlap: apply block line styles first, inline styles next and [PreviewStyle.Hidden]
 * last, which is the order they come in. Placements come in document order.
 */
data class RenderOutput(
    val runs: List<StyleRun>,
    val placements: List<Placement>,
)

object LivePreview {
    /** Syntax on the lines any of `selections` touches stays visible as muted markers. */
    fun render(
        document: MarkdownDocument,
        selections: List<TextRange>,
        mode: RenderMode,
    ): RenderOutput = Renderer(document, selections, mode).render()
}

private class Renderer(
    private val document: MarkdownDocument,
    private val selections: List<TextRange>,
    private val mode: RenderMode,
) {
    private val block = mutableListOf<StyleRun>()
    private val inline = mutableListOf<StyleRun>()
    private val hidden = mutableListOf<StyleRun>()
    private val placements = mutableListOf<Pair<Int, Placement>>()

    fun render(): RenderOutput {
        visitNodes()
        renderTables()
        val ordered = placements.sortedBy { it.first }.map { it.second }
        return RenderOutput(block + inline + hidden, ordered)
    }

    private fun visitNodes() {
        val ancestors = ArrayDeque<MarkdownNode>()
        for (node in document.nodes) {
            while (ancestors.isNotEmpty() && !ancestors.last().encloses(node)) {
                ancestors.removeLast()
            }
            val parent = ancestors.lastOrNull()?.kind
            ancestors.addLast(node)
            visit(node, parent)
        }
    }

    private fun renderTables() {
        val tables = document.tables
        if (tables.isEmpty()) return
        val gathered = block + inline + hidden
        for (table in tables) {
            val revealed = mode == RenderMode.Editable && linesActive(table.range)
            val rendered = if (revealed) null else RenderedTable.of(document, table, gathered)
            if (rendered != null) renderTable(table, rendered) else styleTableSource(table)
        }
    }

    private fun renderTable(
        table: MarkdownTable,
        rendered: RenderedTable,
    ) {
        hide(table.header.range)
        val rest = table.lines.drop(1)
        if (rest.isNotEmpty()) {
            val last = rest.last()
            val lineBreak = if (last.range.to < document.length) 1 else 0
            hide(TextRange(rest.first().range.from, last.range.to + lineBreak))
        }
        placements.removeAll { (start, _) -> start >= table.range.from && start < table.range.to }
        addPlacement(table.range.from, Placement.Table(rendered))
    }

    private fun styleTableSource(table: MarkdownTable) {
        table.lines.forEach { addBlock(it.range, PreviewStyle.TableSourceLine) }
        val delimiter = table.delimiter
        muted(TextRange(delimiter.rowStart, delimiter.range.to))
        for (line in listOf(table.header) + table.rows) {
            for (position in line.rowStart until line.range.to) {
                val outsideCells =
                    line.cells.none { position >= it.range.from && position < it.range.to }
                if (document.text[position] == '|' && outsideCells) {
                    muted(TextRange(position, position + 1))
                }
            }
        }
    }

    private fun visit(
        node: MarkdownNode,
        parent: NodeKind?,
    ) {
        val range = node.range
        val ownedBy = { kind: NodeKind -> parent == kind }
        when (node.kind) {
            NodeKind.AtxHeading, NodeKind.SetextHeading -> addBlock(range, Heading(node.level ?: 1))

            NodeKind.HeaderMark -> syntax(range, ownedBy(NodeKind.AtxHeading), true)

            NodeKind.Blockquote -> addLines(range, PreviewStyle.QuoteLine)

            NodeKind.QuoteMark -> hideUnlessActive(range, extendingSpace = true)

            NodeKind.FencedCode -> addLines(range, PreviewStyle.CodeBlockLine)

            NodeKind.IndentedCode -> addLines(range, PreviewStyle.CodeBlockLine)

            NodeKind.ListMark -> addInline(range, PreviewStyle.ListMark)

            NodeKind.Emphasis -> addInline(range, PreviewStyle.Emphasis)

            NodeKind.StrongEmphasis -> addInline(range, PreviewStyle.Strong)

            NodeKind.Strikethrough -> addInline(range, PreviewStyle.Strikethrough)

            NodeKind.EmphasisMark, NodeKind.StrikethroughMark -> hideUnlessActive(range, false)

            NodeKind.InlineCode -> addInline(range, PreviewStyle.InlineCode)

            NodeKind.CodeMark -> syntax(range, ownedBy(NodeKind.InlineCode), false)

            NodeKind.LinkLabel -> if (parent == NodeKind.Link) addInline(range, PreviewStyle.Link)

            NodeKind.LinkMark -> syntax(range, ownedBy(NodeKind.Link), false)

            NodeKind.Url -> visitUrl(node, parent)

            NodeKind.Autolink -> addInline(range, PreviewStyle.Url)

            NodeKind.Image -> visitImage(node)

            NodeKind.TaskMarker -> addPlacement(node.from, Checkbox(range, node.checked == true))

            NodeKind.HorizontalRule -> visitRule(node)

            NodeKind.CodeInfo,
            NodeKind.CodeText,
            NodeKind.Task,
            NodeKind.Link,
            NodeKind.BulletList,
            NodeKind.OrderedList,
            NodeKind.ListItem,
            NodeKind.Paragraph,
            NodeKind.Table,
            NodeKind.HardBreak,
            -> Unit
        }
    }

    private fun visitRule(node: MarkdownNode) {
        if (linesActive(node.range)) return
        hide(node.range)
        addPlacement(node.from, Placement.Rule(document.lineContaining(node.from)))
    }

    /** Syntax that belongs to its parent hides off the active lines; stray syntax stays muted. */
    private fun syntax(
        range: TextRange,
        owned: Boolean,
        extendingSpace: Boolean,
    ) = if (owned) hideUnlessActive(range, extendingSpace) else muted(range)

    private fun addBlock(
        range: TextRange,
        style: PreviewStyle,
    ) {
        block += StyleRun(range, style)
    }

    private fun addInline(
        range: TextRange,
        style: PreviewStyle,
    ) {
        inline += StyleRun(range, style)
    }

    private fun hide(range: TextRange) {
        hidden += StyleRun(range, PreviewStyle.Hidden)
    }

    private fun addPlacement(
        start: Int,
        placement: Placement,
    ) {
        placements += start to placement
    }

    private fun visitUrl(
        node: MarkdownNode,
        parent: NodeKind?,
    ) {
        val destination = node.from > 0 && document.text[node.from - 1] == '('
        when {
            parent == NodeKind.Link && destination -> hideUnlessActive(node.range, false)
            parent == NodeKind.Image && destination -> muted(node.range)
            else -> addInline(node.range, PreviewStyle.Url)
        }
    }

    private fun visitImage(node: MarkdownNode) {
        val reference = ImageReference.referenceFor(node, document) ?: return
        val active = linesActive(node.range)
        if (!active) hide(node.range)
        val line = document.lineContaining(node.from)
        addPlacement(node.from, Placement.Image(reference, line, active))
    }

    private fun linesActive(range: TextRange): Boolean {
        val lineStart = document.lineContaining(range.from).from
        val lineEnd = document.lineContaining(range.to).to
        return selections.any { it.from <= lineEnd && it.to >= lineStart }
    }

    private fun addLines(
        range: TextRange,
        style: PreviewStyle,
    ) {
        val first = document.lineIndexContaining(range.from)
        val last = document.lineIndexContaining(maxOf(range.from, range.to - 1))
        for (index in first..last) addBlock(document.lineRange(index), style)
    }

    private fun hideUnlessActive(
        range: TextRange,
        extendingSpace: Boolean,
    ) {
        if (linesActive(range)) {
            muted(range)
        } else {
            val extend =
                extendingSpace && range.to < document.length && document.text[range.to] == ' '
            hide(if (extend) TextRange(range.from, range.to + 1) else range)
        }
    }

    private fun muted(range: TextRange) {
        addInline(range, PreviewStyle.MutedMarker)
    }
}

private fun MarkdownNode.encloses(node: MarkdownNode): Boolean = from <= node.from && node.to <= to
