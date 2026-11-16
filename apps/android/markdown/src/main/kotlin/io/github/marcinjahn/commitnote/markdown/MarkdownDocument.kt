package io.github.marcinjahn.commitnote.markdown

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** The lezer markdown vocabulary shared by every client's editor. */
@Serializable
enum class NodeKind(
    val id: String,
) {
    @SerialName("atxHeading")
    AtxHeading("atxHeading"),

    @SerialName("setextHeading")
    SetextHeading("setextHeading"),

    @SerialName("headerMark")
    HeaderMark("headerMark"),

    @SerialName("blockquote")
    Blockquote("blockquote"),

    @SerialName("quoteMark")
    QuoteMark("quoteMark"),

    @SerialName("bulletList")
    BulletList("bulletList"),

    @SerialName("orderedList")
    OrderedList("orderedList"),

    @SerialName("listItem")
    ListItem("listItem"),

    @SerialName("listMark")
    ListMark("listMark"),

    @SerialName("task")
    Task("task"),

    @SerialName("taskMarker")
    TaskMarker("taskMarker"),

    @SerialName("fencedCode")
    FencedCode("fencedCode"),

    @SerialName("codeMark")
    CodeMark("codeMark"),

    @SerialName("codeInfo")
    CodeInfo("codeInfo"),

    @SerialName("codeText")
    CodeText("codeText"),

    @SerialName("indentedCode")
    IndentedCode("indentedCode"),

    @SerialName("horizontalRule")
    HorizontalRule("horizontalRule"),

    @SerialName("paragraph")
    Paragraph("paragraph"),

    @SerialName("emphasis")
    Emphasis("emphasis"),

    @SerialName("strongEmphasis")
    StrongEmphasis("strongEmphasis"),

    @SerialName("emphasisMark")
    EmphasisMark("emphasisMark"),

    @SerialName("strikethrough")
    Strikethrough("strikethrough"),

    @SerialName("strikethroughMark")
    StrikethroughMark("strikethroughMark"),

    @SerialName("inlineCode")
    InlineCode("inlineCode"),

    @SerialName("link")
    Link("link"),

    @SerialName("linkMark")
    LinkMark("linkMark"),

    @SerialName("linkLabel")
    LinkLabel("linkLabel"),

    @SerialName("url")
    Url("url"),

    @SerialName("autolink")
    Autolink("autolink"),

    @SerialName("image")
    Image("image"),

    @SerialName("table")
    Table("table"),

    @SerialName("hardBreak")
    HardBreak("hardBreak"),
    ;

    val isHeading: Boolean get() = this == AtxHeading || this == SetextHeading

    companion object {
        private val byId = entries.associateBy { it.id }

        fun fromId(id: String): NodeKind? = byId[id]
    }
}

/**
 * A syntax node over `[from, to)` in UTF-16 code units. Headings carry their `level` and task
 * markers whether they are `checked`.
 */
data class MarkdownNode(
    val kind: NodeKind,
    val from: Int,
    val to: Int,
    val level: Int? = null,
    val checked: Boolean? = null,
) {
    val range: TextRange get() = TextRange(from, to)
}

/** A half-open range `[from, to)` in UTF-16 code units. */
data class TextRange(
    val from: Int,
    val to: Int,
) {
    init {
        require(from <= to) { "A range cannot end before it starts" }
    }

    val length: Int get() = to - from

    val isEmpty: Boolean get() = from == to

    companion object {
        fun caret(position: Int): TextRange = TextRange(position, position)
    }
}

class MarkdownDocument private constructor(
    val text: String,
    /** Document order, parents before children. */
    val nodes: List<MarkdownNode>,
) {
    /** The UTF-16 offset of the start of each line. */
    val lineStarts: IntArray =
        IntArray(text.count { it == '\n' } + 1).also { starts ->
            var line = 1
            text.forEachIndexed { index, unit -> if (unit == '\n') starts[line++] = index + 1 }
        }

    /** The tables in document order, as lezer finds them on the header lines of the table nodes. */
    val tables: List<MarkdownTable> by lazy { findTables(this) }

    val length: Int get() = text.length

    fun slice(range: TextRange): String {
        val end = range.to.coerceAtMost(length)
        return text.substring(range.from.coerceAtMost(end), end)
    }

    /** The line around `offset`, without its line break. */
    fun lineContaining(offset: Int): TextRange = lineRange(lineIndexContaining(offset))

    /** The 0-based index of the line around `offset`, which is clamped to the document. */
    fun lineIndexContaining(offset: Int): Int {
        val clamped = offset.coerceIn(0, length)
        var low = 0
        var high = lineStarts.size
        while (low < high) {
            val middle = (low + high) ushr 1
            if (lineStarts[middle] <= clamped) low = middle + 1 else high = middle
        }
        return low - 1
    }

    /** The line at a valid 0-based `index`, without its line break. */
    fun lineRange(index: Int): TextRange {
        val end = if (index + 1 < lineStarts.size) lineStarts[index + 1] - 1 else length
        return TextRange(lineStarts[index], end)
    }

    /** Nodes intersecting `range`; an empty range matches nodes that contain or touch its position. */
    fun nodesOverlapping(range: TextRange): List<MarkdownNode> =
        if (range.isEmpty) {
            nodes.filter { it.from <= range.from && range.from <= it.to }
        } else {
            nodes.filter { it.from < range.to && range.from < it.to }
        }

    companion object {
        /** `nodes` must be in document order, parents before children. */
        fun fromNodes(
            text: String,
            nodes: List<MarkdownNode>,
        ): MarkdownDocument = MarkdownDocument(text, nodes.toList())
    }
}
