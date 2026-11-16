package io.github.marcinjahn.commitnote.flows

import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import io.github.marcinjahn.commitnote.MainActivity
import io.github.marcinjahn.commitnote.core.api.CoreCommands
import io.github.marcinjahn.commitnote.core.api.Empty
import io.github.marcinjahn.commitnote.core.api.FakeCoreCommands
import io.github.marcinjahn.commitnote.core.api.FakeRemoteEditParams
import io.github.marcinjahn.commitnote.editor.CheckboxSpan
import io.github.marcinjahn.commitnote.testing.SAMPLE_REPOSITORY
import io.github.marcinjahn.commitnote.testing.TestApp
import io.github.marcinjahn.commitnote.testing.awaitEditorText
import io.github.marcinjahn.commitnote.testing.core
import io.github.marcinjahn.commitnote.testing.focusEditor
import io.github.marcinjahn.commitnote.testing.logInToSampleTree
import io.github.marcinjahn.commitnote.testing.onEditor
import io.github.marcinjahn.commitnote.testing.tap
import io.github.marcinjahn.commitnote.testing.tapEditorAt
import io.github.marcinjahn.commitnote.testing.typeInEditor
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = TestApp::class, sdk = [Config.NEWEST_SDK], qualifiers = "w320dp-h640dp-mdpi")
class NoteEditingFlowTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun keepsTypedTextWhenTheNoteIsOpenedAgain() {
        val original = openWelcome()

        compose.focusEditor()
        compose.typeInEditor("\nTyped on the phone")
        compose.tap("note-back")
        compose.tap("tree-node-Welcome")

        compose.awaitEditorText("show the typed line") { it == "$original\nTyped on the phone" }
    }

    @Test
    fun tappingACheckboxTogglesTheTask() {
        openWelcome()
        compose.focusEditor()
        compose.onEditor {
            text.replace(0, length(), "Shopping\n- [ ] Milk")
            setSelection(0)
        }
        val checkbox =
            compose.onEditor {
                restyleNow()
                text.getSpanStart(text.getSpans(0, length(), CheckboxSpan::class.java).single())
            }

        compose.tapEditorAt(checkbox)

        compose.awaitEditorText("check the task") { it == "Shopping\n- [x] Milk" }
    }

    @Test
    fun showsAnEditMadeOnAnotherDevice() {
        openWelcome()
        val remote = "# Remote title\nChanged on another phone"

        core {
            send(
                FakeCoreCommands.remoteEdit,
                FakeRemoteEditParams(SAMPLE_REPOSITORY, listOf("Welcome"), remote, "Other phone"),
            )
            send(CoreCommands.syncRefresh, Empty)
        }

        compose.awaitEditorText("show the remote edit") { it == remote }
    }

    private fun openWelcome(): String {
        compose.logInToSampleTree()
        compose.tap("tree-node-Welcome")
        return compose.awaitEditorText("show the note") { it.isNotEmpty() }
    }
}
