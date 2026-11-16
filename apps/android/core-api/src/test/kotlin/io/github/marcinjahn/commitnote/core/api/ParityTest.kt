package io.github.marcinjahn.commitnote.core.api

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.descriptors.PolymorphicKind
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.StructureKind
import kotlinx.serialization.descriptors.elementDescriptors
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

@OptIn(ExperimentalSerializationApi::class)
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
    fun `every command has exactly one descriptor`() {
        assertEquals(CoreNames.commands.sorted(), CoreCommands.all.map { it.name }.sorted())
        assertEquals(CoreNames.fakeCommands.sorted(), FakeCoreCommands.all.map { it.name }.sorted())
    }

    @Test
    fun `every event has exactly one subtype`() {
        assertEquals(CoreNames.events.sorted(), CoreEvent.serializers.keys.sorted())

        val subtypes = CoreEvent.serializers.values.map { it.descriptor.serialName }
        assertEquals(subtypes.size, subtypes.toSet().size)
        assertEquals(
            CoreEvent::class.java.permittedSubclasses.size,
            subtypes.size,
            "an event subtype is missing from the serializer table",
        )
    }

    @Test
    fun `every command block in the TypeScript source has its discriminator variants in Kotlin`() {
        val blocks =
            blocksOf("CoreCommands", "\"") + blocksOf("FakeCoreCommands", "\"")
        assertEquals(CoreNames.commands.size + CoreNames.fakeCommands.size, blocks.size)

        val descriptors =
            (CoreCommands.all + FakeCoreCommands.all).associate {
                it.name to listOf(it.paramsSerializer.descriptor, it.resultSerializer.descriptor)
            }
        for ((name, block) in blocks) {
            assertVariantsExist(name, block, descriptors.getValue(name))
        }
    }

    @Test
    fun `every event block in the TypeScript source has its discriminator variants in Kotlin`() {
        val blocks = blocksOf("CoreEvents", "")
        assertEquals(CoreNames.events.size, blocks.size)

        for ((name, block) in blocks) {
            assertVariantsExist(
                name,
                block,
                listOf(CoreEvent.serializers.getValue(name).descriptor),
            )
        }
    }

    @Test
    fun `no name is listed twice`() {
        for (names in listOf(CoreNames.commands, CoreNames.events, CoreNames.fakeCommands)) {
            assertEquals(names.size, names.toSet().size)
        }
        val typed = (CoreCommands.all + FakeCoreCommands.all).map { it.name }
        assertEquals(typed.size, typed.toSet().size)
    }

    private fun assertVariantsExist(
        name: String,
        block: String,
        descriptors: List<SerialDescriptor>,
    ) {
        val expected = discriminatorLiterals(withReferencedDeclarations(block))
        val found = descriptors.flatMapTo(mutableSetOf()) { sealedVariantNames(it) }

        assertEquals(emptySet<String>(), expected - found, "$name: variants missing in Kotlin")
    }

    /** The entries of `export type <typeName> = { ... }`, keyed by name, as source text. */
    private fun blocksOf(
        typeName: String,
        quote: String,
    ): Map<String, String> {
        val start = source.indexOf("export type $typeName = {")
        assertTrue(start >= 0, "$typeName is declared in api.ts")
        val body = source.substring(start).substringAfter("{\n").substringBefore("\n};")
        val entries = Regex("(?m)^  $quote([A-Za-z0-9.]+)$quote:").findAll(body).toList()
        return entries
            .mapIndexed { index, entry ->
                val end = entries.getOrNull(index + 1)?.range?.first ?: body.length
                entry.groupValues[1] to body.substring(entry.range.first, end)
            }.toMap()
    }

    /** The block plus the declarations of every api.ts type it mentions, transitively. */
    private fun withReferencedDeclarations(block: String): String {
        val seen = mutableSetOf<String>()
        val text = StringBuilder(block)
        val pending = ArrayDeque(identifiersIn(block))
        while (pending.isNotEmpty()) {
            val identifier = pending.removeFirst()
            if (!seen.add(identifier)) continue
            val declaration = declarationOf(identifier) ?: continue
            text.append('\n').append(declaration)
            pending.addAll(identifiersIn(declaration))
        }
        return text.toString()
    }

    private fun identifiersIn(text: String): List<String> =
        Regex("\\b[A-Z][A-Za-z0-9]+\\b").findAll(text).map { it.value }.toList()

    private fun declarationOf(identifier: String): String? {
        val match =
            Regex("(?m)^(?:export )?(?:type|interface) $identifier\\b").find(source)
                ?: return null
        val end = source.indexOf("\nexport ", match.range.last).takeIf { it >= 0 }
        return source.substring(match.range.first, end ?: source.length)
    }

    /** `kind: "x"` and `state: "x"` literals that close an object type, not a string union. */
    private fun discriminatorLiterals(text: String): Set<String> =
        Regex("\\b(?:kind|state): \"([^\"]+)\"(?=\\s*[;}])")
            .findAll(text)
            .map { it.groupValues[1] }
            .toSet()

    private fun sealedVariantNames(
        descriptor: SerialDescriptor,
        visited: MutableSet<String> = mutableSetOf(),
        found: MutableSet<String> = mutableSetOf(),
    ): Set<String> {
        val isContainer =
            descriptor.kind == StructureKind.LIST || descriptor.kind == StructureKind.MAP
        if (!isContainer && !visited.add(descriptor.serialName)) return found
        if (descriptor.kind == PolymorphicKind.SEALED && descriptor.elementsCount > 1) {
            for (variant in descriptor.getElementDescriptor(1).elementDescriptors) {
                found += variant.serialName
            }
        }
        for (element in descriptor.elementDescriptors) {
            sealedVariantNames(element, visited, found)
        }
        return found
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
