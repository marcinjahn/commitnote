package io.github.marcinjahn.commitnote.transfer

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException

/** The MIME types the import picker offers: archives and Markdown files. */
val IMPORT_MIME_TYPES = arrayOf("application/zip", "text/markdown")

/** A document the user picked, read completely. */
class PickedDocument(
    val name: String,
    val bytes: ByteArray,
) {
    val isArchive: Boolean get() = name.endsWith(".zip", ignoreCase = true)

    val mimeType: String get() = if (isArchive) "application/zip" else "text/markdown"
}

/** Reads every one of [uris]; null when any of them cannot be read. */
suspend fun ContentResolver.readDocuments(uris: List<Uri>): List<PickedDocument>? =
    withContext(Dispatchers.IO) {
        try {
            uris.map { uri ->
                val bytes = openInputStream(uri)?.use { it.readBytes() } ?: return@withContext null
                PickedDocument(displayName(uri), bytes)
            }
        } catch (_: IOException) {
            null
        } catch (_: SecurityException) {
            null
        }
    }

private fun ContentResolver.displayName(uri: Uri): String {
    val fromProvider =
        runCatching {
            query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) cursor.getString(0) else null
            }
        }.getOrNull()
    return fromProvider ?: uri.lastPathSegment.orEmpty().substringAfterLast('/')
}
