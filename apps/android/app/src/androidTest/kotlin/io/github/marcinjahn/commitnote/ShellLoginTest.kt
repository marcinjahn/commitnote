package io.github.marcinjahn.commitnote

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ActivityScenario
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test

class ShellLoginTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private lateinit var scenario: ActivityScenario<MainActivity>

    @Before
    fun setUp() {
        clearRememberedSession()
        scenario = ActivityScenario.launch(MainActivity::class.java)
    }

    @After
    fun tearDown() {
        scenario.close()
        clearRememberedSession()
    }

    @Test
    fun loginReachesTheTree() {
        compose.waitUntilTagExists("token-field")
        compose.onNodeWithTag("token-field").performTextInput(FAKE_ACCESS_TOKEN)
        compose.onNodeWithTag("continue-button").performClick()

        compose.waitUntilTagExists("repo-$SAMPLE_REPOSITORY")
        compose.onNodeWithTag("repo-$SAMPLE_REPOSITORY").performClick()

        compose.waitUntilTagExists("passphrase-field")
        compose.onNodeWithTag("passphrase-field").performTextInput(SAMPLE_PASSPHRASE)
        compose.onNodeWithTag("unlock-button").performClick()

        compose.waitUntilTagExists("tree-list")
        compose.waitUntil(WAIT_MILLIS) {
            compose.onAllNodes(treeNode).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun ComposeTestRule.waitUntilTagExists(tag: String) =
        waitUntil(WAIT_MILLIS) { onAllNodes(hasTestTag(tag)).fetchSemanticsNodes().isNotEmpty() }

    private companion object {
        const val WAIT_MILLIS = 180_000L

        val treeNode =
            SemanticsMatcher("is a tree node") {
                it.config.getOrNull(SemanticsProperties.TestTag)?.startsWith("tree-node-") == true
            }
    }
}
