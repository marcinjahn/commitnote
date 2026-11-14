package io.github.marcinjahn.commitnote.host

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import io.github.marcinjahn.commitnote.core.api.ForgeKind
import io.github.marcinjahn.commitnote.core.api.Secret
import io.github.marcinjahn.commitnote.core.runtime.services.RememberedKeys
import io.github.marcinjahn.commitnote.core.runtime.services.RememberedSession
import io.github.marcinjahn.commitnote.core.runtime.services.RememberedSessionService
import io.github.marcinjahn.commitnote.core.runtime.services.RepositoryCoordinates
import io.github.marcinjahn.commitnote.core.runtime.services.ServiceException
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.GeneralSecurityException
import java.security.InvalidKeyException
import java.security.KeyStore
import java.security.ProviderException
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Keeps the remembered session in a file sealed with a non-exportable Keystore key. The file holds a
 * version byte, the IV length, the IV and the AES-GCM ciphertext of the session as JSON. A record
 * that cannot be read for any reason counts as absent and is removed.
 */
class KeystoreRememberedSession(
    context: Context,
) : RememberedSessionService {
    @Serializable
    private class StoredSession(
        val repoUrl: String,
        val coordinates: StoredCoordinates,
        val accessToken: String,
        val keys: StoredKeys,
    )

    @Serializable
    private class StoredCoordinates(
        val forge: ForgeKind,
        val owner: String,
        val repo: String,
    )

    @Serializable
    private class StoredKeys(
        val contentKey: String,
        val nameKey: String,
        val nameIvKey: String,
        val keyCheckKey: String,
    )

    private val lock = Any()
    private val file = File(context.noBackupFilesDir, FILE_NAME)

    override fun save(session: RememberedSession) {
        synchronized(lock) {
            val plaintext = encode(session)
            try {
                val sealed = seal(plaintext)
                write(sealed)
            } catch (_: GeneralSecurityException) {
                throw ServiceException(SAVE_FAILED)
            } catch (_: IOException) {
                throw ServiceException(SAVE_FAILED)
            } catch (_: ProviderException) {
                throw ServiceException(SAVE_FAILED)
            } finally {
                plaintext.fill(0)
            }
        }
    }

    override fun load(): RememberedSession? =
        synchronized(lock) {
            val session =
                try {
                    readSession()
                } catch (_: Exception) {
                    null
                }
            if (session == null) file.delete()
            session
        }

    override fun clear() {
        synchronized(lock) {
            try {
                val keyStore = keyStore()
                if (keyStore.containsAlias(KEY_ALIAS)) keyStore.deleteEntry(KEY_ALIAS)
                Files.deleteIfExists(file.toPath())
            } catch (_: GeneralSecurityException) {
                throw ServiceException(CLEAR_FAILED)
            } catch (_: IOException) {
                throw ServiceException(CLEAR_FAILED)
            } catch (_: ProviderException) {
                throw ServiceException(CLEAR_FAILED)
            }
        }
    }

    private fun readSession(): RememberedSession? {
        if (!file.exists()) return null
        val bytes = file.readBytes()
        if (bytes.size < HEADER_SIZE || bytes[0] != VERSION) return null
        val ivLength = bytes[1].toInt() and 0xFF
        val ivEnd = HEADER_SIZE + ivLength
        if (ivLength != GCM_IV_LENGTH || bytes.size <= ivEnd) return null
        val key = keyStore().getKey(KEY_ALIAS, null) as? SecretKey ?: return null
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(
            Cipher.DECRYPT_MODE,
            key,
            GCMParameterSpec(GCM_TAG_BITS, bytes, HEADER_SIZE, ivLength),
        )
        val plaintext = cipher.doFinal(bytes, ivEnd, bytes.size - ivEnd)
        try {
            return decode(plaintext)
        } finally {
            plaintext.fill(0)
        }
    }

    private fun seal(plaintext: ByteArray): ByteArray {
        val cipher =
            try {
                encryptingCipher(existingOrNewKey())
            } catch (_: InvalidKeyException) {
                encryptingCipher(replacedKey())
            }
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(plaintext)
        return byteArrayOf(VERSION, iv.size.toByte()) + iv + ciphertext
    }

    private fun encryptingCipher(key: SecretKey): Cipher =
        Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, key) }

    private fun existingOrNewKey(): SecretKey =
        keyStore().getKey(KEY_ALIAS, null) as? SecretKey ?: generateKey()

    private fun replacedKey(): SecretKey {
        keyStore().deleteEntry(KEY_ALIAS)
        return generateKey()
    }

    private fun generateKey(): SecretKey {
        val spec =
            KeyGenParameterSpec
                .Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(KEY_SIZE_BITS)
                .build()
        return KeyGenerator
            .getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEY_STORE)
            .apply { init(spec) }
            .generateKey()
    }

    private fun write(sealed: ByteArray) {
        val directory = file.parentFile ?: throw IOException()
        directory.mkdirs()
        val temporary = File.createTempFile(TEMPORARY_PREFIX, null, directory)
        try {
            FileOutputStream(temporary).use { output ->
                output.write(sealed)
                output.fd.sync()
            }
            Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE)
        } finally {
            temporary.delete()
        }
    }

    private fun encode(session: RememberedSession): ByteArray {
        val base64 = Base64.getEncoder()
        val stored =
            StoredSession(
                repoUrl = session.repoUrl,
                coordinates =
                    StoredCoordinates(
                        forge = session.coordinates.forge,
                        owner = session.coordinates.owner,
                        repo = session.coordinates.repo,
                    ),
                accessToken = session.accessToken.expose(),
                keys =
                    StoredKeys(
                        contentKey = base64.encodeToString(session.keys.contentKey),
                        nameKey = base64.encodeToString(session.keys.nameKey),
                        nameIvKey = base64.encodeToString(session.keys.nameIvKey),
                        keyCheckKey = base64.encodeToString(session.keys.keyCheckKey),
                    ),
            )
        return Json.encodeToString(StoredSession.serializer(), stored).toByteArray(Charsets.UTF_8)
    }

    private fun decode(plaintext: ByteArray): RememberedSession {
        val stored =
            Json.decodeFromString(StoredSession.serializer(), plaintext.toString(Charsets.UTF_8))
        val base64 = Base64.getDecoder()
        return RememberedSession(
            repoUrl = stored.repoUrl,
            coordinates =
                RepositoryCoordinates(
                    forge = stored.coordinates.forge,
                    owner = stored.coordinates.owner,
                    repo = stored.coordinates.repo,
                ),
            accessToken = Secret(stored.accessToken),
            keys =
                RememberedKeys(
                    contentKey = base64.decode(stored.keys.contentKey),
                    nameKey = base64.decode(stored.keys.nameKey),
                    nameIvKey = base64.decode(stored.keys.nameIvKey),
                    keyCheckKey = base64.decode(stored.keys.keyCheckKey),
                ),
        )
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }

    internal companion object {
        const val KEY_ALIAS = "remembered-session"
        const val FILE_NAME = "remembered-session.bin"
        const val VERSION: Byte = 1

        private const val ANDROID_KEY_STORE = "AndroidKeyStore"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val KEY_SIZE_BITS = 256
        private const val GCM_TAG_BITS = 128
        private const val GCM_IV_LENGTH = 12
        private const val HEADER_SIZE = 2
        private const val TEMPORARY_PREFIX = "remembered-session"
        private const val SAVE_FAILED = "Remembered session could not be stored"
        private const val CLEAR_FAILED = "Remembered session could not be cleared"
    }
}
