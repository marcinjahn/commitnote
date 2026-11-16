package io.github.marcinjahn.commitnote.testing

import android.os.SystemClock
import android.view.MotionEvent
import androidx.compose.ui.test.ComposeTimeoutException
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import io.github.marcinjahn.commitnote.MainActivity
import io.github.marcinjahn.commitnote.R
import io.github.marcinjahn.commitnote.editor.NoteEditText

private const val EDITOR_WAIT_MILLIS = 60_000L

typealias AppComposeRule = AndroidComposeTestRule<*, MainActivity>

fun AppComposeRule.noteEditor(): NoteEditText {
    awaitTag("note-editor")
    return runOnIdle { checkNotNull(activity.findViewById<NoteEditText>(R.id.note_editor)) }
}

fun AppComposeRule.editorText(): String = runOnIdle { noteEditorNow().text.toString() }

fun AppComposeRule.awaitEditorText(
    expectation: String,
    condition: (String) -> Boolean,
): String {
    awaitTag("note-editor")
    try {
        waitUntil(EDITOR_WAIT_MILLIS) {
            runOnIdle { noteEditorNow().text.toString().let(condition) }
        }
    } catch (timeout: ComposeTimeoutException) {
        throw AssertionError(
            "Timed out waiting for the editor text to $expectation; it is ${editorText().length} characters long",
            timeout,
        )
    }
    return editorText()
}

/** Runs [block] on the editor view from the main thread, as typing or a tap would. */
fun <T> AppComposeRule.onEditor(block: NoteEditText.() -> T): T {
    noteEditor()
    var result: Result<T>? = null
    runOnUiThread { result = runCatching { noteEditorNow().block() } }
    waitForIdle()
    return checkNotNull(result).getOrThrow()
}

/** Focuses the editor and puts the caret at the end of its text. */
fun AppComposeRule.focusEditor() =
    onEditor {
        requestFocus()
        setSelection(length())
    }

/** Types [typed] at the caret. */
fun AppComposeRule.typeInEditor(typed: String) =
    onEditor {
        val start = selectionStart.coerceAtLeast(0)
        val end = selectionEnd.coerceAtLeast(0)
        text.replace(minOf(start, end), maxOf(start, end), typed)
    }

/** Taps the editor at the start of the character at [offset]. */
fun AppComposeRule.tapEditorAt(offset: Int) =
    onEditor {
        restyleNow()
        val layout = checkNotNull(layout)
        val line = layout.getLineForOffset(offset)
        val x = totalPaddingLeft - scrollX + layout.getPrimaryHorizontal(offset) + 1f
        val y =
            totalPaddingTop - scrollY + (layout.getLineTop(line) + layout.getLineBottom(line)) / 2f
        val time = SystemClock.uptimeMillis()
        for (action in listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP)) {
            val event = MotionEvent.obtain(time, time, action, x, y, 0)
            dispatchTouchEvent(event)
            event.recycle()
        }
    }

private fun AppComposeRule.noteEditorNow(): NoteEditText =
    checkNotNull(activity.findViewById(R.id.note_editor))
