package io.github.marcinjahn.commitnote

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ActivityScenario
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test

class LoginFlowTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private lateinit var scenario: ActivityScenario<MainActivity>

    @Before
    fun setUp() {
        clearAppState()
        scenario = ActivityScenario.launch(MainActivity::class.java)
    }

    @After
    fun tearDown() {
        scenario.close()
        clearAppState()
    }

    @Test
    fun loginReachesTheTree() {
        compose.awaitTag("token-field")
        compose.onNodeWithTag("token-field").performTextInput(FAKE_ACCESS_TOKEN)
        compose.tap("continue-button")

        compose.tap("repo-$SAMPLE_REPOSITORY")

        compose.awaitTag("passphrase-field")
        compose.onNodeWithTag("passphrase-field").performTextInput(SAMPLE_PASSPHRASE)
        compose.tap("unlock-button")

        compose.awaitTag("tree-list")
        compose.waitUntil(FLOW_WAIT_MILLIS) {
            compose.onAllNodes(treeNode).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private companion object {
        val treeNode =
            SemanticsMatcher("is a tree node") {
                it.config.getOrNull(SemanticsProperties.TestTag)?.startsWith("tree-node-") == true
            }
    }
}
