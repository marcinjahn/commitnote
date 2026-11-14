package io.github.marcinjahn.commitnote.core.runtime.services

import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.PosixFilePermissions
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.io.path.readText
import kotlin.io.path.writeText

class FileBlobCacheServiceTest {
    @TempDir
    lateinit var temp: Path

    private val older = "1".repeat(40)
    private val newer = "2".repeat(40)
    private val sha256Id = "abcdef0123456789".repeat(4)
    private val repo = "sample/notes"
    private val repoDirectory = "5b7b7b25c8efdd20e54c37d95b4d54b56ac6a7660da3ba7c3ba9ec0997b24d15"

    private fun cache() = FileBlobCacheService(temp.resolve("blobs"))

    private fun entry(
        text: String,
        isText: Boolean,
        lastUsedAt: Long,
    ) = BlobCacheEntry(text.encodeToByteArray(), isText, lastUsedAt)

    private fun failure(action: () -> Unit): String? =
        runCatching(action).exceptionOrNull()?.message

    private fun mode(path: Path) =
        PosixFilePermissions.toString(Files.getPosixFilePermissions(path))

    @Test
    fun `put get list and delete round trip`() {
        val cache = cache()
        assertNull(cache.get(repo, older))
        assertTrue(cache.list(repo).isEmpty())

        cache.put(repo, older, entry("cipher one", false, 100))
        cache.put(repo, newer, entry("cipher two!", true, 200))

        val one = checkNotNull(cache.get(repo, older))
        assertArrayEquals("cipher one".encodeToByteArray(), one.bytes)
        assertFalse(one.text)
        assertEquals(100, one.lastUsedAt)
        assertTrue(checkNotNull(cache.get(repo, newer)).text)
        assertEquals(
            listOf(BlobCacheListing(older, 10, 100), BlobCacheListing(newer, 11, 200)),
            cache.list(repo),
        )

        cache.delete(repo, older)

        assertNull(cache.get(repo, older))
        assertEquals(listOf(newer), cache.list(repo).map { it.blobSha })
        cache.delete(repo, older)
    }

    @Test
    fun `put replaces an existing blob`() {
        val cache = cache()
        cache.put(repo, older, entry("first", false, 1))

        cache.put(repo, older, entry("second version", true, 2))

        val stored = checkNotNull(cache.get(repo, older))
        assertEquals("second version", stored.bytes.decodeToString())
        assertEquals(listOf(BlobCacheListing(older, 14, 2)), cache.list(repo))
    }

    @Test
    fun `repositories are isolated listed and deleted`() {
        val cache = cache()
        cache.put(repo, older, entry("a", false, 1))
        cache.put("other/repo", older, entry("b", false, 1))

        assertEquals(listOf("other/repo", repo), cache.listRepos())
        assertEquals("a", checkNotNull(cache.get(repo, older)).bytes.decodeToString())

        cache.deleteRepo(repo)

        assertEquals(listOf("other/repo"), cache.listRepos())
        assertNull(cache.get(repo, older))
        assertEquals("b", checkNotNull(cache.get("other/repo", older)).bytes.decodeToString())
        cache.deleteRepo("never/seen")
    }

    @Test
    fun `a missing root lists no repositories`() {
        assertTrue(cache().listRepos().isEmpty())
    }

    @Test
    fun `the repo directory is named by the sha-256 of the key`() {
        cache().put(repo, older, entry("x", false, 1))

        val directory = temp.resolve("blobs").resolve(repoDirectory)
        assertEquals(
            listOf(older, "index.json"),
            directory.listDirectoryEntries().map { it.name }.sorted(),
        )
        assertTrue(directory.resolve("index.json").readText().contains(repo))
    }

    @Test
    fun `directories are private and files are owner only`() {
        cache().put(repo, older, entry("x", false, 1))

        val directory = temp.resolve("blobs").resolve(repoDirectory)
        assertEquals("rwx------", mode(temp.resolve("blobs")))
        assertEquals("rwx------", mode(directory))
        assertEquals("rw-------", mode(directory.resolve(older)))
        assertEquals("rw-------", mode(directory.resolve("index.json")))
    }

    @Test
    fun `writes leave no temporary files`() {
        val cache = cache()
        cache.put(repo, older, entry("x", false, 1))
        cache.put(repo, newer, entry("y", false, 1))
        cache.delete(repo, older)

        val names =
            temp
                .resolve(
                    "blobs",
                ).resolve(repoDirectory)
                .listDirectoryEntries()
                .map { it.name }
        assertTrue(names.none { it.startsWith(".tmp") }, names.toString())
    }

    @Test
    fun `touched recency persists after flush and on close`() {
        val first = cache()
        first.put(repo, older, entry("x", false, 100))
        first.touch(repo, older, 500)
        first.touch(repo, newer, 600)

        assertEquals(500, checkNotNull(first.get(repo, older)).lastUsedAt)
        assertEquals(100, checkNotNull(cache().get(repo, older)).lastUsedAt)

        first.flush()

        assertEquals(500, checkNotNull(cache().get(repo, older)).lastUsedAt)

        first.touch(repo, older, 900)
        first.close()

        assertEquals(900, checkNotNull(cache().get(repo, older)).lastUsedAt)
        assertNull(first.get(repo, newer))
    }

    @Test
    fun `invalid blob ids are rejected before any storage access`() {
        val cache = cache()
        val invalid =
            listOf(
                "",
                "abc",
                "../".repeat(14),
                "G".repeat(40),
                "A".repeat(40),
                "1".repeat(41),
                "1".repeat(63),
            )

        for (id in invalid) {
            assertEquals("Invalid blob id", failure { cache.get(repo, id) }, id)
            assertEquals(
                "Invalid blob id",
                failure { cache.put(repo, id, entry("x", false, 1)) },
                id,
            )
            assertEquals("Invalid blob id", failure { cache.touch(repo, id, 1) }, id)
            assertEquals("Invalid blob id", failure { cache.delete(repo, id) }, id)
        }
        cache.put(repo, sha256Id, entry("x", false, 1))
        assertEquals(listOf(sha256Id), cache.list(repo).map { it.blobSha })
        assertFalse(Files.exists(temp.resolve("blobs").resolve(repoDirectory).resolve("abc")))
    }

    @Test
    fun `a missing blob file is dropped from the index`() {
        val cache = cache()
        cache.put(repo, older, entry("x", false, 1))
        Files.delete(temp.resolve("blobs").resolve(repoDirectory).resolve(older))

        assertNull(cache.get(repo, older))

        assertTrue(cache.list(repo).isEmpty())
    }

    @Test
    fun `an unreadable index invalidates its directory`() {
        cache().put(repo, older, entry("x", false, 1))
        temp
            .resolve("blobs")
            .resolve(repoDirectory)
            .resolve("index.json")
            .writeText("not json")

        val reopened = cache()

        assertNull(reopened.get(repo, older))
        assertTrue(reopened.list(repo).isEmpty())
        assertFalse(Files.exists(temp.resolve("blobs").resolve(repoDirectory)))
    }

    @Test
    fun `unreadable repo directories are dropped from the listing`() {
        cache().put(repo, older, entry("x", false, 1))
        Files.createDirectories(temp.resolve("blobs").resolve("stray"))
        temp.resolve("blobs").resolve("stray-file").writeText("x")

        assertEquals(listOf(repo), cache().listRepos())
        assertEquals(
            listOf(repoDirectory),
            temp.resolve("blobs").listDirectoryEntries().map { it.name },
        )
    }

    @Test
    fun `an index of another key invalidates its directory`() {
        cache().put(repo, older, entry("x", false, 1))
        temp
            .resolve(
                "blobs",
            ).resolve(
                repoDirectory,
            ).resolve("index.json")
            .writeText("""{"repoKey":"someone/else","blobs":{}}""")

        assertNull(cache().get(repo, older))
    }

    @Test
    fun `storage failures carry a generic message`() {
        val root = temp.resolve("blocked")
        root.writeText("a file where the root should be")
        val cache = FileBlobCacheService(root.resolve("blobs"))

        assertEquals(
            "Blob cache storage failed",
            failure {
                cache.put(repo, older, entry("secret", false, 1))
            },
        )
    }
}
