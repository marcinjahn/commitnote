package io.github.marcinjahn.commitnote.core.runtime

import io.github.marcinjahn.commitnote.core.api.CoreCommand
import io.github.marcinjahn.commitnote.core.api.CoreCommands
import io.github.marcinjahn.commitnote.core.api.Empty
import io.github.marcinjahn.commitnote.core.runtime.services.Argon2idParameters
import io.github.marcinjahn.commitnote.core.runtime.services.BlobCacheEntry
import io.github.marcinjahn.commitnote.core.runtime.services.BlobCacheService
import io.github.marcinjahn.commitnote.core.runtime.services.CryptoService
import io.github.marcinjahn.commitnote.core.runtime.services.FileBlobCacheService
import io.github.marcinjahn.commitnote.core.runtime.services.JcaCryptoService
import io.github.marcinjahn.commitnote.core.runtime.services.LogLevel
import io.github.marcinjahn.commitnote.core.runtime.testing.FakeCoreRuntimes
import io.github.marcinjahn.commitnote.core.runtime.testing.RecordingLogService
import kotlinx.serialization.Serializable
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.util.concurrent.atomic.AtomicBoolean

class HostFailureTest {
    @Test
    fun `an Error on a host thread rejects the promise and the runtime stays usable`() =
        blocking {
            val failing = FailsOnce { NoClassDefFoundError("java/lang/ProcessHandle") }
            val crypto =
                object : CryptoService by JcaCryptoService() {
                    override fun argon2id(parameters: Argon2idParameters): ByteArray {
                        failing.check()
                        return ByteArray(parameters.hashLength)
                    }
                }
            val logger = RecordingLogService()
            val runtime =
                FakeCoreRuntimes.start(
                    FakeCoreRuntimes.hostServices(crypto = crypto),
                    logger,
                    FakeCoreRuntimes.fakeBundle + HOST_PROBE,
                )

            val first = runtime.send(probeArgon2, Empty).outcome
            val second = runtime.send(probeArgon2, Empty).outcome
            val name = runtime.send(CoreCommands.deviceName, Empty).name
            runtime.stop()

            assertEquals("Argon2id failed", first)
            assertEquals(RESOLVED, second)
            assertTrue(name.isNotEmpty())
            assertTrue(errorLog("Host operation failed: NoClassDefFoundError") in logger.entries)
        }

    @Test
    fun `an Error on the storage thread rejects the promise and the runtime stays usable`() =
        blocking {
            val failing = FailsOnce { NoSuchMethodError("missing on this device") }
            val files = FileBlobCacheService(Files.createTempDirectory("commitnote-blob-cache"))
            val blobCache =
                object : BlobCacheService by files {
                    override fun put(
                        repoKey: String,
                        blobSha: String,
                        entry: BlobCacheEntry,
                    ) {
                        failing.check()
                        files.put(repoKey, blobSha, entry)
                    }
                }
            val runtime =
                FakeCoreRuntimes.start(
                    FakeCoreRuntimes.hostServices(blobCache = blobCache),
                    RecordingLogService(),
                    FakeCoreRuntimes.fakeBundle + HOST_PROBE,
                )

            val first = runtime.send(probeBlobPut, Empty).outcome
            val second = runtime.send(probeBlobPut, Empty).outcome
            runtime.stop()

            assertEquals("Blob cache write failed", first)
            assertEquals(RESOLVED, second)
        }

    @Test
    fun `an Error that escapes an engine task is logged and the thread keeps running`() =
        blocking {
            val logger = RecordingLogService()
            val engineThread = EngineThread(logger) {}

            engineThread.execute { throw StackOverflowError() }
            val answer = engineThread.call { "still running" }
            engineThread.shutdown()

            assertEquals("still running", answer)
            assertTrue(errorLog("An engine task failed: StackOverflowError") in logger.entries)
        }

    private fun errorLog(message: String) = RecordingLogService.Entry(LogLevel.ERROR, message)

    private class FailsOnce(
        private val error: () -> Error,
    ) {
        private val failed = AtomicBoolean()

        fun check() {
            if (failed.compareAndSet(false, true)) throw error()
        }
    }

    @Serializable
    private data class Outcome(
        val outcome: String,
    )

    private val probeArgon2 =
        CoreCommand("probe.argon2id", Empty.serializer(), Outcome.serializer())
    private val probeBlobPut =
        CoreCommand("probe.blobPut", Empty.serializer(), Outcome.serializer())

    private companion object {
        const val RESOLVED = "resolved"

        /** Answers each `probe.*` command with how the matching host promise settled. */
        const val HOST_PROBE = """
;(() => {
  const core = globalThis.CommitnoteNativeCore;
  const start = core.start;
  const operations = {
    "probe.argon2id": (host) => host.crypto.argon2id({
      password: new Uint8Array([1]),
      salt: new Uint8Array(16),
      memoryKiB: 64,
      iterations: 1,
      parallelism: 1,
      hashLength: 32,
    }),
    "probe.blobPut": (host) => host.blobCache.put("repo", "a".repeat(40), {
      bytes: new Uint8Array([1]),
      text: false,
      lastUsedAt: 1,
    }),
  };
  core.start = (host, options) => {
    const started = start(host, options);
    const send = started.send;
    started.send = (text) => {
      const request = JSON.parse(text);
      const operation = operations[request.command];
      if (!operation) {
        return send(text);
      }
      const answer = (outcome) => host.post(JSON.stringify({
        kind: "response",
        id: request.id,
        ok: true,
        result: { outcome },
      }));
      operation(host).then(
        () => answer("resolved"),
        (error) => answer(error instanceof Error ? error.message : String(error)),
      );
    };
    return started;
  };
})();
"""
    }
}
