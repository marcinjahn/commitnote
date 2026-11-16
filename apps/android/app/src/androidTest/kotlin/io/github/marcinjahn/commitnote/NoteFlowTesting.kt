package io.github.marcinjahn.commitnote

import android.os.SystemClock
import android.view.KeyEvent
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import io.github.marcinjahn.commitnote.editor.NoteEditText

const val FLOW_WAIT_MILLIS = 180_000L

fun ComposeTestRule.awaitTag(tag: String) =
    waitUntil(FLOW_WAIT_MILLIS) { onAllNodes(hasTestTag(tag)).fetchSemanticsNodes().isNotEmpty() }

fun ComposeTestRule.awaitNoTag(tag: String) =
    waitUntil(FLOW_WAIT_MILLIS) { onAllNodes(hasTestTag(tag)).fetchSemanticsNodes().isEmpty() }

/**
 * Invokes the node's click action instead of injecting a touch. A touch lands at the node's centre
 * and is dropped when a scroll viewport clips that point, and the viewport keeps changing while the
 * keyboard animates in or out, which Compose's idling does not wait for.
 */
fun ComposeTestRule.tap(tag: String) {
    awaitTag(tag)
    onNodeWithTag(tag).performSemanticsAction(SemanticsActions.OnClick)
}

fun ComposeTestRule.logInToSampleTree() = logInTo(SAMPLE_REPOSITORY, firstNode = "Welcome")

/** Logs in to a fake-forge [repository] and waits until its tree shows [firstNode]. */
fun ComposeTestRule.logInTo(
    repository: String,
    firstNode: String,
) {
    awaitTag("token-field")
    onNodeWithTag("token-field").performTextInput(FAKE_ACCESS_TOKEN)
    tap("continue-button")
    tap("repo-$repository")
    awaitTag("passphrase-field")
    onNodeWithTag("passphrase-field").performTextInput(SAMPLE_PASSPHRASE)
    tap("unlock-button")
    awaitTag("tree-node-$firstNode")
}

/** Runs [block] on the open note's editor view, from the main thread. */
fun <T> ActivityScenario<MainActivity>.onEditor(block: NoteEditText.() -> T): T {
    var result: Result<T>? = null
    onActivity { activity ->
        result =
            runCatching {
                checkNotNull(
                    activity.findViewById<NoteEditText>(R.id.note_editor),
                ).block()
            }
    }
    return checkNotNull(result).getOrThrow()
}

fun ComposeTestRule.awaitEditorText(
    scenario: ActivityScenario<MainActivity>,
    condition: (String) -> Boolean,
) {
    awaitTag("note-editor")
    waitUntil(FLOW_WAIT_MILLIS) { scenario.onEditor { condition(text.toString()) } }
}

const val CTRL = KeyEvent.META_CTRL_ON or KeyEvent.META_CTRL_LEFT_ON
const val SHIFT = KeyEvent.META_SHIFT_ON or KeyEvent.META_SHIFT_LEFT_ON

/** Sends a key press through the real input pipeline, with [meta] held down. */
fun pressKey(
    keyCode: Int,
    meta: Int = 0,
) {
    sendKey(KeyEvent.ACTION_DOWN, keyCode, meta)
    sendKey(KeyEvent.ACTION_UP, keyCode, meta)
}

/**
 * Presses [keyCode] [times] times while the Shift key itself is held, as a physical keyboard does.
 * Text fields extend their selection only after seeing the Shift key go down; the Shift meta state
 * on the arrow key alone just moves the caret.
 */
fun pressKeyHoldingShift(
    keyCode: Int,
    times: Int = 1,
) {
    sendKey(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_SHIFT_LEFT, SHIFT)
    repeat(times) { pressKey(keyCode, SHIFT) }
    sendKey(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_SHIFT_LEFT, 0)
}

private fun sendKey(
    action: Int,
    keyCode: Int,
    meta: Int,
) {
    val time = SystemClock.uptimeMillis()
    InstrumentationRegistry
        .getInstrumentation()
        .sendKeySync(KeyEvent(time, time, action, keyCode, 0, meta))
}
