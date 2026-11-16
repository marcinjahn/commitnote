package io.github.marcinjahn.commitnote.layout

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToIndex
import io.github.marcinjahn.commitnote.MainActivity
import io.github.marcinjahn.commitnote.core.api.CoreCommands
import io.github.marcinjahn.commitnote.core.api.Empty
import io.github.marcinjahn.commitnote.core.api.FakeCoreCommands
import io.github.marcinjahn.commitnote.core.api.FakeRemoteEditParams
import io.github.marcinjahn.commitnote.core.api.FakeSaveNoteParams
import io.github.marcinjahn.commitnote.testing.SAMPLE_REPOSITORY
import io.github.marcinjahn.commitnote.testing.awaitEditorText
import io.github.marcinjahn.commitnote.testing.awaitNoTag
import io.github.marcinjahn.commitnote.testing.awaitTag
import io.github.marcinjahn.commitnote.testing.core
import io.github.marcinjahn.commitnote.testing.focusEditor
import io.github.marcinjahn.commitnote.testing.logInToSampleTree
import io.github.marcinjahn.commitnote.testing.longPress
import io.github.marcinjahn.commitnote.testing.openFromMainMenu
import io.github.marcinjahn.commitnote.testing.tap
import io.github.marcinjahn.commitnote.testing.tapNth
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/** Checks that primary controls stay reachable in a window profile; subclasses pick the profile. */
abstract class ScreenProfileTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun theLoginButtonIsReachable() {
        compose
            .awaitTag("continue-button")
            .performScrollTo()
            .assertIsDisplayed()
    }

    @Test
    fun theLastTreeRowClearsTheNewButton() {
        compose.logInToSampleTree()
        val initialRows = compose.treeRowCount()
        core {
            repeat(EXTRA_NOTES) {
                val name = "Extra ${it + 1}"
                val params =
                    FakeRemoteEditParams(SAMPLE_REPOSITORY, listOf(name), "# $name", "Other phone")
                send(FakeCoreCommands.remoteEdit, params)
            }
            send(CoreCommands.syncRefresh, Empty)
        }
        compose.waitUntil { compose.treeRowCount() >= initialRows + EXTRA_NOTES }

        compose.onNodeWithTag("new-menu").assertIsDisplayed()
        val list = compose.onNodeWithTag("tree-list")
        list.performScrollToIndex(compose.treeRowCount() - 1)
        compose.waitForIdle()

        val lastRowBottom =
            compose
                .onAllNodes(isTreeRow)
                .fetchSemanticsNodes()
                .maxOf { it.boundsInRoot.bottom }
        val buttonTop =
            compose
                .onNodeWithTag("new-menu")
                .fetchSemanticsNode()
                .boundsInRoot.top
        assertTrue(
            "the last row ends at $lastRowBottom, below the new button at $buttonTop",
            lastRowBottom <= buttonTop,
        )
    }

    @Test
    fun theEditorKeepsMostOfTheWindowWhileTyping() {
        compose.logInToSampleTree()
        compose.tap("tree-node-Welcome")
        compose.awaitEditorText("show the note") { it.isNotEmpty() }
        compose.awaitTag("word-count")

        compose.focusEditor()

        compose.awaitNoTag("word-count")
        val editorHeight =
            compose
                .onNodeWithTag("note-editor")
                .fetchSemanticsNode()
                .boundsInRoot.height
        val rootHeight =
            compose
                .onRoot()
                .fetchSemanticsNode()
                .boundsInRoot.height
        assertTrue(
            "the editor is $editorHeight px high in a $rootHeight px window",
            editorHeight >= rootHeight / 2,
        )
    }

    @Test
    fun theSearchFieldIsDisplayed() {
        compose.logInToSampleTree()
        compose.openFromMainMenu("menu-search")

        compose.awaitTag("search-field").assertIsDisplayed()
    }

    @Test
    fun theLastSettingCanBeScrolledIntoView() {
        compose.logInToSampleTree()
        compose.openFromMainMenu("menu-settings")

        compose.awaitTag("settings-about").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun theRestoreButtonIsDisplayedInAVersionPreview() {
        compose.logInToSampleTree()
        compose.tap("tree-node-Welcome")
        compose.awaitEditorText("show the note") { it.isNotEmpty() }
        saveNote("Welcome", "# Welcome\nThe first version")
        saveNote("Welcome", "# Welcome\nThe second version")
        compose.awaitEditorText("show the second version") { it.endsWith("The second version") }

        compose.tap("note-menu")
        compose.tap("note-menu-history")
        compose.awaitTag("history-list")
        compose.tapNth("history-version", 1)
        compose.awaitTag("history-diff")

        compose.awaitTag("history-restore").assertIsDisplayed()
    }

    @Test
    fun theShareActionCanBeScrolledIntoView() {
        compose.logInToSampleTree()
        compose.tap("tree-node-Welcome")
        compose.tap("note-menu")
        compose.tap("note-menu-share")

        compose.awaitTag("share-create").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun theTrashDialogShowsItsConfirmButton() {
        compose.logInToSampleTree()

        compose.longPress("tree-node-Welcome")
        compose.tap("node-action-trash")
        compose.awaitTag("trash-confirm").assertIsDisplayed()
    }

    private fun ComposeTestRule.treeRowCount(): Int =
        onNodeWithTag(
            "tree-list",
        ).fetchSemanticsNode().config[SemanticsProperties.CollectionInfo].rowCount

    private fun saveNote(
        name: String,
        text: String = "# $name",
    ) {
        core { send(FakeCoreCommands.saveNote, FakeSaveNoteParams(listOf(name), text)) }
    }

    private companion object {
        const val EXTRA_NOTES = 12

        val isTreeRow =
            SemanticsMatcher("is a tree row") {
                it.config.getOrNull(SemanticsProperties.TestTag)?.startsWith("tree-node-") == true
            }
    }
}
