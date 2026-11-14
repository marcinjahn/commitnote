package io.github.marcinjahn.commitnote.core.runtime

import io.github.marcinjahn.commitnote.core.api.CoreCommands
import io.github.marcinjahn.commitnote.core.api.CoreEvent
import io.github.marcinjahn.commitnote.core.api.Empty
import io.github.marcinjahn.commitnote.core.api.FakeCheckVectorsParams
import io.github.marcinjahn.commitnote.core.api.FakeCoreCommands
import io.github.marcinjahn.commitnote.core.api.FakeHttpRequestParams
import io.github.marcinjahn.commitnote.core.api.FakeTimerProbeParams
import io.github.marcinjahn.commitnote.core.api.NoteOpenParams
import io.github.marcinjahn.commitnote.core.api.OpenNote
import io.github.marcinjahn.commitnote.core.api.SessionLogoutParams
import io.github.marcinjahn.commitnote.core.api.SessionResumeResult
import io.github.marcinjahn.commitnote.core.runtime.services.CryptoService
import io.github.marcinjahn.commitnote.core.runtime.services.JcaCryptoService
import io.github.marcinjahn.commitnote.core.runtime.services.OkHttpHttpService
import io.github.marcinjahn.commitnote.core.runtime.testing.FakeCoreRuntimes
import io.github.marcinjahn.commitnote.core.runtime.testing.InMemoryRememberedSessionService
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.yield
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonObject
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File
import java.net.InetAddress
import java.util.concurrent.atomic.AtomicInteger
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.TimeSource

class FakeCoreConformanceTest {
    @Test
    fun `every test vector passes through the host services`() =
        blocking {
            val directory = File(checkNotNull(System.getProperty("commitnote.testVectors")))
            val files =
                directory
                    .listFiles { file -> file.name.endsWith(".json") }
                    .orEmpty()
                    .sortedBy { it.name }
                    .associate { it.name to Json.parseToJsonElement(it.readText()) }
            assertTrue(files.isNotEmpty(), "no vector files found")
            val expected = files.values.sumOf(::expectedChecks)
            val runtime = FakeCoreRuntimes.start()

            val result = runtime.send(FakeCoreCommands.checkVectors, FakeCheckVectorsParams(files))
            runtime.stop()

            assertEquals(emptyList<String>(), result.failures)
            assertEquals(expected, result.checked)
        }

    @Test
    fun `the whole sample notes repo decrypts`() =
        blocking {
            val runtime = FakeCoreRuntimes.start()
            val tree = runtime.logIn(SAMPLE_REPO, SAMPLE_PASSPHRASE)
            val expected =
                runtime
                    .send(FakeCoreCommands.expectedSampleNotes, Empty)
                    .notes
                    .associate { it.path to it.text }

            val paths = notePaths(tree)
            assertEquals(expected.keys, paths.toSet())
            assertEquals(expected.size, paths.size)
            for (path in paths) {
                val text = runtime.openLoaded(path)
                assertTrue(expected[path] == text, "a note differs from the expected sample text")
            }
            runtime.stop()
        }

    @Test
    fun `a remembered session resumes in a second runtime`() =
        blocking {
            val remembered = InMemoryRememberedSessionService()
            val first =
                FakeCoreRuntimes.start(
                    FakeCoreRuntimes.hostServices(rememberedSession = remembered),
                )
            first.logIn(SAMPLE_REPO, SAMPLE_PASSPHRASE)
            first.stop()
            assertNotNull(remembered.session, "logging in remembered no session")

            val second =
                FakeCoreRuntimes.start(
                    FakeCoreRuntimes.hostServices(rememberedSession = remembered),
                )
            val resumed = second.send(CoreCommands.sessionResume, Empty)

            assertEquals(SessionResumeResult.Resumed, resumed)
            assertTrue(notePaths(second.waitForTree()).isNotEmpty())
            second.stop()
        }

    @Test
    fun `timers fire in delay order and can be cancelled`() =
        blocking {
            val runtime = FakeCoreRuntimes.start()
            val started = TimeSource.Monotonic.markNow()

            val result =
                runtime.send(
                    FakeCoreCommands.timerProbe,
                    FakeTimerProbeParams(listOf(50, 10, 30), 0),
                )

            assertEquals(listOf(1, 2), result.fired)
            assertTrue(started.elapsedNow() >= 30.milliseconds)
            runtime.stop()
        }

    @Test
    fun `http requests reach an https server and report non-2xx statuses`() {
        val localhost = InetAddress.getByName("localhost")
        val certificate =
            HeldCertificate
                .Builder()
                .addSubjectAlternativeName(localhost.canonicalHostName)
                .addSubjectAlternativeName("localhost")
                .addSubjectAlternativeName("127.0.0.1")
                .build()
        val trusted =
            HandshakeCertificates
                .Builder()
                .addTrustedCertificate(certificate.certificate)
                .build()
        val client =
            OkHttpClient
                .Builder()
                .sslSocketFactory(trusted.sslSocketFactory(), trusted.trustManager)
                .build()
        MockWebServer().use { server ->
            server.useHttps(
                HandshakeCertificates
                    .Builder()
                    .heldCertificate(certificate)
                    .build()
                    .sslSocketFactory(),
            )
            server.start(localhost, 0)
            server.enqueue(
                MockResponse
                    .Builder()
                    .code(201)
                    .addHeader("X-Reply", "Yes")
                    .body("reply ✓\nsecond line")
                    .build(),
            )
            server.enqueue(
                MockResponse
                    .Builder()
                    .code(404)
                    .body("not here")
                    .build(),
            )

            blocking {
                val runtime =
                    FakeCoreRuntimes.start(
                        FakeCoreRuntimes.hostServices(http = OkHttpHttpService(client)),
                    )
                val created =
                    runtime.send(
                        FakeCoreCommands.httpRequest,
                        FakeHttpRequestParams(
                            "POST",
                            server.url("/echo?x=1").toString(),
                            mapOf("X-Custom-Header" to "Value 1", "Content-Type" to "text/plain"),
                            "héllo\nbody",
                        ),
                    )
                val missing =
                    runtime.send(
                        FakeCoreCommands.httpRequest,
                        FakeHttpRequestParams(
                            "GET",
                            server.url("/missing").toString(),
                            emptyMap(),
                            "",
                        ),
                    )
                runtime.stop()

                assertEquals(201, created.status)
                assertEquals("Yes", created.headers["x-reply"])
                assertEquals("reply ✓\nsecond line", created.bodyText)
                assertEquals(404, missing.status)
                assertEquals("not here", missing.bodyText)
            }

            val posted = server.takeRequest()
            assertEquals("POST", posted.method)
            assertEquals("/echo?x=1", posted.target)
            assertEquals("Value 1", posted.headers["X-Custom-Header"])
            assertEquals("héllo\nbody", posted.body?.utf8())
            assertEquals("GET", server.takeRequest().method)
        }
    }

    @Test
    fun `stop fails pending requests and nothing is emitted afterwards`() =
        blocking {
            val runtime = FakeCoreRuntimes.start()
            val events = mutableListOf<CoreEvent>()
            val collector =
                launch(Dispatchers.Default, CoroutineStart.UNDISPATCHED) {
                    runtime.events.collect { event -> synchronized(events) { events += event } }
                }
            val pending =
                async(start = CoroutineStart.UNDISPATCHED) {
                    runCatching {
                        runtime.send(
                            FakeCoreCommands.timerProbe,
                            FakeTimerProbeParams(listOf(60_000), null),
                        )
                    }
                }
            runtime.send(CoreCommands.deviceName, Empty)

            runtime.stop()
            runtime.stop()
            val seenAtStop = synchronized(events) { events.size }
            delay(200.milliseconds)

            assertInstanceOf(
                CoreRuntimeStoppedException::class.java,
                pending.await().exceptionOrNull(),
            )
            assertEquals(seenAtStop, synchronized(events) { events.size })
            val later = runCatching { runtime.send(CoreCommands.deviceName, Empty) }
            assertInstanceOf(CoreRuntimeStoppedException::class.java, later.exceptionOrNull())
            collector.cancel()
        }

    @Test
    fun `session end clears the crypto key handles`() =
        blocking {
            val crypto = ClearCountingCrypto()
            val runtime = FakeCoreRuntimes.start(FakeCoreRuntimes.hostServices(crypto = crypto))
            runtime.logIn(SAMPLE_REPO, SAMPLE_PASSPHRASE)
            val ended =
                async(Dispatchers.Default, CoroutineStart.UNDISPATCHED) {
                    runtime.events.first { it is CoreEvent.SessionEnded }
                }
            yield()
            assertEquals(0, crypto.clears.get())

            runtime.send(CoreCommands.sessionLogout, SessionLogoutParams(anyway = false))
            ended.await()
            runtime.send(CoreCommands.deviceName, Empty)

            assertTrue(crypto.clears.get() >= 1, "the session ended without clearing the keys")
            runtime.stop()
        }

    private class ClearCountingCrypto(
        private val inner: CryptoService = JcaCryptoService(),
    ) : CryptoService by inner {
        val clears = AtomicInteger()

        override fun clear() {
            clears.incrementAndGet()
            inner.clear()
        }
    }

    private suspend fun CoreRuntime.openLoaded(path: List<String>): String =
        poll {
            when (val note = send(CoreCommands.noteOpen, NoteOpenParams(path)).note) {
                is OpenNote.Loading -> null
                is OpenNote.Loaded -> note.content
                else -> error("a note did not load: ${note?.javaClass?.simpleName}")
            }
        }

    private fun expectedChecks(file: JsonElement): Int =
        1 + file.jsonObject.values.sumOf { (it as? JsonArray)?.size ?: 0 }
}
