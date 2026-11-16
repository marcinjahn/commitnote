package io.github.marcinjahn.commitnote.markdown

private const val IMAGE_LABEL = "Image"
private const val EMPTY_LABEL = "Empty"

data class TableTextStyle(
    val emphasis: Boolean = false,
    val strong: Boolean = false,
    val strikethrough: Boolean = false,
    val code: Boolean = false,
)

sealed interface TableCellPiece {
    data class Text(
        val text: String,
        val style: TableTextStyle,
        /** The openable destination when the text is a link. */
        val link: String?,
    ) : TableCellPiece

    data class Image(
        val reference: ImageReference,
    ) : TableCellPiece

    /** Whether both show the same thing, whatever their source ranges. */
    fun sameContent(other: TableCellPiece): Boolean =
        if (this is Image && other is Image) {
            reference.copy(range = other.reference.range) == other.reference
        } else {
            this == other
        }
}

data class TableCellContent(
    val pieces: List<TableCellPiece>,
    /** A UTF-16 offset in the document. */
    val caretOffset: Int,
) {
    /** The pieces' text, an image contributing its alt text. */
    val plainText: String =
        pieces.joinToString("") {
            when (it) {
                is TableCellPiece.Text -> it.text
                is TableCellPiece.Image -> it.reference.alt
            }
        }

    /** The trimmed plain text with an image without alt text read as "Image"; "Empty" when blank. */
    val accessibleLabel: String =
        pieces
            .joinToString("") {
                when (it) {
                    is TableCellPiece.Text -> it.text
                    is TableCellPiece.Image -> it.reference.alt.ifEmpty { IMAGE_LABEL }
                }
            }.trim()
            .ifEmpty { EMPTY_LABEL }

    fun sameContent(other: TableCellContent): Boolean =
        plainText == other.plainText &&
            accessibleLabel == other.accessibleLabel &&
            pieces.size == other.pieces.size &&
            pieces.zip(other.pieces).all { (a, b) -> a.sameContent(b) }
}

/** A table as the live preview shows it when no selection touches it. */
data class RenderedTable(
    val source: MarkdownTable,
    /** The header row, then the body rows; each holds exactly `columnCount` cells. */
    val rows: List<List<TableCellContent>>,
    /** The number of `>` in the container prefix. */
    val quoteLevel: Int,
) {
    val range: TextRange get() = source.range

    val alignments: List<TableAlignment> get() = source.alignments

    val containerPrefix: String get() = source.containerPrefix.orEmpty()

    /** The container prefix after its last `>` and the one space or tab that follows it. */
    val listPrefix: String
        get() {
            val prefix = containerPrefix
            val mark = prefix.lastIndexOf('>')
            if (mark < 0) return prefix
            val rest = prefix.substring(mark + 1)
            return if (rest.firstOrNull()?.let(::isBlankUnit) == true) rest.substring(1) else rest
        }

    val columnCount: Int get() = source.columnCount

    val rowCount: Int get() = rows.size

    val header: List<TableCellContent> get() = rows[0]

    val bodyRows: List<List<TableCellContent>> get() = rows.subList(1, rows.size)

    /** Whether both show the same thing, whatever their source ranges and caret offsets. */
    fun sameContent(other: RenderedTable): Boolean =
        alignments == other.alignments &&
            containerPrefix == other.containerPrefix &&
            quoteLevel == other.quoteLevel &&
            rows.size == other.rows.size &&
            rows.zip(other.rows).all { (a, b) ->
                a.size == b.size && a.zip(b).all { (x, y) -> x.sameContent(y) }
            }

    companion object {
        /**
         * `runs` are the live preview's runs for a render in which no selection touches `table`.
         * Null when the table's line prefixes are irregular.
         */
        fun of(
            document: MarkdownDocument,
            table: MarkdownTable,
            runs: List<StyleRun>,
        ): RenderedTable? {
            val prefix = table.containerPrefix ?: return null
            val reader = CellReader(document, table.range, runs)
            val rows =
                (listOf(table.header) + table.rows).map { line ->
                    List(table.columnCount) { column ->
                        line.cells.getOrNull(column)?.let(reader::content)
                            ?: TableCellContent(emptyList(), line.range.to)
                    }
                }
            return RenderedTable(table, rows, prefix.count { it == '>' })
        }
    }
}

private class UnitMarks {
    var dropped = false

    /** Inside inline code or a URL, where a backslash is not an escape. */
    var verbatim = false
    var linked = false
    var style = TableTextStyle()

    fun apply(preview: PreviewStyle) {
        when (preview) {
            PreviewStyle.Hidden, PreviewStyle.MutedMarker -> {
                dropped = true
            }

            PreviewStyle.Emphasis -> {
                style = style.copy(emphasis = true)
            }

            PreviewStyle.Strong -> {
                style = style.copy(strong = true)
            }

            PreviewStyle.Strikethrough -> {
                style = style.copy(strikethrough = true)
            }

            PreviewStyle.InlineCode -> {
                style = style.copy(code = true)
                verbatim = true
            }

            PreviewStyle.Link -> {
                linked = true
            }

            PreviewStyle.Url -> {
                linked = true
                verbatim = true
            }

            is PreviewStyle.Heading,
            PreviewStyle.CodeBlockLine,
            PreviewStyle.TableSourceLine,
            PreviewStyle.QuoteLine,
            PreviewStyle.ListMark,
            -> {
                Unit
            }
        }
    }
}

private sealed interface CellImage {
    val end: Int

    data class Reference(
        override val end: Int,
        val reference: ImageReference,
    ) : CellImage

    data class Label(
        override val end: Int,
        val label: TextRange,
    ) : CellImage
}

/** A referenced image, or the label of one whose destination is not a reference. */
private fun cellImage(
    node: MarkdownNode,
    document: MarkdownDocument,
): CellImage? {
    val reference = ImageReference.referenceFor(node, document)
    if (reference != null) return CellImage.Reference(node.to, reference)
    return imageLabelRange(node, document)?.let { CellImage.Label(node.to, it) }
}

private class CellReader(
    private val document: MarkdownDocument,
    range: TextRange,
    runs: List<StyleRun>,
) {
    private val base = range.from
    private val marks = List(range.length) { UnitMarks() }

    /** Keyed by the image node's start. */
    private val images = mutableMapOf<Int, CellImage>()

    init {
        fun mark(
            offsets: TextRange,
            style: PreviewStyle,
        ) {
            for (offset in maxOf(offsets.from, range.from) until minOf(offsets.to, range.to)) {
                marks[offset - base].apply(style)
            }
        }
        runs.forEach { mark(it.range, it.style) }
        for (node in document.nodesOverlapping(range)) {
            when (node.kind) {
                NodeKind.Autolink -> {
                    mark(TextRange(node.from, node.from + 1), PreviewStyle.Hidden)
                    mark(TextRange(node.to - 1, node.to), PreviewStyle.Hidden)
                }

                NodeKind.Image -> {
                    val image = cellImage(node, document)
                    if (image != null) images[node.from] = image
                }

                else -> {
                    Unit
                }
            }
        }
    }

    fun content(cell: MarkdownTableCell): TableCellContent {
        val text = document.text
        val content = cell.contentRange
        val pieces = PieceBuilder()
        var stretchLink: String? = null
        var stretchResolved = false
        var escaped = false
        var index = content.from
        while (index < content.to) {
            val image = images[index]?.takeIf { it.end <= content.to }
            if (image != null) {
                when (image) {
                    is CellImage.Reference -> {
                        pieces.pushImage(image.reference)
                    }

                    is CellImage.Label -> {
                        pieces.pushText(
                            document.slice(image.label),
                            TableTextStyle(),
                            null,
                        )
                    }
                }
                stretchResolved = false
                escaped = false
                index = image.end
                continue
            }
            val unitMarks = marks[index - base]
            val escapes =
                !escaped &&
                    !unitMarks.verbatim &&
                    text[index] == '\\' &&
                    index + 1 < content.to &&
                    isAsciiPunctuation(text[index + 1])
            if (unitMarks.dropped || escapes) {
                escaped = escapes && !unitMarks.dropped
                stretchResolved = false
                index++
                continue
            }
            escaped = false
            val link =
                if (unitMarks.linked) {
                    if (!stretchResolved) {
                        stretchLink = MarkdownLinks.linkUrl(document, index)
                        stretchResolved = true
                    }
                    stretchLink
                } else {
                    stretchResolved = false
                    null
                }
            pieces.pushText(text.substring(index, index + 1), unitMarks.style, link)
            index++
        }
        return TableCellContent(pieces.finish(), caretOffset(text, cell))
    }
}

private fun caretOffset(
    text: String,
    cell: MarkdownTableCell,
): Int =
    when {
        !cell.contentRange.isEmpty -> cell.contentRange.to
        !cell.range.isEmpty && text[cell.range.from] == ' ' -> cell.range.from + 1
        else -> cell.range.from
    }

private class PieceBuilder {
    private val pieces = mutableListOf<TableCellPiece>()
    private val text = StringBuilder()
    private var style = TableTextStyle()
    private var link: String? = null

    fun pushText(
        units: String,
        unitStyle: TableTextStyle,
        unitLink: String?,
    ) {
        if (units.isEmpty()) return
        if (text.isEmpty() || style != unitStyle || link != unitLink) {
            flush()
            style = unitStyle
            link = unitLink
        }
        text.append(units)
    }

    fun pushImage(reference: ImageReference) {
        flush()
        pieces += TableCellPiece.Image(reference)
    }

    private fun flush() {
        if (text.isEmpty()) return
        pieces += TableCellPiece.Text(text.toString(), style, link)
        link = null
        text.clear()
    }

    fun finish(): List<TableCellPiece> {
        flush()
        return pieces.toList()
    }
}
