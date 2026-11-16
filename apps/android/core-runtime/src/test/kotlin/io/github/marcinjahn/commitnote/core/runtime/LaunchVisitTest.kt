package io.github.marcinjahn.commitnote.core.runtime

import io.github.marcinjahn.commitnote.core.runtime.services.LogLevel
import io.github.marcinjahn.commitnote.core.runtime.services.VisitSender
import io.github.marcinjahn.commitnote.core.runtime.testing.FakeCoreRuntimes
import io.github.marcinjahn.commitnote.core.runtime.testing.RecordingLogService
import io.github.marcinjahn.commitnote.core.runtime.testing.RecordingVisitSender
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class LaunchVisitTest {
    @Test
    fun `the url the core returns is sent once`() =
        blocking {
            val sender = RecordingVisitSender()

            runVisit(FakeCoreRuntimes.fakeBundle, sender)

            val url = sender.urls.single()
            assertTrue(url.startsWith("https://"))
            assertTrue("%2Fapp%2Fandroid" in url)
            assertTrue(url.endsWith("&s=411"))
        }

    @Test
    fun `nothing is sent when the core has no url`() =
        blocking {
            val sender = RecordingVisitSender()

            val noUrl = """ok: true, result: { url: null }"""

            runVisit(FakeCoreRuntimes.fakeBundle + answerVisit(noUrl), sender)

            assertEquals(emptyList<String>(), sender.urls)
        }

    @Test
    fun `a failing core answer is logged without crashing or sending`() =
        blocking {
            val sender = RecordingVisitSender()
            val logger = RecordingLogService()
            val error =
                """ok: false, error: { kind: "internal", message: "secret", transient: false }"""

            runVisit(FakeCoreRuntimes.fakeBundle + answerVisit(error), sender, logger)

            assertEquals(emptyList<String>(), sender.urls)
            val entry = logger.entries.single { it.message.startsWith("The visit failed") }
            assertEquals(LogLevel.WARN, entry.level)
            assertFalse("secret" in entry.message)
        }

    @Test
    fun `a throwing sender does not crash`() =
        blocking {
            val logger = RecordingLogService()
            val sender = VisitSender { throw IllegalStateException("https://example.test/?secret") }

            runVisit(FakeCoreRuntimes.fakeBundle, sender, logger)

            val messages = logger.entries.map { it.message }
            assertTrue(messages.any { it.startsWith("The visit failed") })
            assertTrue(messages.none { "secret" in it })
        }

    private suspend fun runVisit(
        bundle: String,
        sender: VisitSender,
        logger: RecordingLogService = RecordingLogService(),
    ) {
        val runtime = FakeCoreRuntimes.start(logger = logger, bundleSource = bundle)
        try {
            LaunchVisit(sender, logger, screenWidth = 411).run(runtime)
        } finally {
            runtime.stop()
        }
    }

    /** Replaces the core's answer to `analytics.visit` with the given response fields. */
    private fun answerVisit(response: String) =
        """
;(() => {
  const core = globalThis.CommitnoteNativeCore;
  const start = core.start;
  core.start = (host, options) => {
    const started = start(host, options);
    const send = started.send;
    started.send = (text) => {
      const request = JSON.parse(text);
      if (request.command !== "analytics.visit") return send(text);
      host.post(JSON.stringify({ kind: "response", id: request.id, $response }));
    };
    return started;
  };
})();
"""
}
