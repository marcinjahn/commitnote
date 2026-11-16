package io.github.marcinjahn.commitnote.markdown

/** A block that holds other blocks, as lezer's markdown parser stacks them. */
internal sealed interface BlockContainer {
    data object Quote : BlockContainer

    /** A list, by the unit its item markers end with: the bullet, or the `.` or `)` after a number. */
    data class ItemList(
        val marker: Char,
    ) : BlockContainer {
        val isBullet: Boolean get() = isBulletMarker(marker)

        /** Whether an item whose marker ends with `marker` goes on in this list rather than starting another. */
        fun holdsItemsLike(marker: Char): Boolean = isBullet == isBulletMarker(marker)
    }

    /** A list item, by how many columns past the base column of its marker line its content starts. */
    data class Item(
        val contentOffset: Int,
    ) : BlockContainer
}

private fun isBulletMarker(unit: Char): Boolean = unit == '-' || unit == '+' || unit == '*'

/** A line read against a stack of containers, as lezer's `readLine` leaves its `Line`. */
internal class ContainerMatch private constructor(
    private val text: String,
    val line: Int,
    val end: Int,
) {
    /** How many containers, outermost first, the line continues. */
    var depth = 0
        private set

    /** Where the markup of the continued containers ends. */
    var base = line
        private set
    var baseColumn = 0
        private set

    /** The first position at or past `base` that is not a space, tab or line break; where lezer's `Line.pos` leaves the text. */
    var content = text.skipSpaces(line, end)
        private set

    val isBlank: Boolean get() = content == end

    val textStart: Int get() = content

    /** The line's text from its content on. */
    val contentText: String get() = text.substring(content, end)

    fun continuesAll(containers: List<BlockContainer>): Boolean = depth == containers.size

    /** Indented four or more columns past the base column: indented code, which neither interrupts nor underlines a paragraph. */
    val isCodeIndented: Boolean get() = indent >= baseColumn + 4

    val indent: Int get() = text.column(line, content)

    /** The line as lezer's `scrub` adds it to a paragraph: spaces standing for the container markup, then the rest. */
    fun scrub(): Pair<Int, String> =
        if (baseColumn == 0) {
            0 to text.substring(line, end)
        } else {
            (base - line) to text.substring(base, end)
        }

    fun moveBase(to: Int) {
        base = to
        baseColumn = text.column(line, to)
    }

    fun moveBaseColumn(goal: Int) {
        baseColumn = goal
        base = text.findColumn(line, end, goal)
    }

    fun forward() {
        if (base > content) content = text.skipSpaces(base, end)
    }

    private fun skipQuoteMark(): Boolean {
        if (text.code(content) != '>'.code || content >= end) return false
        val spaced = content + 1 < end && isSpaceUnit(text[content + 1])
        moveBase(content + 1 + if (spaced) 1 else 0)
        return true
    }

    private fun skipItemIndent(contentOffset: Int): Boolean {
        val goal = baseColumn + contentOffset
        if (!isBlank && indent < goal) return false
        moveBaseColumn(goal)
        return true
    }

    /** lezer's `skipForList`: whether the line stays in a list, given the list's open `item`. */
    private fun continuesList(
        marker: Char,
        item: BlockContainer?,
    ): Boolean {
        if (isBlank) return true
        if (item is BlockContainer.Item && indent >= baseColumn + item.contentOffset) return true
        if (indent >= baseColumn + 4) return false
        val line = contentText
        val size =
            if (isBulletMarker(marker)) {
                bulletItemSize(line, null)?.takeUnless { isThematicBreak(line, null) }
            } else {
                orderedItemSize(line, null)
            }
        return size != null && line[size - 1] == marker
    }

    /** lezer's `getListIndent`: the column a list item's content starts at, for a marker ending at `markerEnd`. */
    fun listContentColumn(markerEnd: Int): Int {
        val afterMarker = text.column(line, markerEnd)
        val contentStart = text.skipSpaces(markerEnd, end)
        val contentColumn = text.column(line, contentStart)
        return if (contentColumn >= afterMarker + 5 || contentStart == end) {
            afterMarker + 1
        } else {
            contentColumn
        }
    }

    companion object {
        /** lezer's `readLine`: how far the line at `line` continues `containers`, outermost first. */
        fun match(
            text: String,
            line: Int,
            containers: List<BlockContainer>,
        ): ContainerMatch {
            val matched = ContainerMatch(text, line, text.lineEndAt(line))
            for ((index, container) in containers.withIndex()) {
                val continued =
                    when (container) {
                        BlockContainer.Quote -> {
                            matched.skipQuoteMark()
                        }

                        is BlockContainer.ItemList -> {
                            matched.continuesList(
                                container.marker,
                                containers.getOrNull(index + 1),
                            )
                        }

                        is BlockContainer.Item -> {
                            matched.skipItemIndent(container.contentOffset)
                        }
                    }
                matched.forward()
                if (!continued) break
                matched.depth++
            }
            return matched
        }
    }
}

/** Whether a line after a paragraph line goes on with the paragraph, lazily too, as lezer's `DefaultEndLeaf` decides. */
internal fun continuesParagraph(
    line: ContainerMatch,
    containers: List<BlockContainer>,
): Boolean = !line.isBlank && (line.isCodeIndented || !interruptsParagraph(line, containers))

/** lezer's `isSetextUnderline`. */
internal fun isSetextUnderline(line: ContainerMatch): Boolean {
    val text = line.contentText
    val marker = text.firstOrNull()?.takeIf { it == '-' || it == '=' } ?: return false
    val run = text.runLength(0, marker)
    return !line.isCodeIndented && (run until text.length).all { isSpaceUnit(text[it]) }
}

/** The open paragraph a block start would interrupt, which decides whether it may. */
private class ParagraphContext(
    val inBulletList: Boolean,
    val inOrderedList: Boolean,
    /** The line continues every container, so a dash underline makes a setext heading rather than a thematic break. */
    val continuesContainers: Boolean,
)

private fun interruptsParagraph(
    line: ContainerMatch,
    containers: List<BlockContainer>,
): Boolean {
    val text = line.contentText
    val paragraph =
        ParagraphContext(
            inBulletList = containers.any { it is BlockContainer.ItemList && it.isBullet },
            inOrderedList = containers.any { it is BlockContainer.ItemList && !it.isBullet },
            continuesContainers = line.continuesAll(containers),
        )
    return isAtxHeading(text) ||
        codeFenceLength(text) != null ||
        text.firstOrNull() == '>' ||
        bulletItemSize(text, paragraph) != null ||
        orderedItemSize(text, paragraph) != null ||
        isThematicBreak(text, paragraph) ||
        HtmlBlockEnd.starting(text, true) != null
}

/** lezer's Table `endLeaf`: whether a paragraph line ends it to start a table, the next line being a matching delimiter line. */
private fun startsTable(
    text: String,
    line: ContainerMatch,
): Boolean {
    val row = text.substring(line.base, line.end)
    if (!hasPipe(row)) return false
    val next =
        if (line.end < text.length) {
            text.substring(line.end + 1, text.lineEndAt(line.end + 1))
        } else {
            ""
        }
    val nextRow = next.substring(minOf(line.base - line.line, next.length))
    return isDelimiterLine(next) && rowCellCount(row) == rowCellCount(nextRow)
}

private fun String.runLength(
    from: Int,
    unit: Char,
): Int {
    var index = from
    while (index < length && this[index] == unit) index++
    return index - from
}

private fun isSpaceAt(
    line: String,
    index: Int,
): Boolean = index < line.length && isSpaceUnit(line[index])

private fun hasContentFrom(
    line: String,
    index: Int,
): Boolean = index < line.length && line.skipSpaces(index, line.length) < line.length

// The block start rules below read a line's content from its first non-space unit on. Where they
// take an `interrupting` paragraph, null asks whether the block starts at all and a paragraph
// whether it interrupts that paragraph, like the `breaking` flag of lezer's rules.

private fun isAtxHeading(line: String): Boolean {
    if (line.firstOrNull() != '#') return false
    val size = line.runLength(0, '#')
    return size <= 6 && (size >= line.length || isSpaceUnit(line[size]))
}

/** lezer's `isFencedCode`: the length of the opening fence. */
private fun codeFenceLength(line: String): Int? {
    val marker = line.firstOrNull()?.takeIf { it == '`' || it == '~' } ?: return null
    val size = line.runLength(0, marker)
    return size.takeIf { it >= 3 && (marker == '~' || line.indexOf('`', size) < 0) }
}

/** lezer's `isBulletList`: the marker's length. */
private fun bulletItemSize(
    line: String,
    interrupting: ParagraphContext?,
): Int? {
    val starts =
        line.firstOrNull()?.let(::isBulletMarker) == true &&
            (line.length == 1 || isSpaceAt(line, 1)) &&
            (interrupting == null || interrupting.inBulletList || hasContentFrom(line, 2))
    return if (starts) 1 else null
}

/** lezer's `isOrderedList`: the marker's length. Outside an ordered list only a non-empty item numbered `1` interrupts a paragraph. */
private fun orderedItemSize(
    line: String,
    interrupting: ParagraphContext?,
): Int? {
    var digits = 0
    while (digits < line.length && line[digits] in '0'..'9') digits++
    if (digits == 0 || digits > 9 || digits >= line.length || line[digits] !in ".)") return null
    val after = digits + 1
    if (after < line.length && !isSpaceAt(line, after)) return null
    val starts =
        interrupting == null ||
            interrupting.inOrderedList ||
            (digits == 1 && line[0] == '1' && hasContentFrom(line, after))
    return if (starts) after else null
}

private fun isThematicBreak(
    line: String,
    interrupting: ParagraphContext?,
): Boolean {
    val marker = line.firstOrNull()?.takeIf { it == '-' || it == '*' || it == '_' } ?: return false
    if (!line.all { it == marker || isSpaceUnit(it) }) return false
    val run = line.runLength(0, marker)
    val setextUnderline = marker == '-' && (run until line.length).all { isSpaceUnit(line[it]) }
    if (setextUnderline && interrupting?.continuesContainers == true) return false
    return line.count { it == marker } >= 3
}

/** A line of a paragraph, the leaf block lezer's markdown parser starts tables in. */
internal data class ParagraphLine(
    /** The containers around the paragraph, outermost first. */
    val containers: List<BlockContainer>,
    val paragraphStart: Int,
    /** Where the paragraph's text on this line starts, after the container markup. */
    val textStart: Int,
)

/**
 * For each of the ascending line starts in `lines`, the paragraph it is a line of, if any. The
 * document's blocks are read once, as lezer's markdown parser reads them, up to the last of them.
 */
internal fun paragraphLines(
    text: String,
    lines: List<Int>,
): List<ParagraphLine?> {
    val walk = BlockWalk(text, lines)
    while (walk.found.size < lines.size && !walk.atEnd) walk.advance()
    return walk.found + List(lines.size - walk.found.size) { null }
}

/** lezer's `BlockContext`, keeping of the blocks only what `paragraphLines` reports. */
private class BlockWalk(
    private val text: String,
    private val targets: List<Int>,
) {
    private val stack = ArrayList<BlockContainer>()
    private var line = ContainerMatch.match(text, 0, emptyList())
    val found = ArrayList<ParagraphLine?>(targets.size)
    var atEnd = false
        private set

    /** lezer's `nextLine`, first recording the role of the line it leaves when that line is the next target; false at the end. */
    private fun consume(paragraphStart: Int? = null): Boolean {
        if (atEnd) return false
        if (targets.getOrNull(found.size) == line.line) {
            found +=
                paragraphStart?.let { ParagraphLine(stack.toList(), it, line.textStart) }
        }
        if (line.end == text.length) {
            atEnd = true
            return false
        }
        line = ContainerMatch.match(text, line.end + 1, stack)
        return true
    }

    /** lezer's `advance`: reads the block that starts at the current line, after closing the containers it leaves. */
    fun advance() {
        while (true) {
            truncateStack(line.depth)
            if (!line.isBlank) break
            if (!consume()) return
        }
        while (true) {
            when (startBlock()) {
                BlockStart.Container -> line.forward()
                BlockStart.Leaf -> return
                null -> break
            }
        }
        if (line.isBlank) consume() else paragraph()
    }

    private fun truncateStack(size: Int) {
        while (stack.size > size) stack.removeAt(stack.lastIndex)
    }

    private enum class BlockStart { Container, Leaf }

    /** lezer's default block parsers, in their order. */
    private fun startBlock(): BlockStart? {
        val content = line.contentText
        if (line.isCodeIndented) {
            indentedCode()
            return BlockStart.Leaf
        }
        codeFenceLength(content)?.let { length ->
            fencedCode(content[0], length)
            return BlockStart.Leaf
        }
        if (content.firstOrNull() == '>') {
            stack += BlockContainer.Quote
            val size = 1 + if (content.getOrNull(1) == ' ') 1 else 0
            line.moveBase(line.content + size)
            return BlockStart.Container
        }
        if (isThematicBreak(content, null) || isAtxHeading(content)) {
            consume()
            return BlockStart.Leaf
        }
        (bulletItemSize(content, null) ?: orderedItemSize(content, null))?.let { size ->
            openListItem(size)
            return BlockStart.Container
        }
        htmlBlock(HtmlBlockEnd.starting(content, false) ?: return null)
        return BlockStart.Leaf
    }

    private fun indentedCode() {
        val base = line.baseColumn + 4
        while (consume() && line.depth >= stack.size) {
            if (!line.isBlank && line.indent < base) break
        }
    }

    private fun fencedCode(
        fence: Char,
        length: Int,
    ) {
        while (consume() && line.depth >= stack.size) {
            val current = line
            val run = if (current.isCodeIndented) 0 else current.contentText.runLength(0, fence)
            if (run >= length &&
                text.skipSpaces(current.content + run, current.end) == current.end
            ) {
                consume()
                return
            }
        }
    }

    private fun openListItem(markerSize: Int) {
        val markerEnd = line.content + markerSize
        val marker = text[markerEnd - 1]
        val top = stack.lastOrNull()
        if (!(top is BlockContainer.ItemList && top.holdsItemsLike(marker))) {
            stack += BlockContainer.ItemList(marker)
        }
        val contentColumn = line.listContentColumn(markerEnd)
        stack += BlockContainer.Item(contentColumn - line.baseColumn)
        line.moveBaseColumn(contentColumn)
    }

    private fun htmlBlock(end: HtmlBlockEnd) {
        var trailing = end != HtmlBlockEnd.BlankLine
        while (!end.isMet(text.substring(line.line, line.end)) && consume()) {
            if (line.depth < stack.size) {
                trailing = false
                break
            }
        }
        if (trailing) consume()
    }

    /** lezer's leaf block loop for a paragraph from the current line on; a link reference definition reports no paragraph lines. */
    private fun paragraph() {
        val start = line.content
        val firstLine = line.contentText
        val opensTable = hasPipe(firstLine)
        var reference = LinkReference.start(firstLine)
        val firstFound = found.size
        var more = consume(start)
        while (more) {
            val current = line
            if (!continuesParagraph(current, stack) ||
                (!opensTable && !current.isCodeIndented && startsTable(text, current))
            ) {
                break
            }
            reference?.let { definition ->
                val (indent, lineText) = current.scrub()
                when (definition.nextLine(indent, lineText)) {
                    ReferenceProgress.Complete -> {
                        clearFoundFrom(firstFound)
                        return
                    }

                    ReferenceProgress.Failed -> {
                        reference = null
                    }

                    ReferenceProgress.Pending -> {
                        Unit
                    }
                }
            }
            if (current.continuesAll(stack) && isSetextUnderline(current)) {
                consume()
                return
            }
            more = consume(start)
        }
        if (reference?.isComplete == true) clearFoundFrom(firstFound)
    }

    private fun clearFoundFrom(index: Int) {
        for (position in index until found.size) found[position] = null
    }
}
