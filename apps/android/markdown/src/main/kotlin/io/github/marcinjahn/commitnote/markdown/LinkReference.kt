package io.github.marcinjahn.commitnote.markdown

private const val MAX_LABEL_LENGTH = 999

internal enum class ReferenceProgress {
    /** The definition ended before the line just read, which starts another block. */
    Complete,
    Failed,
    Pending,
}

private sealed interface Scan {
    data class Found(
        val end: Int,
    ) : Scan

    data object Invalid : Scan

    data object Incomplete : Scan
}

/** lezer's `LinkReferenceParser`: reads a paragraph's text line by line as a link reference definition. */
internal class LinkReference private constructor(
    firstLine: String,
) {
    private val content = StringBuilder(firstLine)
    private var stage = Stage.Start

    /** Where the part read last ends. */
    private var pos = 0
    private val label = LabelScan()
    private var title: TitleScan? = null

    /** lezer's `RefStage`: the part of the definition read last. */
    private enum class Stage { Start, Label, Link, Title, Failed }

    /** lezer's `nextLine`, given the line as its `scrub` leaves it. */
    fun nextLine(
        indent: Int,
        text: String,
    ): ReferenceProgress {
        content.append('\n').append(" ".repeat(indent)).append(text)
        val end = advance()
        return when {
            stage == Stage.Failed -> ReferenceProgress.Failed
            end != null && end < content.length -> ReferenceProgress.Complete
            else -> ReferenceProgress.Pending
        }
    }

    /** lezer's `finish`: whether the paragraph's whole text is a definition. */
    val isComplete: Boolean
        get() =
            (stage == Stage.Link || stage == Stage.Title) &&
                skipSpaces(content, pos, content.length) == content.length

    /** lezer's `advance`: reads on as far as the text allows, and where the definition would end. */
    private fun advance(): Int? {
        while (true) {
            when (stage) {
                Stage.Failed -> {
                    return null
                }

                Stage.Start -> {
                    when (val scan = label.resume(content)) {
                        is Scan.Found -> {
                            if (scan.end < content.length && content[scan.end] == ':') {
                                pos = scan.end + 1
                                stage = Stage.Label
                            } else {
                                stage = Stage.Failed
                            }
                        }

                        Scan.Invalid -> {
                            stage = Stage.Failed
                        }

                        Scan.Incomplete -> {
                            return null
                        }
                    }
                }

                Stage.Label -> {
                    when (val scan = urlEnd(content, skipSpaces(content, pos, content.length))) {
                        is Scan.Found -> {
                            pos = scan.end
                            stage = Stage.Link
                        }

                        Scan.Invalid -> {
                            stage = Stage.Failed
                        }

                        Scan.Incomplete -> {
                            return null
                        }
                    }
                }

                Stage.Link -> {
                    val skip = skipSpaces(content, pos, content.length)
                    var end: Int? = null
                    if (skip > pos) {
                        val titleEnd = titleEnd(skip)
                        val titleLineEnd = titleEnd?.let { lineEndAfter(content, it) }
                        if (titleEnd != null && titleLineEnd != null) {
                            pos = titleEnd
                            stage = Stage.Title
                            end = titleLineEnd
                        }
                    }
                    return (end ?: lineEndAfter(content, pos))?.takeIf {
                        it in
                            1 until content.length
                    }
                }

                Stage.Title -> {
                    return lineEndAfter(content, pos)
                }
            }
        }
    }

    /** lezer's `parseLinkTitle`, resumed for a title that starts where the last one did. */
    private fun titleEnd(start: Int): Int? {
        if (start >= content.length) return null
        val close =
            when (content[start]) {
                '"' -> '"'
                '\'' -> '\''
                '(' -> ')'
                else -> return null
            }
        val scan =
            title?.takeIf { it.start == start } ?: TitleScan(start, close).also { title = it }
        return scan.resume(content)
    }

    /** lezer's `parseLinkLabel` for the label a definition starts with, resumed where the text read before ended. */
    private class LabelScan {
        private var scanned = 0
        private var escaped = false
        private var hasContent = false

        fun resume(content: CharSequence): Scan {
            val limit = minOf(content.length, 1 + MAX_LABEL_LENGTH)
            for (position in maxOf(scanned, 1) until limit) {
                val unit = content[position]
                scanned = position + 1
                if (escaped) {
                    escaped = false
                } else if (unit == ']') {
                    return if (hasContent) Scan.Found(position + 1) else Scan.Invalid
                } else {
                    hasContent = hasContent || !isSpaceUnit(unit)
                    if (unit == '[') return Scan.Invalid
                    escaped = unit == '\\'
                }
            }
            return Scan.Incomplete
        }
    }

    private class TitleScan(
        val start: Int,
        private val close: Char,
    ) {
        private var scanned = start + 1
        private var escaped = false
        private var end: Int? = null

        fun resume(content: CharSequence): Int? {
            if (end == null) {
                for (position in scanned until content.length) {
                    val unit = content[position]
                    if (escaped) {
                        escaped = false
                    } else if (unit == close) {
                        end = position + 1
                        break
                    } else {
                        escaped = unit == '\\'
                    }
                }
                scanned = content.length
            }
            return end
        }
    }

    companion object {
        /** A reader for a paragraph whose first line is `firstLine`, unless that line cannot start a definition. */
        fun start(firstLine: String): LinkReference? {
            if (firstLine.firstOrNull() != '[') return null
            val reference = LinkReference(firstLine)
            reference.advance()
            return reference.takeIf { it.stage != Stage.Failed }
        }
    }
}

/** lezer's `parseURL`. */
private fun urlEnd(
    content: CharSequence,
    start: Int,
): Scan {
    if (start < content.length && content[start] == '<') {
        for (position in start + 1 until content.length) {
            when (content[position]) {
                '>' -> return Scan.Found(position + 1)
                '<', '\n' -> return Scan.Invalid
            }
        }
        return Scan.Incomplete
    }
    var depth = 0
    var escaped = false
    var position = start
    while (position < content.length) {
        val unit = content[position]
        if (isSpaceUnit(unit)) {
            break
        } else if (escaped) {
            escaped = false
        } else if (unit == '(') {
            depth++
        } else if (unit == ')') {
            if (depth == 0) break
            depth--
        } else if (unit == '\\') {
            escaped = true
        }
        position++
    }
    return when {
        position > start -> Scan.Found(position)
        position >= content.length -> Scan.Incomplete
        else -> Scan.Invalid
    }
}

/** lezer's `lineEnd`: where the line at `pos` ends, if only spaces come before. */
private fun lineEndAfter(
    content: CharSequence,
    pos: Int,
): Int? {
    for (index in pos until content.length) {
        if (content[index] == '\n') return index
        if (!isSpaceUnit(content[index])) return null
    }
    return maxOf(content.length, pos)
}

private fun skipSpaces(
    content: CharSequence,
    from: Int,
    to: Int,
): Int {
    var index = from
    while (index < to && isSpaceUnit(content[index])) index++
    return index
}
