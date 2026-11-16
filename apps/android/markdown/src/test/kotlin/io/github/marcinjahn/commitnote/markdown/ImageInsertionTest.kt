package io.github.marcinjahn.commitnote.markdown

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

private const val REFERENCE = "![](image:abcdefghijklmnopqrstuvwxy2#640x480)"
private const val SHARED_VECTOR_COUNT = 54

class ImageInsertionTest {
    @Serializable
    private data class Vectors(
        val insertions: List<Insertion>,
    )

    @Serializable
    private data class Insertion(
        val name: String,
        val text: String,
        val selection: Selection,
        val argument: List<String>,
        val expected: Expected,
    )

    @Serializable
    private data class Selection(
        val anchor: Int,
        val head: Int,
    )

    @Serializable
    private data class Expected(
        val text: String,
        val selection: Selection,
    )

    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `every shared insertion vector matches`() {
        val property = System.getProperty("commitnote.testVectors")
        val directory = requireNotNull(property) { "commitnote.testVectors is not set" }
        val raw = File(directory, "image-insertion.json").readText()
        val listed =
            json
                .parseToJsonElement(raw)
                .jsonObject
                .getValue("insertions")
                .jsonArray.size
        val vectors = json.decodeFromString<Vectors>(raw).insertions

        val failures =
            vectors.mapNotNull { vector ->
                val edit =
                    MarkdownCommands.insertImageReferences(
                        vector.text,
                        vector.selection.head,
                        vector.argument,
                    )
                val text = edit.applyTo(vector.text)
                val expected = vector.expected
                val matches =
                    text == expected.text &&
                        edit.selectionAfter.isEmpty &&
                        edit.selectionAfter.from == expected.selection.head &&
                        expected.selection.anchor == expected.selection.head
                if (matches) {
                    null
                } else {
                    "${vector.name}: got ${text.quoted()} at ${edit.selectionAfter}, " +
                        "expected ${expected.text.quoted()} at ${expected.selection.head}"
                }
            }

        assertEquals(SHARED_VECTOR_COUNT, listed)
        assertEquals(listed, vectors.size)
        val report = failures.joinToString("\n")
        assertTrue(failures.isEmpty()) {
            "${failures.size} of ${vectors.size} insertion vectors failed:\n$report"
        }
    }

    @Test
    fun `counts text before the caret in UTF-16 units`() {
        val edit = MarkdownCommands.insertImageReferences("😀 ab", 3, listOf(REFERENCE))

        assertEquals("😀 \n$REFERENCE\nab", edit.applyTo("😀 ab"))
        assertEquals(TextRange.caret(2 + 1 + 1 + REFERENCE.length + 1), edit.selectionAfter)
    }

    @Test
    fun `inserts after an emoji, not inside it`() {
        val edit = MarkdownCommands.insertImageReferences("😀", 2, listOf(REFERENCE))

        assertEquals("😀\n$REFERENCE\n", edit.applyTo("😀"))
        assertEquals(TextRange.caret(2 + 1 + REFERENCE.length + 1), edit.selectionAfter)
    }

    @Test
    fun `clamps a caret past the end`() {
        val edit = MarkdownCommands.insertImageReferences("text", 99, listOf(REFERENCE))

        assertEquals("text\n$REFERENCE\n", edit.applyTo("text"))
        assertEquals(TextRange.caret(4 + 1 + REFERENCE.length + 1), edit.selectionAfter)
    }

    private fun String.quoted() = "\"" + replace("\n", "\\n") + "\""
}
