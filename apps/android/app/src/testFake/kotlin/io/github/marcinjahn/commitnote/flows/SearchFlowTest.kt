package io.github.marcinjahn.commitnote.flows

import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.performTextInput
import io.github.marcinjahn.commitnote.MainActivity
import io.github.marcinjahn.commitnote.core.api.FakeCoreCommands
import io.github.marcinjahn.commitnote.core.api.FakeSaveNoteParams
import io.github.marcinjahn.commitnote.testing.TestApp
import io.github.marcinjahn.commitnote.testing.awaitEditorText
import io.github.marcinjahn.commitnote.testing.awaitTag
import io.github.marcinjahn.commitnote.testing.core
import io.github.marcinjahn.commitnote.testing.logInToSampleTree
import io.github.marcinjahn.commitnote.testing.onEditor
import io.github.marcinjahn.commitnote.testing.openFromMainMenu
import io.github.marcinjahn.commitnote.testing.tap
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = TestApp::class, sdk = [Config.NEWEST_SDK], qualifiers = "w320dp-h640dp-mdpi")
class SearchFlowTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun findsTextInANoteAndOpensItAtTheMatch() {
        compose.logInToSampleTree()
        val text = "# Welcome\nStripes of the quokka"
        core { send(FakeCoreCommands.saveNote, FakeSaveNoteParams(listOf("Welcome"), text)) }

        compose.openFromMainMenu("menu-search")
        compose.awaitTag("search-field").performTextInput("quokka")
        compose.tap("search-content-row")

        compose.awaitEditorText("show the found note") { it == text }
        val match = text.indexOf("quokka")
        compose.awaitEditorText("select the match") { compose.onEditor { selectionStart } == match }
        assertEquals(match, compose.onEditor { selectionStart })
    }
}
