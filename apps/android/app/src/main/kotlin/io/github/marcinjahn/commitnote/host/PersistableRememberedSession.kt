package io.github.marcinjahn.commitnote.host

import io.github.marcinjahn.commitnote.core.runtime.services.RememberedSessionService

/**
 * A remembered session store whose disk copy the user can opt out of. While persist is off the
 * session lives only in memory, so it lasts until the process ends.
 */
interface PersistableRememberedSession : RememberedSessionService {
    fun setPersist(persist: Boolean)
}
