package io.github.marcinjahn.commitnote.flows

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.performScrollTo
import io.github.marcinjahn.commitnote.MainActivity
import io.github.marcinjahn.commitnote.testing.TestApp
import io.github.marcinjahn.commitnote.testing.awaitTag
import io.github.marcinjahn.commitnote.testing.logInToSampleTree
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = TestApp::class, sdk = [Config.NEWEST_SDK])
class LoginToTreeFlowTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun logsInToTheTree() {
        logInAndCheckKeyNodes()
    }

    @Test
    @Config(qualifiers = "+night")
    fun logsInToTheTreeInDarkMode() {
        logInAndCheckKeyNodes()
    }

    @Test
    fun logsInToTheTreeAtDoubleFontScale() {
        RuntimeEnvironment.setFontScale(2f)
        compose.activityRule.scenario.recreate()
        logInAndCheckKeyNodes()
    }

    private fun logInAndCheckKeyNodes() {
        compose.awaitTag("continue-button").performScrollTo().assertIsDisplayed()
        compose.logInToSampleTree()
        compose.awaitTag("tree-node-Welcome").assertIsDisplayed()
        compose.awaitTag("sync-status").assertIsDisplayed()
        compose.awaitTag("new-menu").assertIsDisplayed()
    }
}
