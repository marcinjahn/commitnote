package io.github.marcinjahn.commitnote.flows

import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import io.github.marcinjahn.commitnote.BuildConfig
import io.github.marcinjahn.commitnote.MainActivity
import io.github.marcinjahn.commitnote.testing.TestApp
import io.github.marcinjahn.commitnote.testing.awaitNoTag
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
class AboutFlowTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun showsTheVersionAndTheLicenceTexts() {
        compose.logInToSampleTree()

        compose.openFromSettings("settings-about")

        compose
            .awaitTag(
                "about-version",
            ).assertTextContains(BuildConfig.VERSION_NAME, substring = true)
        compose.awaitTag("about-core-api")
        compose
            .awaitTag(
                "about-app-licence",
            ).assertTextContains("GNU General Public License, version 3 or later", substring = true)
        compose.tap("about-licence-OkHttp")
        compose
            .awaitTag(
                "about-licence-text",
            ).assertTextContains("Apache License", substring = true)
        compose.tap("about-licence-OkHttp")
        compose.awaitNoTag("about-licence-text")
        compose.tap("about-licence-V8")
        compose
            .awaitTag(
                "about-licence-text",
            ).assertTextContains("Neither the name of the copyright holder", substring = true)
        compose.tap("about-licence-V8")
        compose.awaitNoTag("about-licence-text")
        compose.tap("about-licence-ICU data")
        compose
            .awaitTag(
                "about-licence-text",
            ).assertTextContains("Copyright © 2016-2024 Unicode, Inc.", substring = true)
        compose.tap("about-licence-ICU data")
        compose.awaitNoTag("about-licence-text")
        compose.tap("about-licence-Bouncy Castle")
        compose
            .awaitTag(
                "about-licence-text",
            ).assertTextContains("Legion of the Bouncy Castle", substring = true)
    }
}
