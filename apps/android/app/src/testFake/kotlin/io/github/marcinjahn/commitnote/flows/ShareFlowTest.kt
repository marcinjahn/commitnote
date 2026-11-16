package io.github.marcinjahn.commitnote.flows

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.performTextInput
import io.github.marcinjahn.commitnote.MainActivity
import io.github.marcinjahn.commitnote.testing.TestApp
import io.github.marcinjahn.commitnote.testing.awaitNoTag
import io.github.marcinjahn.commitnote.testing.awaitTag
import io.github.marcinjahn.commitnote.testing.logInToSampleTree
import io.github.marcinjahn.commitnote.testing.openFromMainMenu
import io.github.marcinjahn.commitnote.testing.pressBack
import io.github.marcinjahn.commitnote.testing.tap
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = TestApp::class, sdk = [Config.NEWEST_SDK], qualifiers = "w320dp-h640dp-mdpi")
class ShareFlowTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun sharesANoteWithAPasswordAndRevokesTheLink() {
        compose.logInToSampleTree()
        compose.tap("tree-node-Welcome")
        compose.tap("note-menu")
        compose.tap("note-menu-share")

        compose.awaitTag("share-password").performTextInput("correct horse")
        compose.tap("share-create")
        compose.awaitTag("share-link-text").assertIsDisplayed()
        compose.awaitTag("share-password-copy")
        compose.awaitTag("sheet-share")

        compose.pressBack()
        compose.awaitNoTag("share-sheet")
        compose.pressBack()
        compose.openFromMainMenu("menu-shared-links")
        compose.awaitTag("shared-link").assertIsDisplayed()

        compose.tap("share-row-menu")
        compose.tap("share-action-revoke")
        compose.tap("share-revoke-confirm")
        compose.awaitTag("shared-links-empty")
    }
}
