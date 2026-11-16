package io.github.marcinjahn.commitnote.core.runtime.services

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File

object TestVectors {
    private val directory = File(checkNotNull(System.getProperty("commitnote.testVectors")))

    fun load(name: String): JsonObject =
        Json.parseToJsonElement(File(directory, name).readText()).jsonObject

    fun array(
        file: String,
        field: String,
    ): JsonArray = load(file).getValue(field).jsonArray
}

fun JsonObject.text(field: String): String = getValue(field).jsonPrimitive.content

fun JsonObject.int(field: String): Int = getValue(field).jsonPrimitive.int

fun JsonObject.hex(field: String): ByteArray = text(field).hexToByteArray()
