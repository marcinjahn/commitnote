package io.github.marcinjahn.commitnote.editor

import kotlinx.serialization.Serializable

/**
 * A search match to reveal in a note: the matched [text] and the [before] it in the snippet, which
 * tells apart repeated matches. The core's snippet may have collapsed whitespace, so the match is
 * located by its text alone when the context does not occur verbatim.
 */
@Serializable
data class NoteMatch(
    val before: String,
    val text: String,
) {
    /** The first place of this match in [content], or null when the note no longer has it. */
    fun locate(content: String): TextSelection? {
        if (text.isEmpty()) return null
        val context = before.trimStart(ELLIPSIS)
        val withContext = content.indexOf(context + text, ignoreCase = true)
        val start =
            if (context.isNotEmpty() && withContext >= 0) {
                withContext + context.length
            } else {
                content.indexOf(text, ignoreCase = true)
            }
        return if (start >= 0) TextSelection(start, start + text.length) else null
    }

    private companion object {
        const val ELLIPSIS = '…'
    }
}
