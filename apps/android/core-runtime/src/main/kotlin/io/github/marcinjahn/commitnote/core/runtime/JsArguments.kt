package io.github.marcinjahn.commitnote.core.runtime

import io.github.marcinjahn.commitnote.core.runtime.engine.JsHostError
import io.github.marcinjahn.commitnote.core.runtime.engine.JsValue

internal fun List<JsValue>.argument(index: Int): JsValue = getOrElse(index) { JsValue.Undefined }

internal fun Map<String, JsValue>.field(name: String): JsValue = get(name) ?: JsValue.Undefined

internal val JsValue.isAbsent: Boolean get() = this == JsValue.Undefined || this == JsValue.Null

internal fun JsValue.asBytes(): ByteArray =
    (this as? JsValue.Bytes)?.value ?: throw JsHostError("Expected a Uint8Array")

internal fun JsValue.asString(): String =
    (this as? JsValue.Text)?.value ?: throw JsHostError("Expected a string")

internal fun JsValue.asBoolean(): Boolean =
    (this as? JsValue.Bool)?.value ?: throw JsHostError("Expected a boolean")

internal fun JsValue.asRecord(): Map<String, JsValue> =
    (this as? JsValue.Record)?.fields ?: throw JsHostError("Expected an object")

internal fun JsValue.asFiniteNumber(): Double {
    val number = (this as? JsValue.Number)?.value ?: throw JsHostError("Expected a number")
    if (!number.isFinite()) throw JsHostError("Expected a finite number")
    return number
}

internal fun JsValue.asInteger(
    min: Long,
    max: Long,
): Long {
    val number = (this as? JsValue.Number)?.value ?: throw JsHostError("Expected an integer")
    if (!number.isFinite() || number % 1.0 != 0.0 || number < min || number > max) {
        throw JsHostError("Integer out of range")
    }
    return number.toLong()
}

internal fun JsValue.asInt(
    min: Int,
    max: Int,
): Int = asInteger(min.toLong(), max.toLong()).toInt()

internal fun record(vararg fields: Pair<String, JsValue>): JsValue.Record =
    JsValue.Record(mapOf(*fields))

internal fun text(value: String): JsValue.Text = JsValue.Text(value)

internal fun number(value: Number): JsValue.Number = JsValue.Number(value.toDouble())
