package io.github.marcinjahn.commitnote.flows

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import io.github.marcinjahn.commitnote.MainActivity
import io.github.marcinjahn.commitnote.testing.FOREIGN_REPOSITORY
import io.github.marcinjahn.commitnote.testing.SAMPLE_REPOSITORY
import io.github.marcinjahn.commitnote.testing.TestApp
import io.github.marcinjahn.commitnote.testing.awaitTag
import io.github.marcinjahn.commitnote.testing.logInToRepository
import io.github.marcinjahn.commitnote.testing.tap
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = TestApp::class, sdk = [Config.NEWEST_SDK])
class UnusableRepositoryFlowTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun explainsAnUnusableRepositoryAndGoesBackToThePicker() {
        compose.logInToRepository(FOREIGN_REPOSITORY)
        compose.awaitTag("unusable-message").assertIsDisplayed()

        compose.tap("check-again-button")
        compose.awaitTag("unusable-message").assertIsDisplayed()

        compose.tap("choose-another-button")
        compose.awaitTag("repo-$SAMPLE_REPOSITORY").assertIsDisplayed()
    }
}
