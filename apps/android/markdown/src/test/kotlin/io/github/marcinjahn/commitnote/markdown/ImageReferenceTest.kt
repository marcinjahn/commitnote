package io.github.marcinjahn.commitnote.markdown

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource

private const val ID = "abcdefghijklmnopqrstuvwxyz"

class ImageReferenceTest {
    @Test
    fun `parses an id with and without dimensions`() {
        assertEquals(ImageTarget(ID, 640, 480), ImageReference.parse("image:$ID#640x480"))
        assertEquals(ImageTarget(ID, null, null), ImageReference.parse("image:$ID"))
        assertEquals(99999, ImageReference.parse("image:234567abcdefghijklmnopqrst#99999x1")?.width)
    }

    @ParameterizedTest
    @ValueSource(
        strings = [
            "image:abc",
            "image:${ID}a",
            "image:ABCDEFGHIJKLMNOPQRSTUVWXYZ",
            "image:abcdefghijklmnopqrstuvwxy1",
            "image:$ID#0x5",
            "image:$ID#5x0",
            "image:$ID#100000x5",
            "image:$ID#5",
            "image:$ID#5x",
            "image:$ID#05x5",
            "image:$ID#5x5x",
            "https://example.com/a.png",
            "IMAGE:$ID",
        ],
    )
    fun `rejects malformed urls`(url: String) {
        assertNull(ImageReference.parse(url))
    }

    @Test
    fun `unescapes alt text`() {
        assertEquals("a]b \\ c\\d", ImageReference.unescapedAlt("a\\]b \\\\ c\\d"))
    }

    @Test
    fun `reads a reference from an image node`() {
        val text = "x ![my \\[alt\\]](image:$ID#640x480) y"
        val document = MarkdownParser.parse(text)

        assertEquals(
            ImageReference(ID, 640, 480, "my [alt]", TextRange(2, text.length - 2)),
            ImageReference.referenceFor(document.image(), document),
        )
    }

    @Test
    fun `images that are not references have none`() {
        val document = MarkdownParser.parse("![a](https://x.y/a.png) ![b](image:short)")
        val images = document.nodes.filter { it.kind == NodeKind.Image }

        assertEquals(2, images.size)
        images.forEach { assertNull(ImageReference.referenceFor(it, document)) }
    }

    @Test
    fun `reads a reference without dimensions or alt text`() {
        val document = MarkdownParser.parse("![](image:$ID)")
        val reference = ImageReference.referenceFor(document.image(), document)

        assertEquals("", reference?.alt)
        assertNull(reference?.width)
    }

    @Test
    fun `finds references in text`() {
        assertTrue(ImageReference.containsReference("a\n![x](image:$ID#2x3)\nb"))
        assertTrue(ImageReference.containsReference("![](image:$ID)"))
        assertFalse(ImageReference.containsReference("![x](image:short) ![y](https://a.b/c.png)"))
        assertFalse(ImageReference.containsReference("plain image:$ID text"))
        assertFalse(ImageReference.containsReference(""))
    }

    private fun MarkdownDocument.image() = nodes.first { it.kind == NodeKind.Image }
}
