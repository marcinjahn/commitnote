package io.github.marcinjahn.commitnote.layout

import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.isDisplayed
import io.github.marcinjahn.commitnote.testing.TestApp
import io.github.marcinjahn.commitnote.testing.awaitEditorText
import io.github.marcinjahn.commitnote.testing.awaitTag
import io.github.marcinjahn.commitnote.testing.logInToSampleTree
import io.github.marcinjahn.commitnote.testing.tap
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(
    application = TestApp::class,
    sdk = [Config.NEWEST_SDK],
    qualifiers = "w411dp-h457dp-420dpi-keysexposed-qwerty",
)
class ClicksProfileTest : ScreenProfileTest()

@RunWith(RobolectricTestRunner::class)
@Config(
    application = TestApp::class,
    sdk = [Config.NEWEST_SDK],
    qualifiers = "w411dp-h457dp-420dpi-keysexposed-qwerty",
    fontScale = 1.3f,
)
class ClicksLargeFontProfileTest : ScreenProfileTest()

@RunWith(RobolectricTestRunner::class)
@Config(application = TestApp::class, sdk = [Config.NEWEST_SDK], qualifiers = "w360dp-h374dp")
class FoldableCoverProfileTest : ScreenProfileTest()

@RunWith(RobolectricTestRunner::class)
@Config(application = TestApp::class, sdk = [Config.NEWEST_SDK], qualifiers = "w360dp-h320dp")
class SplitScreenProfileTest : ScreenProfileTest()

@RunWith(RobolectricTestRunner::class)
@Config(application = TestApp::class, sdk = [Config.NEWEST_SDK], qualifiers = "w640dp-h320dp")
class LandscapePhoneProfileTest : ScreenProfileTest() {
    @Test
    fun anOpenNoteHidesTheTree() {
        compose.logInToSampleTree()
        compose.tap("tree-node-Welcome")
        compose.awaitEditorText("show the note") { it.isNotEmpty() }
        compose.awaitTag("note-editor")

        val trees = compose.onAllNodes(hasTestTag("tree-list"))
        val treeCount = trees.fetchSemanticsNodes().size
        assertTrue(
            "the tree is still displayed",
            (0 until treeCount).none { trees[it].isDisplayed() },
        )
    }
}
