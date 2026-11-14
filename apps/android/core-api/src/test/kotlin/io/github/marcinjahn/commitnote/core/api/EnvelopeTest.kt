package io.github.marcinjahn.commitnote.core.api

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class EnvelopeTest {
    private fun parse(text: String) = CoreWire.parse(text)

    private fun failure(text: String) =
        assertThrows(CoreMessageException::class.java) { parse(text) }

    @Test
    fun `a request encodes id, command and params`() {
        val text =
            CoreCommands.lifecycleSetVisible.encodeRequest(
                1,
                LifecycleSetVisibleParams(true),
            )

        assertEquals(
            Json.parseToJsonElement(
                """{"id":1,"command":"lifecycle.setVisible","params":{"visible":true}}""",
            ),
            Json.parseToJsonElement(text),
        )
    }

    @Test
    fun `a request with no params encodes an empty object`() {
        val text = CoreCommands.treeGet.encodeRequest(5, Empty)

        assertEquals("""{"id":5,"command":"tree.get","params":{}}""", text)
    }

    @Test
    fun `a request keeps explicit nulls and carries secrets as plain strings`() {
        assertEquals(
            """{"id":2,"command":"note.open","params":{"path":null}}""",
            CoreCommands.noteOpen.encodeRequest(2, NoteOpenParams(null)),
        )
        assertEquals(
            """{"id":3,"command":"login.unlock","params":{"passphrase":"pass \"phrase\""}}""",
            CoreCommands.loginUnlock.encodeRequest(3, PassphraseParams(Secret("pass \"phrase\""))),
        )
    }

    @Test
    fun `a success response keeps the raw result`() {
        val message = parse("""{"kind":"response","id":3,"ok":true,"result":{"name":"Laptop"}}""")

        val response = assertInstanceOf(CoreMessage.Response::class.java, message).response
        val success = assertInstanceOf(CoreResponse.Success::class.java, response)
        assertEquals(3, success.id)
        assertEquals(
            DeviceNameResult("Laptop"),
            CoreCommands.deviceName.decodeResult(success.result),
        )
    }

    @Test
    fun `a success response without a result has an empty one`() {
        val message = parse("""{"kind":"response","id":2,"ok":true}""")

        val response = assertInstanceOf(CoreMessage.Response::class.java, message).response
        assertEquals(
            JsonObject(emptyMap()),
            assertInstanceOf(CoreResponse.Success::class.java, response).result,
        )
    }

    @Test
    fun `an error response decodes the core error`() {
        val message =
            parse(
                """{"kind":"response","id":4,"ok":false,""" +
                    """"error":{"kind":"notReady","message":"Try again.","transient":false}}""",
            )

        assertEquals(
            CoreMessage.Response(
                CoreResponse.Failure(4, CoreError(CoreErrorKind.NOT_READY, "Try again.", false)),
            ),
            message,
        )
    }

    @Test
    fun `the response to an unparseable request has id minus one`() {
        val message =
            parse(
                """{"kind":"response","id":-1,"ok":false,""" +
                    """"error":{"kind":"invalidParams","message":"m","transient":false}}""",
            )

        val response = assertInstanceOf(CoreMessage.Response::class.java, message).response
        assertEquals(-1, response.id)
    }

    @Test
    fun `an event keeps its name and payload`() {
        val message = parse("""{"kind":"event","event":"noticeCleared","payload":{"id":"n1"}}""")

        val event = assertInstanceOf(CoreMessage.Event::class.java, message).event
        assertEquals("noticeCleared", event.name)
        assertEquals(buildJsonObject { put("id", "n1") }, event.payload)
    }

    @Test
    fun `an event without a payload has an empty one`() {
        val message = parse("""{"kind":"event","event":"sessionEnded"}""")

        assertEquals(
            JsonObject(emptyMap()),
            assertInstanceOf(CoreMessage.Event::class.java, message).event.payload,
        )
    }

    @Test
    fun `a failed response without an error is rejected`() {
        assertEquals(
            CoreMessageException.Reason.SHAPE,
            failure("""{"kind":"response","id":2,"ok":false}""").reason,
        )
    }

    @Test
    fun `an unknown message kind or a non-object payload is a shape error`() {
        assertEquals(
            CoreMessageException.Reason.SHAPE,
            failure("""{"kind":"banner","id":2}""").reason,
        )
        assertEquals(
            CoreMessageException.Reason.SHAPE,
            failure("""{"kind":"event","event":"notice","payload":[1]}""").reason,
        )
        assertEquals(CoreMessageException.Reason.SHAPE, failure("[]").reason)
    }

    @Test
    fun `text that is not JSON is a syntax error`() {
        assertEquals(CoreMessageException.Reason.SYNTAX, failure("not json").reason)
    }

    @Test
    fun `a result of the wrong shape fails to decode`() {
        val result = JsonObject(mapOf("nombre" to JsonPrimitive("x")))

        assertThrows(
            CoreMessageException::class.java,
        ) { CoreCommands.deviceName.decodeResult(result) }
    }

    @Test
    fun `decode failures do not quote the payload`() {
        val secret = "secret-note-text-17"
        val badEvent = """{"kind":"event","event":"noticeCleared","payload":{"id":["$secret"]}}"""
        val failures =
            listOf(
                failure("""{"kind":"response","id":1,"ok":false,"error":{"kind":["$secret"]}}"""),
                assertThrows(CoreMessageException::class.java) {
                    CoreEvent.decode(
                        assertInstanceOf(CoreMessage.Event::class.java, parse(badEvent)).event,
                    )
                },
                failure("""{"kind":"event","payload":{"note":"$secret" """),
            )

        for (error in failures) {
            assertFalse(error.message.orEmpty().contains(secret))
            assertFalse(error.toString().contains(secret))
            assertEquals(null, error.cause)
        }
    }
}
