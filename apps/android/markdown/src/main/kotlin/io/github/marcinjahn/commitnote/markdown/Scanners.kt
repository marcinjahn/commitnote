package io.github.marcinjahn.commitnote.markdown

private val TRAILING_PUNCTUATION =
    setOf('?', '!', '.', ',', ':', '*', '_', '~').map { it.code }.toSet()
private const val EMAIL_AUTOLINK_LOCAL_PUNCTUATION = ".!#$%&'*+/=?^_`{|}~-"

/** The unit at `index`, or -1 outside the text. */
internal fun String.code(index: Int): Int = if (index in indices) this[index].code else -1

/** JavaScript's `\s`. */
internal fun isWhitespace(c: Int): Boolean =
    c in 9..13 ||
        c == 32 ||
        c == 0xA0 ||
        c == 0x1680 ||
        c in 0x2000..0x200A ||
        c == 0x2028 ||
        c == 0x2029 ||
        c == 0x202F ||
        c == 0x205F ||
        c == 0x3000 ||
        c == 0xFEFF

internal fun isWhitespace(unit: Char): Boolean = isWhitespace(unit.code)

/** The range JavaScript's `String.prototype.trim` keeps of `text[from, to)`. */
internal fun String.trimmedRange(
    from: Int,
    to: Int,
): IntRange {
    var start = from
    while (start < to && isWhitespace(this[start])) start++
    var end = to
    while (end > start && isWhitespace(this[end - 1])) end--
    return start until end
}

internal fun String.jsTrim(): String {
    val range = trimmedRange(0, length)
    return substring(range.first, range.last + 1)
}

internal fun isBlankUnit(unit: Char): Boolean = unit == ' ' || unit == '\t'

internal fun String.lineStartAt(position: Int): Int {
    val clamped = position.coerceIn(0, length)
    return lastIndexOf('\n', clamped - 1) + 1
}

/** End of the line at `position`, before its line break. */
internal fun String.lineEndAt(position: Int): Int {
    if (position >= length) return length
    val index = indexOf('\n', position.coerceAtLeast(0))
    return if (index < 0) length else index
}

internal fun String.isBlankLine(
    from: Int,
    to: Int,
): Boolean = (from until to).all { isWhitespace(this[it]) }

/** The first index in `from until to` that is not a space or tab, or `to`. */
internal fun String.skipBlanks(
    from: Int,
    to: Int,
): Int {
    var index = from
    while (index < to && isBlankUnit(this[index])) index++
    return index
}

/** A space, tab or line break, which block parsing skips around markers. */
internal fun isSpaceUnit(unit: Char): Boolean = isBlankUnit(unit) || unit == '\n' || unit == '\r'

internal fun String.skipSpaces(
    from: Int,
    to: Int,
): Int {
    var index = from
    while (index < to && isSpaceUnit(this[index])) index++
    return index
}

/** The column of `position` on the line starting at `line`, with tab stops every four columns. */
internal fun String.column(
    line: Int,
    position: Int,
): Int {
    var column = 0
    for (index in line until position) column = advanceColumn(column, this[index])
    return column
}

/** The first index in `line until end` at or past column `goal`, or `end`. */
internal fun String.findColumn(
    line: Int,
    end: Int,
    goal: Int,
): Int {
    var index = line
    var column = 0
    while (index < end && column < goal) {
        column = advanceColumn(column, this[index])
        index++
    }
    return index
}

private fun advanceColumn(
    column: Int,
    unit: Char,
): Int = if (unit == '\t') column + 4 - column % 4 else column + 1

internal fun isWordChar(c: Int): Boolean = isAlphanumeric(c) || c == '_'.code

internal fun isDigit(c: Int): Boolean = c in 48..57

internal fun isAlpha(c: Int): Boolean = c in 65..90 || c in 97..122

internal fun isAlphanumeric(c: Int): Boolean = isAlpha(c) || isDigit(c)

internal fun isAsciiPunctuation(unit: Char): Boolean =
    unit.code in 33..47 || unit.code in 58..64 || unit.code in 91..96 || unit.code in 123..126

private fun isHexDigit(
    c: Int,
    caseInsensitive: Boolean,
): Boolean = isDigit(c) || c in 97..102 || (caseInsensitive && c in 65..70)

private fun isHostChar(c: Int): Boolean = isWordChar(c) || c == '-'.code

private fun isEmailLocalChar(c: Int): Boolean =
    isWordChar(c) || c == '.'.code || c == '+'.code || c == '-'.code

private fun isEmailAutolinkLocalChar(c: Int): Boolean =
    isAlphanumeric(c) || (c in 0..127 && EMAIL_AUTOLINK_LOCAL_PUNCTUATION.indexOf(c.toChar()) >= 0)

internal fun String.hasPrefixAt(
    prefix: String,
    at: Int,
): Boolean = at >= 0 && startsWith(prefix, at)

/** `(?:#\d+|#x[a-f\d]+|\w+);` at `start`; returns the match length. */
internal fun entityLength(
    text: String,
    start: Int,
    hexCaseInsensitive: Boolean,
): Int? {
    if (text.code(start) == '#'.code) {
        var i = start + 1
        while (isDigit(text.code(i))) i++
        if (i > start + 1 && text.code(i) == ';'.code) return i + 1 - start
        val x = text.code(start + 1)
        if (x == 'x'.code || (hexCaseInsensitive && x == 'X'.code)) {
            i = start + 2
            while (isHexDigit(text.code(i), hexCaseInsensitive)) i++
            if (i > start + 2 && text.code(i) == ';'.code) return i + 1 - start
        }
        return null
    }
    var i = start
    while (isWordChar(text.code(i))) i++
    return if (i > start && text.code(i) == ';'.code) i + 1 - start else null
}

/** `[\w.+-]{1,100}@` at `start`. */
internal fun isEmailPrefix(
    text: String,
    start: Int,
): Boolean {
    var i = start
    while (i - start <= 100 && isEmailLocalChar(text.code(i))) i++
    return i > start && i - start <= 100 && text.code(i) == '@'.code
}

/** End of a `www.`/`http(s)://` autolink whose host starts at `from`. */
internal fun autolinkUrlEnd(
    text: String,
    from: Int,
): Int? {
    var i = from
    while (isHostChar(text.code(i))) i++
    if (i == from) return null
    var previousLabelStart = from
    var lastLabelStart = from
    var lastLabelEnd = i
    var groups = 0
    while (text.code(i) == '.'.code && isHostChar(text.code(i + 1))) {
        val labelStart = i + 1
        i = labelStart
        while (isHostChar(text.code(i))) i++
        previousLabelStart = lastLabelStart
        lastLabelStart = labelStart
        lastLabelEnd = i
        groups++
    }
    if (groups == 0) return null
    if ((previousLabelStart until lastLabelEnd).any { text.code(it) == '_'.code }) return null
    if (text.code(i) == ':'.code && isDigit(text.code(i + 1))) {
        i++
        while (isDigit(text.code(i))) i++
    }
    if (text.code(i) == '/'.code) {
        i++
        while (i < text.length && !isWhitespace(text.code(i)) && text.code(i) != '<'.code) i++
    }
    var end = i
    while (end > from) {
        val last = text.code(end - 1)
        val unbalancedParen =
            last == ')'.code && count(text, from, end, ')') > count(text, from, end, '(')
        if (last in TRAILING_PUNCTUATION || unbalancedParen) {
            end--
            continue
        }
        val entityStart = if (last == ';'.code) trailingEntityStart(text, from, end) else null
        if (entityStart != null) end = entityStart else break
    }
    return end
}

private fun count(
    text: String,
    from: Int,
    to: Int,
    ch: Char,
): Int = (from until to).count { text[it] == ch }

/** Start of `&(?:#\d+|#x[a-f\d]+|\w+);` ending exactly at `end`. */
private fun trailingEntityStart(
    text: String,
    from: Int,
    end: Int,
): Int? {
    val ampersand = ((end - 2) downTo from).firstOrNull { text.code(it) == '&'.code } ?: return null
    val length = entityLength(text, ampersand + 1, false) ?: return null
    return if (ampersand + 1 + length == end) ampersand else null
}

/** Length of `([^\[\]]|\[[^\]]*\])*` over `text[start, end)`. */
internal fun bracketBalancedLength(
    text: String,
    start: Int,
    end: Int,
): Int {
    var i = start
    while (i < end) {
        val c = text[i]
        if (c == ']') break
        if (c == '[') {
            var j = i + 1
            while (j < end && text[j] != ']') j++
            if (j >= end) break
            i = j + 1
        } else {
            i++
        }
    }
    return i - start
}

/** End of `[\w.+-]+@[\w-]+(\.[\w.-]+)+` at `from`, without a trailing dot. */
internal fun autolinkEmailEnd(
    text: String,
    from: Int,
): Int? {
    var i = from
    while (isEmailLocalChar(text.code(i))) i++
    if (i == from || text.code(i) != '@'.code) return null
    i++
    val domain = i
    while (isHostChar(text.code(i))) i++
    if (i == domain || text.code(i) != '.'.code) return null
    i++
    val rest = i
    while (isHostChar(text.code(i)) || text.code(i) == '.'.code) i++
    if (i == rest) return null
    val last = text.code(i - 1)
    if (last == '_'.code || last == '-'.code) return null
    return if (last == '.'.code) i - 1 else i
}

/** `<scheme:…>` or `<email>` after the `<` at `start`; returns the length including `>`. */
internal fun autolinkLength(
    text: String,
    start: Int,
): Int? {
    if (isAlpha(text.code(start))) {
        var i = start + 1
        while (isWordChar(text.code(i)) || text.code(i) in setOf('-'.code, '+'.code, '.'.code)) i++
        if (i > start + 1 && text.code(i) == ':'.code) {
            val body = i + 1
            i = body
            while (i < text.length && !isWhitespace(text.code(i)) && text.code(i) != '>'.code) i++
            if (i > body && text.code(i) == '>'.code) return i + 1 - start
        }
    }
    var i = start
    while (isEmailAutolinkLocalChar(text.code(i))) i++
    if (i == start || text.code(i) != '@'.code) return null
    i++
    while (true) {
        val label = i
        while (isAlphanumeric(text.code(i)) || text.code(i) == '-'.code) i++
        val length = i - label
        if (length == 0 || length > 63 || !isAlphanumeric(text.code(label)) ||
            !isAlphanumeric(text.code(i - 1))
        ) {
            return null
        }
        if (text.code(i) == '.'.code) {
            i++
            continue
        }
        return if (text.code(i) == '>'.code) i + 1 - start else null
    }
}

/** End of a GFM autolink literal (`www.`, `http(s)://`, email, `mailto:`, `xmpp:`) at `pos`. */
internal fun autolinkLiteralEnd(
    text: String,
    pos: Int,
    hasOpenLink: Boolean,
): Int? {
    if (pos > 0 && isWordChar(text.code(pos - 1))) return null
    val end =
        when {
            text.hasPrefixAt("www.", pos) || text.hasPrefixAt("http://", pos) ||
                text.hasPrefixAt("https://", pos) -> {
                val prefix =
                    when {
                        text.hasPrefixAt("www.", pos) -> 4
                        text.hasPrefixAt("http://", pos) -> 7
                        else -> 8
                    }
                val end = autolinkUrlEnd(text, pos + prefix) ?: return null
                if (hasOpenLink) pos + bracketBalancedLength(text, pos, end) else end
            }

            isEmailPrefix(text, pos) -> {
                autolinkEmailEnd(text, pos) ?: return null
            }

            text.hasPrefixAt("mailto:", pos) || text.hasPrefixAt("xmpp:", pos) -> {
                val xmpp = text.hasPrefixAt("xmpp:", pos)
                var end = autolinkEmailEnd(text, pos + if (xmpp) 5 else 7) ?: return null
                if (xmpp && text.code(end) == '/'.code) {
                    var i = end + 1
                    while (isAlphanumeric(text.code(i)) || text.code(i) == '@'.code ||
                        text.code(i) == '.'.code
                    ) {
                        i++
                    }
                    if (i > end + 1) end = i
                }
                end
            }

            else -> {
                return null
            }
        }
    return if (end > pos) end else null
}
