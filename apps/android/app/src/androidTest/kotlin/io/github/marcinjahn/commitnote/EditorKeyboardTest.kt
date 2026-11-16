package io.github.marcinjahn.commitnote

import android.view.KeyEvent
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test

class EditorKeyboardTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private lateinit var scenario: ActivityScenario<MainActivity>

    @Before
    fun setUp() {
        clearAppState()
        scenario = ActivityScenario.launch(MainActivity::class.java)
        compose.logInToSampleTree()
        compose.tap("tree-node-Welcome")
        compose.awaitEditorText(scenario) { it.isNotEmpty() }
        scenario.onEditor {
            requestFocus()
            text.append("\nshortcut target")
            setSelection(length() - "target".length, length())
        }
        compose.waitUntil(FLOW_WAIT_MILLIS) { scenario.onEditor { isFocused } }
    }

    @After
    fun tearDown() {
        scenario.close()
        clearAppState()
    }

    @Test
    fun ctrlBMakesTheSelectionBold() {
        pressKey(KeyEvent.KEYCODE_B, CTRL)

        compose.awaitEditorText(scenario) { it.endsWith("\nshortcut **target**") }
    }

    @Test
    fun ctrlShiftXStrikesTheSelectionThrough() {
        pressKey(KeyEvent.KEYCODE_X, CTRL or SHIFT)

        compose.awaitEditorText(scenario) { it.endsWith("\nshortcut ~~target~~") }
    }
}
