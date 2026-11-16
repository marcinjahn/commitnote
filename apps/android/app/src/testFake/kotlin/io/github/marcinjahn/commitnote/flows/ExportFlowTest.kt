package io.github.marcinjahn.commitnote.flows

import android.content.Intent
import android.net.Uri
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import io.github.marcinjahn.commitnote.MainActivity
import io.github.marcinjahn.commitnote.testing.TestApp
import io.github.marcinjahn.commitnote.testing.answerDocumentPicker
import io.github.marcinjahn.commitnote.testing.awaitApp
import io.github.marcinjahn.commitnote.testing.logInToSampleTree
import io.github.marcinjahn.commitnote.testing.openFromSettings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.zip.ZipInputStream

@RunWith(RobolectricTestRunner::class)
@Config(application = TestApp::class, sdk = [Config.NEWEST_SDK], qualifiers = "w320dp-h640dp-mdpi")
class ExportFlowTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @get:Rule
    val folder = TemporaryFolder()

    @Test
    fun writesTheNotesAsAZipToTheChosenDocument() {
        val target = folder.newFile("export.zip")
        compose.logInToSampleTree()

        compose.openFromSettings("settings-export")
        val request = compose.answerDocumentPicker(Uri.fromFile(target))

        assertEquals(Intent.ACTION_CREATE_DOCUMENT, request.action)
        assertEquals("application/zip", request.type)
        compose.awaitApp("the export to be written") { target.length() > 0 }
        val entries =
            ZipInputStream(target.inputStream()).use { zip ->
                generateSequence { zip.nextEntry }.map { it.name }.toList()
            }
        assertTrue(entries.any { it.startsWith("Welcome") })
    }
}
