package io.github.marcinjahn.commitnote.host

import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.os.Build
import io.github.marcinjahn.commitnote.core.runtime.services.DecodedImage
import io.github.marcinjahn.commitnote.core.runtime.services.ImageCodecService
import io.github.marcinjahn.commitnote.core.runtime.services.ImageHandle
import io.github.marcinjahn.commitnote.core.runtime.services.ServiceException
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.roundToInt

class PlatformImageCodec : ImageCodecService {
    private val bitmaps = ConcurrentHashMap<String, Bitmap>()
    private val nextId = AtomicLong()

    override fun decode(bytes: ByteArray): DecodedImage {
        val bitmap =
            try {
                ImageDecoder.decodeBitmap(ImageDecoder.createSource(ByteBuffer.wrap(bytes))) {
                    decoder,
                    info,
                    _,
                    ->
                    decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                    limitSize(decoder, info.size.width, info.size.height)
                }
            } catch (_: IOException) {
                throw ServiceException("Image could not be decoded")
            }
        val id = "img-${nextId.incrementAndGet()}"
        bitmaps[id] = bitmap
        return DecodedImage(ImageHandle(id), bitmap.width, bitmap.height)
    }

    private fun limitSize(
        decoder: ImageDecoder,
        width: Int,
        height: Int,
    ) {
        if (width.toLong() * height > MAX_PIXELS) throw ServiceException("Image is too large")
        val longEdge = maxOf(width, height)
        if (longEdge > MAX_EDGE) {
            val scale = MAX_EDGE.toDouble() / longEdge
            decoder.setTargetSize(
                (width * scale).roundToInt().coerceAtLeast(1),
                (height * scale).roundToInt().coerceAtLeast(1),
            )
        }
    }

    override fun encodeWebp(
        handle: ImageHandle,
        width: Int,
        height: Int,
        quality: Float,
    ): ByteArray {
        val source = bitmaps[handle.id] ?: throw ServiceException(UNKNOWN_HANDLE)
        if (width <= 0 || height <= 0 || quality.isNaN()) {
            throw ServiceException("Invalid image encoding parameters")
        }
        val scaled =
            if (width == source.width && height == source.height) {
                source
            } else {
                Bitmap.createScaledBitmap(source, width, height, true)
            }
        try {
            val output = ByteArrayOutputStream()
            if (!compressWebp(scaled, quality, output)) {
                throw ServiceException("Image could not be encoded")
            }
            return output.toByteArray()
        } finally {
            if (scaled !== source) scaled.recycle()
        }
    }

    override fun release(handle: ImageHandle) {
        val bitmap = bitmaps.remove(handle.id) ?: throw ServiceException(UNKNOWN_HANDLE)
        bitmap.recycle()
    }

    private fun compressWebp(
        bitmap: Bitmap,
        quality: Float,
        output: ByteArrayOutputStream,
    ): Boolean {
        val percent = (quality * 100).roundToInt().coerceIn(0, 100)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            bitmap.compress(Bitmap.CompressFormat.WEBP_LOSSY, percent, output)
        } else {
            // On API 29 a quality of 100 selects lossless encoding.
            @Suppress("DEPRECATION")
            bitmap.compress(
                Bitmap.CompressFormat.WEBP,
                percent.coerceAtMost(MAX_LOSSY_QUALITY),
                output,
            )
        }
    }

    private companion object {
        const val UNKNOWN_HANDLE = "Unknown image handle"
        const val MAX_LOSSY_QUALITY = 99
        const val MAX_PIXELS = 50_000_000L
        const val MAX_EDGE = 4096
    }
}
