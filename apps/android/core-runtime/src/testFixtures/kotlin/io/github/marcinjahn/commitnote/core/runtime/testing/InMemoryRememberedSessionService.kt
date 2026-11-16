package io.github.marcinjahn.commitnote.core.runtime.testing

import io.github.marcinjahn.commitnote.core.runtime.services.RememberedKeys
import io.github.marcinjahn.commitnote.core.runtime.services.RememberedSession
import io.github.marcinjahn.commitnote.core.runtime.services.RememberedSessionService

/** Share one instance between runtimes to resume a session in the second one. */
class InMemoryRememberedSessionService : RememberedSessionService {
    @Volatile
    private var stored: RememberedSession? = null

    val session: RememberedSession? get() = stored?.copy()

    override fun save(session: RememberedSession) {
        stored = session.copy()
    }

    override fun load(): RememberedSession? = stored?.copy()

    override fun clear() {
        stored = null
    }

    private fun RememberedSession.copy() =
        RememberedSession(
            repoUrl,
            coordinates,
            accessToken,
            RememberedKeys(
                keys.contentKey.copyOf(),
                keys.nameKey.copyOf(),
                keys.nameIvKey.copyOf(),
                keys.keyCheckKey.copyOf(),
            ),
        )
}
