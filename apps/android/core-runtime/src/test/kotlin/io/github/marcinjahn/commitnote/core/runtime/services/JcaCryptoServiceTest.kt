package io.github.marcinjahn.commitnote.core.runtime.services

import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class JcaCryptoServiceTest {
    private val crypto = JcaCryptoService()

    private fun failure(action: () -> Unit): String? =
        runCatching(action).exceptionOrNull()?.message

    @Test
    fun `aes-gcm seals and opens the known answers`() {
        val vectors = TestVectors.array("primitives.json", "aesGcm")
        assertTrue(vectors.isNotEmpty())
        for (vector in vectors.map { it.jsonObject }) {
            val key = crypto.importKey(vector.hex("keyHex"), KeyAlgorithm.AES_GCM)
            val iv = vector.hex("ivHex")
            val aad = vector.hex("aadHex")

            val sealed = crypto.aesGcmEncrypt(key, iv, aad, vector.hex("plaintextHex"))

            assertArrayEquals(vector.hex("ciphertextHex"), sealed)
            assertArrayEquals(
                vector.hex("plaintextHex"),
                crypto.aesGcmDecrypt(key, iv, aad, sealed),
            )
        }
    }

    @Test
    fun `aes-gcm returns null when authentication fails`() {
        val key = crypto.importKey(ByteArray(32) { 7 }, KeyAlgorithm.AES_GCM)
        val iv = ByteArray(12) { 3 }
        val aad = byteArrayOf(9, 9)
        val sealed = crypto.aesGcmEncrypt(key, iv, aad, byteArrayOf(1, 2, 3, 4, 5))

        fun flipped(index: Int) =
            crypto.aesGcmDecrypt(
                key,
                iv,
                aad,
                sealed.copyOf().also {
                    it[index] =
                        (it[index].toInt() xor 1).toByte()
                },
            )

        assertEquals(5 + 16, sealed.size)
        assertNull(flipped(sealed.size - 1))
        assertNull(flipped(sealed.size - 16))
        assertNull(flipped(0))
        assertNull(crypto.aesGcmDecrypt(key, iv, byteArrayOf(9), sealed))
        assertNull(crypto.aesGcmDecrypt(key, iv, aad, byteArrayOf(1, 2, 3)))
        assertNull(crypto.aesGcmDecrypt(key, iv, aad, ByteArray(0)))
    }

    @Test
    fun `aes keys must be 16 or 32 bytes and the iv 12 bytes`() {
        assertEquals(
            "Invalid key length",
            failure {
                crypto.importKey(ByteArray(24), KeyAlgorithm.AES_GCM)
            },
        )
        assertEquals(
            "Invalid key length",
            failure { crypto.importKey(ByteArray(0), KeyAlgorithm.AES_GCM) },
        )
        crypto.importKey(ByteArray(16), KeyAlgorithm.AES_GCM)

        val key = crypto.importKey(ByteArray(16), KeyAlgorithm.AES_GCM)
        assertEquals(
            "AES-GCM IV must be 12 bytes",
            failure {
                crypto.aesGcmEncrypt(key, ByteArray(11), ByteArray(0), ByteArray(1))
            },
        )
        assertEquals(
            "AES-GCM IV must be 12 bytes",
            failure {
                crypto.aesGcmDecrypt(key, ByteArray(13), ByteArray(0), ByteArray(16))
            },
        )
    }

    @Test
    fun `hkdf matches the known answers`() {
        val vectors = TestVectors.array("primitives.json", "hkdfSha256")
        assertTrue(vectors.isNotEmpty())
        for (vector in vectors.map { it.jsonObject }) {
            val key = crypto.importKey(vector.hex("ikmHex"), KeyAlgorithm.HKDF)

            val derived =
                crypto.hkdfSha256(
                    key,
                    vector.hex("saltHex"),
                    vector.hex("infoHex"),
                    vector.int("lengthBytes"),
                )

            assertArrayEquals(vector.hex("okmHex"), derived)
        }
    }

    @Test
    fun `hkdf length is bounded`() {
        val key = crypto.importKey(byteArrayOf(1), KeyAlgorithm.HKDF)

        assertEquals(8160, crypto.hkdfSha256(key, ByteArray(0), ByteArray(0), 8160).size)
        assertEquals(1, crypto.hkdfSha256(key, ByteArray(0), ByteArray(0), 1).size)
        assertEquals(
            "Invalid HKDF length",
            failure {
                crypto.hkdfSha256(key, ByteArray(0), ByteArray(0), 8161)
            },
        )
        assertEquals(
            "Invalid HKDF length",
            failure {
                crypto.hkdfSha256(key, ByteArray(0), ByteArray(0), 0)
            },
        )
        assertEquals(
            "Invalid HKDF length",
            failure {
                crypto.hkdfSha256(key, ByteArray(0), ByteArray(0), -1)
            },
        )
    }

    @Test
    fun `hmac matches the known answers`() {
        val vectors = TestVectors.array("primitives.json", "hmacSha256")
        assertTrue(vectors.isNotEmpty())
        for (vector in vectors.map { it.jsonObject }) {
            val key = crypto.importKey(vector.hex("keyHex"), KeyAlgorithm.HMAC_SHA_256)

            assertArrayEquals(vector.hex("macHex"), crypto.hmacSha256(key, vector.hex("dataHex")))
        }
    }

    @Test
    fun `an empty hmac key works as the zero key`() {
        val key = crypto.importKey(ByteArray(0), KeyAlgorithm.HMAC_SHA_256)

        assertArrayEquals(
            "b613679a0814d9ec772f95d778c35fc5ff1697c493715653c6c712144292c5ad".hexToByteArray(),
            crypto.hmacSha256(key, ByteArray(0)),
        )
    }

    @Test
    fun `digests match the known answers`() {
        for (vector in TestVectors.array("primitives.json", "sha1").map { it.jsonObject }) {
            assertArrayEquals(
                vector.hex("digestHex"),
                crypto.digest(DigestAlgorithm.SHA_1, vector.hex("dataHex")),
            )
        }
        for (vector in TestVectors.array("primitives.json", "sha256").map { it.jsonObject }) {
            assertArrayEquals(
                vector.hex("digestHex"),
                crypto.digest(DigestAlgorithm.SHA_256, vector.hex("dataHex")),
            )
        }
    }

    @Test
    fun `argon2id matches the known answers`() {
        val vectors = TestVectors.array("argon2id.json", "vectors")
        assertTrue(vectors.isNotEmpty())
        for (vector in vectors.map { it.jsonObject }) {
            val output =
                crypto.argon2id(
                    Argon2idParameters(
                        password = vector.text("password").encodeToByteArray(),
                        salt = vector.hex("saltHex"),
                        memoryKiB = vector.int("memoryKiB"),
                        iterations = vector.int("iterations"),
                        parallelism = vector.int("parallelism"),
                        hashLength = vector.int("hashLength"),
                    ),
                )

            assertArrayEquals(vector.hex("outputHex"), output, vector.text("name"))
        }
    }

    @Test
    fun `argon2id derives the keyring master secrets`() {
        for (vector in TestVectors.array("keyring.json", "vectors").map { it.jsonObject }) {
            val kdf = vector.getValue("kdf").jsonObject

            val master =
                crypto.argon2id(
                    Argon2idParameters(
                        password = vector.text("passphrase").encodeToByteArray(),
                        salt = kdf.hex("saltHex"),
                        memoryKiB = kdf.int("memoryKiB"),
                        iterations = kdf.int("iterations"),
                        parallelism = kdf.int("parallelism"),
                        hashLength = 32,
                    ),
                )

            assertArrayEquals(vector.hex("masterSecretHex"), master, vector.text("name"))
        }
    }

    @Test
    fun `argon2id rejects unusable parameters`() {
        fun parameters(
            memoryKiB: Int = 8,
            iterations: Int = 1,
            parallelism: Int = 1,
            hashLength: Int = 32,
        ) = Argon2idParameters(
            byteArrayOf(1),
            ByteArray(16),
            memoryKiB,
            iterations,
            parallelism,
            hashLength,
        )

        assertEquals(32, crypto.argon2id(parameters()).size)
        for (
        invalid in
        listOf(
            parameters(memoryKiB = 7),
            parameters(iterations = 0),
            parameters(parallelism = 0),
            parameters(hashLength = 3),
            parameters(hashLength = 1025),
        )
        ) {
            assertEquals("Invalid Argon2id parameters", failure { crypto.argon2id(invalid) })
        }
    }

    @Test
    fun `a handle only works for the algorithm it was imported for`() {
        val aes = crypto.importKey(ByteArray(16), KeyAlgorithm.AES_GCM)
        val hmac = crypto.importKey(byteArrayOf(1), KeyAlgorithm.HMAC_SHA_256)
        val hkdf = crypto.importKey(byteArrayOf(1), KeyAlgorithm.HKDF)
        val iv = ByteArray(12)
        val unknown = KeyHandle("k9999")

        val attempts =
            listOf<() -> Unit>(
                { crypto.aesGcmEncrypt(hmac, iv, ByteArray(0), ByteArray(1)) },
                { crypto.aesGcmDecrypt(hkdf, iv, ByteArray(0), ByteArray(16)) },
                { crypto.hmacSha256(aes, ByteArray(1)) },
                { crypto.hmacSha256(hkdf, ByteArray(1)) },
                { crypto.hkdfSha256(aes, ByteArray(0), ByteArray(0), 8) },
                { crypto.hkdfSha256(hmac, ByteArray(0), ByteArray(0), 8) },
                { crypto.aesGcmEncrypt(unknown, iv, ByteArray(0), ByteArray(1)) },
                { crypto.rawKey(unknown) },
            )
        for (attempt in attempts) {
            assertEquals("Unknown key handle", failure(attempt))
        }
    }

    @Test
    fun `importing copies the key and handles are unique`() {
        val raw = ByteArray(16) { 5 }
        val first = crypto.importKey(raw, KeyAlgorithm.AES_GCM)
        val second = crypto.importKey(raw, KeyAlgorithm.AES_GCM)
        raw.fill(0)

        assertNotEquals(first, second)
        assertArrayEquals(ByteArray(16) { 5 }, crypto.rawKey(first))
        crypto.rawKey(first).fill(1)
        assertArrayEquals(ByteArray(16) { 5 }, crypto.rawKey(first))
    }

    @Test
    fun `clear drops every handle`() {
        val key = crypto.importKey(ByteArray(16), KeyAlgorithm.AES_GCM)

        crypto.clear()

        assertThrows(ServiceException::class.java) { crypto.rawKey(key) }
        assertEquals(
            "Unknown key handle",
            failure { crypto.aesGcmEncrypt(key, ByteArray(12), ByteArray(0), ByteArray(1)) },
        )
        crypto.importKey(ByteArray(16), KeyAlgorithm.AES_GCM)
    }
}
