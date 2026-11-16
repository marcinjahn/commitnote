package io.github.marcinjahn.commitnote.flows

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import io.github.marcinjahn.commitnote.MainActivity
import io.github.marcinjahn.commitnote.testing.TestApp
import io.github.marcinjahn.commitnote.testing.awaitNoTag
import io.github.marcinjahn.commitnote.testing.awaitTag
import io.github.marcinjahn.commitnote.testing.logInToSampleTree
import io.github.marcinjahn.commitnote.testing.longPress
import io.github.marcinjahn.commitnote.testing.tap
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
// On wider screens a Compose dialog holding a text field never idles under Robolectric (an endless
// remeasure of the platform-default-width dialog window); a compact phone width keeps it stable.
@Config(application = TestApp::class, sdk = [Config.NEWEST_SDK], qualifiers = "w320dp-h640dp-mdpi")
class TreeActionsFlowTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun createsRenamesMovesTagsFiltersAndTrashes() {
        compose.logInToSampleTree()

        compose.tap("new-menu")
        compose.tap("new-folder")
        compose.awaitTag("name-field").performTextInput("Inbox")
        compose.tap("dialog-confirm")
        compose.awaitTag("tree-node-Inbox")

        compose.longPress("tree-node-Inbox")
        compose.tap("node-action-rename")
        compose.awaitTag("name-field").performTextReplacement("Archive")
        compose.tap("dialog-confirm")
        compose.awaitTag("tree-node-Archive")
        compose.awaitNoTag("tree-node-Inbox")

        compose.longPress("tree-node-Welcome")
        compose.tap("node-action-moveto")
        compose.tap("move-target-Archive")
        compose.awaitNoTag("tree-node-Welcome")
        compose.tap("tree-node-Archive")
        compose.awaitTag("tree-node-Welcome")

        compose.longPress("tree-node-Welcome")
        compose.tap("node-action-colortag")
        compose.tap("color-tag-red")
        compose.tap("tag-filter-red")
        compose.awaitNoTag("tree-node-Journal")
        compose.awaitTag("tree-node-Welcome").assertIsDisplayed()
        compose.tap("tag-filter-red")
        compose.awaitTag("tree-node-Journal")

        compose.longPress("tree-node-Welcome")
        compose.tap("node-action-trash")
        compose.tap("trash-confirm")
        compose.awaitTag("notice").assertIsDisplayed()
        compose.awaitNoTag("tree-node-Welcome")
    }
}
