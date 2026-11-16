package io.github.marcinjahn.commitnote

import androidx.activity.BackEventCompat
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test

class PredictiveBackTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private lateinit var scenario: ActivityScenario<MainActivity>

    @Before
    fun setUp() {
        clearAppState()
        scenario = ActivityScenario.launch(MainActivity::class.java)
        compose.logInToSampleTree()
        compose.tap("tree-node-Welcome")
        compose.awaitTag("note-editor")
    }

    @After
    fun tearDown() {
        scenario.close()
        clearAppState()
    }

    @Test
    fun aCompletedBackGestureReturnsToTheTree() {
        scenario.onActivity { activity ->
            val dispatcher = activity.onBackPressedDispatcher
            dispatcher.dispatchOnBackStarted(backEvent(0.1f))
            dispatcher.dispatchOnBackProgressed(backEvent(0.6f))
            dispatcher.onBackPressed()
        }

        compose.awaitNoTag("note-editor")
        compose.awaitTag("tree-node-Welcome")
    }

    @Test
    fun aCancelledBackGestureKeepsTheNoteOpen() {
        scenario.onActivity { activity ->
            val dispatcher = activity.onBackPressedDispatcher
            dispatcher.dispatchOnBackStarted(backEvent(0.1f))
            dispatcher.dispatchOnBackProgressed(backEvent(0.4f))
            dispatcher.dispatchOnBackCancelled()
        }

        compose.waitForIdle()
        compose.awaitTag("note-editor")
    }

    private fun backEvent(progress: Float) =
        BackEventCompat(
            touchX = 0f,
            touchY = 400f,
            progress = progress,
            swipeEdge = BackEventCompat.EDGE_LEFT,
        )
}
