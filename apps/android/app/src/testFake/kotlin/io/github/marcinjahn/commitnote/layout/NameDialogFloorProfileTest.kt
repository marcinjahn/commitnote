package io.github.marcinjahn.commitnote.layout

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import io.github.marcinjahn.commitnote.MainActivity
import io.github.marcinjahn.commitnote.testing.TestApp
import io.github.marcinjahn.commitnote.testing.awaitTag
import io.github.marcinjahn.commitnote.testing.logInToSampleTree
import io.github.marcinjahn.commitnote.testing.longPress
import io.github.marcinjahn.commitnote.testing.tap
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

// A Compose dialog holding a text field never idles under Robolectric at widths from 360 dp up (see
// TreeActionsFlowTest), so the name dialog is proved at the 320x320 dp floor, which is both narrower
// and shorter than every reference profile.
abstract class NameDialogFloorProfileTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun theRenameDialogShowsItsConfirmButton() {
        compose.logInToSampleTree()

        compose.longPress("tree-node-Welcome")
        compose.tap("node-action-rename")

        compose.awaitTag("dialog-confirm").assertIsDisplayed()
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(application = TestApp::class, sdk = [Config.NEWEST_SDK], qualifiers = "w320dp-h320dp-mdpi")
class NameDialogFloorTest : NameDialogFloorProfileTest()

@RunWith(RobolectricTestRunner::class)
@Config(
    application = TestApp::class,
    sdk = [Config.NEWEST_SDK],
    qualifiers = "w320dp-h320dp-mdpi",
    fontScale = 1.3f,
)
class NameDialogFloorLargeFontTest : NameDialogFloorProfileTest()
