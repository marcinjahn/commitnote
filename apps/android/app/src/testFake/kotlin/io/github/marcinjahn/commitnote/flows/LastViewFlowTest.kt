package io.github.marcinjahn.commitnote.flows

import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import io.github.marcinjahn.commitnote.MainActivity
import io.github.marcinjahn.commitnote.testing.LastViewTestApp
import io.github.marcinjahn.commitnote.testing.awaitEditorText
import io.github.marcinjahn.commitnote.testing.awaitTag
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(
    application = LastViewTestApp::class,
    sdk = [Config.NEWEST_SDK],
    qualifiers = "w320dp-h640dp-mdpi",
)
class LastViewFlowTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun reopensTheNoteTheLastSessionLeftOpen() {
        compose.awaitTag("note-title").assertTextEquals(LastViewTestApp.LAST_VIEW_NOTE.last())
        compose.awaitEditorText("show the note") { it.isNotEmpty() }
    }
}
