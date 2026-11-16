package io.github.marcinjahn.commitnote

import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test

class SmokeFlowTest {
    @get:Rule
    val compose = createEmptyComposeRule()

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
    fun opensEditsAndReopensANote() {
        compose.logInToSampleTree()
        compose.tap("tree-node-Welcome")
        compose.awaitEditorText(scenario) { it.isNotEmpty() }
        val original = scenario.onEditor { text.toString() }

        scenario.onEditor {
            requestFocus()
            text.append("\nTyped on the device")
        }
        compose.waitUntil(FLOW_WAIT_MILLIS) { scenario.onEditor { isFocused } }
        compose.tap("note-back")
        compose.tap("tree-node-Welcome")

        compose.awaitEditorText(scenario) { it == "$original\nTyped on the device" }
    }
}
