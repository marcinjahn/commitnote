package io.github.marcinjahn.commitnote

import android.content.res.Configuration
import android.os.SystemClock
import android.view.KeyEvent
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.isDisplayed
import androidx.compose.ui.test.isFocused
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import io.github.marcinjahn.commitnote.editor.NoteEditText
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain

class ClicksKeyboardTest {
    private val compose = createEmptyComposeRule()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(ClicksDisplayRule()).around(compose)

    private lateinit var scenario: ActivityScenario<MainActivity>

    @Before
    fun setUp() {
        clearAppState()
        scenario = ActivityScenario.launch(MainActivity::class.java)
    }

    @After
    fun tearDown() {
        scenario.close()
        clearAppState()
    }

    @Test
    fun createsNamesWritesAndFormatsANoteWithKeysOnly() {
        val name = "Keys${SystemClock.uptimeMillis()}"
        var configuration: Configuration? = null
        scenario.onActivity { configuration = Configuration(it.resources.configuration) }
        assertTrue(checkNotNull(configuration).screenHeightDp < 480)
        assertTrue(checkNotNull(configuration).screenWidthDp in 400..420)
        compose.logInToSampleTree()

        pressKey(KeyEvent.KEYCODE_N, CTRL)
        compose.awaitFocused("draft-name")
        sendText(name)
        pressKey(KeyEvent.KEYCODE_ENTER)
        compose.awaitTag("note-editor")
        compose.waitUntil(FLOW_WAIT_MILLIS) { scenario.onEditor { isFocused } }

        sendText("Typed with keys")
        compose.awaitEditorText(scenario) { it.endsWith("Typed with keys") }
        pressKeyHoldingShift(KeyEvent.KEYCODE_DPAD_LEFT, times = "keys".length)
        compose.waitUntil(FLOW_WAIT_MILLIS) { scenario.onEditor { selectedText() == "keys" } }
        pressKey(KeyEvent.KEYCODE_B, CTRL)

        compose.awaitEditorText(scenario) { it.endsWith("Typed with **keys**") }
        assertTrue(compose.onNodeWithTag("insert-image").isDisplayed())

        pressKey(KeyEvent.KEYCODE_ESCAPE)

        compose.awaitTag("tree-node-$name")
        scenario.onActivity { assertFalse(it.isFinishing) }
    }

    private fun ComposeTestRule.awaitFocused(tag: String) =
        waitUntil(FLOW_WAIT_MILLIS) {
            onAllNodes(hasTestTag(tag) and isFocused()).fetchSemanticsNodes().isNotEmpty()
        }

    private fun sendText(text: String) =
        InstrumentationRegistry.getInstrumentation().sendStringSync(text)

    /** The selected text; Shift+Left keeps the selection's start, its anchor, after its end. */
    private fun NoteEditText.selectedText(): String =
        text.substring(minOf(selectionStart, selectionEnd), maxOf(selectionStart, selectionEnd))
}
