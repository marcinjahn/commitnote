package io.github.marcinjahn.commitnote.flows

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import io.github.marcinjahn.commitnote.MainActivity
import io.github.marcinjahn.commitnote.core.api.CoreCommands
import io.github.marcinjahn.commitnote.core.api.Empty
import io.github.marcinjahn.commitnote.core.api.FakeCoreCommands
import io.github.marcinjahn.commitnote.core.api.FakeFailNextParams
import io.github.marcinjahn.commitnote.core.api.NoteEditParams
import io.github.marcinjahn.commitnote.core.api.NoteOpenParams
import io.github.marcinjahn.commitnote.core.api.OpenNote
import io.github.marcinjahn.commitnote.testing.SAMPLE_REPOSITORY
import io.github.marcinjahn.commitnote.testing.TestApp
import io.github.marcinjahn.commitnote.testing.awaitTag
import io.github.marcinjahn.commitnote.testing.core
import io.github.marcinjahn.commitnote.testing.logInToSampleTree
import io.github.marcinjahn.commitnote.testing.tap
import kotlinx.coroutines.delay
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = TestApp::class, sdk = [Config.NEWEST_SDK])
class UnsavedLogoutFlowTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun warnsAboutUnsavedChangesBeforeLoggingOut() {
        compose.logInToSampleTree()
        val welcome = listOf("Welcome")
        core {
            send(
                FakeCoreCommands.failNext,
                FakeFailNextParams(SAMPLE_REPOSITORY, "commit", "Network", 50),
            )
            while (send(
                    CoreCommands.noteOpen,
                    NoteOpenParams(welcome),
                ).note !is OpenNote.Loaded
            ) {
                delay(50)
            }
            send(CoreCommands.noteEdit, NoteEditParams(welcome, "An edit that cannot be saved"))
            send(CoreCommands.syncFlush, Empty)
        }

        compose.tap("main-menu")
        compose.tap("menu-log-out")
        compose.tap("logout-anyway")
        compose.awaitTag("token-field").assertIsDisplayed()
    }
}
