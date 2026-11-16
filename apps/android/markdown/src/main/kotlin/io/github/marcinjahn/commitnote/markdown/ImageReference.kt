package io.github.marcinjahn.commitnote.markdown

private const val SCHEME = "image:"
private const val ID_LENGTH = 26
private const val MAX_DIMENSION_DIGITS = 5

/** The parts of an `image:` destination. */
data class ImageTarget(
    val imageId: String,
    val width: Int?,
    val height: Int?,
)

/** An image node whose destination refers to a stored image. */
data class ImageReference(
    val imageId: String,
    val width: Int?,
    val height: Int?,
    /** The label with escaped ASCII punctuation unescaped. */
    val alt: String,
    /** The whole image node. */
    val range: TextRange,
) {
    companion object {
        /** Parses `image:<26 base32 units>` with an optional `#WxH` suffix of 1-5 digit dimensions. */
        fun parse(url: String): ImageTarget? {
            val idEnd = SCHEME.length + ID_LENGTH
            if (url.length < idEnd || !url.startsWith(SCHEME)) return null
            val imageId = url.substring(SCHEME.length, idEnd)
            if (!imageId.all { it in 'a'..'z' || it in '2'..'7' }) return null
            if (url.length == idEnd) return ImageTarget(imageId, null, null)
            if (url[idEnd] != '#') return null
            val separator = url.indexOf('x', idEnd + 1).takeIf { it >= 0 } ?: return null
            val width = dimension(url.substring(idEnd + 1, separator)) ?: return null
            val height = dimension(url.substring(separator + 1)) ?: return null
            return ImageTarget(imageId, width, height)
        }

        /** Removes the backslash from escaped ASCII punctuation. */
        fun unescapedAlt(alt: String): String {
            val result = StringBuilder(alt.length)
            var index = 0
            while (index < alt.length) {
                if (alt[index] == '\\' && index + 1 < alt.length &&
                    isAsciiPunctuation(alt[index + 1])
                ) {
                    result.append(alt[index + 1])
                    index += 2
                } else {
                    result.append(alt[index])
                    index++
                }
            }
            return result.toString()
        }

        fun containsReference(text: String): Boolean {
            if (SCHEME !in text) return false
            val document = MarkdownParser.parse(text)
            return document.nodes.any { referenceFor(it, document) != null }
        }

        /** The reference an image node describes, or null when its destination is not an image reference. */
        fun referenceFor(
            node: MarkdownNode,
            document: MarkdownDocument,
        ): ImageReference? {
            if (node.kind != NodeKind.Image) return null
            val inside = nodesInside(node, document)
            val openings =
                inside.filter { it.kind == NodeKind.LinkMark && document.slice(it.range) == "(" }
            val url =
                inside.firstOrNull { candidate ->
                    candidate.kind == NodeKind.Url && openings.any { it.to == candidate.from }
                } ?: return null
            val target = parse(document.slice(url.range)) ?: return null
            val alt = document.slice(labelRange(inside, document) ?: return null)
            return ImageReference(
                target.imageId,
                target.width,
                target.height,
                unescapedAlt(alt),
                node.range,
            )
        }
    }
}

/** The label of an image node, from the end of its `![` mark to the start of its `]` mark. */
internal fun imageLabelRange(
    node: MarkdownNode,
    document: MarkdownDocument,
): TextRange? = labelRange(nodesInside(node, document), document)

private fun nodesInside(
    node: MarkdownNode,
    document: MarkdownDocument,
): List<MarkdownNode> =
    document.nodesOverlapping(node.range).filter {
        it.from >= node.from && it.from < node.to &&
            it.to <= node.to
    }

private fun labelRange(
    inside: List<MarkdownNode>,
    document: MarkdownDocument,
): TextRange? {
    val marks = inside.filter { it.kind == NodeKind.LinkMark }
    val opening = marks.firstOrNull() ?: return null
    val closing = marks.drop(1).lastOrNull { document.slice(it.range) == "]" } ?: return null
    return TextRange(opening.to, closing.from)
}

private fun dimension(digits: String): Int? {
    if (digits.length !in 1..MAX_DIMENSION_DIGITS || digits[0] == '0') return null
    if (!digits.all { it in '0'..'9' }) return null
    return digits.toInt()
}
