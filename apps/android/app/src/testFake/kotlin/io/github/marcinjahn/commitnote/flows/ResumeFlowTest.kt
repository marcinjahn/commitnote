package io.github.marcinjahn.commitnote.flows

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import io.github.marcinjahn.commitnote.MainActivity
import io.github.marcinjahn.commitnote.testing.ResumingTestApp
import io.github.marcinjahn.commitnote.testing.awaitTag
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = ResumingTestApp::class, sdk = [Config.NEWEST_SDK])
class ResumeFlowTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun resumesStraightIntoTheTree() {
        compose.awaitTag("tree-node-Welcome").assertIsDisplayed()
        compose.onAllNodes(hasTestTag("token-field")).assertCountEquals(0)
    }
}
