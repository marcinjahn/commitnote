package io.github.marcinjahn.commitnote.flows

import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import io.github.marcinjahn.commitnote.MainActivity
import io.github.marcinjahn.commitnote.core.api.FakeCoreCommands
import io.github.marcinjahn.commitnote.core.api.FakeSaveNoteParams
import io.github.marcinjahn.commitnote.core.api.OpenNote
import io.github.marcinjahn.commitnote.testing.AppComposeRule
import io.github.marcinjahn.commitnote.testing.TestApp
import io.github.marcinjahn.commitnote.testing.awaitApp
import io.github.marcinjahn.commitnote.testing.awaitEditorText
import io.github.marcinjahn.commitnote.testing.awaitNoTag
import io.github.marcinjahn.commitnote.testing.awaitTag
import io.github.marcinjahn.commitnote.testing.awaitText
import io.github.marcinjahn.commitnote.testing.core
import io.github.marcinjahn.commitnote.testing.editorText
import io.github.marcinjahn.commitnote.testing.logInToSampleTree
import io.github.marcinjahn.commitnote.testing.pressBack
import io.github.marcinjahn.commitnote.testing.session
import io.github.marcinjahn.commitnote.testing.tap
import io.github.marcinjahn.commitnote.testing.tapNth
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = TestApp::class, sdk = [Config.NEWEST_SDK], qualifiers = "w320dp-h640dp-mdpi")
class HistoryFlowTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun previewsAnOlderVersionAndRestoresIt() {
        compose.logInToSampleTree()
        compose.tap("tree-node-Welcome")
        compose.awaitEditorText("show the note") { it.isNotEmpty() }
        saveVersion(FIRST_VERSION)
        compose.awaitEditorText("show the first version") { it == FIRST_VERSION }
        saveVersion(SECOND_VERSION)
        compose.awaitEditorText("show the second version") { it == SECOND_VERSION }

        compose.tap("note-menu")
        compose.tap("note-menu-history")
        compose.awaitTag("history-list")
        compose.tapNth("history-version", 1)
        compose.awaitTag("history-diff")
        compose.tap("history-restore")

        compose.awaitText("Version restored")
        compose.awaitNoTag("history-list")
        compose.awaitTag("note-editor")
        compose.assertEditorKeepsText(FIRST_VERSION)
    }

    @Test
    fun keepsAnUpdateDeliveredWhileHistoryWasShown() {
        compose.logInToSampleTree()
        compose.tap("tree-node-Welcome")
        compose.awaitEditorText("show the note") { it.isNotEmpty() }
        compose.tap("note-menu")
        compose.tap("note-menu-history")
        compose.awaitTag("history-list")

        saveVersion(SECOND_VERSION)
        compose.pressBack()

        compose.awaitNoTag("history-list")
        compose.awaitEditorText("show the update") { it == SECOND_VERSION }
        compose.assertEditorKeepsText(SECOND_VERSION)
    }

    private fun AppComposeRule.assertEditorKeepsText(text: String) {
        awaitEditorText("show the text") { it == text }
        awaitApp("the editor to send its edits", SETTLE_MILLIS) { session.editor.isIdle }
        waitForIdle()
        assertEquals(text, editorText())
        val openNote = session.editor.state.value.openNote as OpenNote.Loaded
        assertEquals(text, openNote.content)
    }

    private fun saveVersion(text: String) {
        core { send(FakeCoreCommands.saveNote, FakeSaveNoteParams(listOf("Welcome"), text)) }
    }

    private companion object {
        const val FIRST_VERSION = "# Welcome\nThe first version"
        const val SECOND_VERSION = "# Welcome\nThe second version"
        const val SETTLE_MILLIS = 10_000L
    }
}
