package io.github.marcinjahn.commitnote.note

import android.content.Context
import android.net.Uri
import androidx.core.content.FileProvider
import io.github.marcinjahn.commitnote.app.ImageInput
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID

/** Reads picked, pasted and photographed images, and owns the files the camera writes. */
class NoteImageFiles(
    context: Context,
) {
    private val context = context.applicationContext
    private val cameraDirectory: File get() = File(context.cacheDir, CAMERA_DIRECTORY)

    /** The images among [uris] that could be read; the others are skipped. */
    suspend fun read(uris: List<Uri>): List<ImageInput> =
        withContext(Dispatchers.IO) {
            uris.mapNotNull { uri ->
                try {
                    val type =
                        context.contentResolver
                            .getType(
                                uri,
                            )?.takeIf { it.startsWith("image/") }
                    val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                    if (type != null && bytes != null &&
                        bytes.isNotEmpty()
                    ) {
                        ImageInput(bytes, type)
                    } else {
                        null
                    }
                } catch (error: CancellationException) {
                    throw error
                } catch (_: Exception) {
                    null
                }
            }
        }

    /** A new file for the camera to write a photo to, shared through the app's file provider. */
    fun newPhoto(): Uri {
        val directory = cameraDirectory.apply { mkdirs() }
        val file = File(directory, "${UUID.randomUUID()}.jpg")
        return FileProvider.getUriForFile(context, "${context.packageName}$AUTHORITY_SUFFIX", file)
    }

    suspend fun clearPhotos() {
        withContext(Dispatchers.IO) { cameraDirectory.deleteRecursively() }
    }

    private companion object {
        const val CAMERA_DIRECTORY = "camera"
        const val AUTHORITY_SUFFIX = ".files"
    }
}
