package io.github.marcinjahn.commitnote.core.runtime.engine.javet

import com.caoccao.javet.interfaces.IJavetLogger
import io.github.marcinjahn.commitnote.core.runtime.services.LogLevel
import io.github.marcinjahn.commitnote.core.runtime.services.LogService
import java.util.logging.Handler
import java.util.logging.Level
import java.util.logging.LogRecord
import java.util.logging.Logger

internal class JavetLogger(
    private val target: LogService,
) : IJavetLogger {
    override fun debug(message: String) = target.log(LogLevel.DEBUG, message)

    override fun info(message: String) = target.log(LogLevel.INFO, message)

    override fun warn(message: String) = target.log(LogLevel.WARN, message)

    override fun error(message: String) = target.log(LogLevel.ERROR, message)

    override fun error(
        message: String,
        cause: Throwable,
    ) = target.log(LogLevel.ERROR, message)
}

/**
 * Javet's library loader and host log through `java.util.logging` before any runtime exists, so
 * those records go to the log service of the most recently created engine instead of stderr.
 */
internal object JavetLogRouting {
    @Volatile
    private var target: LogService? = null

    // java.util.logging holds loggers weakly; this reference keeps the configuration alive.
    private val logger: Logger =
        Logger.getLogger("com.caoccao.javet").apply {
            useParentHandlers = false
            addHandler(
                object : Handler() {
                    override fun publish(record: LogRecord) {
                        val message = record.message ?: return
                        target?.log(level(record.level), message)
                    }

                    override fun flush() = Unit

                    override fun close() = Unit
                },
            )
        }

    fun route(service: LogService) {
        target = service
    }

    private fun level(level: Level): LogLevel =
        when {
            level.intValue() >= Level.SEVERE.intValue() -> LogLevel.ERROR
            level.intValue() >= Level.WARNING.intValue() -> LogLevel.WARN
            level.intValue() >= Level.INFO.intValue() -> LogLevel.INFO
            else -> LogLevel.DEBUG
        }
}
