package io.github.marcinjahn.commitnote.markdown

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

/**
 * Differences that stem from commonmark-java following CommonMark/GFM where the web parser
 * deviates. Each entry must still differ from the vector, so stale rows fail the test.
 */
private val ALLOWED =
    listOf(
        "task-not-task" to
            "lezer treats any bracket pair such as [y] as a link and hides its brackets; the " +
            "parser keeps an undefined reference as plain text",
        "link-nested-brackets" to
            "CommonMark links the outer brackets around a bracketed span; lezer links the " +
            "inner pair and leaves the outer text unstyled",
        "link-reference-full" to
            "lezer hides the label brackets of a reference link; the parser leaves reference " +
            "links as plain text",
        "link-reference-collapsed" to
            "lezer hides the label brackets of a reference link; the parser leaves reference " +
            "links as plain text",
        "link-reference-shortcut" to
            "lezer hides the brackets of a shortcut reference; the parser leaves reference " +
            "links as plain text",
        "link-reference-undefined" to
            "lezer hides brackets around text with no definition; CommonMark keeps them as " +
            "literal text",
        "image-reference-style" to
            "lezer mutes the markers of a reference-style image; the parser leaves it as " +
            "plain text, and neither shows an image",
        "table-no-outer-pipes" to
            "a delimiter row of single hyphens makes a table in GFM; lezer reads the row as " +
            "a list item and styles its marker",
        "table-setext-underline" to
            "lezer lets a --- line underline the pipe paragraph as a level 2 setext heading; " +
            "GFM ends the table before it, so the parser styles the line as a thematic break",
        "table-setext-equals" to
            "lezer lets a = line underline the pipe paragraph as a level 1 setext heading; " +
            "GFM keeps the line as a table row, so the parser leaves the text unstyled",
        "table-code-indented-continuation" to
            "lezer keeps a 2. line after a quoted paragraph as lazy paragraph text, so the " +
            "whole input is one quoted paragraph and every line is a quote line; the parser " +
            "starts an ordered list item at 2., ending the blockquote and styling the marker " +
            "as a list mark",
        "table-delimiter-behind-a-quote-mark" to
            "lezer takes a whole tab after > as the quote's spacer, so the second line falls " +
            "short of the list item's content column and, indented four columns past the " +
            "outer quote, continues the paragraph with its > as text; CommonMark takes one " +
            "column of the tab, keeps the line in the item's inner blockquote and the parser " +
            "hides that quote mark",
        "table-indented-lazy-row" to
            "lezer keeps a line indented four columns after a table as a row; the parser " +
            "ends the table there and styles the line as an indented code block",
        "table-quote-lazy-list-marker" to
            "lezer keeps a lazy 2. line in the quoted paragraph because only an item " +
            "numbered 1 interrupts a paragraph, and styles it as a quote line; " +
            "commonmark-java ends the quote there and starts an ordered list, so the parser " +
            "styles its marker",
        "table-list-lazy-empty-item" to
            "lezer keeps a lazy 1. line in the item's paragraph because an empty item cannot " +
            "interrupt a paragraph; commonmark-java starts an empty ordered list there, so " +
            "the parser styles its marker",
        "table-in-quote-after-link-reference" to
            "lezer ends a complete link reference definition before the lazy y | line, which " +
            "then leaves the quote as a plain paragraph; CommonMark reads the definition out " +
            "of a paragraph whose lazy continuation stays in the quote, so the parser styles " +
            "the line as a quote line",
        "table-after-nested-ordered-item" to
            "lezer lets a 2. line interrupt the paragraph inside an ordered list and styles " +
            "the marker of the nested list it opens; CommonMark lets only an item numbered 1 " +
            "start a list that interrupts a paragraph, so the parser keeps the line as " +
            "paragraph text",
    )

/**
 * Differences in the table model that stem from the web readers disagreeing with each other. Each
 * entry must still differ, and must match once the vector alignments are cut to the column count.
 */
private val TABLE_ALLOWED =
    listOf(
        "table-trailing-blank" to
            "readTable counts a column for the blank after the last header pipe; the table " +
            "source reader and the Rust table structure do not",
    )

private val RUN_ORDER =
    compareBy<StyleRun>({ it.range.from }, { it.range.to }, { it.style.toString() })

@Serializable
private data class Vectors(
    val entries: List<Entry>,
)

@Serializable
private data class Entry(
    val name: String,
    val text: String,
    val nodes: List<VectorNode>,
    val tables: List<VectorTable>,
)

@Serializable
private data class VectorNode(
    val kind: NodeKind,
    val level: Int? = null,
    val checked: Boolean? = null,
    val from: Int,
    val to: Int,
) {
    fun node(): MarkdownNode = MarkdownNode(kind, from, to, level, checked)
}

@Serializable
private data class VectorRange(
    val from: Int,
    val to: Int,
) {
    fun range(): TextRange = TextRange(from, to)
}

@Serializable
private data class VectorTable(
    val range: VectorRange,
    val containerPrefix: String?,
    val columnCount: Int,
    val alignments: List<String>,
    val lines: List<VectorTableLine>,
)

@Serializable
private data class VectorTableLine(
    val range: VectorRange,
    val rowStart: Int,
    val trailingPipe: Boolean,
    val cells: List<VectorTableCell>,
)

@Serializable
private data class VectorTableCell(
    val range: VectorRange,
    val contentRange: VectorRange,
    val text: String,
)

private data class Normalized(
    val runs: List<String>,
    val placements: List<String>,
)

class VectorsTest {
    private val entries: List<Entry> by lazy {
        val property = System.getProperty("commitnote.markdownVectors")
        val path = requireNotNull(property) { "commitnote.markdownVectors is not set" }
        Json.decodeFromString<Vectors>(File(path).readText()).entries
    }

    @Test
    fun `parser renders like the vectors`() {
        val failures = mutableListOf<String>()
        val allowed = ALLOWED.map { it.first }.toSet()
        for (entry in entries) {
            val difference = firstDifference(entry)
            val isAllowed = entry.name in allowed
            if (difference != null && !isAllowed) failures += "${entry.name} differs at $difference"
            if (difference == null && isAllowed) {
                failures += "${entry.name} is allowed to differ but matches the vector"
            }
        }
        for ((name, reason) in ALLOWED) {
            if (entries.none { it.name == name }) {
                failures += "allowed entry $name ($reason) has no vector"
            }
        }
        assertTrue(failures.isEmpty(), "\n" + failures.joinToString("\n"))
    }

    @Test
    fun `allowed entries are unique and explained`() {
        assertUniqueAndExplained(ALLOWED)
        assertUniqueAndExplained(TABLE_ALLOWED)
        for ((name, _) in TABLE_ALLOWED) {
            assertTrue(entries.any { it.name == name }, "$name is not a corpus entry")
        }
    }

    @Test
    fun `tables match the web table model`() {
        val failures = mutableListOf<String>()
        val allowed = TABLE_ALLOWED.map { it.first }.toSet()
        for (entry in entries) {
            val document = MarkdownParser.parse(entry.text)
            val exact = firstTableDifference(entry, document, truncateAlignments = false)
            if (entry.name in allowed) {
                if (exact == null) {
                    failures += "${entry.name} is allowed to differ but matches the vector"
                } else {
                    firstTableDifference(entry, document, truncateAlignments = true)?.let {
                        failures += "${entry.name} differs beyond the allowed alignments: $it"
                    }
                }
            } else if (exact != null) {
                failures += "${entry.name} differs: $exact"
            }
        }
        for ((name, reason) in TABLE_ALLOWED) {
            if (entries.none { it.name == name }) {
                failures += "allowed table entry $name ($reason) has no vector"
            }
        }
        assertTrue(failures.isEmpty(), "\n" + failures.joinToString("\n"))
    }

    @Test
    fun `every node kind appears in the vectors`() {
        val expected =
            (1..6).map { "AtxHeading($it)" } +
                (1..2).map { "SetextHeading($it)" } +
                listOf("TaskMarker(true)", "TaskMarker(false)") +
                NodeKind.entries
                    .filterNot { it.isHeading || it == NodeKind.TaskMarker }
                    .map { it.name }
        val present = entries.flatMap { entry -> entry.nodes.map { describe(it.node()) } }.toSet()
        val missing = expected.filterNot { it in present }
        assertTrue(missing.isEmpty(), "no vector contains $missing")
    }

    private fun describe(node: MarkdownNode): String =
        when {
            node.kind.isHeading -> "${node.kind.name}(${node.level})"
            node.kind == NodeKind.TaskMarker -> "TaskMarker(${node.checked})"
            else -> node.kind.name
        }

    private fun assertUniqueAndExplained(rows: List<Pair<String, String>>) {
        val names = mutableSetOf<String>()
        for ((name, reason) in rows) {
            assertTrue(names.add(name), "$name is listed twice")
            assertTrue(reason.isNotBlank(), "$name has no reason")
        }
    }

    private fun firstDifference(entry: Entry): String? {
        val fromVector = MarkdownDocument.fromNodes(entry.text, entry.nodes.map { it.node() })
        val fromParser = MarkdownParser.parse(entry.text)
        val selections =
            listOf("no selection" to emptyList<TextRange>()) +
                fromVector.lineStarts.map { "caret at $it" to listOf(TextRange.caret(it)) }
        for (mode in RenderMode.entries) {
            for ((label, selection) in selections) {
                val expected = normalized(LivePreview.render(fromVector, selection, mode))
                val actual = normalized(LivePreview.render(fromParser, selection, mode))
                if (expected != actual) {
                    return "$mode, $label\n${describeDifference(expected, actual)}"
                }
            }
        }
        return null
    }

    private fun normalized(output: RenderOutput): Normalized =
        Normalized(
            runs =
                output.runs
                    .sortedWith(RUN_ORDER)
                    .map { "${it.range.from}..${it.range.to} ${it.style}" },
            placements = output.placements.map { it.toString() }.sorted(),
        )

    private fun describeDifference(
        expected: Normalized,
        actual: Normalized,
    ): String {
        fun only(
            label: String,
            items: List<String>,
            other: List<String>,
        ) = items.filterNot { it in other }.map { "  $label only: $it" }
        return (
            only("vector", expected.runs, actual.runs) +
                only("parser", actual.runs, expected.runs) +
                only("vector", expected.placements, actual.placements) +
                only("parser", actual.placements, expected.placements)
        ).joinToString("\n")
    }

    private fun firstTableDifference(
        entry: Entry,
        document: MarkdownDocument,
        truncateAlignments: Boolean,
    ): String? {
        val actual = document.tables
        if (actual.size != entry.tables.size) {
            return "table count: vector ${entry.tables.size}, parser ${actual.size}"
        }
        return entry.tables.zip(actual).withIndex().firstNotNullOfOrNull { (index, pair) ->
            val (vector, parser) = pair
            tableDifferences(document, vector, parser, truncateAlignments)
                .firstOrNull()
                ?.let { "table $index $it" }
        }
    }

    private fun tableDifferences(
        document: MarkdownDocument,
        expected: VectorTable,
        actual: MarkdownTable,
        truncateAlignments: Boolean,
    ): List<String> {
        val differences = mutableListOf<String>()

        fun compare(
            what: String,
            vector: Any?,
            parser: Any?,
        ) {
            if (vector != parser) differences += "$what: vector $vector, parser $parser"
        }
        compare("range", expected.range.range(), actual.range)
        compare("container prefix", expected.containerPrefix, actual.containerPrefix)
        compare("column count", expected.columnCount, actual.columnCount)
        val vectorAlignments =
            if (truncateAlignments) {
                expected.alignments.take(expected.columnCount)
            } else {
                expected.alignments
            }
        compare("alignments", vectorAlignments, actual.alignments.map(::alignmentName))
        compare("line count", expected.lines.size, actual.lines.size)
        for ((index, lines) in expected.lines.zip(actual.lines).withIndex()) {
            val (vectorLine, parserLine) = lines
            compare("line $index range", vectorLine.range.range(), parserLine.range)
            compare("line $index row start", vectorLine.rowStart, parserLine.rowStart)
            compare("line $index trailing pipe", vectorLine.trailingPipe, parserLine.trailingPipe)
            compare("line $index cell count", vectorLine.cells.size, parserLine.cells.size)
            for ((column, cells) in vectorLine.cells.zip(parserLine.cells).withIndex()) {
                val (vectorCell, parserCell) = cells
                val cell = "line $index cell $column"
                compare("$cell range", vectorCell.range.range(), parserCell.range)
                val contentRange = vectorCell.contentRange.range()
                compare("$cell content range", contentRange, parserCell.contentRange)
                compare("$cell text", vectorCell.text, document.slice(parserCell.contentRange))
            }
        }
        return differences
    }

    private fun alignmentName(alignment: TableAlignment): String =
        when (alignment) {
            TableAlignment.Unspecified -> ""
            TableAlignment.Left -> "left"
            TableAlignment.Center -> "center"
            TableAlignment.Right -> "right"
        }
}
