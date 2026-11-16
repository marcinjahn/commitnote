package io.github.marcinjahn.commitnote.core.runtime.services

import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import java.io.FileOutputStream
import java.io.IOException
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.attribute.PosixFilePermissions
import java.security.MessageDigest
import java.util.UUID

/**
 * One directory per repository key, named by the SHA-256 of the key, holding the blobs by id and
 * an `index.json` with their metadata. Recency updates from [touch] reach disk on the next write
 * or on [flush].
 */
class FileBlobCacheService(
    private val root: Path,
) : BlobCacheService,
    AutoCloseable {
    @Serializable
    private class IndexEntry(
        val size: Long,
        val lastUsedAt: Long,
        val text: Boolean,
    )

    @Serializable
    private class RepoIndex(
        val repoKey: String,
        val blobs: MutableMap<String, IndexEntry> = mutableMapOf(),
    )

    private val lock = Any()
    private val indexes = mutableMapOf<String, RepoIndex>()
    private val dirty = mutableSetOf<String>()

    override fun get(
        repoKey: String,
        blobSha: String,
    ): BlobCacheEntry? {
        validateBlobId(blobSha)
        synchronized(lock) {
            val index = load(repoKey) ?: return null
            val entry = index.blobs[blobSha] ?: return null
            val bytes =
                try {
                    Files.readAllBytes(blobPath(repoKey, blobSha))
                } catch (_: IOException) {
                    index.blobs.remove(blobSha)
                    dirty.add(repoKey)
                    return null
                }
            return BlobCacheEntry(bytes, entry.text, entry.lastUsedAt)
        }
    }

    override fun put(
        repoKey: String,
        blobSha: String,
        entry: BlobCacheEntry,
    ) {
        validateBlobId(blobSha)
        synchronized(lock) {
            val index = load(repoKey) ?: RepoIndex(repoKey).also { indexes[repoKey] = it }
            storage { writeAtomically(blobPath(repoKey, blobSha), entry.bytes) }
            index.blobs[blobSha] =
                IndexEntry(entry.bytes.size.toLong(), entry.lastUsedAt, entry.text)
            persist(index)
        }
    }

    override fun touch(
        repoKey: String,
        blobSha: String,
        lastUsedAt: Long,
    ) {
        validateBlobId(blobSha)
        synchronized(lock) {
            val entry = load(repoKey)?.blobs?.get(blobSha) ?: return
            index(repoKey).blobs[blobSha] = IndexEntry(entry.size, lastUsedAt, entry.text)
            dirty.add(repoKey)
        }
    }

    override fun delete(
        repoKey: String,
        blobSha: String,
    ) {
        validateBlobId(blobSha)
        synchronized(lock) {
            val index = load(repoKey) ?: return
            storage { remove(blobPath(repoKey, blobSha)) }
            if (index.blobs.remove(blobSha) != null) persist(index)
        }
    }

    override fun list(repoKey: String): List<BlobCacheListing> =
        synchronized(lock) {
            load(repoKey)
                ?.blobs
                ?.entries
                ?.sortedBy { it.key }
                ?.map { (blobSha, entry) ->
                    BlobCacheListing(blobSha, entry.size, entry.lastUsedAt)
                }.orEmpty()
        }

    override fun listRepos(): List<String> =
        synchronized(lock) {
            if (!Files.isDirectory(root)) return emptyList()
            storage {
                val directories = Files.newDirectoryStream(root).use { it.toList() }
                val keys = mutableListOf<String>()
                for (directory in directories) {
                    val index = readIndex(directory)
                    if (index == null) remove(directory) else keys.add(index.repoKey)
                }
                keys.sorted()
            }
        }

    override fun deleteRepo(repoKey: String) {
        synchronized(lock) {
            indexes.remove(repoKey)
            dirty.remove(repoKey)
            storage { remove(repoDirectory(repoKey)) }
        }
    }

    /** Writes the recency updates that have not reached disk yet. */
    fun flush() {
        synchronized(lock) {
            dirty.toList().forEach { repoKey ->
                val index = indexes[repoKey]
                if (index == null || runCatching { persist(index) }.isSuccess) dirty.remove(repoKey)
            }
        }
    }

    override fun close() = flush()

    private fun index(repoKey: String): RepoIndex = checkNotNull(indexes[repoKey])

    /** An index that cannot be read, or belongs to another key, invalidates its directory. */
    private fun load(repoKey: String): RepoIndex? {
        indexes[repoKey]?.let { return it }
        val directory = repoDirectory(repoKey)
        val stored = readIndex(directory)
        if (stored == null || stored.repoKey != repoKey) {
            storage { remove(directory) }
            return null
        }
        indexes[repoKey] = stored
        return stored
    }

    private fun persist(index: RepoIndex) {
        val data = Json.encodeToString(RepoIndex.serializer(), index).toByteArray()
        try {
            storage { writeAtomically(repoDirectory(index.repoKey).resolve(INDEX_NAME), data) }
        } catch (error: ServiceException) {
            dirty.add(index.repoKey)
            throw error
        }
        dirty.remove(index.repoKey)
    }

    private fun readIndex(directory: Path): RepoIndex? =
        try {
            Json.decodeFromString(
                RepoIndex.serializer(),
                Files.readAllBytes(directory.resolve(INDEX_NAME)).decodeToString(),
            )
        } catch (_: IOException) {
            null
        } catch (_: SerializationException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }

    private fun repoDirectory(repoKey: String): Path = root.resolve(sha256Hex(repoKey))

    private fun blobPath(
        repoKey: String,
        blobSha: String,
    ): Path = repoDirectory(repoKey).resolve(blobSha)

    private fun validateBlobId(blobSha: String) {
        val valid =
            blobSha.length in BLOB_ID_LENGTHS && blobSha.all { it in '0'..'9' || it in 'a'..'f' }
        if (!valid) throw ServiceException("Invalid blob id")
    }

    private inline fun <T> storage(action: () -> T): T =
        try {
            action()
        } catch (_: IOException) {
            throw ServiceException(STORAGE_FAILED)
        }

    private fun sha256Hex(value: String): String =
        MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") {
            "%02x".format(it)
        }

    private fun writeAtomically(
        path: Path,
        bytes: ByteArray,
    ) {
        val directory = checkNotNull(path.parent)
        Files.createDirectories(directory, PRIVATE_DIRECTORY)
        val temp =
            directory.resolve(".tmp-${UUID.randomUUID()}")
        try {
            Files.createFile(temp, PRIVATE_FILE)
            FileOutputStream(temp.toFile()).use { output ->
                output.write(bytes)
                output.fd.sync()
            }
            Files.move(temp, path, StandardCopyOption.ATOMIC_MOVE)
        } catch (error: IOException) {
            Files.deleteIfExists(temp)
            throw error
        }
    }

    private fun remove(path: Path) {
        if (!Files.exists(path, LinkOption.NOFOLLOW_LINKS)) return
        if (Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS)) {
            Files.walk(path).use { paths ->
                paths.sorted(Comparator.reverseOrder()).forEach(Files::delete)
            }
        } else {
            Files.delete(path)
        }
    }

    private companion object {
        const val INDEX_NAME = "index.json"
        const val STORAGE_FAILED = "Blob cache storage failed"
        val BLOB_ID_LENGTHS = setOf(40, 64)
        val PRIVATE_DIRECTORY =
            PosixFilePermissions.asFileAttribute(
                PosixFilePermissions.fromString("rwx------"),
            )
        val PRIVATE_FILE =
            PosixFilePermissions.asFileAttribute(
                PosixFilePermissions.fromString("rw-------"),
            )
    }
}
