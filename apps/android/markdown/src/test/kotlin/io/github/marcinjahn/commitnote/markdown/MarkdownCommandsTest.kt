package io.github.marcinjahn.commitnote.markdown

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.MethodSource

private typealias Command = (String, TextRange) -> TextEdit?

private val bold: Command = MarkdownCommands::toggleBold
private val italic: Command = MarkdownCommands::toggleItalic
private val strikethrough: Command = MarkdownCommands::toggleStrikethrough

private fun select(
    text: String,
    word: String,
): TextRange {
    val from = text.indexOf(word)
    return TextRange(from, from + word.length)
}

private fun selection(
    from: Int,
    length: Int,
) = TextRange(from, from + length)

private fun run(
    command: Command,
    text: String,
    selection: TextRange,
): Pair<String, TextRange>? =
    command(text, selection)?.let {
        it.applyTo(text) to it.selectionAfter
    }

class MarkdownCommandsTest {
    @ParameterizedTest
    @MethodSource("formats")
    fun `formatting wraps the selection and keeps it`(
        command: Command,
        marker: String,
    ) {
        val (text, after) = run(command, "a word b", select("a word b", "word"))!!

        assertEquals("a ${marker}word$marker b", text)
        assertEquals("word", text.slice(after))
    }

    @ParameterizedTest
    @MethodSource("formats")
    fun `formatting unwraps markers inside the selection`(
        command: Command,
        marker: String,
    ) {
        val source = "a ${marker}word$marker b"
        val (text, after) = run(command, source, select(source, "${marker}word$marker"))!!

        assertEquals("a word b", text)
        assertEquals("word", text.slice(after))
    }

    @ParameterizedTest
    @MethodSource("formats")
    fun `formatting removes markers around the selection`(
        command: Command,
        marker: String,
    ) {
        val source = "a ${marker}word$marker b"
        val (text, after) = run(command, source, select(source, "word"))!!

        assertEquals("a word b", text)
        assertEquals("word", text.slice(after))
    }

    @ParameterizedTest
    @MethodSource("formats")
    fun `formatting at a caret inserts a marker pair`(
        command: Command,
        marker: String,
    ) {
        val (text, after) = run(command, "ab", TextRange.caret(1))!!

        assertEquals("a$marker${marker}b", text)
        assertEquals(TextRange.caret(1 + marker.length), after)
    }

    @ParameterizedTest
    @MethodSource("formats")
    fun `formatting refuses multiple lines and code`(command: Command) {
        val inline = "a `word` b"
        val fenced = "```\nword\n```"

        assertNull(command("one\ntwo", selection(1, 5)))
        assertNull(command(inline, select(inline, "word")))
        assertNull(command(fenced, select(fenced, "word")))
        assertNull(command("a `b` c", TextRange.caret(4)))
    }

    @ParameterizedTest
    @MethodSource("formats")
    fun `formatting works on link text`(
        command: Command,
        marker: String,
    ) {
        val text = "[word](https://x.y)"

        assertEquals(
            "[${marker}word$marker](https://x.y)",
            run(command, text, select(text, "word"))?.first,
        )
    }

    @ParameterizedTest
    @MethodSource("italicVersusBold")
    fun `italic and bold tell their markers apart`(
        command: Command,
        text: String,
        word: String,
        expected: String,
    ) {
        assertEquals(expected, run(command, text, select(text, word))?.first)
    }

    @Test
    fun `formatting clamps a selection past the end`() {
        assertEquals("a**b**", run(MarkdownCommands::toggleBold, "ab", selection(1, 10))?.first)
    }

    @Test
    fun `a link wraps the selection and leaves the caret in the destination`() {
        val (text, after) =
            run(
                MarkdownCommands::insertLink,
                "a word b",
                select("a word b", "word"),
            )!!

        assertEquals("a [word]() b", text)
        assertEquals(TextRange.caret("a [word](".length), after)
    }

    @Test
    fun `a link escapes brackets in its label`() {
        assertEquals(
            "a [x\\]]() b",
            run(MarkdownCommands::insertLink, "a x] b", select("a x] b", "x]"))?.first,
        )
    }

    @Test
    fun `a link at a caret is empty`() {
        val (text, after) = run(MarkdownCommands::insertLink, "ab", TextRange.caret(1))!!

        assertEquals("a[]()b", text)
        assertEquals(TextRange.caret(2), after)
    }

    @Test
    fun `a link is refused over links, code and multiple lines`() {
        val link = "[word](https://x.y)"
        val bare = "see https://x.y now"
        val code = "a `word` b"

        assertNull(MarkdownCommands.insertLink(link, select(link, "word")))
        assertNull(MarkdownCommands.insertLink(bare, select(bare, "https://x.y")))
        assertNull(MarkdownCommands.insertLink("one\ntwo", selection(1, 5)))
        assertNull(MarkdownCommands.insertLink(code, select(code, "word")))
        assertNull(MarkdownCommands.insertLink(link, TextRange.caret(3)))
    }

    @Test
    fun `a task marker flips`() {
        assertEquals("- [x] milk", toggledText("- [ ] milk", 3))
        assertEquals("- [ ] milk", toggledText("- [x] milk", 3))
        assertEquals("- [ ] milk", toggledText("- [X] milk", 3))
    }

    @Test
    fun `a list item gets a checkbox`() {
        assertEquals("- [ ] milk", toggledText("- milk", 4))
        assertEquals("1. [ ] milk", toggledText("1. milk", 5))
        assertEquals("- [ ] ", toggledText("-", 0))
    }

    @Test
    fun `a paragraph or an empty line becomes a task`() {
        assertEquals("- [ ] milk", toggledText("milk", 2))
        assertEquals("- [ ] ", toggledText("", 0))
        assertEquals("# t\n\n- [ ] milk", toggledText("# t\n\nmilk", 5))
        assertEquals("  - [ ] milk", toggledText("  milk", 3))
        assertEquals("a\n- [ ] ", toggledText("a\n", 2))
    }

    @ParameterizedTest
    @MethodSource("taskSkips")
    fun `a task is refused on headings, code, tables, quotes, rules and blank lines`(
        text: String,
        at: Int,
    ) {
        assertNull(MarkdownCommands.toggleTask(text, TextRange.caret(at)))
    }

    @Test
    fun `a task toggles on every touched line`() {
        val text = "- [ ] a\n# h\nplain\n- b"

        val toggled = toggled(text, TextRange(3, text.length))?.first

        assertEquals("- [x] a\n# h\n- [ ] plain\n- [ ] b", toggled)
    }

    @Test
    fun `a task maps the selection through its edits`() {
        assertEquals(TextRange.caret(8), toggled("- [ ] milk", TextRange.caret(8))?.second)
        assertEquals(TextRange.caret(8), toggled("- milk", TextRange.caret(4))?.second)
        assertEquals(TextRange.caret(6), toggled("milk", TextRange.caret(0))?.second)
        assertEquals("- [ ] a\n- [ ] b" to selection(6, 9), toggled("a\nb", selection(0, 3)))
    }

    @Test
    fun `a task adds no blank line`() {
        assertEquals(2, toggled("a\nb", TextRange.caret(1))?.first?.lines()?.size)
    }

    @ParameterizedTest
    @MethodSource("checkboxes")
    fun `a checkbox toggles to a lowercase marker`(
        range: TextRange,
        expected: String,
    ) {
        val text = "- [ ] a\n- [x] b\n- [X] c"

        assertEquals(expected, MarkdownCommands.toggleCheckbox(text, range).applyTo(text))
    }

    private fun toggled(
        text: String,
        selection: TextRange,
    ) = run(MarkdownCommands::toggleTask, text, selection)

    private fun toggledText(
        text: String,
        at: Int,
    ) = toggled(text, TextRange.caret(at))?.first

    private fun String.slice(range: TextRange) = substring(range.from, range.to)

    companion object {
        @JvmStatic
        fun formats() =
            listOf(
                Arguments.of(bold, "**"),
                Arguments.of(italic, "*"),
                Arguments.of(strikethrough, "~~"),
            )

        @JvmStatic
        fun italicVersusBold() =
            listOf(
                Arguments.of(italic, "a **word** b", "word", "a ***word*** b"),
                Arguments.of(italic, "a ***word*** b", "word", "a **word** b"),
                Arguments.of(italic, "a ***word*** b", "***word***", "a **word** b"),
                Arguments.of(bold, "a ***word*** b", "word", "a *word* b"),
                Arguments.of(italic, "a **word** b", "**word**", "a ***word*** b"),
            )

        @JvmStatic
        fun taskSkips() =
            listOf(
                Arguments.of("# title", 3),
                Arguments.of("```\ncode\n```", 5),
                Arguments.of("| a | b |\n| - | - |\n| 1 | 2 |", 3),
                Arguments.of("- item\n  more", 10),
                Arguments.of("> quote", 4),
                Arguments.of("---", 1),
                Arguments.of("    indented", 6),
                Arguments.of("a\n   \nb", 3),
                Arguments.of("Title\n===", 1),
            )

        @JvmStatic
        fun checkboxes() =
            listOf(
                Arguments.of(TextRange(2, 5), "- [x] a\n- [x] b\n- [X] c"),
                Arguments.of(TextRange(10, 13), "- [ ] a\n- [ ] b\n- [X] c"),
                Arguments.of(TextRange(18, 21), "- [ ] a\n- [x] b\n- [ ] c"),
            )
    }
}
