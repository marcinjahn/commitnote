package io.github.marcinjahn.commitnote.core.runtime.services

import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.SocketEffect
import okhttp3.OkHttpClient
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import okio.Buffer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.net.InetAddress
import java.util.concurrent.TimeUnit

class OkHttpHttpServiceTest {
    private val server = MockWebServer()
    private val plainServer = MockWebServer()
    private val localhost = InetAddress.getByName("localhost")
    private lateinit var http: OkHttpHttpService

    @BeforeEach
    fun start() {
        val certificate =
            HeldCertificate
                .Builder()
                .addSubjectAlternativeName(localhost.canonicalHostName)
                .addSubjectAlternativeName("localhost")
                .addSubjectAlternativeName("127.0.0.1")
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
            HandshakeCertificates
                .Builder()
                .addTrustedCertificate(
                    certificate.certificate,
                ).build()
        http =
            OkHttpHttpService(
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

    private fun get(url: String) = http.request(HttpRequest("GET", url, emptyMap(), null))

    @Test
    fun `request and response round trip with lower-cased header names`() {
        server.enqueue(
            MockResponse
                .Builder()
                .code(201)
                .addHeader("X-Reply", "Yes")
                .addHeader("Content-Type", "text/plain; charset=utf-8")
                .body("reply ✓\nsecond line")
                .build(),
        )

        val response =
            http.request(
                HttpRequest(
                    "POST",
                    server.url("/echo?x=1").toString(),
                    mapOf("X-Custom-Header" to "Value 1", "Content-Type" to "text/plain"),
                    "héllo\nbody".encodeToByteArray(),
                ),
            )

        assertEquals(201, response.status)
        assertEquals("Yes", response.headers["x-reply"])
        assertTrue(response.headers.keys.all { it == it.lowercase() })
        assertEquals("reply ✓\nsecond line", response.body.decodeToString())
        val seen = checkNotNull(server.takeRequest(5, TimeUnit.SECONDS))
        assertEquals("POST", seen.method)
        assertEquals("/echo?x=1", seen.target)
        assertEquals("Value 1", seen.headers["x-custom-header"])
        assertEquals("text/plain", seen.headers["content-type"])
        assertEquals("héllo\nbody", seen.body?.utf8())
    }

    @Test
    fun `binary bodies survive in both directions`() {
        val payload = ByteArray(256) { it.toByte() } + ByteArray(1024) { 0 }
        server.enqueue(MockResponse.Builder().body(Buffer().write(payload)).build())

        val response =
            http.request(
                HttpRequest("PUT", server.url("/blob").toString(), emptyMap(), payload),
            )

        assertArrayEquals(payload, response.body)
        assertArrayEquals(
            payload,
            checkNotNull(server.takeRequest(5, TimeUnit.SECONDS)).body?.toByteArray(),
        )
    }

    @Test
    fun `a bodiless request resolves a 404 with its body`() {
        server.enqueue(
            MockResponse
                .Builder()
                .code(404)
                .body("missing")
                .build(),
        )

        val response = get(server.url("/nope").toString())

        assertEquals(404, response.status)
        assertEquals("missing", response.body.decodeToString())
        assertEquals(0, checkNotNull(server.takeRequest(5, TimeUnit.SECONDS)).bodySize)
    }

    @Test
    fun `a post without a body is sent with an empty one`() {
        server.enqueue(MockResponse.Builder().code(204).build())

        val response =
            http.request(
                HttpRequest("POST", server.url("/").toString(), emptyMap(), null),
            )

        assertEquals(204, response.status)
        assertEquals(0, response.body.size)
        assertEquals(
            "0",
            checkNotNull(server.takeRequest(5, TimeUnit.SECONDS)).headers["content-length"],
        )
    }

    @Test
    fun `repeated response headers are joined`() {
        server.enqueue(
            MockResponse
                .Builder()
                .addHeader("Link", "a")
                .addHeader("link", "b")
                .build(),
        )

        assertEquals("a, b", get(server.url("/").toString()).headers["link"])
    }

    @Test
    fun `a dropped connection is a transport failure`() {
        server.enqueue(MockResponse.Builder().onRequestStart(SocketEffect.CloseSocket()).build())

        val error =
            assertThrows(HttpTransportException::class.java) { get(server.url("/").toString()) }

        assertEquals("Network request failed", error.message)
    }

    @Test
    fun `an unreachable server is a transport failure without the address in the message`() {
        val url = server.url("/secret/path").toString()
        server.close()

        val error = assertThrows(HttpTransportException::class.java) { get(url) }

        assertEquals("Network request failed", error.message)
    }

    @Test
    fun `an untrusted certificate is a transport failure`() {
        val strangerHttp = OkHttpHttpService()
        server.enqueue(MockResponse.Builder().body("x").build())

        assertThrows(HttpTransportException::class.java) {
            strangerHttp.request(HttpRequest("GET", server.url("/").toString(), emptyMap(), null))
        }
    }

    @Test
    fun `a plain http url is refused before any request is made`() {
        plainServer.enqueue(MockResponse.Builder().body("x").build())

        val error =
            assertThrows(
                HttpTransportException::class.java,
            ) { get(plainServer.url("/").toString()) }

        assertEquals("Refused a request that is not https", error.message)
        assertEquals(0, plainServer.requestCount)
    }

    @Test
    fun `malformed requests are refused`() {
        for (url in listOf("not a url", "ftp://example.com/", "file:///etc/passwd", "")) {
            val error = assertThrows(HttpTransportException::class.java) { get(url) }
            assertEquals("Refused a request that is not https", error.message, url)
        }
        val badHeader =
            HttpRequest("GET", server.url("/").toString(), mapOf("Bad Header" to "x"), null)
        assertEquals(
            "Refused a malformed request",
            assertThrows(
                HttpTransportException::class.java,
            ) {
                http.request(badHeader)
            }.message,
        )
        val bodyOnGet = HttpRequest("GET", server.url("/").toString(), emptyMap(), byteArrayOf(1))
        assertEquals(
            "Refused a malformed request",
            assertThrows(
                HttpTransportException::class.java,
            ) {
                http.request(bodyOnGet)
            }.message,
        )
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `a redirect to plain http is a transport failure and sends no request there`() {
        server.enqueue(
            MockResponse
                .Builder()
                .code(
                    302,
                ).addHeader("Location", plainServer.url("/landing").toString())
                .build(),
        )
        plainServer.enqueue(MockResponse.Builder().body("landed").build())

        val error =
            assertThrows(HttpTransportException::class.java) { get(server.url("/").toString()) }

        assertEquals("Network request failed", error.message)
        assertEquals(0, plainServer.requestCount)
        assertNull(plainServer.takeRequest(100, TimeUnit.MILLISECONDS))
    }

    @Test
    fun `a redirect within https is followed`() {
        server.enqueue(
            MockResponse
                .Builder()
                .code(
                    302,
                ).addHeader("Location", server.url("/final").toString())
                .build(),
        )
        server.enqueue(MockResponse.Builder().body("final").build())

        val response = get(server.url("/").toString())

        assertEquals("final", response.body.decodeToString())
        assertEquals(2, server.requestCount)
    }

    @Test
    fun `cookies are never kept`() {
        server.enqueue(MockResponse.Builder().addHeader("Set-Cookie", "session=1; Path=/").build())
        server.enqueue(MockResponse.Builder().build())

        get(server.url("/").toString())
        get(server.url("/").toString())

        server.takeRequest(5, TimeUnit.SECONDS)
        assertNull(checkNotNull(server.takeRequest(5, TimeUnit.SECONDS)).headers["cookie"])
    }

    @Test
    fun `the default client times out after sixty seconds and keeps no cache`() {
        val client = OkHttpHttpService.defaultClient()

        assertEquals(60_000, client.callTimeoutMillis)
        assertNull(client.cache)
    }
}
