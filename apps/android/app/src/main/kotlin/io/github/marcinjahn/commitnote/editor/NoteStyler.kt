package io.github.marcinjahn.commitnote.editor

import android.text.Spannable
import android.text.Spanned
import io.github.marcinjahn.commitnote.markdown.MarkdownDocument
import io.github.marcinjahn.commitnote.markdown.Placement
import io.github.marcinjahn.commitnote.markdown.PreviewStyle
import io.github.marcinjahn.commitnote.markdown.RenderOutput
import io.github.marcinjahn.commitnote.markdown.RenderedTable
import io.github.marcinjahn.commitnote.markdown.TextRange

/** The colours of the live preview, as ARGB. */
data class EditorColors(
    val text: Int,
    val muted: Int,
    val link: Int,
    val accent: Int,
    val onAccent: Int,
    val codeBackground: Int,
    val quoteBar: Int,
    val rule: Int,
    val tableLine: Int,
    val tableHeader: Int,
    val imagePlaceholder: Int,
)

/** What TalkBack reads for content drawn in place of source text. */
internal interface EditorLabels {
    fun checkbox(checked: Boolean): String

    fun image(alt: String): String

    fun table(table: RenderedTable): String
}

/** Measures in pixels. */
internal data class EditorMetrics(
    val quoteBarWidth: Int,
    val quoteGap: Int,
    val ruleThickness: Float,
    val checkboxStroke: Float,
    val tableCellPadding: Int,
)

/**
 * Turns the live preview of the text into spans. A restyle keeps the spans that did not change and
 * reuses the ones it removes for the ones it adds, so typing re-lays out only what the edit touched.
 */
internal class NoteStyler(
    private val fonts: EditorFonts,
    private val colors: EditorColors,
    private val metrics: EditorMetrics,
    private val labels: EditorLabels,
    private val images: ImageSource,
    private val lineWidth: () -> Int,
) {
    private data class Placed(
        val spec: SpanSpec,
        val from: Int,
        val to: Int,
    )

    private val pool = HashMap<SpanSpec, ArrayDeque<PreviewSpan>>()

    fun restyle(
        text: Spannable,
        document: MarkdownDocument,
        output: RenderOutput,
    ) {
        val wanted = HashMap<Placed, Int>()
        for (placed in specs(document, output)) wanted.merge(placed, 1, Int::plus)
        for (span in text.getSpans(0, text.length, PreviewSpan::class.java)) {
            val placed = Placed(span.spec, text.getSpanStart(span), text.getSpanEnd(span))
            val count = wanted[placed]
            if (count != null) {
                if (count == 1) wanted.remove(placed) else wanted[placed] = count - 1
            } else {
                text.removeSpan(span)
                pool.getOrPut(span.spec) { ArrayDeque() }.addLast(span)
            }
        }
        for ((placed, count) in wanted) {
            repeat(count) {
                val span = pool[placed.spec]?.removeLastOrNull() ?: create(placed.spec)
                text.setSpan(span, placed.from, placed.to, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            }
        }
        pool.clear()
    }

    /** Re-lays out the images of [imageId] once their bitmap has loaded. */
    fun refreshImage(
        text: Spannable,
        imageId: String,
    ) {
        for (span in text.getSpans(0, text.length, ImageBlockSpan::class.java)) {
            if (span.spec.imageId != imageId) continue
            text.setSpan(
                span,
                text.getSpanStart(span),
                text.getSpanEnd(span),
                Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
            )
        }
    }

    private fun specs(
        document: MarkdownDocument,
        output: RenderOutput,
    ): List<Placed> {
        val placed = mutableListOf<Placed>()
        val hidden = mutableListOf<TextRange>()
        val replaced = mutableListOf<TextRange>()
        val length = document.length

        fun add(
            spec: SpanSpec,
            from: Int,
            to: Int,
        ) {
            val start = from.coerceIn(0, length)
            val end = to.coerceIn(start, length)
            if (start < end) placed += Placed(spec, start, end)
        }

        fun addLines(
            spec: SpanSpec,
            range: TextRange,
        ) = add(spec, range.from, range.to + 1)

        for (run in output.runs) {
            val range = run.range
            when (val style = run.style) {
                is PreviewStyle.Heading -> {
                    add(
                        TextStyleSpec(scale = headingScale(style.level), bold = true),
                        range.from,
                        range.to,
                    )
                }

                PreviewStyle.Emphasis -> {
                    add(TextStyleSpec(italic = true), range.from, range.to)
                }

                PreviewStyle.Strong -> {
                    add(TextStyleSpec(bold = true), range.from, range.to)
                }

                PreviewStyle.Strikethrough -> {
                    add(TextStyleSpec(strike = true), range.from, range.to)
                }

                PreviewStyle.InlineCode -> {
                    add(
                        TextStyleSpec(mono = true, background = colors.codeBackground),
                        range.from,
                        range.to,
                    )
                }

                PreviewStyle.CodeBlockLine -> {
                    add(TextStyleSpec(mono = true), range.from, range.to)
                    addLines(BlockBackgroundSpec(colors.codeBackground), range)
                }

                PreviewStyle.TableSourceLine -> {
                    add(TextStyleSpec(mono = true), range.from, range.to)
                }

                PreviewStyle.QuoteLine -> {
                    add(TextStyleSpec(color = colors.muted), range.from, range.to)
                    addLines(
                        QuoteBarSpec(colors.quoteBar, metrics.quoteBarWidth, metrics.quoteGap),
                        range,
                    )
                }

                PreviewStyle.Link -> {
                    add(TextStyleSpec(color = colors.link, underline = true), range.from, range.to)
                }

                PreviewStyle.Url -> {
                    add(TextStyleSpec(color = colors.link), range.from, range.to)
                }

                PreviewStyle.ListMark, PreviewStyle.MutedMarker -> {
                    add(TextStyleSpec(color = colors.muted), range.from, range.to)
                }

                PreviewStyle.Hidden -> {
                    hidden += range
                }
            }
        }

        for (placement in output.placements) {
            when (placement) {
                is Placement.Checkbox -> {
                    val range = placement.range
                    add(checkbox(placement.checked), range.from, range.to)
                    replaced += range
                }

                is Placement.Rule -> {
                    addLines(RuleSpec(colors.rule, metrics.ruleThickness), placement.lineRange)
                }

                is Placement.Image -> {
                    if (placement.sourceVisible) continue
                    val reference = placement.reference
                    val spec =
                        ImageSpec(
                            imageId = reference.imageId,
                            width = reference.width,
                            height = reference.height,
                            placeholderColor = colors.imagePlaceholder,
                            description = labels.image(reference.alt),
                        )
                    add(spec, reference.range.from, reference.range.to)
                    replaced += reference.range
                }

                is Placement.Table -> {
                    val header = placement.table.source.header.range
                    val spec =
                        TableSpec(
                            table = placement.table,
                            textColor = colors.text,
                            lineColor = colors.tableLine,
                            headerBackground = colors.tableHeader,
                            padding = metrics.tableCellPadding,
                            description = labels.table(placement.table),
                        )
                    add(spec, header.from, header.to)
                    replaced += header
                }
            }
        }

        val shown = subtract(merge(hidden), merge(replaced))
        for (range in shown) {
            for (piece in paragraphPieces(document, range)) add(HiddenSpec, piece.from, piece.to)
        }
        for (lines in collapsedLines(document, shown)) add(CollapsedLinesSpec, lines.from, lines.to)
        return placed
    }

    private fun checkbox(checked: Boolean) =
        CheckboxSpec(
            checked = checked,
            color = colors.accent,
            checkColor = colors.onAccent,
            strokeWidth = metrics.checkboxStroke,
            description = labels.checkbox(checked),
        )

    private fun create(spec: SpanSpec): PreviewSpan =
        when (spec) {
            is TextStyleSpec -> TextStyleSpan(spec, fonts)
            is BlockBackgroundSpec -> BlockBackgroundSpan(spec)
            is QuoteBarSpec -> QuoteBarSpan(spec)
            is RuleSpec -> RuleSpan(spec)
            HiddenSpec -> HiddenSpan()
            CollapsedLinesSpec -> CollapsedLinesSpan()
            is CheckboxSpec -> CheckboxSpan(spec)
            is ImageSpec -> ImageBlockSpan(spec, images, lineWidth)
            is TableSpec -> TableSpan(spec, fonts, lineWidth)
        }

    private companion object {
        fun headingScale(level: Int): Float =
            when (level) {
                1 -> 1.6f
                2 -> 1.4f
                3 -> 1.2f
                4 -> 1.1f
                else -> 1f
            }

        /** The ranges sorted, with overlapping and touching ones joined. */
        fun merge(ranges: List<TextRange>): List<TextRange> {
            val result = mutableListOf<TextRange>()
            for (range in ranges.filter { !it.isEmpty }.sortedBy { it.from }) {
                val last = result.lastOrNull()
                if (last != null && range.from <= last.to) {
                    result[result.lastIndex] = TextRange(last.from, maxOf(last.to, range.to))
                } else {
                    result += range
                }
            }
            return result
        }

        /** Sorted, disjoint [ranges] without the parts the sorted, disjoint [removed] cover. */
        fun subtract(
            ranges: List<TextRange>,
            removed: List<TextRange>,
        ): List<TextRange> {
            if (removed.isEmpty()) return ranges
            val result = mutableListOf<TextRange>()
            for (range in ranges) {
                var start = range.from
                for (cut in removed) {
                    if (cut.to <= start || cut.from >= range.to) continue
                    if (cut.from > start) result += TextRange(start, cut.from)
                    start = maxOf(start, cut.to)
                }
                if (start < range.to) result += TextRange(start, range.to)
            }
            return result
        }

        /** [range] cut after each line break, so no replacement spans two paragraphs. */
        fun paragraphPieces(
            document: MarkdownDocument,
            range: TextRange,
        ): List<TextRange> {
            val pieces = mutableListOf<TextRange>()
            var start = range.from
            while (start < range.to) {
                val lineEnd = document.lineContaining(start).to
                val end = minOf(range.to, lineEnd + 1)
                pieces += TextRange(start, end)
                start = end
            }
            return pieces
        }

        /** The runs of whole lines that [hidden] covers together with their line breaks. */
        fun collapsedLines(
            document: MarkdownDocument,
            hidden: List<TextRange>,
        ): List<TextRange> {
            val result = mutableListOf<TextRange>()
            for (range in hidden) {
                var index = document.lineIndexContaining(range.from)
                var runStart = -1
                var runEnd = -1
                while (index < document.lineStarts.size) {
                    val line = document.lineRange(index)
                    if (line.from >= range.to) break
                    val atEnd =
                        line.to == document.length && range.to == document.length &&
                            line.from > range.from
                    val covered = line.from >= range.from && (line.to + 1 <= range.to || atEnd)
                    if (covered) {
                        if (runStart < 0) runStart = line.from
                        runEnd = line.to
                    }
                    index++
                }
                if (runStart >= 0 && runEnd > runStart) result += TextRange(runStart, runEnd)
            }
            return result
        }
    }
}
