package io.github.marcinjahn.commitnote.core.runtime

import io.github.marcinjahn.commitnote.core.api.CoreEvent
import io.github.marcinjahn.commitnote.core.api.CoreMessage
import io.github.marcinjahn.commitnote.core.api.CoreMessageException
import io.github.marcinjahn.commitnote.core.api.CoreResponse
import io.github.marcinjahn.commitnote.core.api.CoreWire
import io.github.marcinjahn.commitnote.core.runtime.services.LogLevel
import io.github.marcinjahn.commitnote.core.runtime.services.LogService
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.serialization.json.JsonElement

/** Matches core responses to pending requests and fans events out to collectors. */
internal class CoreRouter(
    private val logger: LogService,
) {
    private val lock = Any()
    private var stopped = false
    private var lastId = 0L
    private val pending = HashMap<Long, CompletableDeferred<JsonElement>>()
    private val eventFlow = MutableSharedFlow<CoreEvent>(extraBufferCapacity = Int.MAX_VALUE)

    val events: SharedFlow<CoreEvent> = eventFlow.asSharedFlow()

    val isStopped: Boolean get() = synchronized(lock) { stopped }

    /** @throws CoreRuntimeStoppedException once [stop] has run. */
    fun register(): Pair<Long, CompletableDeferred<JsonElement>> =
        synchronized(lock) {
            if (stopped) throw CoreRuntimeStoppedException()
            lastId += 1
            val deferred = CompletableDeferred<JsonElement>()
            pending[lastId] = deferred
            lastId to deferred
        }

    fun forget(id: Long) {
        synchronized(lock) { pending.remove(id) }
    }

    fun fail(
        id: Long,
        error: Throwable,
    ): Boolean = synchronized(lock) { pending.remove(id) }?.completeExceptionally(error) ?: false

    /** Returns whether the message ended the session. */
    fun receive(message: String): Boolean {
        val parsed =
            try {
                CoreWire.parse(message)
            } catch (error: CoreMessageException) {
                logger.log(LogLevel.WARN, "Ignored a core message: ${error.message}")
                return false
            }
        return when (parsed) {
            is CoreMessage.Response -> {
                settle(parsed.response)
                false
            }

            is CoreMessage.Event -> {
                emit(parsed)
            }
        }
    }

    /** Returns true the first time; fails every pending request. */
    fun stop(): Boolean {
        val failed =
            synchronized(lock) {
                if (stopped) return false
                stopped = true
                pending.values.toList().also { pending.clear() }
            }
        failed.forEach { it.completeExceptionally(CoreRuntimeStoppedException()) }
        return true
    }

    private fun settle(response: CoreResponse) {
        val (deferred, stoppedNow) = synchronized(lock) { pending.remove(response.id) to stopped }
        if (deferred == null) {
            if (!stoppedNow) {
                val detail = (response as? CoreResponse.Failure)?.error?.kind?.wireName ?: "ok"
                logger.log(
                    LogLevel.WARN,
                    "Ignored a core response for unknown request ${response.id} ($detail)",
                )
            }
            return
        }
        when (response) {
            is CoreResponse.Success -> deferred.complete(response.result)
            is CoreResponse.Failure -> deferred.completeExceptionally(CoreException(response.error))
        }
    }

    private fun emit(message: CoreMessage.Event): Boolean {
        val event =
            try {
                CoreEvent.decode(message.event)
            } catch (error: CoreMessageException) {
                logger.log(LogLevel.WARN, "Ignored a core message: ${error.message}")
                return false
            }
        synchronized(lock) {
            if (stopped) return false
            eventFlow.tryEmit(event)
        }
        return event is CoreEvent.SessionEnded
    }
}
