package io.github.marcinjahn.commitnote

import androidx.test.platform.app.InstrumentationRegistry
import io.github.marcinjahn.commitnote.core.runtime.services.BlobCacheEntry
import io.github.marcinjahn.commitnote.core.runtime.services.FileBlobCacheService
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.ExperimentalPathApi
import kotlin.io.path.deleteRecursively

/** The blob cache uses file APIs whose availability differs between the JVM and Android. */
class FileBlobCacheServiceTest {
    private val directory: Path =
        Files.createTempDirectory(
            InstrumentationRegistry
                .getInstrumentation()
                .targetContext.cacheDir
                .toPath(),
            "blob-cache-test",
        )

    @OptIn(ExperimentalPathApi::class)
    @After
    fun tearDown() {
        directory.deleteRecursively()
    }

    @Test
    fun storesAndReadsBack() {
        val cache = FileBlobCacheService(directory)
        val blobSha = "a".repeat(40)
        assertNull(cache.get(REPOSITORY, blobSha))

        cache.put(
            REPOSITORY,
            blobSha,
            BlobCacheEntry(byteArrayOf(1, 2, 3), text = false, lastUsedAt = 7),
        )

        val stored = checkNotNull(cache.get(REPOSITORY, blobSha))
        assertArrayEquals(byteArrayOf(1, 2, 3), stored.bytes)
        assertFalse(stored.text)
        assertEquals(7, stored.lastUsedAt)
    }

    @Test
    fun leavesNoTemporaryFilesBehind() {
        val cache = FileBlobCacheService(directory)

        cache.put(
            REPOSITORY,
            "b".repeat(40),
            BlobCacheEntry(byteArrayOf(1), text = true, lastUsedAt = 1),
        )

        val leftovers =
            Files.walk(directory).use { paths ->
                paths.filter { it.fileName.toString().startsWith(".tmp-") }.toList()
            }
        assertEquals(emptyList<Path>(), leftovers)
    }

    private companion object {
        const val REPOSITORY = "sample/notes"
    }
}
