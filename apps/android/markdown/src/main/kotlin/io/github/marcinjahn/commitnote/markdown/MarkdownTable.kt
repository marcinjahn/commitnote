package io.github.marcinjahn.commitnote.markdown

enum class TableAlignment { Unspecified, Left, Center, Right }

data class MarkdownTableCell(
    val range: TextRange,
    /** `range` without leading and trailing spaces and tabs; empty at `range.from` for a blank cell. */
    val contentRange: TextRange,
)

data class MarkdownTableLine(
    /** The whole line, container prefix included, line break excluded. */
    val range: TextRange,
    /** Where the row starts after the container prefix. */
    val rowStart: Int,
    val cells: List<MarkdownTableCell>,
    val trailingPipe: Boolean,
)

data class MarkdownTable(
    /** From the header line's start to the last line's end. */
    val range: TextRange,
    /** Repeated on every line: empty at top level, null when the line prefixes are irregular. */
    val containerPrefix: String?,
    val columnCount: Int,
    val alignments: List<TableAlignment>,
    val lines: List<MarkdownTableLine>,
) {
    val header: MarkdownTableLine get() = lines[0]

    val delimiter: MarkdownTableLine get() = lines[1]

    val rows: List<MarkdownTableLine> get() = lines.subList(2, lines.size)

    /** The (line index, column) at `position`, clamped to the last line and column. */
    fun cellAt(position: Int): Pair<Int, Int> {
        val line =
            lines.indexOfFirst { position <= it.range.to }.takeIf { it >= 0 } ?: lines.lastIndex
        val cells = lines[line].cells
        val column =
            cells.indexOfFirst { position <= it.range.to }.takeIf { it >= 0 }
                ?: (cells.size - 1).coerceAtLeast(0)
        return line to column.coerceAtMost((columnCount - 1).coerceAtLeast(0))
    }

    /** The line index of a display row, which counts the header and body rows but not the delimiter; clamped to the last line. */
    fun lineForRow(row: Int): Int = (if (row == 0) 0 else row + 1).coerceAtMost(lines.lastIndex)
}

/** The tables lezer's markdown parser finds on the header lines of the document's table nodes. */
internal fun findTables(document: MarkdownDocument): List<MarkdownTable> {
    val text = document.text
    val headers =
        document.nodes
            .filter { it.kind == NodeKind.Table }
            .map { text.lineStartAt(it.from) }
            .distinct()
            .sorted()
    return paragraphLines(text, headers).filterNotNull().mapNotNull { line ->
        readTable(text, line.textStart, line.containers)
            ?.takeIf { formsTable(text, it, line.containers, line.paragraphStart) }
    }
}

/**
 * Reads the table from its header through the delimiter line, then on to where lezer ends the
 * paragraph, which can be before or after the end of the table node. Null when the paragraph
 * ends at the header line.
 */
private fun readTable(
    text: String,
    header: Int,
    containers: List<BlockContainer>,
): MarkdownTable? {
    val lines = mutableListOf(sourceLine(text, header, false))
    var next = text.lineEndAt(header) + 1
    while (next <= text.length) {
        val matched = ContainerMatch.match(text, next, containers)
        if (!continuesParagraph(matched, containers)) break
        lines += sourceLine(text, matched.textStart, lines.size == 1)
        next = text.lineEndAt(next) + 1
    }
    if (lines.size < 2) return null
    val columnCount = lines[0].cells.size
    return MarkdownTable(
        range = TextRange(lines.first().range.from, lines.last().range.to),
        containerPrefix = containerPrefix(text, lines, containers.isNotEmpty()),
        columnCount = columnCount,
        alignments = alignments(text, lines[1], columnCount),
        lines = lines,
    )
}

private fun formsTable(
    text: String,
    table: MarkdownTable,
    containers: List<BlockContainer>,
    paragraphStart: Int,
): Boolean {
    val header = rowText(text, table.header)
    val delimiter = rowText(text, table.delimiter)
    return paragraphStart == table.header.rowStart &&
        isDelimiterRow(delimiter) &&
        rowCellCount(header) == rowCellCount(delimiter) &&
        !becomesSetextHeading(text, table, containers)
}

/** The row as the line holds it after the container prefix, a trailing `\r` included. */
private fun rowText(
    text: String,
    line: MarkdownTableLine,
): String = text.substring(line.rowStart, line.range.to)

/** Whether a body row or the line after the table underlines the block as a setext heading. */
private fun becomesSetextHeading(
    text: String,
    table: MarkdownTable,
    containers: List<BlockContainer>,
): Boolean {
    val following = if (table.range.to < text.length) listOf(table.range.to + 1) else emptyList()
    return (table.rows.map { it.range.from } + following).any { underlines(text, it, containers) }
}

/** Only a line that continues the paragraph and every container can underline it; a lone `-` in a bullet list starts an item instead. */
private fun underlines(
    text: String,
    line: Int,
    containers: List<BlockContainer>,
): Boolean {
    val matched = ContainerMatch.match(text, line, containers)
    return matched.continuesAll(containers) && continuesParagraph(matched, containers) &&
        isSetextUnderline(matched)
}

private fun alignments(
    text: String,
    delimiter: MarkdownTableLine,
    columnCount: Int,
): List<TableAlignment> {
    val read =
        delimiter.cells.map {
            alignment(text.substring(it.contentRange.from, it.contentRange.to))
        }
    return List(columnCount) { read.getOrElse(it) { TableAlignment.Unspecified } }
}

/** The colons at the ends of a delimiter cell once JavaScript's `trim` takes off its whitespace, a trailing `\r` included. */
private fun alignment(content: String): TableAlignment {
    val trimmed = content.jsTrim()
    val left = trimmed.startsWith(':')
    val right = trimmed.endsWith(':')
    return when {
        left && right -> TableAlignment.Center
        right -> TableAlignment.Right
        left -> TableAlignment.Left
        else -> TableAlignment.Unspecified
    }
}

private fun sourceCell(
    text: String,
    from: Int,
    to: Int,
): MarkdownTableCell {
    var contentTo = to
    while (contentTo > from && isBlankUnit(text[contentTo - 1])) contentTo--
    return MarkdownTableCell(
        TextRange(from, to),
        TextRange(text.skipBlanks(from, contentTo), contentTo),
    )
}

private fun pipePositions(
    text: String,
    from: Int,
    to: Int,
    delimiterRow: Boolean,
): List<Int> {
    val pipes = mutableListOf<Int>()
    var index = from
    while (index < to) {
        val unit = text[index]
        if (unit == '\\' && !delimiterRow) {
            index += 2
            continue
        }
        if (unit == '|') pipes += index
        index++
    }
    return pipes
}

private fun pipeSegments(
    from: Int,
    to: Int,
    pipes: List<Int>,
): MutableList<Pair<Int, Int>> {
    val segments = mutableListOf<Pair<Int, Int>>()
    var start = from
    for (pipe in pipes) {
        segments += start to pipe
        start = pipe + 1
    }
    segments += start to to
    if (pipes.firstOrNull() == from) segments.removeAt(0)
    if (pipes.lastOrNull()?.let { it + 1 == to } == true) segments.removeAt(segments.lastIndex)
    return segments
}

private fun sourceLine(
    text: String,
    rowFrom: Int,
    delimiterRow: Boolean,
): MarkdownTableLine {
    val from = text.lineStartAt(rowFrom)
    val to = text.lineEndAt(rowFrom)
    val pipes = pipePositions(text, rowFrom, to, delimiterRow)
    val segments = pipeSegments(rowFrom, to, pipes)
    var trailingPipe = pipes.lastOrNull()?.let { it + 1 == to } == true
    val lastPipe = pipes.lastOrNull()
    val lastSegment = segments.lastOrNull()
    if (!trailingPipe &&
        lastPipe != null &&
        lastSegment != null &&
        lastSegment.first == lastPipe + 1 &&
        text.isBlankLine(lastSegment.first, lastSegment.second)
    ) {
        segments.removeAt(segments.lastIndex)
        trailingPipe = true
    }
    return MarkdownTableLine(
        range = TextRange(from, to),
        rowStart = rowFrom,
        cells = segments.map { (start, end) -> sourceCell(text, start, end) },
        trailingPipe = trailingPipe,
    )
}

private fun containerPrefix(
    text: String,
    lines: List<MarkdownTableLine>,
    nested: Boolean,
): String? {
    if (!nested) return ""
    val prefixes = lines.map { text.substring(it.range.from, it.rowStart) }
    val prefix = prefixes.first()
    if (prefixes.any { it != prefix }) return null
    return prefix.takeIf { candidate -> candidate.all { it == ' ' || it == '\t' || it == '>' } }
}
