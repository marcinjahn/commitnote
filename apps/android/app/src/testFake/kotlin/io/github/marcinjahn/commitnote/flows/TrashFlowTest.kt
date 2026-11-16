package io.github.marcinjahn.commitnote.flows

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import io.github.marcinjahn.commitnote.MainActivity
import io.github.marcinjahn.commitnote.testing.TestApp
import io.github.marcinjahn.commitnote.testing.awaitNoTag
import io.github.marcinjahn.commitnote.testing.awaitTag
import io.github.marcinjahn.commitnote.testing.logInToSampleTree
import io.github.marcinjahn.commitnote.testing.longPress
import io.github.marcinjahn.commitnote.testing.openFromMainMenu
import io.github.marcinjahn.commitnote.testing.pressBack
import io.github.marcinjahn.commitnote.testing.tap
import io.github.marcinjahn.commitnote.testing.tapFirst
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = TestApp::class, sdk = [Config.NEWEST_SDK], qualifiers = "w320dp-h640dp-mdpi")
class TrashFlowTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun restoresATrashedNoteAndEmptiesTheTrash() {
        compose.logInToSampleTree()
        trash("Welcome")

        compose.openFromMainMenu("menu-trash")
        compose.awaitTag("trash-retention").assertIsDisplayed()
        compose.tap("trash-entry-menu")
        compose.tap("trash-restore")
        compose.tapFirst("trash-target")
        compose.awaitNoTag("trash-entry")
        compose.pressBack()
        compose.awaitTag("tree-node-Welcome")

        trash("Welcome")
        compose.openFromMainMenu("menu-trash")
        compose.awaitTag("trash-entry")
        compose.tap("trash-empty")
        compose.tap("trash-empty-confirm")
        compose.awaitNoTag("trash-entry")
        compose.awaitTag("trash-placeholder")
    }

    private fun trash(note: String) {
        compose.longPress("tree-node-$note")
        compose.tap("node-action-trash")
        compose.tap("trash-confirm")
        compose.awaitNoTag("tree-node-$note")
    }
}
