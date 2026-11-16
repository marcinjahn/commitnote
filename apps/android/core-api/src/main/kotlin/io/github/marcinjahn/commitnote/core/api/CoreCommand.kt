package io.github.marcinjahn.commitnote.core.api

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/** Params and results that are `{}` on the wire. */
@Serializable
data object Empty

/** Describes one native core command: its wire name and how its params and result are encoded. */
class CoreCommand<P, R>(
    val name: String,
    val paramsSerializer: KSerializer<P>,
    val resultSerializer: KSerializer<R>,
) {
    fun encodeRequest(
        id: Long,
        params: P,
    ): String =
        CoreWire.json.encodeToString(
            CoreRequest.serializer(paramsSerializer),
            CoreRequest(id, name, params),
        )

    fun decodeResult(result: JsonElement): R = CoreWire.decode(resultSerializer, result)

    override fun toString(): String = "CoreCommand($name)"
}
