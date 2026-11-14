package io.github.marcinjahn.commitnote.core.runtime.testing

import io.github.marcinjahn.commitnote.core.runtime.services.LogLevel
import io.github.marcinjahn.commitnote.core.runtime.services.LogService
import java.util.concurrent.CopyOnWriteArrayList

class RecordingLogService : LogService {
    data class Entry(
        val level: LogLevel,
        val message: String,
    )

    private val recorded = CopyOnWriteArrayList<Entry>()

    val entries: List<Entry> get() = recorded.toList()

    override fun log(
        level: LogLevel,
        message: String,
    ) {
        recorded.add(Entry(level, message))
    }
}
