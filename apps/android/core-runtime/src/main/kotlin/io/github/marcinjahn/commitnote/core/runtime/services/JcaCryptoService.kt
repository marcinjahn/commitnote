package io.github.marcinjahn.commitnote.core.runtime.services

import org.bouncycastle.crypto.generators.Argon2BytesGenerator
import org.bouncycastle.crypto.params.Argon2Parameters
import java.security.GeneralSecurityException
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

class JcaCryptoService : CryptoService {
    private class StoredKey(
        val raw: ByteArray,
        val algorithm: KeyAlgorithm,
    )

    private val keys = ConcurrentHashMap<String, StoredKey>()
    private val nextId = AtomicLong(1)

    override fun importKey(
        raw: ByteArray,
        algorithm: KeyAlgorithm,
    ): KeyHandle {
        if (algorithm == KeyAlgorithm.AES_GCM && raw.size !in AES_KEY_LENGTHS) {
            throw ServiceException("Invalid key length")
        }
        val id = "k${nextId.getAndIncrement()}"
        keys[id] = StoredKey(raw.copyOf(), algorithm)
        return KeyHandle(id)
    }

    override fun aesGcmEncrypt(
        key: KeyHandle,
        iv: ByteArray,
        additionalData: ByteArray,
        plaintext: ByteArray,
    ): ByteArray = aesGcm(Cipher.ENCRYPT_MODE, key, iv, additionalData, plaintext)

    override fun aesGcmDecrypt(
        key: KeyHandle,
        iv: ByteArray,
        additionalData: ByteArray,
        sealed: ByteArray,
    ): ByteArray? =
        try {
            aesGcm(Cipher.DECRYPT_MODE, key, iv, additionalData, sealed)
        } catch (_: AEADBadTagException) {
            null
        }

    override fun hkdfSha256(
        key: KeyHandle,
        salt: ByteArray,
        info: ByteArray,
        lengthBytes: Int,
    ): ByteArray {
        val inputKeyMaterial = rawFor(key, KeyAlgorithm.HKDF)
        if (lengthBytes !in 1..MAX_HKDF_LENGTH) throw ServiceException("Invalid HKDF length")
        val pseudoRandomKey =
            hmac(if (salt.isEmpty()) ByteArray(SHA_256_LENGTH) else salt, inputKeyMaterial)
        val expand =
            Mac.getInstance(HMAC_SHA_256).apply {
                init(SecretKeySpec(pseudoRandomKey, HMAC_SHA_256))
            }
        val output = ByteArray(lengthBytes)
        var previous = ByteArray(0)
        var written = 0
        var counter = 1
        while (written < lengthBytes) {
            expand.update(previous)
            expand.update(info)
            expand.update(counter.toByte())
            previous = expand.doFinal()
            val count = minOf(previous.size, lengthBytes - written)
            previous.copyInto(output, written, 0, count)
            written += count
            counter++
        }
        pseudoRandomKey.fill(0)
        return output
    }

    override fun hmacSha256(
        key: KeyHandle,
        data: ByteArray,
    ): ByteArray = hmac(rawFor(key, KeyAlgorithm.HMAC_SHA_256), data)

    override fun digest(
        algorithm: DigestAlgorithm,
        data: ByteArray,
    ): ByteArray =
        MessageDigest
            .getInstance(
                when (algorithm) {
                    DigestAlgorithm.SHA_1 -> "SHA-1"
                    DigestAlgorithm.SHA_256 -> "SHA-256"
                },
            ).digest(data)

    override fun argon2id(parameters: Argon2idParameters): ByteArray {
        val valid =
            parameters.memoryKiB >= MIN_ARGON2_MEMORY_KIB &&
                parameters.hashLength in MIN_ARGON2_HASH_LENGTH..MAX_ARGON2_HASH_LENGTH &&
                parameters.iterations > 0 &&
                parameters.parallelism > 0
        if (!valid) throw ServiceException(INVALID_ARGON2)
        val output = ByteArray(parameters.hashLength)
        try {
            val engineParameters =
                Argon2Parameters
                    .Builder(Argon2Parameters.ARGON2_id)
                    .withVersion(Argon2Parameters.ARGON2_VERSION_13)
                    .withMemoryAsKB(parameters.memoryKiB)
                    .withIterations(parameters.iterations)
                    .withParallelism(parameters.parallelism)
                    .withSalt(parameters.salt)
                    .build()
            Argon2BytesGenerator()
                .apply {
                    init(
                        engineParameters,
                    )
                }.generateBytes(parameters.password, output)
        } catch (_: IllegalArgumentException) {
            throw ServiceException(INVALID_ARGON2)
        } catch (_: IllegalStateException) {
            throw ServiceException(INVALID_ARGON2)
        }
        return output
    }

    override fun rawKey(handle: KeyHandle): ByteArray =
        (keys[handle.id] ?: throw ServiceException(UNKNOWN_HANDLE)).raw.copyOf()

    override fun clear() {
        keys.values.forEach { it.raw.fill(0) }
        keys.clear()
    }

    private fun rawFor(
        handle: KeyHandle,
        algorithm: KeyAlgorithm,
    ): ByteArray {
        val stored = keys[handle.id]
        if (stored == null || stored.algorithm != algorithm) throw ServiceException(UNKNOWN_HANDLE)
        return stored.raw
    }

    private fun aesGcm(
        mode: Int,
        key: KeyHandle,
        iv: ByteArray,
        additionalData: ByteArray,
        input: ByteArray,
    ): ByteArray {
        val raw = rawFor(key, KeyAlgorithm.AES_GCM)
        if (iv.size != GCM_IV_LENGTH) throw ServiceException("AES-GCM IV must be 12 bytes")
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(mode, SecretKeySpec(raw, "AES"), GCMParameterSpec(GCM_TAG_BITS, iv))
            cipher.updateAAD(additionalData)
            return cipher.doFinal(input)
        } catch (error: AEADBadTagException) {
            throw error
        } catch (_: GeneralSecurityException) {
            throw ServiceException(OPERATION_FAILED)
        }
    }

    /** HMAC treats an empty key as all zeros, which [SecretKeySpec] refuses to build. */
    private fun hmac(
        key: ByteArray,
        data: ByteArray,
    ): ByteArray {
        val mac = Mac.getInstance(HMAC_SHA_256)
        mac.init(SecretKeySpec(if (key.isEmpty()) ByteArray(1) else key, HMAC_SHA_256))
        return mac.doFinal(data)
    }

    private companion object {
        val AES_KEY_LENGTHS = setOf(16, 32)
        const val GCM_IV_LENGTH = 12
        const val GCM_TAG_BITS = 128
        const val SHA_256_LENGTH = 32
        const val MAX_HKDF_LENGTH = 255 * SHA_256_LENGTH
        const val MIN_ARGON2_MEMORY_KIB = 8
        const val MIN_ARGON2_HASH_LENGTH = 4
        const val MAX_ARGON2_HASH_LENGTH = 1024
        const val HMAC_SHA_256 = "HmacSHA256"
        const val UNKNOWN_HANDLE = "Unknown key handle"
        const val OPERATION_FAILED = "Crypto operation failed"
        const val INVALID_ARGON2 = "Invalid Argon2id parameters"
    }
}
