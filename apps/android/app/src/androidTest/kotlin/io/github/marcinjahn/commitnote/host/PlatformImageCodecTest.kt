package io.github.marcinjahn.commitnote.host

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import androidx.exifinterface.media.ExifInterface
import androidx.test.platform.app.InstrumentationRegistry
import io.github.marcinjahn.commitnote.core.runtime.services.ImageHandle
import io.github.marcinjahn.commitnote.core.runtime.services.ServiceException
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

class PlatformImageCodecTest {
    private val codec = PlatformImageCodec()

    @Test
    fun decodeAppliesExifOrientation() {
        val jpeg = jpeg(width = 40, height = 20, orientation = ExifInterface.ORIENTATION_ROTATE_90)

        val decoded = codec.decode(jpeg)

        assertEquals(20, decoded.width)
        assertEquals(40, decoded.height)
    }

    @Test
    fun decodeKeepsUnrotatedJpegDimensions() {
        val decoded = codec.decode(jpeg(width = 40, height = 20, orientation = null))

        assertEquals(40, decoded.width)
        assertEquals(20, decoded.height)
    }

    @Test
    fun decodeAcceptsPngWithAlpha() {
        val bitmap = Bitmap.createBitmap(16, 8, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(Color.argb(128, 255, 0, 0))
        val png =
            ByteArrayOutputStream().also {
                bitmap.compress(
                    Bitmap.CompressFormat.PNG,
                    100,
                    it,
                )
            }

        val decoded = codec.decode(png.toByteArray())

        assertEquals(16, decoded.width)
        assertEquals(8, decoded.height)
    }

    @Test
    fun decodeRejectsGarbage() {
        assertThrows(ServiceException::class.java) { codec.decode(ByteArray(128) { it.toByte() }) }
    }

    @Test
    fun decodeRejectsEmptyInput() {
        assertThrows(ServiceException::class.java) { codec.decode(ByteArray(0)) }
    }

    @Test
    fun decodeHandlesAreDistinct() {
        val bytes = jpeg(width = 8, height = 8, orientation = null)

        assertNotEquals(codec.decode(bytes).handle, codec.decode(bytes).handle)
    }

    @Test
    fun encodeWebpProducesLossyWebpAtTheRequestedSize() {
        val decoded = codec.decode(jpeg(width = 64, height = 48, orientation = null))

        val webp = codec.encodeWebp(decoded.handle, 32, 24, 0.8f)

        assertArrayEquals("RIFF".toByteArray(), webp.copyOfRange(0, 4))
        assertArrayEquals("WEBP".toByteArray(), webp.copyOfRange(8, 12))
        assertIsLossy(webp)
        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(webp, 0, webp.size, options)
        assertEquals(32, options.outWidth)
        assertEquals(24, options.outHeight)
    }

    @Test
    fun encodeWebpAtFullQualityIsStillLossy() {
        val decoded = codec.decode(jpeg(width = 64, height = 48, orientation = null))

        val webp = codec.encodeWebp(decoded.handle, 64, 48, 1f)

        assertIsLossy(webp)
        assertNotNull(BitmapFactory.decodeByteArray(webp, 0, webp.size))
    }

    @Test
    fun encodeWebpCanBeRepeatedFromOneHandle() {
        val decoded = codec.decode(jpeg(width = 64, height = 48, orientation = null))

        val first = codec.encodeWebp(decoded.handle, 32, 24, 0.5f)
        val second = codec.encodeWebp(decoded.handle, 32, 24, 0.5f)

        assertArrayEquals(first, second)
    }

    @Test
    fun encodeWebpWithAnUnknownHandleFails() {
        val failure =
            assertThrows(ServiceException::class.java) {
                codec.encodeWebp(ImageHandle("img-0"), 8, 8, 0.5f)
            }

        assertEquals("Unknown image handle", failure.message)
    }

    @Test
    fun releaseInvalidatesTheHandle() {
        val decoded = codec.decode(jpeg(width = 8, height = 8, orientation = null))

        codec.release(decoded.handle)

        assertThrows(ServiceException::class.java) { codec.encodeWebp(decoded.handle, 8, 8, 0.5f) }
        assertThrows(ServiceException::class.java) { codec.release(decoded.handle) }
    }

    @Test
    fun releaseOfAnUnknownHandleFails() {
        val failure =
            assertThrows(ServiceException::class.java) { codec.release(ImageHandle("img-unknown")) }

        assertEquals("Unknown image handle", failure.message)
    }

    /** Newer platforms wrap the bitstream in an extended container, so look through the RIFF chunks for it. */
    private fun assertIsLossy(webp: ByteArray) {
        val chunks = riffChunkTypes(webp)
        assertTrue("no lossy bitstream chunk in $chunks", "VP8 " in chunks)
        assertFalse("lossless bitstream chunk in $chunks", "VP8L" in chunks)
    }

    private fun riffChunkTypes(webp: ByteArray): List<String> {
        val buffer = ByteBuffer.wrap(webp).order(ByteOrder.LITTLE_ENDIAN)
        val types = mutableListOf<String>()
        var offset = RIFF_HEADER_SIZE
        while (offset + CHUNK_HEADER_SIZE <= webp.size) {
            types += webp.decodeToString(offset, offset + FOURCC_SIZE)
            val size = buffer.getInt(offset + FOURCC_SIZE)
            offset += CHUNK_HEADER_SIZE + size + (size and 1)
        }
        return types
    }

    private fun jpeg(
        width: Int,
        height: Int,
        orientation: Int?,
    ): ByteArray {
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        for (x in 0 until width) {
            for (y in 0 until height) {
                bitmap.setPixel(x, y, Color.rgb(x * 255 / width, y * 255 / height, 128))
            }
        }
        val directory = InstrumentationRegistry.getInstrumentation().targetContext.cacheDir
        val file = File.createTempFile("codec-test", ".jpg", directory)
        try {
            file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 90, it) }
            if (orientation != null) {
                ExifInterface(file).apply {
                    setAttribute(ExifInterface.TAG_ORIENTATION, orientation.toString())
                    saveAttributes()
                }
            }
            return file.readBytes()
        } finally {
            file.delete()
        }
    }

    private companion object {
        const val RIFF_HEADER_SIZE = 12
        const val FOURCC_SIZE = 4
        const val CHUNK_HEADER_SIZE = 8
    }
}
