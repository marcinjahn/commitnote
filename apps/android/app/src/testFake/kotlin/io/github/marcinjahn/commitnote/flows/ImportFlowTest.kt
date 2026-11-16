package io.github.marcinjahn.commitnote.flows

import android.net.Uri
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import io.github.marcinjahn.commitnote.MainActivity
import io.github.marcinjahn.commitnote.testing.TestApp
import io.github.marcinjahn.commitnote.testing.answerDocumentPicker
import io.github.marcinjahn.commitnote.testing.awaitNoTag
import io.github.marcinjahn.commitnote.testing.awaitTag
import io.github.marcinjahn.commitnote.testing.logInToSampleTree
import io.github.marcinjahn.commitnote.testing.openFromSettings
import io.github.marcinjahn.commitnote.testing.pressBack
import io.github.marcinjahn.commitnote.testing.tap
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

@RunWith(RobolectricTestRunner::class)
@Config(application = TestApp::class, sdk = [Config.NEWEST_SDK], qualifiers = "w320dp-h640dp-mdpi")
class ImportFlowTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @get:Rule
    val folder = TemporaryFolder()

    @Test
    fun importsANotesArchiveAfterThePreview() {
        val archive = zipOf("Imported plan.md" to "# Imported plan\n\nFrom the archive\n")
        compose.logInToSampleTree()

        compose.openFromSettings("settings-import")
        val request = compose.answerDocumentPicker(Uri.fromFile(archive))

        assertEquals(true, request.getBooleanExtra("android.intent.extra.ALLOW_MULTIPLE", false))
        compose.awaitTag("import-preview")
        compose.tap("import-confirm")
        compose.awaitNoTag("import-confirm")

        compose.pressBack()
        compose.tap("tree-node-notes")
        compose.awaitTag("tree-node-Imported plan")
    }

    private fun zipOf(vararg files: Pair<String, String>): File {
        val target = folder.newFile("notes.zip")
        ZipOutputStream(target.outputStream()).use { zip ->
            files.forEach { (name, text) ->
                zip.putNextEntry(ZipEntry(name))
                zip.write(text.toByteArray())
                zip.closeEntry()
            }
        }
        return target
    }
}
