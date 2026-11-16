package io.github.marcinjahn.commitnote.markdown

private val RAW_TAGS = listOf("script", "pre", "style")

private val BLOCK_TAGS =
    setOf(
        "address",
        "article",
        "aside",
        "base",
        "basefont",
        "blockquote",
        "body",
        "caption",
        "center",
        "col",
        "colgroup",
        "dd",
        "details",
        "dialog",
        "dir",
        "div",
        "dl",
        "dt",
        "fieldset",
        "figcaption",
        "figure",
        "footer",
        "form",
        "frame",
        "frameset",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "head",
        "header",
        "hr",
        "html",
        "iframe",
        "legend",
        "li",
        "link",
        "main",
        "menu",
        "menuitem",
        "nav",
        "noframes",
        "ol",
        "optgroup",
        "option",
        "p",
        "param",
        "section",
        "source",
        "summary",
        "table",
        "tbody",
        "td",
        "tfoot",
        "th",
        "thead",
        "title",
        "tr",
        "track",
        "ul",
    )

/**
 * What ends an HTML block, by the kind of markup that started it, as lezer's `HTMLBlockStyle`
 * pairs them.
 */
internal enum class HtmlBlockEnd {
    RawTagClose,
    CommentClose,
    ProcessingInstructionClose,
    DeclarationClose,
    CdataClose,
    BlankLine,
    ;

    /** Whether the whole source line, container markup included, ends the block. */
    fun isMet(line: String): Boolean =
        when (this) {
            RawTagClose -> line.indices.any { isRawTagClose(line, it) }
            CommentClose -> "-->" in line
            ProcessingInstructionClose -> "?>" in line
            DeclarationClose -> '>' in line
            CdataClose -> "]]>" in line
            BlankLine -> line.all(::isBlankUnit)
        }

    companion object {
        /**
         * lezer's `isHTMLBlock` on a line's content. A lone tag starts a block but cannot interrupt
         * a paragraph.
         */
        fun starting(
            line: String,
            interrupting: Boolean,
        ): HtmlBlockEnd? {
            if (line.firstOrNull() != '<') return null
            val rest = line.substring(1)
            return when {
                isTagStart(rest, RAW_TAGS, false) -> RawTagClose
                rest.startsWith("!--") -> CommentClose
                rest.startsWith("?") -> ProcessingInstructionClose
                rest.startsWith("!") && rest.getOrNull(1) in 'A'..'Z' -> DeclarationClose
                rest.startsWith("![CDATA[") -> CdataClose
                isTagStart(rest.removePrefix("/"), BLOCK_TAGS, true) -> BlankLine
                !interrupting && isLoneTag(line) -> BlankLine
                else -> null
            }
        }
    }
}

/** `</` and a raw tag name in any ASCII case, then `>`, at `start`. */
private fun isRawTagClose(
    line: String,
    start: Int,
): Boolean {
    if (!line.startsWith("</", start)) return false
    val name = start + 2
    return RAW_TAGS.any { tag ->
        val end = name + tag.length
        end < line.length && line[end] == '>' && matchesIgnoringCase(line.substring(name, end), tag)
    }
}

/** A single complete opening or closing tag and nothing else but whitespace. */
private fun isLoneTag(line: String): Boolean {
    val tagEnd = if (line.getOrNull(1) == '/') closingTagEnd(line) else openingTagEnd(line)
    return tagEnd != null && (tagEnd until line.length).all { isWhitespace(line[it]) }
}

/** `</[a-z][\w-]*\s*>`, ending past the `>`. */
private fun closingTagEnd(line: String): Int? {
    val nameEnd = tagNameEnd(line, 2) ?: return null
    val close = skipWhitespace(line, nameEnd)
    return if (line.getOrNull(close) == '>') close + 1 else null
}

/** `<[a-z][\w-]*(\s+attribute)*\s*>`, ending past the `>`. */
private fun openingTagEnd(line: String): Int? {
    var index = tagNameEnd(line, 1) ?: return null
    while (true) {
        val next = skipWhitespace(line, index)
        val unit = line.getOrNull(next) ?: return null
        index =
            when {
                unit == '>' -> return next + 1
                next > index && isAttributeNameStart(unit) -> attributeEnd(line, next)
                else -> null
            } ?: return null
    }
}

private fun tagNameEnd(
    line: String,
    from: Int,
): Int? {
    if (line.getOrNull(from)?.let(::isAsciiLetter) != true) return null
    return skipWhile(line, from + 1) { isWord(it) || it == '-' }
}

/** `[a-z:_][\w-.]*(\s*=\s*value)?` from the name's first unit. */
private fun attributeEnd(
    line: String,
    name: Int,
): Int? {
    val nameEnd = skipWhile(line, name + 1) { isWord(it) || it == '-' || it == '.' }
    val equals = skipWhitespace(line, nameEnd)
    if (line.getOrNull(equals) != '=') return nameEnd
    return attributeValueEnd(line, skipWhitespace(line, equals + 1))
}

/** `[^\s"'=<>\`]+`, `'[^']*'` or `"[^"]*"`. */
private fun attributeValueEnd(
    line: String,
    from: Int,
): Int? {
    val first = line.getOrNull(from) ?: return null
    if (first == '\'' || first == '"') {
        val close = line.indexOf(first, from + 1)
        return if (close < 0) null else close + 1
    }
    val end = skipWhile(line, from) { !isWhitespace(it) && it !in "\"'=<>`" }
    return if (end > from) end else null
}

/** ASCII-only case folding, so that no other script's letters stand in for a tag's. */
private fun matchesIgnoringCase(
    units: String,
    tag: String,
): Boolean =
    units.length == tag.length &&
        units.indices.all { units[it].code < 128 && units[it].lowercaseChar() == tag[it] }

private fun isAttributeNameStart(unit: Char): Boolean =
    isAsciiLetter(unit) || unit == ':' || unit == '_'

private fun isAsciiLetter(unit: Char): Boolean = isAlpha(unit.code)

private fun isWord(unit: Char): Boolean = isWordChar(unit.code)

private fun skipWhitespace(
    line: String,
    from: Int,
): Int = skipWhile(line, from, ::isWhitespace)

private fun skipWhile(
    line: String,
    from: Int,
    accepts: (Char) -> Boolean,
): Int {
    var index = from.coerceAtMost(line.length)
    while (index < line.length && accepts(line[index])) index++
    return index
}

/**
 * A tag name from `tags`, in any ASCII case, ended by whitespace, `>`, the line end, or `/>` when
 * `selfClosing` allows it.
 */
private fun isTagStart(
    units: String,
    tags: Collection<String>,
    selfClosing: Boolean,
): Boolean {
    val nameLength = skipWhile(units, 0) { isAlphanumeric(it.code) }
    val name = units.substring(0, nameLength)
    if (tags.none { matchesIgnoringCase(name, it) }) return false
    val after = units.getOrNull(nameLength) ?: return true
    return when {
        after == '>' || isWhitespace(after) -> true
        after == '/' -> selfClosing && units.getOrNull(nameLength + 1) == '>'
        else -> false
    }
}
