package io.github.marcinjahn.commitnote.flows

import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import io.github.marcinjahn.commitnote.MainActivity
import io.github.marcinjahn.commitnote.core.api.CoreCommands
import io.github.marcinjahn.commitnote.core.api.Empty
import io.github.marcinjahn.commitnote.core.api.SettingKeyView
import io.github.marcinjahn.commitnote.core.api.SettingScope
import io.github.marcinjahn.commitnote.core.api.SettingsChangeParams
import io.github.marcinjahn.commitnote.core.api.SettingsSaveState
import io.github.marcinjahn.commitnote.testing.TestApp
import io.github.marcinjahn.commitnote.testing.core
import io.github.marcinjahn.commitnote.testing.logInToSampleTree
import io.github.marcinjahn.commitnote.testing.session
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.TimeSource

@RunWith(RobolectricTestRunner::class)
@Config(application = TestApp::class, sdk = [Config.NEWEST_SDK])
class SettingsFlushFlowTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun savesPendingSettingsWhenTheAppGoesToTheBackground() {
        compose.logInToSampleTree()
        val opened = core { send(CoreCommands.settingsOpen, Empty) }
        assertEquals(SettingScope.SYNCED, opened.view.scopes.colorMode)

        val changed = TimeSource.Monotonic.markNow()
        core {
            send(
                CoreCommands.settingsChange,
                SettingsChangeParams(SettingKeyView.COLOR_MODE, "dark"),
            )
        }
        session.setVisible(false)
        while (!settingsSaved()) compose.waitForIdle()

        assertTrue(
            "The settings were saved by the debounce, not when the app went to the background",
            changed.elapsedNow() < SAVE_DEBOUNCE,
        )
    }

    private fun settingsSaved() =
        core { send(CoreCommands.settingsOpen, Empty) }.save.state == SettingsSaveState.SYNCED

    private companion object {
        val SAVE_DEBOUNCE = 1_000.milliseconds
    }
}
