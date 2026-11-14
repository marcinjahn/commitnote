package io.github.marcinjahn.commitnote.core.api

import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

class ParityTest {
    private val source: String =
        File(requireNotNull(System.getProperty("commitnote.coreApiSource"))).readText()

    @Test
    fun `command names match the TypeScript list in order`() {
        assertEquals(namesIn("CORE_COMMAND_NAMES"), CoreNames.commands)
    }

    @Test
    fun `event names match the TypeScript list in order`() {
        assertEquals(namesIn("CORE_EVENT_NAMES"), CoreNames.events)
    }

    @Test
    fun `fake command names match the TypeScript list in order`() {
        assertEquals(namesIn("FAKE_CORE_COMMAND_NAMES"), CoreNames.fakeCommands)
    }

    @Test
    fun `platform wire names match the TypeScript list in order`() {
        val wireNames =
            NativePlatform.entries.map {
                CoreWire.json
                    .encodeToJsonElement(
                        NativePlatform.serializer(),
                        it,
                    ).jsonPrimitive.content
            }

        assertEquals(namesIn("NATIVE_PLATFORMS"), wireNames)
    }

    @Test
    fun `error kinds match the TypeScript union`() {
        val declaration = "export type CoreErrorKind ="
        val start = source.indexOf(declaration)
        assertTrue(start >= 0, "CoreErrorKind is declared in api.ts")
        val body = source.substring(start + declaration.length).substringBefore(';')

        assertEquals(quoted(body), CoreErrorKind.known.map { it.wireName })
    }

    @Test
    fun `version and marker match the TypeScript source`() {
        val versionDeclaration = "NATIVE_CORE_API_VERSION = "
        val versionStart = source.indexOf(versionDeclaration)
        assertTrue(versionStart >= 0, "the version is declared in api.ts")
        val version =
            source
                .substring(versionStart + versionDeclaration.length)
                .takeWhile { it.isDigit() }
        val markerDeclaration = "NATIVE_CORE_MARKER = \""
        val markerStart = source.indexOf(markerDeclaration)
        assertTrue(markerStart >= 0, "the marker is declared in api.ts")
        val marker =
            source
                .substring(markerStart + markerDeclaration.length)
                .substringBefore('"')

        assertEquals(version.toInt(), NativeCoreApi.VERSION)
        assertEquals(marker, NativeCoreApi.MARKER)
    }

    @Test
    fun `every typed command is in the matching name list`() {
        assertEquals(
            emptyList<String>(),
            CoreCommands.all.map { it.name } - CoreNames.commands.toSet(),
        )
        assertEquals(
            emptyList<String>(),
            FakeCoreCommands.all.map { it.name } - CoreNames.fakeCommands.toSet(),
        )
    }

    @Test
    fun `no name is listed twice`() {
        for (names in listOf(CoreNames.commands, CoreNames.events, CoreNames.fakeCommands)) {
            assertEquals(names.size, names.toSet().size)
        }
        val typed = (CoreCommands.all + FakeCoreCommands.all).map { it.name }
        assertEquals(typed.size, typed.toSet().size)
    }

    private fun namesIn(array: String): List<String> {
        val declaration = "const $array = ["
        val start = source.indexOf(declaration)
        assertTrue(start >= 0, "$array is declared in api.ts")
        return quoted(source.substring(start + declaration.length).substringBefore(']'))
    }

    private fun quoted(body: String): List<String> =
        body.split('"').filterIndexed { index, _ ->
            index %
                2 ==
                1
        }
}
