package io.github.marcinjahn.commitnote.editor

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.os.Build
import android.text.Layout
import android.text.TextPaint
import android.text.TextUtils
import android.text.style.LeadingMarginSpan
import android.text.style.LineBackgroundSpan
import android.text.style.LineHeightSpan
import android.text.style.MetricAffectingSpan
import android.text.style.ReplacementSpan
import io.github.marcinjahn.commitnote.markdown.RenderedTable
import io.github.marcinjahn.commitnote.markdown.TableAlignment
import io.github.marcinjahn.commitnote.ui.FontSet
import kotlin.math.roundToInt

/**
 * A span the live preview owns. Its [spec] says what it draws, so a span whose spec and range did
 * not change is kept, and a removed one is reused for the same spec.
 */
internal interface PreviewSpan {
    val spec: SpanSpec
}

internal sealed interface SpanSpec

/** Character styles; each flag adds to what overlapping spans set. */
internal data class TextStyleSpec(
    val scale: Float = 1f,
    val bold: Boolean = false,
    val italic: Boolean = false,
    val mono: Boolean = false,
    val color: Int? = null,
    val background: Int? = null,
    val strike: Boolean = false,
    val underline: Boolean = false,
) : SpanSpec

internal data class BlockBackgroundSpec(
    val color: Int,
) : SpanSpec

internal data class QuoteBarSpec(
    val color: Int,
    val width: Int,
    val gap: Int,
) : SpanSpec

internal data class RuleSpec(
    val color: Int,
    val thickness: Float,
) : SpanSpec

internal data object HiddenSpec : SpanSpec

internal data object CollapsedLinesSpec : SpanSpec

internal data class CheckboxSpec(
    val checked: Boolean,
    val color: Int,
    val checkColor: Int,
    val strokeWidth: Float,
    val description: String,
) : SpanSpec

internal data class ImageSpec(
    val imageId: String,
    val width: Int?,
    val height: Int?,
    val placeholderColor: Int,
    val description: String,
) : SpanSpec

internal data class TableSpec(
    val table: RenderedTable,
    val textColor: Int,
    val lineColor: Int,
    val headerBackground: Int,
    val padding: Int,
    val description: String,
) : SpanSpec

/** The faces of the note font and the code font, to resolve overlapping styles. */
internal class EditorFonts(
    val text: FontSet,
    val code: FontSet,
) {
    private data class Face(
        val bold: Boolean,
        val italic: Boolean,
        val mono: Boolean,
    )

    private val faces =
        buildMap {
            for (mono in listOf(false, true)) {
                val set = if (mono) code else text
                for (bold in listOf(false, true)) {
                    for (italic in listOf(
                        false,
                        true,
                    )) {
                        put(set.face(bold, italic), Face(bold, italic, mono))
                    }
                }
            }
        }

    fun apply(
        paint: TextPaint,
        bold: Boolean,
        italic: Boolean,
        mono: Boolean,
    ) {
        val current = faces[paint.typeface] ?: Face(bold = false, italic = false, mono = false)
        val set = if (current.mono || mono) code else text
        paint.typeface = set.face(current.bold || bold, current.italic || italic)
    }
}

internal class TextStyleSpan(
    override val spec: TextStyleSpec,
    private val fonts: EditorFonts,
) : MetricAffectingSpan(),
    PreviewSpan {
    override fun updateMeasureState(paint: TextPaint) {
        if (spec.scale != 1f) paint.textSize *= spec.scale
        if (spec.bold || spec.italic ||
            spec.mono
        ) {
            fonts.apply(paint, spec.bold, spec.italic, spec.mono)
        }
    }

    override fun updateDrawState(paint: TextPaint) {
        updateMeasureState(paint)
        spec.color?.let { paint.color = it }
        spec.background?.let { paint.bgColor = it }
        if (spec.strike) paint.isStrikeThruText = true
        if (spec.underline) paint.isUnderlineText = true
    }
}

internal class BlockBackgroundSpan(
    override val spec: BlockBackgroundSpec,
) : LineBackgroundSpan,
    PreviewSpan {
    override fun drawBackground(
        canvas: Canvas,
        paint: Paint,
        left: Int,
        right: Int,
        top: Int,
        baseline: Int,
        bottom: Int,
        text: CharSequence,
        start: Int,
        end: Int,
        lineNumber: Int,
    ) {
        val color = paint.color
        paint.color = spec.color
        canvas.drawRect(left.toFloat(), top.toFloat(), right.toFloat(), bottom.toFloat(), paint)
        paint.color = color
    }
}

internal class QuoteBarSpan(
    override val spec: QuoteBarSpec,
) : LeadingMarginSpan,
    PreviewSpan {
    override fun getLeadingMargin(first: Boolean): Int = spec.width + spec.gap

    override fun drawLeadingMargin(
        canvas: Canvas,
        paint: Paint,
        x: Int,
        dir: Int,
        top: Int,
        baseline: Int,
        bottom: Int,
        text: CharSequence,
        start: Int,
        end: Int,
        first: Boolean,
        layout: Layout?,
    ) {
        val color = paint.color
        val style = paint.style
        paint.color = spec.color
        paint.style = Paint.Style.FILL
        val right = x + dir * spec.width
        canvas.drawRect(
            minOf(x, right).toFloat(),
            top.toFloat(),
            maxOf(x, right).toFloat(),
            bottom.toFloat(),
            paint,
        )
        paint.color = color
        paint.style = style
    }
}

internal class RuleSpan(
    override val spec: RuleSpec,
) : LineBackgroundSpan,
    PreviewSpan {
    override fun drawBackground(
        canvas: Canvas,
        paint: Paint,
        left: Int,
        right: Int,
        top: Int,
        baseline: Int,
        bottom: Int,
        text: CharSequence,
        start: Int,
        end: Int,
        lineNumber: Int,
    ) {
        val color = paint.color
        val strokeWidth = paint.strokeWidth
        paint.color = spec.color
        paint.strokeWidth = spec.thickness
        val y = (top + bottom) / 2f
        canvas.drawLine(left.toFloat(), y, right.toFloat(), y, paint)
        paint.color = color
        paint.strokeWidth = strokeWidth
    }
}

/** Source text that takes no room. */
internal class HiddenSpan :
    ReplacementSpan(),
    PreviewSpan {
    override val spec: SpanSpec = HiddenSpec

    init {
        describe("")
    }

    override fun getSize(
        paint: Paint,
        text: CharSequence?,
        start: Int,
        end: Int,
        fm: Paint.FontMetricsInt?,
    ): Int {
        fm?.let(paint::getFontMetricsInt)
        return 0
    }

    override fun draw(
        canvas: Canvas,
        text: CharSequence?,
        start: Int,
        end: Int,
        x: Float,
        top: Int,
        y: Int,
        bottom: Int,
        paint: Paint,
    ) = Unit
}

/** Lines whose whole text is hidden, collapsed to no height. */
internal class CollapsedLinesSpan :
    LineHeightSpan,
    PreviewSpan {
    override val spec: SpanSpec = CollapsedLinesSpec

    override fun chooseHeight(
        text: CharSequence,
        start: Int,
        end: Int,
        spanstartv: Int,
        lineHeight: Int,
        fm: Paint.FontMetricsInt,
    ) {
        fm.top = 0
        fm.ascent = 0
        fm.descent = 0
        fm.bottom = 0
    }
}

internal class CheckboxSpan(
    override val spec: CheckboxSpec,
) : ReplacementSpan(),
    PreviewSpan {
    private val box = RectF()
    private val check = Path()

    init {
        describe(spec.description)
    }

    override fun getSize(
        paint: Paint,
        text: CharSequence?,
        start: Int,
        end: Int,
        fm: Paint.FontMetricsInt?,
    ): Int {
        fm?.let(paint::getFontMetricsInt)
        return width(paint)
    }

    /** The room the box takes in text drawn with [paint]. */
    fun width(paint: Paint): Int = (paint.textSize * WIDTH_EMS).roundToInt()

    override fun draw(
        canvas: Canvas,
        text: CharSequence?,
        start: Int,
        end: Int,
        x: Float,
        top: Int,
        y: Int,
        bottom: Int,
        paint: Paint,
    ) {
        val size = paint.textSize * BOX_EMS
        val centerY = y - paint.textSize * CENTER_EMS
        val left = x + (width(paint) - size) / 2
        box.set(left, centerY - size / 2, left + size, centerY + size / 2)
        val corner = size * CORNER_RATIO
        val color = paint.color
        val style = paint.style
        val strokeWidth = paint.strokeWidth
        paint.color = spec.color
        paint.strokeWidth = spec.strokeWidth
        paint.style = if (spec.checked) Paint.Style.FILL else Paint.Style.STROKE
        canvas.drawRoundRect(box, corner, corner, paint)
        if (spec.checked) {
            paint.color = spec.checkColor
            paint.style = Paint.Style.STROKE
            check.reset()
            check.moveTo(box.left + size * 0.25f, box.top + size * 0.52f)
            check.lineTo(box.left + size * 0.43f, box.top + size * 0.7f)
            check.lineTo(box.left + size * 0.76f, box.top + size * 0.32f)
            canvas.drawPath(check, paint)
        }
        paint.color = color
        paint.style = style
        paint.strokeWidth = strokeWidth
    }

    private companion object {
        const val WIDTH_EMS = 1.3f
        const val BOX_EMS = 0.9f
        const val CENTER_EMS = 0.33f
        const val CORNER_RATIO = 0.2f
    }
}

/** The bitmaps of images, loaded on demand. */
internal interface ImageSource {
    /** The bitmap when loaded; null starts loading it. */
    fun bitmap(imageId: String): Bitmap?
}

/** An image drawn as wide as the line, in place of its reference. */
internal class ImageBlockSpan(
    override val spec: ImageSpec,
    private val images: ImageSource,
    private val lineWidth: () -> Int,
) : ReplacementSpan(),
    PreviewSpan {
    private val bounds = RectF()

    init {
        describe(spec.description)
    }

    override fun getSize(
        paint: Paint,
        text: CharSequence?,
        start: Int,
        end: Int,
        fm: Paint.FontMetricsInt?,
    ): Int {
        val width = lineWidth().coerceAtLeast(0)
        val height = height(width, paint)
        if (fm != null) {
            paint.getFontMetricsInt(fm)
            fm.ascent = -height
            fm.top = -height
            fm.descent = 0
            fm.bottom = 0
        }
        return width
    }

    override fun draw(
        canvas: Canvas,
        text: CharSequence?,
        start: Int,
        end: Int,
        x: Float,
        top: Int,
        y: Int,
        bottom: Int,
        paint: Paint,
    ) {
        val width = lineWidth().coerceAtLeast(0)
        val height = height(width, paint)
        bounds.set(x, (y - height).toFloat(), x + width, y.toFloat())
        val bitmap = images.bitmap(spec.imageId)
        if (bitmap != null) {
            canvas.drawBitmap(bitmap, null, bounds, paint)
            return
        }
        val color = paint.color
        val style = paint.style
        paint.color = spec.placeholderColor
        paint.style = Paint.Style.FILL
        canvas.drawRect(bounds, paint)
        paint.color = color
        paint.style = style
    }

    private fun height(
        width: Int,
        paint: Paint,
    ): Int {
        val bitmap = images.bitmap(spec.imageId)
        val sourceWidth = spec.width ?: bitmap?.width
        val sourceHeight = spec.height ?: bitmap?.height
        if (sourceWidth == null || sourceHeight == null || sourceWidth == 0) {
            return maxOf(width / 2, paint.fontSpacing.roundToInt())
        }
        return (width.toLong() * sourceHeight / sourceWidth).toInt()
    }
}

/** A table drawn as a grid of its cells' plain text, in place of its header row. */
internal class TableSpan(
    override val spec: TableSpec,
    private val fonts: EditorFonts,
    private val lineWidth: () -> Int,
) : ReplacementSpan(),
    PreviewSpan {
    private val cellPaint = TextPaint()

    init {
        describe(spec.description)
    }

    override fun getSize(
        paint: Paint,
        text: CharSequence?,
        start: Int,
        end: Int,
        fm: Paint.FontMetricsInt?,
    ): Int {
        if (fm != null) {
            paint.getFontMetricsInt(fm)
            val height = rowHeight(paint) * spec.table.rows.size
            fm.ascent = -height
            fm.top = -height
            fm.descent = 0
            fm.bottom = 0
        }
        return lineWidth().coerceAtLeast(0)
    }

    override fun draw(
        canvas: Canvas,
        text: CharSequence?,
        start: Int,
        end: Int,
        x: Float,
        top: Int,
        y: Int,
        bottom: Int,
        paint: Paint,
    ) {
        val table = spec.table
        val columns = table.columnCount.coerceAtLeast(1)
        val width = lineWidth().coerceAtLeast(0).toFloat()
        val rowHeight = rowHeight(paint)
        val tableTop = (y - rowHeight * table.rows.size).toFloat()
        val columnWidth = width / columns
        val color = paint.color
        val style = paint.style
        paint.style = Paint.Style.FILL
        paint.color = spec.headerBackground
        canvas.drawRect(x, tableTop, x + width, tableTop + rowHeight, paint)
        paint.color = spec.lineColor
        for (row in 0..table.rows.size) {
            val lineY = tableTop + row * rowHeight
            canvas.drawLine(x, lineY, x + width, lineY, paint)
        }
        for (column in 0..columns) {
            val lineX = (x + column * columnWidth).coerceAtMost(x + width - 1)
            canvas.drawLine(lineX, tableTop, lineX, tableTop + rowHeight * table.rows.size, paint)
        }
        paint.color = color
        paint.style = style
        table.rows.forEachIndexed { rowIndex, row ->
            cellPaint.set(paint)
            cellPaint.color = spec.textColor
            if (rowIndex == 0) fonts.apply(cellPaint, bold = true, italic = false, mono = false)
            val baseline =
                tableTop + rowIndex * rowHeight + spec.padding - cellPaint.fontMetrics.ascent
            row.forEachIndexed { column, cell ->
                val available = columnWidth - 2 * spec.padding
                if (available <= 0) return@forEachIndexed
                val shown =
                    TextUtils.ellipsize(
                        cell.plainText,
                        cellPaint,
                        available,
                        TextUtils.TruncateAt.END,
                    )
                val textWidth = cellPaint.measureText(shown, 0, shown.length)
                val cellLeft = x + column * columnWidth + spec.padding
                val offset =
                    when (table.alignments.getOrNull(column)) {
                        TableAlignment.Center -> (available - textWidth) / 2
                        TableAlignment.Right -> available - textWidth
                        else -> 0f
                    }
                canvas.drawText(shown, 0, shown.length, cellLeft + offset, baseline, cellPaint)
            }
        }
    }

    private fun rowHeight(paint: Paint): Int = paint.fontSpacing.roundToInt() + 2 * spec.padding
}

/** What TalkBack reads in place of the replaced text; older systems read the source text. */
private fun ReplacementSpan.describe(description: String) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) contentDescription = description
}
