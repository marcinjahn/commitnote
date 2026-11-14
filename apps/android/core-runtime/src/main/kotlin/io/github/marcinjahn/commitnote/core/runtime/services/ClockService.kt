package io.github.marcinjahn.commitnote.core.runtime.services

interface ClockService {
    /** Epoch milliseconds. */
    fun now(): Long

    fun setTimeout(
        delayMs: Long,
        callback: Runnable,
    ): Long

    fun clearTimeout(id: Long)
}
