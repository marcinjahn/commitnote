package io.github.marcinjahn.commitnote.flows

import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import io.github.marcinjahn.commitnote.MainActivity
import io.github.marcinjahn.commitnote.app.SessionPhase
import io.github.marcinjahn.commitnote.core.api.CoreCommands
import io.github.marcinjahn.commitnote.core.api.Empty
import io.github.marcinjahn.commitnote.core.api.FakeChangeRepoKeyParams
import io.github.marcinjahn.commitnote.core.api.FakeCoreCommands
import io.github.marcinjahn.commitnote.core.api.FakeFailNextParams
import io.github.marcinjahn.commitnote.core.api.FakeRemoteEditParams
import io.github.marcinjahn.commitnote.testing.CachedStartTestApp
import io.github.marcinjahn.commitnote.testing.LastViewTestApp
import io.github.marcinjahn.commitnote.testing.SAMPLE_REPOSITORY
import io.github.marcinjahn.commitnote.testing.awaitApp
import io.github.marcinjahn.commitnote.testing.awaitEditorText
import io.github.marcinjahn.commitnote.testing.awaitTag
import io.github.marcinjahn.commitnote.testing.awaitText
import io.github.marcinjahn.commitnote.testing.core
import io.github.marcinjahn.commitnote.testing.editorText
import io.github.marcinjahn.commitnote.testing.focusEditor
import io.github.marcinjahn.commitnote.testing.session
import io.github.marcinjahn.commitnote.testing.typeInEditor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(
    application = CachedStartTestApp::class,
    sdk = [Config.NEWEST_SDK],
    qualifiers = "w320dp-h640dp-mdpi",
)
class CachedStartFlowTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun showsTheLastViewWhileTheRefreshIsHeld() {
        awaitKeptNote()

        assertTrue(compose.onAllNodes(hasTestTag("token-field")).fetchSemanticsNodes().isEmpty())
        assertEquals(SessionPhase.Unlocked, session.phase.value)
        assertTrue("the held refresh already finished", session.sync.value?.refreshing == true)

        releaseRefresh()
        compose.awaitApp("the refresh to finish") { session.sync.value?.refreshing == false }
    }

    @Test
    fun theRefreshBringsAnEditMadeOnAnotherDevice() {
        val kept = awaitKeptNote()
        val remote = "$REMOTE_LINE\n$kept"
        remoteEdit(remote)

        releaseRefresh()

        compose.awaitEditorText("show the remote edit") { it == remote }
    }

    @Test
    fun anEditOfTheKeptNoteMergesWithTheRefreshedOne() {
        val kept = awaitKeptNote()
        remoteEdit("$REMOTE_LINE\n$kept")
        compose.focusEditor()
        compose.typeInEditor("\n$LOCAL_LINE")

        releaseRefresh()

        compose.awaitEditorText("hold both edits") {
            it == "$REMOTE_LINE\n$kept\n$LOCAL_LINE"
        }
        core { send(CoreCommands.syncFlush, Empty) }
        compose.awaitApp("the merged note to be saved") { session.sync.value?.unsavedCount == 0 }
    }

    @Test
    fun aFailedRefreshKeepsTheKeptNotes() {
        val kept = awaitKeptNote()
        failRefresh("Network")

        releaseRefresh()

        compose.awaitText(NETWORK_MESSAGE)
        assertEquals(SessionPhase.Unlocked, session.phase.value)
        assertEquals(kept, compose.editorText())
    }

    @Test
    fun aRevokedTokenKeepsTheLocalEdit() {
        val kept = awaitKeptNote()
        compose.focusEditor()
        compose.typeInEditor("\n$LOCAL_LINE")
        failRefresh("Unauthorized")

        releaseRefresh()

        compose.awaitText(UNAUTHORIZED_MESSAGE)
        assertEquals(SessionPhase.Unlocked, session.phase.value)
        assertEquals("$kept\n$LOCAL_LINE", compose.editorText())
    }

    @Test
    fun aChangedKeyShowsOnceTheRefreshLands() {
        awaitKeptNote()
        core { send(FakeCoreCommands.changeRepoKey, FakeChangeRepoKeyParams(SAMPLE_REPOSITORY)) }

        releaseRefresh()

        compose.awaitTag("key-changed-message")
    }

    private fun awaitKeptNote(): String {
        compose.awaitTag("note-title").assertTextEquals(LastViewTestApp.LAST_VIEW_NOTE.last())
        return compose.awaitEditorText("show the kept note") { it.isNotEmpty() }
    }

    private fun releaseRefresh() = core { send(FakeCoreCommands.releaseRefresh, Empty) }

    private fun remoteEdit(text: String) =
        core {
            send(
                FakeCoreCommands.remoteEdit,
                FakeRemoteEditParams(SAMPLE_REPOSITORY, WELCOME, text, "Other phone"),
            )
        }

    private fun failRefresh(kind: String) =
        core {
            send(
                FakeCoreCommands.failNext,
                FakeFailNextParams(SAMPLE_REPOSITORY, "getHead", kind, 50),
            )
        }

    private companion object {
        val WELCOME = LastViewTestApp.LAST_VIEW_NOTE
        const val REMOTE_LINE = "Edited on another device"
        const val LOCAL_LINE = "Typed on the phone"
        const val NETWORK_MESSAGE = "Could not reach GitHub. Showing the last loaded notes."
        const val UNAUTHORIZED_MESSAGE =
            "Your access token is no longer valid. Log out and log in again."
    }
}
