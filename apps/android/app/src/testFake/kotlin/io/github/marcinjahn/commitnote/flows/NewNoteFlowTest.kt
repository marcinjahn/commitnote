package io.github.marcinjahn.commitnote.flows

import android.view.KeyEvent
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performTextInput
import io.github.marcinjahn.commitnote.MainActivity
import io.github.marcinjahn.commitnote.app.EditorTarget
import io.github.marcinjahn.commitnote.testing.TestApp
import io.github.marcinjahn.commitnote.testing.awaitApp
import io.github.marcinjahn.commitnote.testing.awaitEditorText
import io.github.marcinjahn.commitnote.testing.awaitTag
import io.github.marcinjahn.commitnote.testing.logInToSampleTree
import io.github.marcinjahn.commitnote.testing.session
import io.github.marcinjahn.commitnote.testing.tap
import io.github.marcinjahn.commitnote.testing.typeInEditor
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = TestApp::class, sdk = [Config.NEWEST_SDK], qualifiers = "w320dp-h640dp-mdpi")
class NewNoteFlowTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun aNamedDraftBecomesANoteInTheTree() {
        compose.logInToSampleTree()
        compose.tap("new-menu")
        compose.tap("new-note")

        compose.awaitTag("draft-name").performTextInput("Groceries")
        compose.awaitTag("draft-name").performImeAction()
        compose.typeInEditor("Milk and eggs")
        compose.awaitApp("the draft to become a note") {
            session.editor.state.value.target is EditorTarget.Note
        }
        compose.tap("note-back")

        compose.awaitTag("tree-node-Groceries")
    }

    @Test
    fun typingOnAHardwareKeyboardInTheTreeStartsANote() {
        compose.logInToSampleTree()

        compose.runOnUiThread {
            compose.activity.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_H))
            compose.activity.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_H))
        }

        compose.awaitTag("draft-name")
        compose.awaitEditorText("start with the typed letter") { it == "h" }
    }
}
