package io.github.marcinjahn.commitnote.markdown

private val CODE_KINDS = setOf(NodeKind.InlineCode, NodeKind.FencedCode, NodeKind.IndentedCode)
private val LINK_KINDS = setOf(NodeKind.Link, NodeKind.Image, NodeKind.Autolink, NodeKind.Url)
private const val TASK_ITEM = "- [ ] "

/**
 * Editing commands on markdown source. Selections are clamped to the text; a command returns null
 * when it does not apply there.
 */
object MarkdownCommands {
    fun toggleBold(
        text: String,
        selection: TextRange,
    ): TextEdit? = toggleMarker(text, selection, "**")

    fun toggleItalic(
        text: String,
        selection: TextRange,
    ): TextEdit? = toggleMarker(text, selection, "*")

    fun toggleStrikethrough(
        text: String,
        selection: TextRange,
    ): TextEdit? = toggleMarker(text, selection, "~~")

    /** Wraps the selection as a link label and leaves the caret in the empty destination. */
    fun insertLink(
        text: String,
        selection: TextRange,
    ): TextEdit? {
        val context = Context(text, selection)
        val (from, to) = context.from to context.to
        if (context.overlaps(CODE_KINDS) || context.overlaps(LINK_KINDS)) return null
        if (from == to) return single(from, to, "[]()", TextRange.caret(from + 1))
        if (context.spansLines()) return null
        val label = escapeLinkLabel(text.substring(from, to))
        return single(from, to, "[$label]()", TextRange.caret(from + label.length + 3))
    }

    /** Checks an unchecked task marker at `markerRange` and unchecks a checked one. */
    fun toggleCheckbox(
        text: String,
        markerRange: TextRange,
    ): TextEdit {
        val lower = markerRange.from.coerceAtMost(text.length)
        val upper = markerRange.to.coerceAtMost(text.length).coerceAtLeast(lower)
        val checked = text.substring(lower, upper).let { it == "[x]" || it == "[X]" }
        return single(lower, upper, if (checked) "[ ]" else "[x]", TextRange.caret(upper))
    }

    /**
     * On every line the selection touches: flips a task marker, adds one to a list item, or turns
     * a paragraph or an empty line into a task.
     */
    fun toggleTask(
        text: String,
        selection: TextRange,
    ): TextEdit? {
        val context = Context(text, selection)
        val document = context.document
        val lines =
            document.lineIndexContaining(context.from)..document.lineIndexContaining(context.to)
        val changes = lines.flatMap { taskChanges(document, it) }
        if (changes.isEmpty()) return null
        val mapped =
            if (selection.isEmpty) {
                TextRange.caret(mapPosition(context.from, changes, Assoc.After))
            } else {
                mapSelection(TextRange(context.from, context.to), changes)
            }
        return mergedEdit(text, changes, mapped)
    }

    /**
     * Inserts image references at a UTF-16 `position` the way the web and iOS clients do: as blocks
     * on their own lines, inline inside table cells, and after a table when the position is at the
     * end of its last row.
     */
    fun insertImageReferences(
        text: String,
        position: Int,
        references: List<String>,
    ): TextEdit {
        val insertion = ImageInsertion.insert(MarkdownParser.parse(text), position, references)
        return single(
            insertion.at,
            insertion.at,
            insertion.insert,
            TextRange.caret(insertion.caret),
        )
    }
}

private fun single(
    from: Int,
    to: Int,
    replacement: String,
    selectionAfter: TextRange,
) = TextEdit(TextRange(from, to), replacement, selectionAfter)

private class Context(
    text: String,
    selection: TextRange,
) {
    val document = MarkdownParser.parse(text)
    val from = selection.from.coerceIn(0, text.length)
    val to = selection.to.coerceIn(from, text.length)

    fun spansLines(): Boolean = document.lineContaining(from) != document.lineContaining(to)

    fun overlaps(kinds: Set<NodeKind>): Boolean =
        document.nodes.any { it.kind in kinds && it.from < to && it.to > from }
}

private fun escapeLinkLabel(text: String): String =
    buildString {
        for (unit in text) {
            if (unit == '[' || unit == ']') append('\\')
            append(unit)
        }
    }

private fun toggleMarker(
    text: String,
    selection: TextRange,
    marker: String,
): TextEdit? {
    val context = Context(text, selection)
    val (from, to) = context.from to context.to
    val m = marker.length
    if (context.overlaps(CODE_KINDS)) return null
    if (from == to) return single(from, to, marker + marker, TextRange.caret(from + m))
    if (context.spansLines()) return null

    val italic = marker == "*"
    val selected = text.substring(from, to)
    val present =
        if (italic) {
            starRun(selected, 0, 1) % 2 == 1 && starRun(selected, selected.length - 1, -1) % 2 == 1
        } else {
            selected.startsWith(marker) && selected.endsWith(marker)
        }
    if (selected.length > 2 * m && present) {
        val changes = listOf(Change(from, from + m, ""), Change(to - m, to, ""))
        return mergedEdit(text, changes, TextRange(from, to - 2 * m))
    }

    val line = context.document.lineContaining(from)
    val lineText = text.substring(line.from, line.to)
    val lineFrom = from - line.from
    val lineTo = to - line.from
    val outside =
        lineFrom >= m &&
            lineTo + m <= lineText.length &&
            if (italic) {
                starRun(lineText, lineFrom - 1, -1) % 2 == 1 &&
                    starRun(lineText, lineTo, 1) % 2 == 1
            } else {
                lineText.startsWith(marker, lineFrom - m) && lineText.startsWith(marker, lineTo)
            }
    if (outside) {
        val changes = listOf(Change(from - m, from, ""), Change(to, to + m, ""))
        return mergedEdit(text, changes, TextRange(from - m, to - m))
    }
    val changes = listOf(Change(from, from, marker), Change(to, to, marker))
    return mergedEdit(text, changes, TextRange(from + m, to + m))
}

/** The number of `*` from `index` on in the `step` direction. */
private fun starRun(
    text: String,
    index: Int,
    step: Int,
): Int {
    var count = 0
    var position = index
    while (position in text.indices && text[position] == '*') {
        count++
        position += step
    }
    return count
}

private fun taskChanges(
    document: MarkdownDocument,
    lineIndex: Int,
): List<Change> {
    val text = document.text
    val line = document.lineRange(lineIndex)
    val onLine =
        document.nodes.filter { (it.from >= line.from && it.from < line.to) || it.from == line.to }
    val marker = onLine.lastOrNull { it.kind == NodeKind.TaskMarker }
    val listMark = onLine.lastOrNull { it.kind == NodeKind.ListMark }

    if (marker != null) {
        val at = marker.from + 1
        return listOf(Change(at, at + 1, if (marker.checked == true) " " else "x"))
    }
    if (listMark != null) {
        val end = listMark.to
        return if (text.getOrNull(end) == ' ') {
            listOf(Change(end + 1, end + 1, "[ ] "))
        } else {
            listOf(Change(end, end, " [ ] "))
        }
    }

    var indent = 0
    while (line.from + indent < line.to && isWhitespace(text[line.from + indent])) indent++
    if (!line.isEmpty && indent == line.length) return emptyList()
    val position = line.from + indent
    val top = topLevelNode(document, position)
    val convertible = if (line.isEmpty) top == null else top?.kind == NodeKind.Paragraph
    return if (convertible) listOf(Change(position, position, TASK_ITEM)) else emptyList()
}

private fun topLevelNode(
    document: MarkdownDocument,
    position: Int,
): MarkdownNode? {
    var end = 0
    for (node in document.nodes) {
        if (node.from < end) continue
        end = node.to
        if (node.from <= position && position < node.to) return node
    }
    return null
}
