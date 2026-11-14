package io.github.marcinjahn.commitnote.core.runtime.services

import io.github.marcinjahn.commitnote.core.api.ForgeKind
import io.github.marcinjahn.commitnote.core.api.Secret

data class RepositoryCoordinates(
    val forge: ForgeKind,
    val owner: String,
    val repo: String,
)

class RememberedKeys(
    val contentKey: ByteArray,
    val nameKey: ByteArray,
    val nameIvKey: ByteArray,
    val keyCheckKey: ByteArray,
)

class RememberedSession(
    val repoUrl: String,
    val coordinates: RepositoryCoordinates,
    val accessToken: Secret,
    val keys: RememberedKeys,
)

/** Persists raw key material, never a passphrase. */
interface RememberedSessionService {
    fun save(session: RememberedSession)

    fun load(): RememberedSession?

    fun clear()
}
