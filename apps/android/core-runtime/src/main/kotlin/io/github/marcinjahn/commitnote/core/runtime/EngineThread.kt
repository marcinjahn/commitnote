package io.github.marcinjahn.commitnote.core.runtime

import io.github.marcinjahn.commitnote.core.runtime.services.LogLevel
import io.github.marcinjahn.commitnote.core.runtime.services.LogService
import kotlinx.coroutines.CompletableDeferred
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit

/**
 * The one thread that owns the JS engine. [afterEachTask] runs after every task, so promise
 * reactions queued by a task settle before the next one starts.
 */
internal class EngineThread(
    private val logger: LogService,
    private val afterEachTask: () -> Unit,
) {
    private val executor =
        ScheduledThreadPoolExecutor(1) { task ->
            Thread(task, THREAD_NAME).apply { isDaemon = true }
        }.apply {
            removeOnCancelPolicy = true
            executeExistingDelayedTasksAfterShutdownPolicy = false
        }

    /** Drops [block] once the thread has shut down. */
    fun execute(block: () -> Unit) {
        try {
            executor.execute { run(block) }
        } catch (_: RejectedExecutionException) {
            // Shut down: the engine is gone, so there is nothing left to run against.
        }
    }

    fun schedule(
        delayMs: Long,
        block: () -> Unit,
    ): ScheduledFuture<*>? =
        try {
            executor.schedule({ run(block) }, delayMs, TimeUnit.MILLISECONDS)
        } catch (_: RejectedExecutionException) {
            null
        }

    /** Runs [block] on the engine thread and returns its result. */
    suspend fun <T> call(block: () -> T): T {
        val result = CompletableDeferred<T>()
        try {
            executor.execute {
                run {
                    try {
                        result.complete(block())
                    } catch (error: Throwable) {
                        result.completeExceptionally(error)
                    }
                }
            }
        } catch (_: RejectedExecutionException) {
            throw CoreRuntimeStoppedException()
        }
        return result.await()
    }

    fun shutdown() {
        executor.shutdown()
    }

    private fun run(block: () -> Unit) {
        guarded(block)
        guarded(afterEachTask)
    }

    private fun guarded(block: () -> Unit) {
        try {
            block()
        } catch (error: Exception) {
            logger.log(LogLevel.ERROR, "An engine task failed: ${error.javaClass.simpleName}")
        }
    }

    private companion object {
        const val THREAD_NAME = "commitnote-core"
    }
}
