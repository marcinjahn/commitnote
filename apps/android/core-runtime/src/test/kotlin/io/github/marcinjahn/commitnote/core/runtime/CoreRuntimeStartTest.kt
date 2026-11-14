package io.github.marcinjahn.commitnote.core.runtime

import io.github.marcinjahn.commitnote.core.api.CoreCommand
import io.github.marcinjahn.commitnote.core.api.CoreCommands
import io.github.marcinjahn.commitnote.core.api.Empty
import io.github.marcinjahn.commitnote.core.api.NativeCoreApi
import io.github.marcinjahn.commitnote.core.api.NativePlatform
import io.github.marcinjahn.commitnote.core.runtime.testing.FakeCoreRuntimes
import io.github.marcinjahn.commitnote.core.runtime.testing.RecordingLogService
import kotlinx.serialization.Serializable
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class CoreRuntimeStartTest {
    @Test
    fun `the real core bundle starts as android`() =
        blocking {
            val runtime =
                FakeCoreRuntimes.create(
                    bundleSource =
                        FakeCoreRuntimes.realBundle + IDENTITY_PROBE,
                )

            runtime.start(NativePlatform.ANDROID, FakeCoreRuntimes.DEVICE_MODEL)
            val identity = runtime.send(identityProbe, Empty)
            val name = runtime.send(CoreCommands.deviceName, Empty).name
            runtime.stop()

            assertEquals(NativeCoreApi.MARKER, identity.marker)
            assertEquals(8, identity.apiVersion)
            assertTrue(name.isNotEmpty())
        }

    @Test
    fun `a bundle with another marker is rejected before start`() {
        val failure = startFailure(stubBundle(marker = "something-else"))

        assertInstanceOf(CoreStartException.MarkerMismatch::class.java, failure)
        assertTrue(failure.message!!.contains("something-else"))
        assertTrue(failure.message!!.contains(NativeCoreApi.MARKER))
    }

    @Test
    fun `a bundle with another api version is rejected before start`() {
        val failure = startFailure(stubBundle(apiVersion = NativeCoreApi.VERSION - 1))

        assertInstanceOf(CoreStartException.ApiVersionMismatch::class.java, failure)
        assertTrue(failure.message!!.contains("${NativeCoreApi.VERSION - 1}"))
        assertTrue(failure.message!!.contains("${NativeCoreApi.VERSION}"))
    }

    @Test
    fun `a throwing bundle reports the exception`() {
        val failure = startFailure("throw new Error(\"broken bundle\");")

        assertInstanceOf(CoreStartException.JavaScriptException::class.java, failure)
        assertTrue(failure.message!!.contains("broken bundle"))
    }

    @Test
    fun `a start that returns nothing is invalid`() {
        assertInstanceOf(
            CoreStartException.BundleInvalid::class.java,
            startFailure(stubBundle(startBody = "")),
        )
    }

    @Serializable
    private data class Identity(
        val marker: String,
        val apiVersion: Int,
    )

    private val identityProbe =
        CoreCommand("probe.identity", Empty.serializer(), Identity.serializer())

    private fun stubBundle(
        marker: String = NativeCoreApi.MARKER,
        apiVersion: Int = NativeCoreApi.VERSION,
        startBody: String = "throw new Error(\"start must not run\");",
    ) = "globalThis.CommitnoteNativeCore = " +
        "{ marker: \"$marker\", apiVersion: $apiVersion, start(host) { $startBody } };"

    private fun startFailure(bundle: String): Throwable =
        blocking {
            val runtime =
                FakeCoreRuntimes.create(
                    logger = RecordingLogService(),
                    bundleSource = bundle,
                )
            val failure =
                runCatching { runtime.start(NativePlatform.ANDROID, FakeCoreRuntimes.DEVICE_MODEL) }
            val afterwards = runCatching { runtime.send(CoreCommands.deviceName, Empty) }
            assertInstanceOf(CoreRuntimeStoppedException::class.java, afterwards.exceptionOrNull())
            checkNotNull(failure.exceptionOrNull()) { "the bundle started" }
        }

    private companion object {
        /** Answers `probe.identity` with the marker and API version the bundle declares. */
        const val IDENTITY_PROBE = """
;(() => {
  const core = globalThis.CommitnoteNativeCore;
  const start = core.start;
  core.start = (host, options) => {
    const started = start(host, options);
    const send = started.send;
    started.send = (text) => {
      const request = JSON.parse(text);
      if (request.command !== "probe.identity") {
        return send(text);
      }
      host.post(JSON.stringify({
        kind: "response",
        id: request.id,
        ok: true,
        result: { marker: core.marker, apiVersion: core.apiVersion },
      }));
    };
    return started;
  };
})();
"""
    }
}
