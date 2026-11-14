package io.github.marcinjahn.commitnote.core.runtime.services

enum class LogLevel {
    DEBUG,
    INFO,
    WARN,
    ERROR,
}

/** Never receives note contents, names or paths. */
interface LogService {
    fun log(
        level: LogLevel,
        message: String,
    )
}
