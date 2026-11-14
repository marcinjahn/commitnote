package io.github.marcinjahn.commitnote.core.runtime.testing

import io.github.marcinjahn.commitnote.core.runtime.services.DecodedImage
import io.github.marcinjahn.commitnote.core.runtime.services.ImageCodecService
import io.github.marcinjahn.commitnote.core.runtime.services.ImageHandle
import io.github.marcinjahn.commitnote.core.runtime.services.ServiceException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max

/**
 * Reads dimensions from the image header and "encodes" a WebP of the right size and header
 * without any pixels, matching the reference codec of the TypeScript tests byte for byte.
 */
class FakeImageCodecService : ImageCodecService {
    private data class Dimensions(
        val width: Long,
        val height: Long,
    )

    private val images = ConcurrentHashMap<String, Dimensions>()

    override fun decode(bytes: ByteArray): DecodedImage {
        val dimensions =
            sniff(bytes)
                ?.let { format -> runCatching { read(bytes, format) }.getOrNull() }
                ?.takeIf { it.width <= Int.MAX_VALUE && it.height <= Int.MAX_VALUE }
                ?: throw ServiceException("Not a decodable image")
        val handle = UUID.randomUUID().toString()
        images[handle] = dimensions
        return DecodedImage(
            ImageHandle(handle),
            dimensions.width.toInt(),
            dimensions.height.toInt(),
        )
    }

    override fun encodeWebp(
        handle: ImageHandle,
        width: Int,
        height: Int,
        quality: Float,
    ): ByteArray {
        if (!images.containsKey(handle.id)) throw ServiceException("Unknown image handle")
        if (width !in 1..MAX_VP8_DIMENSION || height !in 1..MAX_VP8_DIMENSION) {
            throw ServiceException("WebP dimensions out of range")
        }
        // Through the decimal text, a Float like 0.82f becomes the 0.82 the reference was given;
        // widening it directly would change the rounded length.
        return fakeLossyWebp(width, height, quality.toString().toDouble())
    }

    override fun release(handle: ImageHandle) {
        images.remove(handle.id)
    }

    private enum class Format { PNG, JPEG, GIF, WEBP, BMP }

    private fun sniff(bytes: ByteArray): Format? =
        when {
            bytes.startsWith(PNG_SIGNATURE) -> Format.PNG
            bytes.startsWith(intArrayOf(0xff, 0xd8, 0xff)) -> Format.JPEG
            bytes.ascii(0, 6) == "GIF87a" || bytes.ascii(0, 6) == "GIF89a" -> Format.GIF
            bytes.ascii(0, 4) == "RIFF" && bytes.ascii(8, 4) == "WEBP" -> Format.WEBP
            bytes.ascii(0, 2) == "BM" -> Format.BMP
            else -> null
        }

    private fun read(
        bytes: ByteArray,
        format: Format,
    ): Dimensions? =
        when (format) {
            Format.PNG -> readPng(bytes)
            Format.GIF -> readGif(bytes)
            Format.WEBP -> readWebp(bytes)
            Format.JPEG -> readJpeg(bytes)
            Format.BMP -> readBmp(bytes)
        }

    private fun readPng(bytes: ByteArray): Dimensions? {
        if (bytes.size < 24 || bytes.ascii(12, 4) != "IHDR") return null
        val data = bytes.view(ByteOrder.BIG_ENDIAN)
        return valid(data.uint32(16), data.uint32(20))
    }

    private fun readGif(bytes: ByteArray): Dimensions? {
        if (bytes.size < 10) return null
        val data = bytes.view(ByteOrder.LITTLE_ENDIAN)
        return valid(data.uint16(6).toLong(), data.uint16(8).toLong())
    }

    private fun readWebp(bytes: ByteArray): Dimensions? {
        if (bytes.size < 16) return null
        val data = bytes.view(ByteOrder.LITTLE_ENDIAN)
        return when (bytes.ascii(12, 4)) {
            "VP8 " -> {
                if (bytes.size < 30 || !bytes.startsWith(VP8_START_CODE, offset = 23)) return null
                valid((data.uint16(26) and 0x3fff).toLong(), (data.uint16(28) and 0x3fff).toLong())
            }

            "VP8L" -> {
                if (bytes.size < 25 || bytes.u8(20) != 0x2f) return null
                val bits = data.uint32(21)
                valid((bits and 0x3fff) + 1, ((bits ushr 14) and 0x3fff) + 1)
            }

            "VP8X" -> {
                if (bytes.size < 30) return null
                val width = (bytes.u8(24) or (bytes.u8(25) shl 8) or (bytes.u8(26) shl 16)) + 1
                val height = (bytes.u8(27) or (bytes.u8(28) shl 8) or (bytes.u8(29) shl 16)) + 1
                valid(width.toLong(), height.toLong())
            }

            else -> {
                null
            }
        }
    }

    private fun readJpeg(bytes: ByteArray): Dimensions? {
        val data = bytes.view(ByteOrder.BIG_ENDIAN)
        var offset = 2
        while (offset < bytes.size) {
            if (bytes.u8(offset) != 0xff) return null
            while (offset < bytes.size && bytes.u8(offset) == 0xff) offset++
            if (offset >= bytes.size) return null
            val marker = bytes.u8(offset++)
            if (marker == 0x00 || marker == 0xda) return null
            if (marker == 0x01 || marker in 0xd0..0xd9) continue
            if (offset + 2 > bytes.size) return null
            val length = data.uint16(offset)
            if (length < 2) return null
            if (marker in 0xc0..0xcf && marker != 0xc4 && marker != 0xc8 && marker != 0xcc) {
                if (offset + 7 > bytes.size) return null
                return valid(data.uint16(offset + 5).toLong(), data.uint16(offset + 3).toLong())
            }
            offset += length
        }
        return null
    }

    private fun readBmp(bytes: ByteArray): Dimensions? {
        if (bytes.size < 26) return null
        val data = bytes.view(ByteOrder.LITTLE_ENDIAN)
        val headerSize = data.uint32(14)
        if (headerSize == 12L) return valid(data.uint16(18).toLong(), data.uint16(20).toLong())
        if (headerSize < 40) return null
        return valid(abs(data.getInt(18).toLong()), abs(data.getInt(22).toLong()))
    }

    private fun valid(
        width: Long,
        height: Long,
    ): Dimensions? = if (width > 0 && height > 0) Dimensions(width, height) else null

    private fun ByteArray.u8(index: Int): Int = this[index].toInt() and 0xff

    private fun ByteArray.startsWith(
        signature: IntArray,
        offset: Int = 0,
    ): Boolean =
        size >= offset + signature.size &&
            signature.indices.all { u8(offset + it) == signature[it] }

    private fun ByteArray.ascii(
        offset: Int,
        length: Int,
    ): String =
        if (size < offset + length) "" else String(CharArray(length) { (u8(offset + it)).toChar() })

    private fun ByteArray.view(order: ByteOrder): ByteBuffer = ByteBuffer.wrap(this).order(order)

    private fun ByteBuffer.uint16(index: Int): Int = getShort(index).toInt() and 0xffff

    private fun ByteBuffer.uint32(index: Int): Long = getInt(index).toLong() and 0xffffffffL

    private companion object {
        const val MAX_VP8_DIMENSION = 0x3fff
        const val MIN_WEBP_BYTES = 64
        val PNG_SIGNATURE = intArrayOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
        val VP8_START_CODE = intArrayOf(0x9d, 0x01, 0x2a)

        fun fakeLossyWebp(
            width: Int,
            height: Int,
            quality: Double,
        ): ByteArray {
            val length =
                max(MIN_WEBP_BYTES, floor(width.toDouble() * height * quality / 8 + 0.5).toInt())
            val out = ByteBuffer.allocate(length).order(ByteOrder.LITTLE_ENDIAN)
            out.put(0, "RIFF".toByteArray(Charsets.US_ASCII))
            out.putInt(4, length - 8)
            out.put(8, "WEBP".toByteArray(Charsets.US_ASCII))
            out.put(12, "VP8 ".toByteArray(Charsets.US_ASCII))
            out.putInt(16, length - 20)
            out.put(20, 0x10.toByte())
            out.put(23, byteArrayOf(0x9d.toByte(), 0x01, 0x2a))
            out.putShort(26, width.toShort())
            out.putShort(28, height.toShort())
            return out.array()
        }
    }
}
