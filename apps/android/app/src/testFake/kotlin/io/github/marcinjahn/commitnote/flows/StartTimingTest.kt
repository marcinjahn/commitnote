package io.github.marcinjahn.commitnote.flows

import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import io.github.marcinjahn.commitnote.MainActivity
import io.github.marcinjahn.commitnote.core.api.Empty
import io.github.marcinjahn.commitnote.core.api.FakeCoreCommands
import io.github.marcinjahn.commitnote.testing.CachedStartTestApp
import io.github.marcinjahn.commitnote.testing.TimedStartTestApp
import io.github.marcinjahn.commitnote.testing.UncachedStartTestApp
import io.github.marcinjahn.commitnote.testing.awaitEditorText
import io.github.marcinjahn.commitnote.testing.core
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Records how long a remembered start takes to show the last note; the times are not asserted. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [Config.NEWEST_SDK], qualifiers = "w320dp-h640dp-mdpi")
class StartTimingTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    @Config(application = CachedStartTestApp::class)
    fun recordsTheStartFromTheKeptTree() {
        record("the kept tree")
        core { send(FakeCoreCommands.releaseRefresh, Empty) }
    }

    @Test
    @Config(application = UncachedStartTestApp::class)
    fun recordsTheStartFromTheForge() {
        record("the forge")
    }

    private fun record(source: String) {
        compose.awaitEditorText("show the last note") { it.isNotEmpty() }
        val app = ApplicationProvider.getApplicationContext<TimedStartTestApp>()
        val elapsed = checkNotNull(app.coreCreatedAt).elapsedNow()
        println("Time to content from $source: ${elapsed.inWholeMilliseconds} ms")
    }
}
