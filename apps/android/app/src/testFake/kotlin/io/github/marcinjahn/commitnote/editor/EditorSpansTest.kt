package io.github.marcinjahn.commitnote.editor

import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import io.github.marcinjahn.commitnote.MainActivity
import io.github.marcinjahn.commitnote.testing.TestApp
import io.github.marcinjahn.commitnote.testing.awaitEditorText
import io.github.marcinjahn.commitnote.testing.focusEditor
import io.github.marcinjahn.commitnote.testing.logInToSampleTree
import io.github.marcinjahn.commitnote.testing.onEditor
import io.github.marcinjahn.commitnote.testing.tap
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = TestApp::class, sdk = [Config.NEWEST_SDK], qualifiers = "w320dp-h640dp-mdpi")
class EditorSpansTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun hidesTheHeadingMarkerOnlyOffTheCaretLine() {
        compose.logInToSampleTree()
        compose.tap("tree-node-Welcome")
        compose.awaitEditorText("show the note") { it.isNotEmpty() }
        compose.focusEditor()
        compose.onEditor { text.replace(0, length(), "# Heading\nBody") }

        assertTrue(
            "marker hidden with the caret on another line",
            markerHiddenWithCaretAt("# Heading\n".length),
        )
        assertFalse(
            "marker shown with the caret on its line",
            markerHiddenWithCaretAt("# Head".length),
        )
    }

    private fun markerHiddenWithCaretAt(caret: Int): Boolean =
        compose.onEditor {
            setSelection(caret)
            restyleNow()
            text.getSpans(0, 1, HiddenSpan::class.java).isNotEmpty()
        }
}
