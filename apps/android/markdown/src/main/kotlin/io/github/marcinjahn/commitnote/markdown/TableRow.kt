package io.github.marcinjahn.commitnote.markdown

/** lezer's `hasPipe`: an unescaped pipe anywhere in the row, even one inside a code span. */
internal fun hasPipe(row: String): Boolean {
    var escaped = false
    for (unit in row) {
        if (unit == '|' && !escaped) return true
        escaped = !escaped && unit == '\\'
    }
    return false
}

/** lezer's `delimiterLine` on a whole source line: a delimiter row after any quote markers and whitespace. */
internal fun isDelimiterLine(line: String): Boolean {
    val start = line.indexOfFirst { it != '>' && !isWhitespace(it) }
    return isDelimiterRow(if (start < 0) "" else line.substring(start))
}

/** `|? (cell |)+ cell?` over the whole row, where a cell is `\s* :? -+ :? \s*`. */
internal fun isDelimiterRow(row: String): Boolean {
    if (row.firstOrNull()?.let { it == '-' || it == ':' || it == '|' } != true) return false
    var index = if (row[0] == '|') 1 else 0
    var closedCells = 0
    while (true) {
        val cellEnd = delimiterCellEnd(row, index) ?: return false
        when {
            cellEnd >= row.length -> {
                return closedCells > 0
            }

            row[cellEnd] == '|' -> {
                closedCells++
                index = cellEnd + 1
                if (index == row.length) return true
            }

            else -> {
                return false
            }
        }
    }
}

private fun delimiterCellEnd(
    row: String,
    from: Int,
): Int? {
    fun skip(
        start: Int,
        accepts: (Char) -> Boolean,
    ): Int {
        var index = start
        while (index < row.length && accepts(row[index])) index++
        return index
    }

    fun colon(at: Int): Int = if (at < row.length && row[at] == ':') at + 1 else at
    val dashes = colon(skip(from, ::isWhitespace))
    val dashesEnd = skip(dashes) { it == '-' }
    return if (dashesEnd > dashes) skip(colon(dashesEnd), ::isWhitespace) else null
}

/**
 * lezer's `parseRow` count: every unescaped pipe closes a cell, unless it is a leading pipe, and
 * content after the last pipe adds one. Only spaces and tabs are blank.
 */
internal fun rowCellCount(row: String): Int {
    var count = 0
    var leading = true
    var inCell = false
    var escaped = false
    for (unit in row) {
        if (unit == '|' && !escaped) {
            if (!leading || inCell) count++
            leading = false
            inCell = false
        } else if (escaped || !isBlankUnit(unit)) {
            inCell = true
        }
        escaped = !escaped && unit == '\\'
    }
    return count + if (inCell) 1 else 0
}
