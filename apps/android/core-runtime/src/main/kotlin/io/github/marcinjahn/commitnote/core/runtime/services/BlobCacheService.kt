package io.github.marcinjahn.commitnote.core.runtime.services

class BlobCacheEntry(
    val bytes: ByteArray,
    val text: Boolean,
    val lastUsedAt: Long,
)

data class BlobCacheListing(
    val blobSha: String,
    val size: Long,
    val lastUsedAt: Long,
)

/** Ciphertext blobs per repository key, shared by remembered sessions. */
interface BlobCacheService {
    fun get(
        repoKey: String,
        blobSha: String,
    ): BlobCacheEntry?

    fun put(
        repoKey: String,
        blobSha: String,
        entry: BlobCacheEntry,
    )

    fun touch(
        repoKey: String,
        blobSha: String,
        lastUsedAt: Long,
    )

    fun delete(
        repoKey: String,
        blobSha: String,
    )

    fun list(repoKey: String): List<BlobCacheListing>

    fun listRepos(): List<String>

    fun deleteRepo(repoKey: String)
}
