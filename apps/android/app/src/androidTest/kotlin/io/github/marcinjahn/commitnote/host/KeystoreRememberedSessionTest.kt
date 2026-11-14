package io.github.marcinjahn.commitnote.host

import androidx.test.platform.app.InstrumentationRegistry
import io.github.marcinjahn.commitnote.core.runtime.services.RememberedSession
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.security.KeyStore

class KeystoreRememberedSessionTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val file = File(context.noBackupFilesDir, KeystoreRememberedSession.FILE_NAME)
    private lateinit var remembered: KeystoreRememberedSession

    @Before
    fun setUp() {
        remembered = KeystoreRememberedSession(context)
        remembered.clear()
    }

    @After
    fun tearDown() {
        remembered.clear()
    }

    @Test
    fun loadWithoutSaveIsNull() {
        assertNull(remembered.load())
    }

    @Test
    fun saveThenLoadReturnsTheSession() {
        remembered.save(sampleSession())

        assertSessionEquals(sampleSession(), remembered.load())
        assertSessionEquals(sampleSession(), KeystoreRememberedSession(context).load())
    }

    @Test
    fun saveOverwritesThePreviousSession() {
        remembered.save(sampleSession())
        val replacement =
            sampleSession().let {
                RememberedSession(
                    repoUrl = "https://gitlab.com/group/other",
                    coordinates = it.coordinates,
                    accessToken = it.accessToken,
                    keys = it.keys,
                )
            }

        remembered.save(replacement)

        assertSessionEquals(replacement, remembered.load())
    }

    @Test
    fun savedFileDoesNotContainThePlaintext() {
        remembered.save(sampleSession())

        val text = String(file.readBytes(), Charsets.ISO_8859_1)
        assertFalse(text.contains("token-0123456789"))
        assertFalse(text.contains("octocat"))
    }

    @Test
    fun keyIsNotExportable() {
        remembered.save(sampleSession())

        val key = keyStore().getKey(KeystoreRememberedSession.KEY_ALIAS, null)
        assertNull(key.encoded)
    }

    @Test
    fun clearMakesLoadNullAndRemovesFileAndKey() {
        remembered.save(sampleSession())

        remembered.clear()

        assertNull(remembered.load())
        assertFalse(file.exists())
        assertFalse(keyStore().containsAlias(KeystoreRememberedSession.KEY_ALIAS))
    }

    @Test
    fun clearWithoutSaveDoesNotFail() {
        remembered.clear()
    }

    @Test
    fun corruptedCiphertextIsNullAndTheFileIsRemoved() {
        remembered.save(sampleSession())
        val bytes = file.readBytes()
        bytes[bytes.lastIndex] = (bytes.last().toInt() xor 0x01).toByte()
        file.writeBytes(bytes)

        assertNull(remembered.load())
        assertFalse(file.exists())
    }

    @Test
    fun garbageFileIsNullAndTheFileIsRemoved() {
        remembered.save(sampleSession())
        file.writeBytes(ByteArray(64) { 0x7f })

        assertNull(remembered.load())
        assertFalse(file.exists())
    }

    @Test
    fun wrongVersionIsNullAndTheFileIsRemoved() {
        remembered.save(sampleSession())
        val bytes = file.readBytes()
        bytes[0] = (KeystoreRememberedSession.VERSION + 1).toByte()
        file.writeBytes(bytes)

        assertNull(remembered.load())
        assertFalse(file.exists())
    }

    @Test
    fun truncatedFileIsNullAndTheFileIsRemoved() {
        remembered.save(sampleSession())
        file.writeBytes(file.readBytes().copyOf(1))

        assertNull(remembered.load())
        assertFalse(file.exists())
    }

    @Test
    fun deletedKeyWithFilePresentIsNullAndTheFileIsRemoved() {
        remembered.save(sampleSession())
        keyStore().deleteEntry(KeystoreRememberedSession.KEY_ALIAS)
        assertTrue(file.exists())

        assertNull(remembered.load())
        assertFalse(file.exists())
    }

    @Test
    fun saveAfterTheKeyWasDeletedCreatesANewKey() {
        remembered.save(sampleSession())
        keyStore().deleteEntry(KeystoreRememberedSession.KEY_ALIAS)

        remembered.save(sampleSession())

        assertSessionEquals(sampleSession(), remembered.load())
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
}
