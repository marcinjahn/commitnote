package io.github.marcinjahn.commitnote.core.runtime.services

@JvmInline
value class KeyHandle(
    val id: String,
)

enum class KeyAlgorithm {
    AES_GCM,
    HMAC_SHA_256,
    HKDF,
}

enum class DigestAlgorithm {
    SHA_1,
    SHA_256,
}

class Argon2idParameters(
    val password: ByteArray,
    val salt: ByteArray,
    val memoryKiB: Int,
    val iterations: Int,
    val parallelism: Int,
    val hashLength: Int,
)

/** Owns the key material behind every [KeyHandle] it hands out. */
interface CryptoService {
    /** Copies [raw]; the caller may zero its array afterwards. */
    fun importKey(
        raw: ByteArray,
        algorithm: KeyAlgorithm,
    ): KeyHandle

    /** Returns the ciphertext followed by the 16-byte tag. [iv] must be 12 bytes. */
    fun aesGcmEncrypt(
        key: KeyHandle,
        iv: ByteArray,
        additionalData: ByteArray,
        plaintext: ByteArray,
    ): ByteArray

    /** Returns null when authentication fails. */
    fun aesGcmDecrypt(
        key: KeyHandle,
        iv: ByteArray,
        additionalData: ByteArray,
        sealed: ByteArray,
    ): ByteArray?

    fun hkdfSha256(
        key: KeyHandle,
        salt: ByteArray,
        info: ByteArray,
        lengthBytes: Int,
    ): ByteArray

    fun hmacSha256(
        key: KeyHandle,
        data: ByteArray,
    ): ByteArray

    fun digest(
        algorithm: DigestAlgorithm,
        data: ByteArray,
    ): ByteArray

    /** Blocking and memory-hungry; callers run it off their main executor. */
    fun argon2id(parameters: Argon2idParameters): ByteArray

    /** The raw bytes behind [handle], for persisting a remembered session. */
    fun rawKey(handle: KeyHandle): ByteArray

    /** Drops every handle. */
    fun clear()
}
