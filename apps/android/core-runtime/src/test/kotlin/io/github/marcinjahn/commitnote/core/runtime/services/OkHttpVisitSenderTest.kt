package io.github.marcinjahn.commitnote.core.runtime.services

import io.github.marcinjahn.commitnote.core.runtime.testing.RecordingLogService
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.net.InetAddress
import java.util.concurrent.TimeUnit

class OkHttpVisitSenderTest {
    private val server = MockWebServer()
    private val plainServer = MockWebServer()
    private val logger = RecordingLogService()
    private lateinit var sender: OkHttpVisitSender

    @BeforeEach
    fun start() {
        val localhost = InetAddress.getByName("localhost")
        val certificate =
            HeldCertificate
                .Builder()
                .addSubjectAlternativeName("localhost")
                .build()
        server.useHttps(
            HandshakeCertificates
                .Builder()
                .heldCertificate(certificate)
                .build()
                .sslSocketFactory(),
        )
        server.start(localhost, 0)
        plainServer.start(localhost, 0)
        val trusted =
            HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate).build()
        sender =
            OkHttpVisitSender(
                logger,
                OkHttpClient
                    .Builder()
                    .sslSocketFactory(trusted.sslSocketFactory(), trusted.trustManager)
                    .build(),
            )
    }

    @AfterEach
    fun stop() {
        server.close()
        plainServer.close()
    }

    @Test
    fun `the visit is one get without cookies or a user agent`() {
        server.enqueue(MockResponse.Builder().addHeader("Set-Cookie", "a=b").build())

        sender.send(server.url("/count?p=%2Fapp%2Fandroid&t=App%20(Android)").toString())

        val seen = checkNotNull(server.takeRequest(5, TimeUnit.SECONDS))
        assertEquals("GET", seen.method)
        assertEquals("/count?p=%2Fapp%2Fandroid&t=App%20(Android)", seen.target)
        assertNull(seen.headers["user-agent"])
        assertNull(seen.headers["cookie"])
    }

    @Test
    fun `a url that is not https is refused and logged without the url`() {
        sender.send(plainServer.url("/count?p=secret").toString())

        assertEquals(0, plainServer.requestCount)
        val entry = logger.entries.single()
        assertEquals(LogLevel.WARN, entry.level)
        assertTrue("secret" !in entry.message)
    }

    @Test
    fun `a redirect to plain http is not followed`() {
        server.enqueue(
            MockResponse
                .Builder()
                .code(302)
                .addHeader("Location", plainServer.url("/count?p=secret").toString())
                .build(),
        )

        sender.send(server.url("/count").toString())

        assertNull(plainServer.takeRequest(1, TimeUnit.SECONDS))
        assertEquals(1, server.requestCount)
    }
}
