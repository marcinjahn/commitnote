package io.github.marcinjahn.commitnote.core.runtime.services

interface RandomService {
    /** [length] is within 0..[MAX_LENGTH]. */
    fun randomBytes(length: Int): ByteArray

    companion object {
        const val MAX_LENGTH = 65_536
    }
}
