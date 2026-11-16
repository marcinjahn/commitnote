package io.github.marcinjahn.commitnote.editor

/** A replacement of `[from, to)` in UTF-16 code units of the text before the change. */
data class TextChange(
    val from: Int,
    val to: Int,
    val insert: String,
) {
    val lengthChange: Int get() = insert.length - (to - from)
}

/** A selection in UTF-16 code units; `start` is never after `end`. */
data class TextSelection(
    val start: Int,
    val end: Int,
) {
    val isCaret: Boolean get() = start == end

    companion object {
        fun caret(position: Int) = TextSelection(position, position)
    }
}

object TextChanges {
    private enum class Assoc { Before, After }

    /** Applies sorted, non-overlapping `changes`, each clamped to the text and to the one before. */
    fun apply(
        changes: List<TextChange>,
        text: String,
    ): String {
        if (changes.isEmpty()) return text
        val result = StringBuilder(text.length)
        var cursor = 0
        for (change in changes) {
            val from = change.from.coerceAtMost(text.length).coerceAtLeast(cursor)
            val to = change.to.coerceAtMost(text.length).coerceAtLeast(from)
            result.append(text, cursor, from).append(change.insert)
            cursor = to
        }
        return result.append(text, cursor, text.length).toString()
    }

    fun mapSelection(
        selection: TextSelection,
        changes: List<TextChange>,
    ): TextSelection {
        if (selection.isCaret) {
            return TextSelection.caret(
                map(selection.start, changes, Assoc.Before),
            )
        }
        val start = map(selection.start, changes, Assoc.After)
        return TextSelection(start, maxOf(start, map(selection.end, changes, Assoc.Before)))
    }

    /** The one change between the common prefix and suffix, never splitting a surrogate pair. */
    fun diff(
        old: String,
        new: String,
    ): List<TextChange> {
        if (old == new) return emptyList()
        val shorter = minOf(old.length, new.length)
        var prefix = 0
        while (prefix < shorter && old[prefix] == new[prefix]) prefix++
        if (prefix > 0 && old[prefix - 1].isHighSurrogate()) prefix--
        var suffix = 0
        while (suffix < shorter - prefix &&
            old[old.length - 1 - suffix] == new[new.length - 1 - suffix]
        ) {
            suffix++
        }
        if (suffix > 0 && old[old.length - suffix].isLowSurrogate()) suffix--
        return listOf(
            TextChange(
                prefix,
                old.length - suffix,
                new.substring(
                    prefix,
                    new.length - suffix,
                ),
            ),
        )
    }

    private fun map(
        position: Int,
        changes: List<TextChange>,
        assoc: Assoc,
    ): Int {
        var delta = 0
        for (change in changes) {
            if (change.from == change.to) {
                if (position < change.from ||
                    (position == change.from && assoc == Assoc.Before)
                ) {
                    break
                }
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
}

/** How the editor takes a note's content the core reports. */
enum class TextSyncDecision {
    /** Another note or draft: replace the whole text. */
    Set,

    /** A change made elsewhere to text the editor has not changed since: apply it in place. */
    Update,

    /** The editor already shows it, or it is the core's report of a sent text. */
    Accept,

    /** The editor has changes the core has not seen yet, which win. */
    Skip,
    ;

    companion object {
        fun decide(
            noteSwitch: Int,
            appliedSwitch: Int?,
            text: String,
            doc: String,
            base: String,
            echo: Boolean,
        ): TextSyncDecision =
            when {
                noteSwitch != appliedSwitch -> Set
                text == doc || echo -> Accept
                doc == base -> Update
                else -> Skip
            }
    }
}

/**
 * The texts sent to the core that it has not reported back yet, so a late report of one is told
 * apart from a change made elsewhere.
 */
class SentTexts {
    private val texts = ArrayDeque<String>()

    fun record(text: String) {
        if (texts.size == LIMIT) texts.removeFirst()
        texts.addLast(text)
    }

    /**
     * The core reports sends in order and may skip texts replaced before being sent, so this also
     * forgets every earlier one.
     */
    fun takeEcho(text: String): Boolean {
        val index = texts.indexOf(text)
        if (index < 0) return false
        repeat(index + 1) { texts.removeFirst() }
        return true
    }

    fun clear() = texts.clear()

    private companion object {
        const val LIMIT = 64
    }
}
