package io.github.marcinjahn.commitnote.host

import android.content.Context
import android.security.keystore.KeyPermanentlyInvalidatedException
import io.github.marcinjahn.commitnote.core.api.ForgeKind
import io.github.marcinjahn.commitnote.core.api.Secret
import io.github.marcinjahn.commitnote.core.runtime.services.RememberedKeys
import io.github.marcinjahn.commitnote.core.runtime.services.RememberedSession
import io.github.marcinjahn.commitnote.core.runtime.services.RepositoryCoordinates
import io.github.marcinjahn.commitnote.core.runtime.services.ServiceException
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.GeneralSecurityException
import java.security.InvalidKeyException
import java.security.ProviderException
import java.security.UnrecoverableKeyException
import java.util.Base64
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Keeps the remembered session in memory and, while persist is on, in a file sealed with a
 * non-exportable Keystore key. The file holds a version byte, the IV length, the IV and the AES-GCM
 * ciphertext of the session as JSON. A record that can never be read again is removed; a Keystore
 * failure that may pass leaves it in place and fails the load.
 */
class KeystoreRememberedSession internal constructor(
    directory: File,
    private val keys: SessionKeyStore,
) : PersistableRememberedSession {
    constructor(
        context: Context,
    ) : this(context.noBackupFilesDir, AndroidSessionKeyStore(KEY_ALIAS))

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

    private class UnreadableRecord : Exception()

    private val lock = Any()
    private val file = File(directory, FILE_NAME)
    private var persist = true
    private var inMemory: RememberedSession? = null

    override fun setPersist(persist: Boolean) {
        synchronized(lock) {
            this.persist = persist
            if (!persist) deleteFile(SAVE_FAILED)
        }
    }

    override fun save(session: RememberedSession) {
        synchronized(lock) {
            if (persist) writeSealed(session) else deleteFile(SAVE_FAILED)
            inMemory = session.copy()
        }
    }

    override fun load(): RememberedSession? =
        synchronized(lock) {
            inMemory?.let { return it.copy() }
            if (!persist) return null
            val session =
                try {
                    readSession()
                } catch (_: UnreadableRecord) {
                    file.delete()
                    null
                }
            inMemory = session?.copy()
            session
        }

    override fun clear() {
        synchronized(lock) {
            inMemory = null
            try {
                keys.delete()
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

    private fun writeSealed(session: RememberedSession) {
        val plaintext = encode(session)
        try {
            write(seal(plaintext))
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

    private fun deleteFile(failureMessage: String) {
        try {
            Files.deleteIfExists(file.toPath())
        } catch (_: IOException) {
            throw ServiceException(failureMessage)
        }
    }

    private fun readSession(): RememberedSession? {
        val bytes =
            try {
                if (!file.exists()) return null
                file.readBytes()
            } catch (_: IOException) {
                throw ServiceException(LOAD_FAILED)
            }
        if (bytes.size < HEADER_SIZE || bytes[0] != VERSION) throw UnreadableRecord()
        val ivLength = bytes[1].toInt() and 0xFF
        val ivEnd = HEADER_SIZE + ivLength
        if (ivLength != GCM_IV_LENGTH || bytes.size <= ivEnd) throw UnreadableRecord()
        val plaintext =
            keystoreOperation {
                val key = keys.key() ?: throw UnreadableRecord()
                val cipher = Cipher.getInstance(TRANSFORMATION)
                cipher.init(
                    Cipher.DECRYPT_MODE,
                    key,
                    GCMParameterSpec(GCM_TAG_BITS, bytes, HEADER_SIZE, ivLength),
                )
                cipher.doFinal(bytes, ivEnd, bytes.size - ivEnd)
            }
        try {
            return decode(plaintext)
        } catch (_: SerializationException) {
            throw UnreadableRecord()
        } catch (_: IllegalArgumentException) {
            throw UnreadableRecord()
        } finally {
            plaintext.fill(0)
        }
    }

    /** Sorts Keystore failures into a record that is gone for good and a failure worth retrying. */
    private inline fun <T> keystoreOperation(block: () -> T): T =
        try {
            block()
        } catch (_: KeyPermanentlyInvalidatedException) {
            throw UnreadableRecord()
        } catch (_: UnrecoverableKeyException) {
            throw UnreadableRecord()
        } catch (_: AEADBadTagException) {
            throw UnreadableRecord()
        } catch (_: GeneralSecurityException) {
            throw ServiceException(LOAD_FAILED)
        } catch (_: ProviderException) {
            throw ServiceException(LOAD_FAILED)
        }

    private fun seal(plaintext: ByteArray): ByteArray {
        val cipher =
            try {
                encryptingCipher(keys.key() ?: keys.generate())
            } catch (_: InvalidKeyException) {
                keys.delete()
                encryptingCipher(keys.generate())
            }
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(plaintext)
        return byteArrayOf(VERSION, iv.size.toByte()) + iv + ciphertext
    }

    private fun encryptingCipher(key: SecretKey): Cipher =
        Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, key) }

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

    private fun RememberedSession.copy(): RememberedSession =
        RememberedSession(
            repoUrl = repoUrl,
            coordinates = coordinates,
            accessToken = accessToken,
            keys =
                RememberedKeys(
                    contentKey = keys.contentKey.copyOf(),
                    nameKey = keys.nameKey.copyOf(),
                    nameIvKey = keys.nameIvKey.copyOf(),
                    keyCheckKey = keys.keyCheckKey.copyOf(),
                ),
        )

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

    internal companion object {
        const val KEY_ALIAS = "remembered-session"
        const val FILE_NAME = "remembered-session.bin"
        const val VERSION: Byte = 1

        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val GCM_TAG_BITS = 128
        private const val GCM_IV_LENGTH = 12
        private const val HEADER_SIZE = 2
        private const val TEMPORARY_PREFIX = "remembered-session"
        private const val SAVE_FAILED = "Remembered session could not be stored"
        private const val CLEAR_FAILED = "Remembered session could not be cleared"
        private const val LOAD_FAILED = "Remembered session could not be read"
    }
}
