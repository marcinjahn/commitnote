package io.github.marcinjahn.commitnote.editor

import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.util.AttributeSet
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import androidx.annotation.VisibleForTesting
import androidx.core.view.ContentInfoCompat
import androidx.core.view.ViewCompat
import androidx.core.view.doOnLayout
import androidx.core.view.inputmethod.EditorInfoCompat
import androidx.core.view.inputmethod.InputConnectionCompat
import io.github.marcinjahn.commitnote.R
import io.github.marcinjahn.commitnote.markdown.LivePreview
import io.github.marcinjahn.commitnote.markdown.MarkdownCommands
import io.github.marcinjahn.commitnote.markdown.MarkdownDocument
import io.github.marcinjahn.commitnote.markdown.MarkdownLinks
import io.github.marcinjahn.commitnote.markdown.MarkdownParser
import io.github.marcinjahn.commitnote.markdown.RenderMode
import io.github.marcinjahn.commitnote.markdown.RenderedTable
import io.github.marcinjahn.commitnote.markdown.TextEdit
import io.github.marcinjahn.commitnote.markdown.TextRange
import kotlin.math.abs
import kotlin.math.roundToInt

/** The formatting commands of the editor's keyboard shortcuts. */
private enum class EditorCommand { Bold, Italic, Strikethrough, Link, Task }

/** How the editor looks; [textSizeSp] is the size of body text. */
internal data class EditorAppearance(
    val fonts: EditorFonts,
    val colors: EditorColors,
    val textSizeSp: Float,
)

/**
 * The markdown editor: a text field whose spans show the live preview of its text, restyled once a
 * frame after the text or the selection changes.
 */
class NoteEditText
    @JvmOverloads
    constructor(
        context: Context,
        attrs: AttributeSet? = null,
    ) : EditText(context, attrs),
        EditorSurface {
        interface Listener {
            fun onTextChanged(text: String)

            fun onSelectionChanged(selection: TextSelection)

            fun onOpenLink(url: String)

            fun onOpenImage(imageId: String)
        }

        private sealed interface TapTarget {
            data class Checkbox(
                val span: CheckboxSpan,
            ) : TapTarget

            data class Image(
                val imageId: String,
            ) : TapTarget

            data class Link(
                val url: String,
            ) : TapTarget
        }

        var listener: Listener? = null

        private var styler: NoteStyler? = null
        private var images: ImageSource? = null
        private var appearance: EditorAppearance? = null
        private var availableWidth = 0
        private var restylePending = false
        private var reporting = true
        private var tapTarget: TapTarget? = null
        private var tapX = 0f
        private var tapY = 0f
        private var restyleFrame: Runnable? = null

        init {
            id = R.id.note_editor
            // The controller and the note view model's saved state own the text; restoring view
            // state would report stale text as typed.
            isSaveEnabled = false
            inputType =
                InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or
                InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or InputType.TYPE_TEXT_FLAG_AUTO_CORRECT
            gravity = Gravity.TOP or Gravity.START
            background = null
            isVerticalScrollBarEnabled = true
            contentDescription = context.getString(R.string.note_editor_label)
            addTextChangedListener(
                object : TextWatcher {
                    override fun beforeTextChanged(
                        text: CharSequence?,
                        start: Int,
                        count: Int,
                        after: Int,
                    ) = Unit

                    override fun onTextChanged(
                        text: CharSequence?,
                        start: Int,
                        before: Int,
                        count: Int,
                    ) = Unit

                    override fun afterTextChanged(text: Editable) {
                        if (reporting) listener?.onTextChanged(text.toString())
                        scheduleRestyle()
                    }
                },
            )
        }

        /** Sets how the text looks; [images] supplies the bitmaps of image references. */
        internal fun configure(
            appearance: EditorAppearance,
            images: ImageSource,
        ) {
            if (appearance == this.appearance && images === this.images) return
            this.appearance = appearance
            this.images = images
            typeface = appearance.fonts.text.regular
            setTextColor(appearance.colors.text)
            setLinkTextColor(appearance.colors.link)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, appearance.textSizeSp)
            val density = resources.displayMetrics.density
            styler =
                NoteStyler(
                    fonts = appearance.fonts,
                    colors = appearance.colors,
                    metrics =
                        EditorMetrics(
                            quoteBarWidth = (QUOTE_BAR_DP * density).roundToInt(),
                            quoteGap = (QUOTE_GAP_DP * density).roundToInt(),
                            ruleThickness = RULE_DP * density,
                            checkboxStroke = CHECKBOX_STROKE_DP * density,
                            tableCellPadding = (TABLE_PADDING_DP * density).roundToInt(),
                        ),
                    labels = ResourceLabels(),
                    images = images,
                    lineWidth = { availableWidth },
                )
            text.getSpans(0, text.length, PreviewSpan::class.java).forEach(text::removeSpan)
            restyleNow()
        }

        /** Replaces the whole text without reporting it as typed. */
        override fun setContent(
            content: String,
            selection: TextSelection,
        ) {
            withoutReporting { setText(content) }
            select(selection)
            restyleNow()
        }

        /** Applies changes made elsewhere in place, without reporting them as typed. */
        override fun applyChanges(
            changes: List<TextChange>,
            selection: TextSelection,
        ) {
            withoutReporting {
                val editable = text
                for (change in changes.asReversed()) {
                    val from = change.from.coerceIn(0, editable.length)
                    val to = change.to.coerceIn(from, editable.length)
                    editable.replace(from, to, change.insert)
                }
            }
            select(selection)
        }

        override fun focusText(selection: TextSelection) {
            requestFocus()
            select(selection)
            context.getSystemService(InputMethodManager::class.java)?.showSoftInput(this, 0)
        }

        override fun reveal(selection: TextSelection) {
            doOnLayout { bringPointIntoView(selection.start.coerceIn(0, text.length)) }
        }

        private fun run(command: EditorCommand) {
            val content = text.toString()
            val selection = currentRange()
            val edit =
                when (command) {
                    EditorCommand.Bold -> {
                        MarkdownCommands.toggleBold(content, selection)
                    }

                    EditorCommand.Italic -> {
                        MarkdownCommands.toggleItalic(content, selection)
                    }

                    EditorCommand.Strikethrough -> {
                        MarkdownCommands.toggleStrikethrough(
                            content,
                            selection,
                        )
                    }

                    EditorCommand.Link -> {
                        MarkdownCommands.insertLink(content, selection)
                    }

                    EditorCommand.Task -> {
                        MarkdownCommands.toggleTask(content, selection)
                    }
                } ?: return
            apply(edit)
        }

        /** Re-lays out the references of [imageId] once its bitmap is available. */
        fun refreshImage(imageId: String) {
            styler?.refreshImage(text, imageId)
        }

        @VisibleForTesting
        internal fun restyleNow() {
            restylePending = false
            restyleFrame?.let(::removeCallbacks)
            restyleFrame = null
            val styler = styler ?: return
            val document = MarkdownParser.parse(text.toString())
            val selections = if (hasFocus()) listOf(currentRange()) else emptyList()
            styler.restyle(
                text,
                document,
                LivePreview.render(document, selections, RenderMode.Editable),
            )
        }

        override fun onSelectionChanged(
            selStart: Int,
            selEnd: Int,
        ) {
            super.onSelectionChanged(selStart, selEnd)
            // Called from the platform constructor, before this class's fields are set.
            @Suppress("SENSELESS_COMPARISON", "UNNECESSARY_SAFE_CALL")
            if (text == null) return
            listener?.onSelectionChanged(
                TextSelection(minOf(selStart, selEnd), maxOf(selStart, selEnd)),
            )
            scheduleRestyle()
        }

        override fun onFocusChanged(
            focused: Boolean,
            direction: Int,
            previouslyFocusedRect: android.graphics.Rect?,
        ) {
            super.onFocusChanged(focused, direction, previouslyFocusedRect)
            scheduleRestyle()
        }

        override fun onMeasure(
            widthMeasureSpec: Int,
            heightMeasureSpec: Int,
        ) {
            val measured =
                MeasureSpec.getSize(widthMeasureSpec) - compoundPaddingLeft - compoundPaddingRight
            if (MeasureSpec.getMode(widthMeasureSpec) !=
                MeasureSpec.UNSPECIFIED
            ) {
                availableWidth = measured.coerceAtLeast(0)
            }
            super.onMeasure(widthMeasureSpec, heightMeasureSpec)
        }

        override fun onSizeChanged(
            width: Int,
            height: Int,
            oldWidth: Int,
            oldHeight: Int,
        ) {
            super.onSizeChanged(width, height, oldWidth, oldHeight)
            if (hasFocus() &&
                height < oldHeight
            ) {
                post { bringPointIntoView(selectionEnd.coerceAtLeast(0)) }
            }
        }

        override fun onKeyDown(
            keyCode: Int,
            event: KeyEvent,
        ): Boolean {
            val command =
                if (event.isCtrlPressed && !event.isAltPressed &&
                    !event.isMetaPressed
                ) {
                    shortcut(keyCode, event)
                } else {
                    null
                }
            if (command == null) return super.onKeyDown(keyCode, event)
            run(command)
            return true
        }

        override fun onTouchEvent(event: MotionEvent): Boolean {
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    tapTarget = targetAt(event.x, event.y)
                    tapX = event.x
                    tapY = event.y
                    if (tapTarget != null) return true
                }

                MotionEvent.ACTION_MOVE -> {
                    if (tapTarget != null) {
                        val slop = ViewConfiguration.get(context).scaledTouchSlop
                        if (abs(event.x - tapX) > slop ||
                            abs(event.y - tapY) > slop
                        ) {
                            tapTarget = null
                        }
                        return true
                    }
                }

                MotionEvent.ACTION_UP -> {
                    val target = tapTarget
                    if (target != null) {
                        tapTarget = null
                        performClick()
                        open(target)
                        return true
                    }
                }

                MotionEvent.ACTION_CANCEL -> {
                    if (tapTarget != null) {
                        tapTarget = null
                        return true
                    }
                }
            }
            return super.onTouchEvent(event)
        }

        override fun performClick(): Boolean = super.performClick()

        override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection? {
            val connection = super.onCreateInputConnection(outAttrs) ?: return null
            // From Android 12 the platform passes keyboard content to the receive-content listener.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return connection
            val mimeTypes = ViewCompat.getOnReceiveContentMimeTypes(this) ?: return connection
            EditorInfoCompat.setContentMimeTypes(outAttrs, mimeTypes)
            return InputConnectionCompat.createWrapper(this, connection, outAttrs)
        }

        override fun onTextContextMenuItem(id: Int): Boolean {
            val paste = id == android.R.id.paste || id == android.R.id.pasteAsPlainText
            if (!paste ||
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            ) {
                return super.onTextContextMenuItem(id)
            }
            val clip = context.getSystemService(ClipboardManager::class.java)?.primaryClip
            val hasImage = clip != null && clip.description.hasMimeType("image/*")
            if (!hasImage ||
                ViewCompat.getOnReceiveContentMimeTypes(this) == null
            ) {
                return super.onTextContextMenuItem(id)
            }
            val payload =
                ContentInfoCompat
                    .Builder(
                        clip,
                        ContentInfoCompat.SOURCE_CLIPBOARD,
                    ).build()
            val remaining = ViewCompat.performReceiveContent(this, payload)
            return remaining == null || super.onTextContextMenuItem(id)
        }

        private fun apply(edit: TextEdit) {
            val editable = text
            val from = edit.range.from.coerceIn(0, editable.length)
            val to = edit.range.to.coerceIn(from, editable.length)
            editable.replace(from, to, edit.replacement)
            select(TextSelection(edit.selectionAfter.from, edit.selectionAfter.to))
        }

        private fun select(selection: TextSelection) {
            val length = text.length
            setSelection(selection.start.coerceIn(0, length), selection.end.coerceIn(0, length))
        }

        private fun currentRange(): TextRange {
            val start = selectionStart.coerceAtLeast(0)
            val end = selectionEnd.coerceAtLeast(0)
            return TextRange(minOf(start, end), maxOf(start, end))
        }

        private inline fun withoutReporting(block: () -> Unit) {
            reporting = false
            try {
                block()
            } finally {
                reporting = true
            }
        }

        private fun scheduleRestyle() {
            if (restylePending) return
            restylePending = true
            val frame = Runnable { restyleNow() }
            restyleFrame = frame
            postOnAnimation(frame)
        }

        private fun shortcut(
            keyCode: Int,
            event: KeyEvent,
        ): EditorCommand? =
            when (keyCode) {
                KeyEvent.KEYCODE_B -> {
                    EditorCommand.Bold.takeIf { !event.isShiftPressed }
                }

                KeyEvent.KEYCODE_I -> {
                    EditorCommand.Italic.takeIf { !event.isShiftPressed }
                }

                KeyEvent.KEYCODE_X -> {
                    EditorCommand.Strikethrough.takeIf { event.isShiftPressed }
                }

                KeyEvent.KEYCODE_K -> {
                    EditorCommand.Link.takeIf { !event.isShiftPressed }
                }

                KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> {
                    EditorCommand.Task.takeIf {
                        !event.isShiftPressed
                    }
                }

                else -> {
                    null
                }
            }

        private fun targetAt(
            x: Float,
            y: Float,
        ): TapTarget? {
            val layout = layout ?: return null
            val contentX = x - totalPaddingLeft + scrollX
            val contentY = y - totalPaddingTop + scrollY
            if (contentY < 0 || contentY > layout.height) return null
            val line = layout.getLineForVertical(contentY.toInt())
            if (contentX < layout.getLineLeft(line) ||
                contentX > layout.getLineRight(line)
            ) {
                return null
            }
            val offset = layout.getOffsetForHorizontal(line, contentX)
            val spanned = text
            val lineStart = layout.getLineStart(line)
            val lineEnd = layout.getLineEnd(line)
            for (span in spanned.getSpans(lineStart, lineEnd, CheckboxSpan::class.java)) {
                val start = spanned.getSpanStart(span)
                val left = layout.getPrimaryHorizontal(start)
                if (contentX >= left &&
                    contentX <= left + span.width(paint)
                ) {
                    return TapTarget.Checkbox(span)
                }
            }
            spanned.getSpans(lineStart, lineEnd, ImageBlockSpan::class.java).firstOrNull()?.let {
                return TapTarget.Image(it.spec.imageId)
            }
            val document = MarkdownParser.parse(spanned.toString())
            val url = MarkdownLinks.linkUrl(document, offset) ?: return null
            if (hasFocus() &&
                caretLines(document).contains(document.lineIndexContaining(offset))
            ) {
                return null
            }
            return TapTarget.Link(url)
        }

        private fun caretLines(document: MarkdownDocument): IntRange {
            val range = currentRange()
            return document.lineIndexContaining(range.from)..document.lineIndexContaining(range.to)
        }

        private fun open(target: TapTarget) {
            when (target) {
                is TapTarget.Checkbox -> {
                    val start = text.getSpanStart(target.span)
                    val end = text.getSpanEnd(target.span)
                    if (start < 0) return
                    val edit =
                        MarkdownCommands.toggleCheckbox(
                            text.toString(),
                            TextRange(start, end),
                        )
                    val selection = currentRange()
                    text.replace(edit.range.from, edit.range.to, edit.replacement)
                    select(TextSelection(selection.from, selection.to))
                }

                is TapTarget.Image -> {
                    listener?.onOpenImage(target.imageId)
                }

                is TapTarget.Link -> {
                    listener?.onOpenLink(target.url)
                }
            }
        }

        private inner class ResourceLabels : EditorLabels {
            override fun checkbox(checked: Boolean): String =
                context.getString(
                    if (checked) R.string.editor_task_checked else R.string.editor_task_unchecked,
                )

            override fun image(alt: String): String =
                if (alt.isBlank()) {
                    context.getString(
                        R.string.editor_image,
                    )
                } else {
                    context.getString(R.string.editor_image_described, alt)
                }

            override fun table(table: RenderedTable): String {
                val cells =
                    table.rows.joinToString(
                        "; ",
                    ) { row -> row.joinToString(", ") { it.accessibleLabel } }
                val resources = context.resources
                return context.getString(
                    R.string.editor_table,
                    resources.getQuantityString(
                        R.plurals.editor_table_rows,
                        table.rowCount,
                        table.rowCount,
                    ),
                    resources.getQuantityString(
                        R.plurals.editor_table_columns,
                        table.columnCount,
                        table.columnCount,
                    ),
                    cells,
                )
            }
        }

        private companion object {
            const val QUOTE_BAR_DP = 3f
            const val QUOTE_GAP_DP = 10f
            const val RULE_DP = 1f
            const val CHECKBOX_STROKE_DP = 1.5f
            const val TABLE_PADDING_DP = 6f
        }
    }
