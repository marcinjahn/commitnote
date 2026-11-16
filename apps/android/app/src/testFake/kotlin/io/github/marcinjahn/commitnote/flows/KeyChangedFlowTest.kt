package io.github.marcinjahn.commitnote.flows

import android.content.Intent
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.performTextInput
import io.github.marcinjahn.commitnote.MainActivity
import io.github.marcinjahn.commitnote.core.api.CoreCommands
import io.github.marcinjahn.commitnote.core.api.CoreErrorKind
import io.github.marcinjahn.commitnote.core.api.Empty
import io.github.marcinjahn.commitnote.core.api.FakeChangeRepoKeyParams
import io.github.marcinjahn.commitnote.core.api.FakeCoreCommands
import io.github.marcinjahn.commitnote.core.runtime.CoreException
import io.github.marcinjahn.commitnote.testing.SAMPLE_PASSPHRASE
import io.github.marcinjahn.commitnote.testing.SAMPLE_REPOSITORY
import io.github.marcinjahn.commitnote.testing.TestApp
import io.github.marcinjahn.commitnote.testing.awaitApp
import io.github.marcinjahn.commitnote.testing.awaitNoTag
import io.github.marcinjahn.commitnote.testing.awaitTag
import io.github.marcinjahn.commitnote.testing.core
import io.github.marcinjahn.commitnote.testing.logInToSampleTree
import io.github.marcinjahn.commitnote.testing.tap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = TestApp::class, sdk = [Config.NEWEST_SDK])
class KeyChangedFlowTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun offersTheExportAndRejectsTheOldPassphrase() {
        compose.logInToSampleTree()
        core { send(FakeCoreCommands.changeRepoKey, FakeChangeRepoKeyParams(SAMPLE_REPOSITORY)) }
        val refresh =
            assertThrows(
                CoreException::class.java,
            ) { core { send(CoreCommands.syncRefresh, Empty) } }
        assertEquals(CoreErrorKind.KEY_CHANGED, refresh.error.kind)

        compose.awaitTag("key-changed-message").assertIsDisplayed()
        compose.tap("export-button")
        compose.awaitApp("the document picker to start") {
            shadowOf(compose.activity).peekNextStartedActivityForResult() != null
        }
        val started = shadowOf(compose.activity).nextStartedActivityForResult.intent
        assertEquals(Intent.ACTION_CREATE_DOCUMENT, started.action)

        compose.awaitTag("passphrase-field").performTextInput(SAMPLE_PASSPHRASE)
        compose.tap("unlock-button")
        compose.awaitTag("unlock-error").assertIsDisplayed()
        compose.awaitNoTag("export-button")
    }
}
