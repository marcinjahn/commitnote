package io.github.marcinjahn.commitnote.flows

import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.performTextInput
import io.github.marcinjahn.commitnote.MainActivity
import io.github.marcinjahn.commitnote.testing.SAMPLE_PASSPHRASE
import io.github.marcinjahn.commitnote.testing.TestApp
import io.github.marcinjahn.commitnote.testing.awaitTag
import io.github.marcinjahn.commitnote.testing.logInToSampleTree
import io.github.marcinjahn.commitnote.testing.openFromSettings
import io.github.marcinjahn.commitnote.testing.tap
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = TestApp::class, sdk = [Config.NEWEST_SDK], qualifiers = "w320dp-h640dp-mdpi")
class PassphraseChangeFlowTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun changesThePassphraseAfterTheReview() {
        val replacement = "a much longer passphrase for the repository"
        compose.logInToSampleTree()

        compose.openFromSettings("settings-change-passphrase")
        compose.awaitTag("change-current").performTextInput(SAMPLE_PASSPHRASE)
        compose.awaitTag("change-new").performTextInput(replacement)
        compose.awaitTag("strength-meter")
        compose.awaitTag("change-repeat").performTextInput(replacement)
        compose.tap("change-continue")

        compose.awaitTag("change-summary")
        compose.tap("change-confirm")

        compose.awaitTag("settings-screen")
    }
}
