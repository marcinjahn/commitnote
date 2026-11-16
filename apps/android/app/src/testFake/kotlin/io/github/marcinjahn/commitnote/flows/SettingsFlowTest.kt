package io.github.marcinjahn.commitnote.flows

import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performTextReplacement
import io.github.marcinjahn.commitnote.MainActivity
import io.github.marcinjahn.commitnote.core.api.CoreCommands
import io.github.marcinjahn.commitnote.core.api.Empty
import io.github.marcinjahn.commitnote.testing.AppComposeRule
import io.github.marcinjahn.commitnote.testing.TestApp
import io.github.marcinjahn.commitnote.testing.awaitApp
import io.github.marcinjahn.commitnote.testing.awaitTag
import io.github.marcinjahn.commitnote.testing.core
import io.github.marcinjahn.commitnote.testing.logInToSampleTree
import io.github.marcinjahn.commitnote.testing.openFromMainMenu
import io.github.marcinjahn.commitnote.testing.session
import io.github.marcinjahn.commitnote.testing.tap
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = TestApp::class, sdk = [Config.NEWEST_SDK], qualifiers = "w320dp-h640dp-mdpi")
class SettingsFlowTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun changesTheAppearanceScopesASettingAndRenamesTheDevice() {
        compose.logInToSampleTree()
        compose.openFromMainMenu("menu-settings")

        compose.tap("settings-color-mode-dark")
        compose.awaitSelected("settings-color-mode-dark")
        compose.tap("settings-accent-green")
        compose.awaitSelected("settings-accent-green")
        compose.awaitApp("the dark color mode to apply") {
            session.appearance.value.colorMode == "dark"
        }
        assertEquals("green", session.appearance.value.accentColor)

        compose.tap("settings-scope-accent-color")
        compose.awaitTag("settings-scope-accent-color")
        compose.waitUntil(SETTLE_MILLIS) {
            runCatching {
                compose
                    .onNodeWithTag(
                        "settings-scope-accent-color",
                    ).assertTextContains("This device")
            }.isSuccess
        }

        compose.awaitTag("settings-device-name").performTextReplacement("Pixel on the desk")
        compose.awaitTag("settings-device-name").performImeAction()
        compose.waitUntil(SETTLE_MILLIS) {
            core { send(CoreCommands.deviceName, Empty) }.name == "Pixel on the desk"
        }
    }

    private fun AppComposeRule.awaitSelected(tag: String) {
        awaitTag(tag)
        waitUntil(SETTLE_MILLIS) {
            runCatching { onNodeWithTag(tag).assertIsSelected() }.isSuccess
        }
    }

    private companion object {
        const val SETTLE_MILLIS = 60_000L
    }
}
