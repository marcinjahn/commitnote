package io.github.marcinjahn.commitnote.core.runtime

import io.github.marcinjahn.commitnote.core.api.AnalyticsVisitParams
import io.github.marcinjahn.commitnote.core.api.CoreCommands
import io.github.marcinjahn.commitnote.core.runtime.services.LogLevel
import io.github.marcinjahn.commitnote.core.runtime.services.LogService
import io.github.marcinjahn.commitnote.core.runtime.services.VisitSender
import kotlinx.coroutines.CancellationException

/**
 * Asks the core for the visit URL and, when it returns one, hands it to [sender]. Nothing is
 * awaited beyond the core's answer, and failures are logged without detail. [screenWidth] is in
 * dp, or null when unknown.
 */
class LaunchVisit(
    private val sender: VisitSender,
    private val logger: LogService,
    private val screenWidth: Int?,
) {
    suspend fun run(runtime: CoreRuntime) {
        try {
            runtime
                .send(CoreCommands.analyticsVisit, AnalyticsVisitParams(screenWidth))
                .url
                ?.let(sender::send)
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            logger.log(LogLevel.WARN, "The visit failed: ${error.javaClass.simpleName}")
        }
    }
}
