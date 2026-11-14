package io.github.marcinjahn.commitnote.core.api

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

/** A credential that serializes as a plain string but never appears in `toString()`. */
@Serializable(with = SecretSerializer::class)
class Secret(
    private val value: String,
) {
    fun expose(): String = value

    override fun equals(other: Any?): Boolean = other is Secret && other.value == value

    override fun hashCode(): Int = value.hashCode()

    override fun toString(): String = "Secret(<redacted>)"
}

internal object SecretSerializer : KSerializer<Secret> {
    override val descriptor = PrimitiveSerialDescriptor("Secret", PrimitiveKind.STRING)

    override fun serialize(
        encoder: Encoder,
        value: Secret,
    ) = encoder.encodeString(value.expose())

    override fun deserialize(decoder: Decoder): Secret = Secret(decoder.decodeString())
}
