package io.github.marcinjahn.commitnote.core.api

import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

@Serializable
class CoreRequest<P>(
    val id: Long,
    val command: String,
    val params: P,
) {
    override fun toString(): String = "CoreRequest(id=$id, command=$command)"
}

sealed interface CoreResponse {
    val id: Long

    class Success(
        override val id: Long,
        val result: JsonElement,
    ) : CoreResponse {
        override fun toString(): String = "Success(id=$id)"
    }

    data class Failure(
        override val id: Long,
        val error: CoreError,
    ) : CoreResponse
}

/** An event as posted by the core, before its payload is decoded. */
class RawEvent(
    val name: String,
    val payload: JsonObject,
) {
    override fun toString(): String = "RawEvent($name)"
}

sealed interface CoreMessage {
    data class Response(
        val response: CoreResponse,
    ) : CoreMessage

    data class Event(
        val event: RawEvent,
    ) : CoreMessage
}

/**
 * A message from the core that could not be decoded. Carries no payload text, because decoder
 * messages can quote note content or credentials.
 */
class CoreMessageException(
    val reason: Reason,
) : Exception("malformed core message (${reason.description})") {
    enum class Reason(
        val description: String,
    ) {
        SYNTAX("invalid JSON"),
        SHAPE("unexpected shape"),
        UNKNOWN_EVENT("unknown event name"),
    }
}

object CoreWire {
    val json: Json =
        Json {
            ignoreUnknownKeys = true
            encodeDefaults = false
            explicitNulls = true
        }

    fun parse(text: String): CoreMessage {
        val element =
            try {
                json.parseToJsonElement(text)
            } catch (_: SerializationException) {
                throw CoreMessageException(CoreMessageException.Reason.SYNTAX)
            }
        val message = element as? JsonObject ?: throw shapeError()
        return shaped {
            when (message.string("kind")) {
                "response" -> CoreMessage.Response(response(message))
                "event" -> CoreMessage.Event(event(message))
                else -> throw shapeError()
            }
        }
    }

    internal fun <T> decode(
        serializer: DeserializationStrategy<T>,
        element: JsonElement,
    ): T = shaped { json.decodeFromJsonElement(serializer, element) }

    private fun response(message: JsonObject): CoreResponse {
        val id = message["id"]?.jsonPrimitive?.longOrNull ?: throw shapeError()
        val ok = message["ok"]?.jsonPrimitive?.booleanOrNull ?: throw shapeError()
        if (ok) {
            return CoreResponse.Success(id, message["result"] ?: JsonObject(emptyMap()))
        }
        val error = message["error"] ?: throw shapeError()
        return CoreResponse.Failure(id, decode(CoreError.serializer(), error))
    }

    private fun event(message: JsonObject): RawEvent {
        val name = message.string("event") ?: throw shapeError()
        val payload = message["payload"] ?: JsonObject(emptyMap())
        return RawEvent(name, payload as? JsonObject ?: throw shapeError())
    }

    private fun JsonObject.string(key: String): String? = get(key)?.jsonPrimitive?.contentOrNull

    private fun shapeError() = CoreMessageException(CoreMessageException.Reason.SHAPE)

    private inline fun <T> shaped(block: () -> T): T =
        try {
            block()
        } catch (_: SerializationException) {
            throw shapeError()
        } catch (_: IllegalArgumentException) {
            throw shapeError()
        }
}
