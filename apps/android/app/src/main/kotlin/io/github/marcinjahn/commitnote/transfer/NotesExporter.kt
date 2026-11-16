package io.github.marcinjahn.commitnote.transfer

import android.content.ContentResolver
import android.net.Uri
import io.github.marcinjahn.commitnote.app.AppSession
import io.github.marcinjahn.commitnote.core.api.ExportedArchive
import io.github.marcinjahn.commitnote.core.runtime.CoreException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException
import java.util.Base64

enum class ExportState { Idle, Exporting, Failed }

/**
 * Exports the notes to a zip document the user picks: [export] asks the core for the archive and
 * emits its file name on [saveRequests], for the screen to launch the document picker; [save]
 * writes the picked document.
 */
class NotesExporter(
    private val session: AppSession,
    private val includeImages: Boolean,
    private val scope: CoroutineScope,
) {
    private val mutableState = MutableStateFlow(ExportState.Idle)
    val state: StateFlow<ExportState> = mutableState.asStateFlow()

    private val documentRequests = Channel<String>(Channel.CONFLATED)

    /** The file names to ask the user where to save the export under. */
    val saveRequests: Flow<String> = documentRequests.receiveAsFlow()

    private var archive: ExportedArchive? = null

    fun export() {
        if (state.value == ExportState.Exporting) return
        mutableState.value = ExportState.Exporting
        scope.launch {
            try {
                session.editor.flush()
                val exported = session.exportNotes(includeImages)
                archive = exported
                documentRequests.send(exported.fileName)
            } catch (error: CancellationException) {
                throw error
            } catch (_: CoreException) {
                mutableState.value = ExportState.Failed
            }
        }
    }

    /** Writes the archive to [uri]; a null [uri] means the user cancelled the picker. */
    fun save(
        uri: Uri?,
        contentResolver: ContentResolver,
    ) {
        val exported = archive
        if (uri == null || exported == null) {
            mutableState.value = ExportState.Idle
            return
        }
        scope.launch {
            mutableState.value =
                try {
                    withContext(Dispatchers.IO) {
                        val bytes = Base64.getDecoder().decode(exported.base64)
                        val stream = contentResolver.openOutputStream(uri) ?: throw IOException()
                        stream.use { it.write(bytes) }
                    }
                    archive = null
                    ExportState.Idle
                } catch (_: IOException) {
                    ExportState.Failed
                } catch (_: IllegalArgumentException) {
                    ExportState.Failed
                } catch (_: SecurityException) {
                    ExportState.Failed
                }
        }
    }
}
