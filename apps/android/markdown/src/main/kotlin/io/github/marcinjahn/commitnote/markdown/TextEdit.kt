package io.github.marcinjahn.commitnote.markdown

/** Replaces `range` with `replacement`; `selectionAfter` is in the edited text's offsets. */
data class TextEdit(
    val range: TextRange,
    val replacement: String,
    val selectionAfter: TextRange,
) {
    fun applyTo(text: String): String = text.replaceRange(range.from, range.to, replacement)
}

/** One change of a command, in the offsets of the text before any of them. */
internal data class Change(
    val from: Int,
    val to: Int,
    val insert: String,
) {
    val isInsertion: Boolean get() = from == to

    val lengthChange: Int get() = insert.length - (to - from)
}

internal enum class Assoc { Before, After }

/** Where `position` lands once the sorted, non-overlapping `changes` are made. */
internal fun mapPosition(
    position: Int,
    changes: List<Change>,
    assoc: Assoc,
): Int {
    var delta = 0
    for (change in changes) {
        if (change.isInsertion) {
            if (position < change.from || (position == change.from && assoc == Assoc.Before)) break
            delta += change.insert.length
            continue
        }
        if (position <= change.from) break
        if (position < change.to) {
            return change.from + delta + if (assoc == Assoc.Before) 0 else change.insert.length
        }
        delta += change.lengthChange
    }
    return position + delta
}

internal fun mapSelection(
    selection: TextRange,
    changes: List<Change>,
): TextRange {
    if (selection.isEmpty) {
        val caret = mapPosition(selection.from, changes, Assoc.Before)
        return TextRange.caret(caret)
    }
    val start = mapPosition(selection.from, changes, Assoc.After)
    val end = mapPosition(selection.to, changes, Assoc.Before)
    return TextRange(start, maxOf(start, end))
}

/** The sorted, non-overlapping `changes` of `text` as one edit spanning all of them. */
internal fun mergedEdit(
    text: String,
    changes: List<Change>,
    selectionAfter: TextRange,
): TextEdit {
    val replacement = StringBuilder()
    changes.forEachIndexed { index, change ->
        replacement.append(change.insert)
        changes.getOrNull(index + 1)?.let { next -> replacement.append(text, change.to, next.from) }
    }
    return TextEdit(
        TextRange(changes.first().from, changes.last().to),
        replacement.toString(),
        selectionAfter,
    )
}
