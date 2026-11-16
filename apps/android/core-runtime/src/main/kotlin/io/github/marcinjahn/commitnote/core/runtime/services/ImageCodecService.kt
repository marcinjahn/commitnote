package io.github.marcinjahn.commitnote.core.runtime.services

@JvmInline
value class ImageHandle(
    val id: String,
)

data class DecodedImage(
    val handle: ImageHandle,
    val width: Int,
    val height: Int,
)

interface ImageCodecService {
    /**
     * Decodes with the image's orientation applied.
     *
     * @throws ServiceException when [bytes] are not a decodable image.
     */
    fun decode(bytes: ByteArray): DecodedImage

    /** Lossy WebP of the decoded image scaled to [width] x [height]; [quality] is within 0..1. */
    fun encodeWebp(
        handle: ImageHandle,
        width: Int,
        height: Int,
        quality: Float,
    ): ByteArray

    fun release(handle: ImageHandle)
}
