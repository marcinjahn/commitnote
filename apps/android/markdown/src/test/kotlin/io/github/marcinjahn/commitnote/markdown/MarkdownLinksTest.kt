package io.github.marcinjahn.commitnote.markdown

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.junit.jupiter.params.provider.ValueSource

class MarkdownLinksTest {
    @ParameterizedTest
    @CsvSource(
        "https://a.b/c, https://a.b/c",
        "http://a.b, http://a.b",
        "www.a.b, https://www.a.b",
        "WWW.A.B, https://WWW.A.B",
        "me+x@a-b.co.uk, mailto:me+x@a-b.co.uk",
        "mailto:me@a.b, mailto:me@a.b",
        "HTTPS://a.b, HTTPS://a.b",
    )
    fun `web and mail links open`(
        raw: String,
        expected: String,
    ) {
        assertEquals(expected, MarkdownLinks.openableUrl(raw))
    }

    @ParameterizedTest
    @ValueSource(
        strings = [
            "javascript:alert(1)",
            "ftp://a.b",
            "file:///etc/passwd",
            "image:abc",
            "foo",
            "a@b",
            "relative/path",
            "",
            "@a.b",
            "https://exa mple.com",
            "https://a.b:xx/",
            "https://[::1",
            "https://a%zz.b/",
            "https://a<b>.c/",
        ],
    )
    fun `other schemes, text and malformed urls do not open`(raw: String) {
        assertNull(MarkdownLinks.openableUrl(raw))
    }

    @ParameterizedTest
    @ValueSource(
        strings = [
            "https://a.b/a b",
            "https://a.b/é?q=1 2#x",
            "https://[::1]:80/x",
            "https://u@a.b:/",
            "https://é.com/",
            "mailto:a b@c.d",
        ],
    )
    fun `urls a url parser accepts open unchanged`(raw: String) {
        assertEquals(raw, MarkdownLinks.openableUrl(raw))
    }

    @ParameterizedTest
    @ValueSource(ints = [3, 5, 8, 9, 12, 20, 23])
    fun `an inline link opens from any of its parts`(offset: Int) {
        assertEquals("https://a.b/c", linkAt("x [label](https://a.b/c) y", offset))
    }

    @Test
    fun `text around an inline link opens nothing`() {
        assertNull(linkAt("x [label](https://a.b/c) y", 0))
        assertNull(linkAt("x [label](https://a.b/c) y", 25))
    }

    @Test
    fun `autolinks and bare urls open`() {
        assertEquals("https://a.b", linkAt("a <https://a.b> b", 5))
        assertEquals("https://a.b", linkAt("see https://a.b now", 6))
        assertEquals("https://www.a.b", linkAt("see www.a.b now", 6))
        assertEquals("mailto:a@b.co", linkAt("mail a@b.co now", 6))
    }

    @Test
    fun `link destinations are normalised or refused`() {
        assertEquals("https://www.a.b", linkAt("[a](www.a.b)", 1))
        assertNull(linkAt("[a](javascript:alert(1))", 1))
        assertNull(linkAt("[a](relative/path)", 1))
        assertNull(linkAt("[a]()", 1))
        assertNull(linkAt("![a](image:abcdefghijklmnopqrstuvwxyz)", 5))
        assertEquals("https://a.b/(x)", linkAt("[a](<https://a.b/(x)>)", 1))
    }

    @Test
    fun `a url label opens the destination`() {
        assertEquals("https://c.d", linkAt("[https://a.b](https://c.d)", 4))
    }

    private fun linkAt(
        text: String,
        offset: Int,
    ) = MarkdownLinks.linkUrl(MarkdownParser.parse(text), offset)
}
