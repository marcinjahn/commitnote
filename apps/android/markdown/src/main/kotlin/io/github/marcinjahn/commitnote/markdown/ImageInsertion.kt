package io.github.marcinjahn.commitnote.markdown

/** Where image references go: `insert` at `at`, with the caret ending at `caret`. */
internal data class Insertion(
    val at: Int,
    val insert: String,
    val caret: Int,
)

internal object ImageInsertion {
    fun insert(
        document: MarkdownDocument,
        position: Int,
        references: List<String>,
    ): Insertion {
        val text = document.text
        val at = position.coerceIn(0, text.length)
        val tables = document.tables
        val block = references.joinToString("\n")
        val table =
            tables.firstOrNull { at >= it.range.from && at <= it.range.to }
                ?: return insertBlock(text, tables, at, block, "")
        return insertInTable(text, tables, table, at, block, references)
    }

    private fun insertInTable(
        text: String,
        tables: List<MarkdownTable>,
        table: MarkdownTable,
        at: Int,
        block: String,
        references: List<String>,
    ): Insertion {
        fun after(end: Int) = insertBlockAfterTable(text, tables, end, block, table.containerPrefix)

        val (lineIndex, _) = table.cellAt(at)
        val line = table.lines[lineIndex]
        val isLast = lineIndex == table.lines.lastIndex
        if (lineIndex == 0 && at <= line.rowStart) {
            return insertBlock(
                text,
                tables,
                line.range.from,
                block,
                table.containerPrefix.orEmpty(),
            )
        }
        val lastCell = line.cells.lastOrNull()
        if (lastCell == null) {
            if (isLast && at > line.rowStart) return after(line.range.to)
            return insertInline(text, at.coerceIn(line.rowStart, line.range.to), references)
        }
        if (isLast && line.trailingPipe && at > lastCell.range.to) return after(line.range.to)
        return insertInline(text, inlinePoint(table, line, lineIndex, at), references)
    }

    private fun insertBlock(
        text: String,
        tables: List<MarkdownTable>,
        position: Int,
        block: String,
        prefix: String,
    ): Insertion {
        val separator = prefix.trimEnd(' ', '\t')
        var at = position.coerceAtMost(text.length)
        var from = text.lineStartAt(at)
        var to = text.lineEndAt(at)
        if (at == to && at != from && to < text.length) {
            val nextTo = text.lineEndAt(to + 1)
            if (text.isBlankLine(to + 1, nextTo)) {
                at = to + 1
                from = at
                to = nextTo
            }
        }

        val before = StringBuilder()
        if (at != from) before.append('\n')
        if (at > 0) {
            val previousFrom = text.lineStartAt(at - 1)
            val previousInTable =
                tables.any { previousFrom >= it.range.from && previousFrom <= it.range.to }
            if (!text.isBlankLine(previousFrom, at) && previousInTable) {
                before.append(separator).append('\n')
            }
        }
        val after = !text.isBlankLine(at, to) && at == from && tables.any { it.range.from == from }

        val prefixed = prefixLines(block, prefix)
        val insert = StringBuilder().append(before).append(prefixed).append('\n')
        var caret = at + before.length + prefixed.length + 1
        if (after) {
            insert.append(separator).append('\n')
            caret += separator.length
        }
        return Insertion(at, insert.toString(), caret)
    }

    private fun insertBlockAfterTable(
        text: String,
        tables: List<MarkdownTable>,
        tableEnd: Int,
        block: String,
        prefix: String?,
    ): Insertion {
        if (prefix.isNullOrEmpty()) return insertBlock(text, tables, tableEnd, block, "")
        val separator = prefix.trimEnd(' ', '\t')
        val head = "\n$separator\n${prefixLines(block, prefix)}"
        if (tableEnd >= text.length) {
            val insert = "$head\n"
            return Insertion(tableEnd, insert, tableEnd + insert.length)
        }
        val nextFrom = tableEnd + 1
        val next = text.substring(nextFrom, text.lineEndAt(nextFrom))
        if (isContainerSeparator(next, separator)) {
            return Insertion(tableEnd, head, tableEnd + head.length + 1 + trimEndJs(next).length)
        }
        val insert = "$head\n${closingSeparator(next, separator)}"
        return Insertion(tableEnd, insert, tableEnd + insert.length)
    }

    private fun insertInline(
        text: String,
        position: Int,
        references: List<String>,
    ): Insertion {
        val joined = references.joinToString(" ")
        val lead = position > 0 && !isWhitespace(text[position - 1])
        val trail = position < text.length && !isWhitespace(text[position])
        val insert = (if (lead) " " else "") + joined + (if (trail) " " else "")
        return Insertion(position, insert, position + (if (lead) 1 else 0) + joined.length)
    }

    /** The delimiter line stands for the header cell above; elsewhere the position is clamped into a cell. */
    private fun inlinePoint(
        table: MarkdownTable,
        line: MarkdownTableLine,
        lineIndex: Int,
        position: Int,
    ): Int {
        if (lineIndex == 1) {
            val (_, column) = table.cellAt(position)
            val header = table.header.cells.getOrNull(column) ?: return position
            return if (!header.contentRange.isEmpty) {
                header.contentRange.to
            } else {
                minOf(header.range.from + 1, header.range.to)
            }
        }
        val first = line.cells.firstOrNull() ?: return position
        val last = line.cells.last()
        val clamped = position.coerceAtLeast(first.range.from).coerceAtMost(last.range.to)
        val cell = line.cells.firstOrNull { clamped <= it.range.to } ?: return clamped
        return maxOf(clamped, cell.range.from)
    }
}

private fun prefixLines(
    block: String,
    prefix: String,
): String = if (prefix.isEmpty()) block else block.split('\n').joinToString("\n") { prefix + it }

private fun trimEndJs(text: String): String = text.trimEnd(::isWhitespace)

private fun isContainerSeparator(
    line: String,
    separator: String,
): Boolean {
    val trimmed = trimEndJs(line)
    return trimmed.isEmpty() || (trimmed.endsWith('>') && separator.startsWith(trimmed))
}

/** The longest run of `separator` up to one of its `>` that `line` starts with. */
private fun closingSeparator(
    line: String,
    separator: String,
): String {
    var closing = ""
    for ((index, marker) in separator.withIndex()) {
        val candidate = separator.substring(0, index + 1)
        if (marker == '>' && line.startsWith(candidate)) closing = candidate
    }
    return closing
}
