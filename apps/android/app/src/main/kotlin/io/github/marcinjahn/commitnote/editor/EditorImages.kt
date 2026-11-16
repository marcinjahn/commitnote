package io.github.marcinjahn.commitnote.editor

import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.util.LruCache
import io.github.marcinjahn.commitnote.core.api.NoteImage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.nio.ByteBuffer
import java.util.Base64
import kotlin.math.roundToInt

/** Decodes stored images no larger than [maxEdge] pixels on their long edge. */
object ImageBitmaps {
    suspend fun decode(
        image: NoteImage,
        maxEdge: Int,
    ): Bitmap? =
        withContext(Dispatchers.Default) {
            try {
                val bytes = Base64.getDecoder().decode(image.base64)
                ImageDecoder.decodeBitmap(
                    ImageDecoder.createSource(ByteBuffer.wrap(bytes)),
                ) { decoder, info, _ ->
                    val longEdge = maxOf(info.size.width, info.size.height)
                    if (longEdge > maxEdge) {
                        val scale = maxEdge.toDouble() / longEdge
                        decoder.setTargetSize(
                            (info.size.width * scale).roundToInt().coerceAtLeast(1),
                            (info.size.height * scale).roundToInt().coerceAtLeast(1),
                        )
                    }
                }
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                null
            }
        }
}

/**
 * The editor's image bitmaps, loaded through [load] when first drawn and kept in a cache bounded in
 * bytes. Call it from the main thread.
 */
internal class EditorImages(
    private val scope: CoroutineScope,
    private val maxEdge: Int,
    private val load: suspend (imageId: String) -> NoteImage?,
    private val onLoaded: (imageId: String) -> Unit,
) : ImageSource {
    private val cache =
        object : LruCache<String, Bitmap>(CACHE_BYTES) {
            override fun sizeOf(
                key: String,
                value: Bitmap,
            ): Int = value.allocationByteCount
        }
    private val loading = HashSet<String>()
    private val missing = HashSet<String>()

    override fun bitmap(imageId: String): Bitmap? {
        cache.get(imageId)?.let { return it }
        if (imageId !in loading && imageId !in missing) start(imageId)
        return null
    }

    private fun start(imageId: String) {
        loading += imageId
        scope.launch {
            val bitmap =
                try {
                    load(imageId)?.let { ImageBitmaps.decode(it, maxEdge) }
                } finally {
                    loading -= imageId
                }
            if (bitmap == null) {
                missing += imageId
                return@launch
            }
            cache.put(imageId, bitmap)
            onLoaded(imageId)
        }
    }

    private companion object {
        const val CACHE_BYTES = 48 * 1024 * 1024
    }
}
