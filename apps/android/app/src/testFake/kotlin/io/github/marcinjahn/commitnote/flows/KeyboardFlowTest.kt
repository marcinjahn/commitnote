package io.github.marcinjahn.commitnote.flows

import android.os.SystemClock
import android.view.KeyCharacterMap
import android.view.KeyEvent
import android.view.KeyboardShortcutGroup
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.isFocused
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.requestFocus
import io.github.marcinjahn.commitnote.MainActivity
import io.github.marcinjahn.commitnote.R
import io.github.marcinjahn.commitnote.app.EditorTarget
import io.github.marcinjahn.commitnote.core.api.FakeCoreCommands
import io.github.marcinjahn.commitnote.core.api.FakeRemoteEditParams
import io.github.marcinjahn.commitnote.editor.NoteEditText
import io.github.marcinjahn.commitnote.testing.SAMPLE_REPOSITORY
import io.github.marcinjahn.commitnote.testing.TestApp
import io.github.marcinjahn.commitnote.testing.awaitApp
import io.github.marcinjahn.commitnote.testing.awaitEditorText
import io.github.marcinjahn.commitnote.testing.awaitNoTag
import io.github.marcinjahn.commitnote.testing.awaitTag
import io.github.marcinjahn.commitnote.testing.core
import io.github.marcinjahn.commitnote.testing.focusEditor
import io.github.marcinjahn.commitnote.testing.logInToSampleTree
import io.github.marcinjahn.commitnote.testing.longPress
import io.github.marcinjahn.commitnote.testing.onEditor
import io.github.marcinjahn.commitnote.testing.session
import io.github.marcinjahn.commitnote.testing.tap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowUiAutomation

private const val WAIT_MILLIS = 60_000L
private const val CTRL = KeyEvent.META_CTRL_ON or KeyEvent.META_CTRL_LEFT_ON
private const val SHIFT = KeyEvent.META_SHIFT_ON or KeyEvent.META_SHIFT_LEFT_ON

@RunWith(RobolectricTestRunner::class)
@Config(application = TestApp::class, sdk = [Config.NEWEST_SDK], qualifiers = "w320dp-h640dp-mdpi")
class KeyboardFlowTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun ctrlNStartsANoteNamedFromTheKeyboard() {
        compose.logInToSampleTree()

        compose.press(KeyEvent.KEYCODE_N, CTRL)
        compose.awaitTag("draft-name").assertIsFocused()
        compose.type("Groceries")
        compose.press(KeyEvent.KEYCODE_ENTER)
        compose.waitUntil(WAIT_MILLIS) { compose.onEditor { isFocused } }
        compose.type("Milk")

        compose.awaitApp("the draft to become the Groceries note") {
            (session.editor.state.value.target as? EditorTarget.Note)?.path == listOf("Groceries")
        }
        compose.awaitEditorText("hold the typed text") { it == "Milk" }
    }

    @Test
    fun ctrlFOpensSearch() {
        compose.logInToSampleTree()

        compose.press(KeyEvent.KEYCODE_F, CTRL)

        compose.awaitTag("search-field")
    }

    @Test
    fun ctrlRRefreshesTheTree() {
        compose.logInToSampleTree()
        core {
            send(
                FakeCoreCommands.remoteEdit,
                FakeRemoteEditParams(
                    SAMPLE_REPOSITORY,
                    listOf("Remote"),
                    "# Remote",
                    "Other phone",
                ),
            )
        }

        assertTrue(compose.press(KeyEvent.KEYCODE_R, CTRL))

        compose.awaitTag("tree-node-Remote")
    }

    @Test
    fun escapeLeavesANoteForTheTree() {
        compose.logInToSampleTree()
        compose.tap("tree-node-Welcome")
        compose.awaitTag("note-editor")

        compose.press(KeyEvent.KEYCODE_ESCAPE)

        compose.awaitNoTag("note-editor")
        compose.awaitTag("tree-list")
    }

    @Test
    fun escapeAtTheTreeKeepsTheAppOpen() {
        compose.logInToSampleTree()

        assertTrue(compose.press(KeyEvent.KEYCODE_ESCAPE))

        assertFalse(compose.activity.isFinishing)
        compose.awaitTag("tree-list")
    }

    // The rename dialog never idles under Robolectric at widths of 360dp and more.
    @Test
    @Config(qualifiers = "w320dp-h320dp-mdpi")
    fun escapeClosesTheRenameDialog() {
        compose.logInToSampleTree()
        compose.longPress("tree-node-Welcome")
        compose.tap("node-action-rename")
        compose.awaitTag("name-field")

        compose.press(KeyEvent.KEYCODE_ESCAPE)

        compose.awaitNoTag("name-field")
        compose.awaitTag("tree-list")
    }

    @Test
    fun escapeClosesTheRowMenu() {
        compose.logInToSampleTree()
        compose.longPress("tree-node-Welcome")
        compose.awaitTag("node-action-rename")

        compose.press(KeyEvent.KEYCODE_ESCAPE)

        compose.awaitNoTag("node-action-rename")
        compose.awaitTag("tree-list")
    }

    @Test
    fun tabReachesTheFirstTreeRow() {
        compose.logInToSampleTree()

        assertEquals(FIRST_ROW, compose.focusTreeRowWith(KeyEvent.KEYCODE_TAB))
    }

    @Test
    fun downReachesTheFirstTreeRow() {
        compose.logInToSampleTree()

        assertEquals(FIRST_ROW, compose.focusTreeRowWith(KeyEvent.KEYCODE_DPAD_DOWN))
    }

    @Test
    fun enterOpensTheFocusedNoteRow() {
        compose.logInToSampleTree()
        compose.focusTreeRowWith(KeyEvent.KEYCODE_DPAD_DOWN, row = "tree-node-Welcome")

        compose.press(KeyEvent.KEYCODE_ENTER)

        compose.awaitEditorText("show the opened note") { it.isNotEmpty() }
        assertEquals(listOf("Welcome"), session.editor.state.value.target.notePath)
    }

    @Test
    fun shiftF10OpensTheRowMenu() {
        compose.logInToSampleTree()
        compose.focusTreeRowWith(KeyEvent.KEYCODE_DPAD_DOWN)

        compose.press(KeyEvent.KEYCODE_F10, SHIFT)

        compose.awaitTag("node-action-rename")
    }

    @Test
    fun theMenuKeyOpensTheRowMenu() {
        compose.logInToSampleTree()
        compose.focusTreeRowWith(KeyEvent.KEYCODE_DPAD_DOWN)

        compose.press(KeyEvent.KEYCODE_MENU)

        compose.awaitTag("node-action-rename")
    }

    @Test
    fun theShortcutsHelperListsEveryShortcut() {
        val groups = mutableListOf<KeyboardShortcutGroup>()

        compose.runOnUiThread { compose.activity.onProvideKeyboardShortcuts(groups, null, -1) }

        val context = compose.activity
        assertEquals(
            listOf(
                context.getString(R.string.keyboard_shortcuts_app),
                context.getString(R.string.keyboard_shortcuts_editor),
            ),
            groups.map { it.label.toString() },
        )
        assertEquals(
            listOf(
                listOf(
                    KeyEvent.KEYCODE_N to CTRL_ONLY,
                    KeyEvent.KEYCODE_F to CTRL_ONLY,
                    KeyEvent.KEYCODE_R to CTRL_ONLY,
                    KeyEvent.KEYCODE_ESCAPE to 0,
                ),
                listOf(
                    KeyEvent.KEYCODE_B to CTRL_ONLY,
                    KeyEvent.KEYCODE_I to CTRL_ONLY,
                    KeyEvent.KEYCODE_X to (CTRL_ONLY or KeyEvent.META_SHIFT_ON),
                    KeyEvent.KEYCODE_K to CTRL_ONLY,
                    KeyEvent.KEYCODE_ENTER to CTRL_ONLY,
                ),
            ),
            groups.map { group -> group.items.map { it.keycode to it.modifiers } },
        )
    }

    @Test
    fun keysAloneTypeAndFormatInTheEditor() {
        compose.logInToSampleTree()
        compose.tap("tree-node-Welcome")
        compose.awaitEditorText("show the note") { it.isNotEmpty() }
        compose.focusEditor()
        compose.onEditor { text.clear() }

        compose.type("word")
        compose.awaitEditorText("hold the typed word") { it == "word" }

        listOf(
            Triple(KeyEvent.KEYCODE_B, CTRL, "**word**"),
            Triple(KeyEvent.KEYCODE_I, CTRL, "*word*"),
            Triple(KeyEvent.KEYCODE_X, CTRL or SHIFT, "~~word~~"),
            Triple(KeyEvent.KEYCODE_K, CTRL, "[word]()"),
        ).forEach { (key, meta, formatted) ->
            compose.onEditor {
                text.replace(0, length(), "word")
                setSelection(0, length())
            }
            compose.press(key, meta)
            compose.awaitEditorText("format the selection as $formatted") { it == formatted }
        }
        compose.onEditor {
            text.replace(0, length(), "word")
            setSelection(length())
        }
        compose.press(KeyEvent.KEYCODE_ENTER, CTRL)
        compose.awaitEditorText("turn the line into a task") { it == "- [ ] word" }
    }

    @Test
    fun keysAloneOpenThePhotoPicker() {
        compose.logInToSampleTree()
        compose.tap("tree-node-Welcome")
        compose.awaitEditorText("show the note") { it.isNotEmpty() }

        compose.awaitTag("insert-image").requestFocus().assertIsFocused()
        compose.press(KeyEvent.KEYCODE_ENTER)
        compose.awaitTag("insert-photo-library")
        compose.press(KeyEvent.KEYCODE_DPAD_DOWN)
        compose.onNodeWithTagFocused("insert-photo-library")
        compose.press(KeyEvent.KEYCODE_ENTER)

        val expected =
            ActivityResultContracts.PickVisualMedia().createIntent(
                compose.activity,
                PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
            )
        val started = shadowOf(compose.activity).nextStartedActivityForResult
        assertEquals(expected.action, started.intent.action)
    }

    private companion object {
        const val CTRL_ONLY = KeyEvent.META_CTRL_ON
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(
    application = TestApp::class,
    sdk = [Config.NEWEST_SDK],
    qualifiers = "w320dp-h640dp-mdpi-keysexposed-qwerty",
)
class KeyboardConfigChangeFlowTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    @Test
    fun hidingTheKeyboardKeepsTheActivityAndTheEditor() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        compose.logInToSampleTree()
        compose.tap("tree-node-Welcome")
        compose.awaitTag("note-editor")
        compose.awaitApp("the note to load into the editor") {
            controller
                .get()
                .editor()
                ?.text
                ?.isNotEmpty() == true
        }
        val activity = controller.get()
        activity.editor()!!.apply {
            requestFocus()
            append("\nkept across the change")
        }
        compose.waitForIdle()
        val text = activity.editor()!!.text.toString()

        RuntimeEnvironment.setQualifiers("+keyshidden")
        controller.configurationChange(RuntimeEnvironment.getApplication().resources.configuration)
        compose.waitForIdle()

        assertSame(activity, controller.get())
        val editor = checkNotNull(controller.get().editor())
        assertEquals(text, editor.text.toString())
        assertTrue(editor.isFocused)
    }

    private fun MainActivity.editor(): NoteEditText? = findViewById(R.id.note_editor)
}

/**
 * Sends a key press to the window holding the input focus, dialogs and popups included, and
 * tells whether the press went handled.
 */
private fun ComposeTestRule.press(
    keyCode: Int,
    metaState: Int = 0,
): Boolean {
    val time = SystemClock.uptimeMillis()
    val handled = inject(KeyEvent(time, time, KeyEvent.ACTION_DOWN, keyCode, 0, metaState))
    inject(KeyEvent(time, time, KeyEvent.ACTION_UP, keyCode, 0, metaState))
    waitForIdle()
    return handled
}

private fun ComposeTestRule.type(text: String) {
    val events =
        checkNotNull(
            KeyCharacterMap.load(KeyCharacterMap.VIRTUAL_KEYBOARD).getEvents(text.toCharArray()),
        )
    events.forEach(::inject)
    waitForIdle()
}

private fun inject(event: KeyEvent): Boolean = ShadowUiAutomation.injectInputEvent(event)

private val treeRowTag = SemanticsProperties.TestTag

private fun ComposeTestRule.focusedTreeRow(): String? =
    onAllNodes(isFocused())
        .fetchSemanticsNodes()
        .mapNotNull { it.config.getOrNull(treeRowTag) }
        .firstOrNull { it.startsWith("tree-node-") }

/** Presses [keyCode] until a tree row, or the given [row], takes the focus, and returns that row's tag. */
private fun ComposeTestRule.focusTreeRowWith(
    keyCode: Int,
    row: String? = null,
): String {
    repeat(MAX_FOCUS_MOVES) {
        focusedTreeRow()?.takeIf { row == null || it == row }?.let { focused ->
            onAllNodes(SemanticsMatcher.expectValue(treeRowTag, focused))[0].assertIsFocused()
            return focused
        }
        press(keyCode)
    }
    throw AssertionError(
        "${row ?: "No tree row"} did not take the focus after $MAX_FOCUS_MOVES presses",
    )
}

private fun ComposeTestRule.onNodeWithTagFocused(tag: String) = awaitTag(tag).assertIsFocused()

private const val MAX_FOCUS_MOVES = 8
private const val FIRST_ROW = "tree-node-Empty folder"
