package io.github.marcinjahn.commitnote.markdown

private val OPENABLE_SCHEMES = setOf("http", "https", "mailto")

object MarkdownLinks {
    /** The openable destination of the link, autolink or bare URL at `offset`. */
    fun linkUrl(
        document: MarkdownDocument,
        offset: Int,
    ): String? =
        listOf(true, false).firstNotNullOfOrNull { forward ->
            val chain = document.nodes.filter { it.touches(offset, forward) }
            val url = urlNode(chain, document) ?: return@firstNotNullOfOrNull null
            openableUrl(unwrapDestination(document.slice(url.range).trim(::isSpaceSeparator)))
        }

    /** The exact string to hand to a URL parser when `raw` is an http, https or mailto link. */
    fun openableUrl(raw: String): String? {
        val url =
            when {
                hasPrefixIgnoringCase(raw, "www.") -> "https://$raw"
                isEmail(raw) -> "mailto:$raw"
                else -> raw
            }
        val scheme = schemeOf(url) ?: return null
        return url.takeIf { scheme in OPENABLE_SCHEMES && parsesAsUrl(it) }
    }
}

private fun MarkdownNode.touches(
    offset: Int,
    forward: Boolean,
): Boolean = if (forward) from <= offset && offset < to else from < offset && offset <= to

private fun MarkdownNode.isUrlWithin(node: MarkdownNode): Boolean =
    kind == NodeKind.Url && from >= node.from && from < node.to

private fun urlNode(
    chain: List<MarkdownNode>,
    document: MarkdownDocument,
): MarkdownNode? {
    val ordered = chain.asReversed()
    for ((index, node) in ordered.withIndex()) {
        when (node.kind) {
            NodeKind.Link -> {
                return destinationOf(node, document)
            }

            NodeKind.Autolink -> {
                return document.nodes.firstOrNull { it.isUrlWithin(node) }
            }

            NodeKind.Url -> {
                if (ordered.getOrNull(index + 1)?.kind !=
                    NodeKind.LinkLabel
                ) {
                    return node
                }
            }

            else -> {
                continue
            }
        }
    }
    return null
}

/** The link's `(destination)`, which a URL in its label is not. */
private fun destinationOf(
    link: MarkdownNode,
    document: MarkdownDocument,
): MarkdownNode? {
    fun inLink(position: Int) = position >= link.from && position < link.to
    return document.nodes.firstOrNull { node ->
        node.kind == NodeKind.Url &&
            inLink(node.from) &&
            node.from > 0 &&
            document.text[node.from - 1] == '(' &&
            document.nodes.none { label ->
                label.kind == NodeKind.LinkLabel && node.from in label.from until label.to &&
                    inLink(label.from)
            }
    }
}

private fun isSpaceSeparator(unit: Char): Boolean =
    unit == '\t' ||
        unit == ' ' ||
        unit == '\u00A0' ||
        unit == '\u1680' ||
        unit in '\u2000'..'\u200A' ||
        unit == '\u202F' ||
        unit == '\u205F' ||
        unit == '\u3000'

private fun unwrapDestination(raw: String): String = raw.removeSurrounding("<", ">")

private fun hasPrefixIgnoringCase(
    string: String,
    prefix: String,
): Boolean = string.lowercase().startsWith(prefix)

private fun schemeOf(url: String): String? {
    for ((index, unit) in url.withIndex()) {
        if (unit == ':') return if (index > 0) url.substring(0, index).lowercase() else null
        val letter = isAlpha(unit.code)
        val valid = letter || (index > 0 && (isDigit(unit.code) || unit in "+-."))
        if (!valid) return null
    }
    return null
}

private fun isEmail(string: String): Boolean {
    val at = string.indexOf('@')
    if (at < 0) return false
    val local = string.substring(0, at)
    if (local.isEmpty() || !local.all { isWordChar(it.code) || it in ".+-" }) return false
    val labels = string.substring(at + 1).split('.')
    return labels.size >= 2 &&
        labels.all { label -> label.isNotEmpty() && label.all { isWordChar(it.code) || it == '-' } }
}

/**
 * Whether Foundation's `URL(string:)` accepts the string: it percent-encodes most characters and
 * rejects only an unusable host or port.
 */
private fun parsesAsUrl(url: String): Boolean {
    val colon = url.indexOf(':')
    if (colon < 0) return false
    val rest = url.substring(colon + 1)
    if (!rest.startsWith("//")) return true
    val afterSlashes = rest.substring(2)
    val authorityEnd =
        afterSlashes.indexOfAny(charArrayOf('/', '?', '#')).takeIf { it >= 0 }
            ?: afterSlashes.length
    val authority = afterSlashes.substring(0, authorityEnd)
    val hostAndPort = authority.substring(authority.lastIndexOf('@') + 1)
    if (hostAndPort.startsWith('[')) {
        val close = hostAndPort.indexOf(']')
        if (close < 0) return false
        val address = hostAndPort.substring(1, close)
        val port = hostAndPort.substring(close + 1)
        val portValid = if (port.startsWith(':')) isPort(port.substring(1)) else port.isEmpty()
        return address.codePoints().allMatch { it == '%'.code || isHostChar(it) } && portValid
    }
    val portSeparator = hostAndPort.indexOf(':')
    if (portSeparator < 0) return isHost(hostAndPort)
    val host = hostAndPort.substring(0, portSeparator)
    return isPort(hostAndPort.substring(portSeparator + 1)) && isHost(host)
}

private fun isPort(port: String): Boolean = port.all { isDigit(it.code) }

private fun isHost(host: String): Boolean {
    val codePoints = host.codePoints().toArray()
    return codePoints.indices.all { index ->
        val codePoint = codePoints[index]
        if (codePoint == '%'.code) {
            index + 2 < codePoints.size &&
                isHexDigit(codePoints[index + 1]) &&
                isHexDigit(codePoints[index + 2])
        } else {
            isHostChar(codePoint)
        }
    }
}

private fun isHexDigit(codePoint: Int): Boolean =
    isDigit(codePoint) || codePoint in 'a'.code..'f'.code || codePoint in 'A'.code..'F'.code

private fun isHostChar(codePoint: Int): Boolean =
    !(
        Character.getType(codePoint) == Character.CONTROL.toInt() ||
            isUnicodeWhiteSpace(codePoint) ||
            codePoint in "\"<>[\\]^`{|}\uFFFD".map { it.code } ||
            codePoint in 0xE000..0xF8FF ||
            codePoint >= 0xF0000
    )

/** Unicode's `White_Space` property. */
private fun isUnicodeWhiteSpace(codePoint: Int): Boolean =
    codePoint in 9..13 ||
        codePoint == 32 ||
        codePoint == 0x85 ||
        codePoint == 0xA0 ||
        codePoint == 0x1680 ||
        codePoint in 0x2000..0x200A ||
        codePoint == 0x2028 ||
        codePoint == 0x2029 ||
        codePoint == 0x202F ||
        codePoint == 0x205F ||
        codePoint == 0x3000
