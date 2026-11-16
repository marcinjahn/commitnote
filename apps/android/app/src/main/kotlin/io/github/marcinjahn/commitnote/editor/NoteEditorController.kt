package io.github.marcinjahn.commitnote.editor

import io.github.marcinjahn.commitnote.app.EditorSession
import io.github.marcinjahn.commitnote.app.EditorState
import io.github.marcinjahn.commitnote.app.EditorTarget
import io.github.marcinjahn.commitnote.app.NoteContentUpdate
import io.github.marcinjahn.commitnote.markdown.MarkdownCommands

/** Where the controller shows the text; the editor view while one is attached. */
interface EditorSurface {
    fun setContent(
        content: String,
        selection: TextSelection,
    )

    fun applyChanges(
        changes: List<TextChange>,
        selection: TextSelection,
    )

    /** Moves the input focus into the text and selects [selection]. */
    fun focusText(selection: TextSelection)

    /** Scrolls the text so that [selection] is in view. */
    fun reveal(selection: TextSelection)
}

/**
 * Keeps the text the editor shows in step with the editor session: typed text goes to the session,
 * and the core's reports replace the text, change it in place or are ignored while typed text the
 * core has not seen yet is pending. Outlives the editor view, which re-attaches with the text.
 * Call it from the main thread.
 */
class NoteEditorController(
    private val editor: EditorSession,
    restoredText: String? = null,
    private val onLocalEdit: (String) -> Unit = {},
    private var match: NoteMatch? = null,
) {
    var text: String = ""
        private set

    var selection: TextSelection = TextSelection.caret(0)
        private set

    private val sent = SentTexts()
    private var surface: EditorSurface? = null
    private var base = ""
    private var appliedSwitch: Int? = null
    private var appliedSerial: Int? = null
    private var unsent: String? = restoredText
    private var revealPending = false

    fun attach(surface: EditorSurface) {
        this.surface = surface
        surface.setContent(text, selection)
        revealIfPending()
    }

    fun detach(surface: EditorSurface) {
        if (this.surface === surface) this.surface = null
    }

    fun onState(state: EditorState) {
        when (val target = state.target) {
            EditorTarget.None -> {}

            is EditorTarget.Draft, EditorTarget.EarlyDraft -> {
                if (appliedSwitch == state.switch) return
                appliedSwitch = state.switch
                base = ""
                show(editor.draftText, TextSelection.caret(editor.draftText.length))
            }

            is EditorTarget.Note -> {
                if (state.focusAtEnd == target.path && appliedSwitch == state.switch) focusAtEnd()
                val update = state.update ?: return
                if (update.path != target.path) return
                if (update.serial == appliedSerial && state.switch == appliedSwitch) return
                apply(update, state)
            }
        }
    }

    /** Text the user typed into the editor. */
    fun onTextChanged(text: String) {
        if (text == this.text) return
        this.text = text
        send(text)
    }

    /** Inserts [references] at the selection, as if typed. */
    fun insertImageReferences(references: List<String>) {
        if (references.isEmpty()) return
        val edit = MarkdownCommands.insertImageReferences(text, selection.end, references)
        val change = TextChange(edit.range.from, edit.range.to, edit.replacement)
        text = TextChanges.apply(listOf(change), text)
        selection = TextSelection(edit.selectionAfter.from, edit.selectionAfter.to)
        surface?.applyChanges(listOf(change), selection)
        send(text)
    }

    private fun send(text: String) {
        if (editor.state.value.target is EditorTarget.Note) sent.record(text)
        editor.edit(text)
        onLocalEdit(text)
    }

    fun onSelectionChanged(selection: TextSelection) {
        this.selection = selection
        editor.state.value.target.notePath
            ?.let { editor.savePosition(it, selection) }
    }

    private fun apply(
        update: NoteContentUpdate,
        state: EditorState,
    ) {
        val sameSwitch = state.switch == appliedSwitch
        val echo = sameSwitch && sent.takeEcho(update.content)
        val decision =
            TextSyncDecision.decide(
                noteSwitch = state.switch,
                appliedSwitch = appliedSwitch,
                text = update.content,
                doc = text,
                base = base,
                echo = echo,
            )
        appliedSerial = update.serial
        appliedSwitch = state.switch
        when (decision) {
            TextSyncDecision.Set -> {
                base = update.content
                show(update.content, initialSelection(update))
                revealIfPending()
                restoreUnsent()
                if (state.focusAtEnd == update.path) focusAtEnd()
            }

            TextSyncDecision.Update -> {
                val edits = update.edits?.takeIf { TextChanges.apply(it, text) == update.content }
                val changes = edits ?: TextChanges.diff(text, update.content)
                base = update.content
                text = update.content
                selection = TextChanges.mapSelection(selection, changes)
                surface?.applyChanges(changes, selection)
            }

            TextSyncDecision.Accept -> {
                base = update.content
            }

            TextSyncDecision.Skip -> {}
        }
    }

    private fun focusAtEnd() {
        editor.clearFocusAtEnd()
        selection = TextSelection.caret(text.length)
        surface?.focusText(selection)
    }

    private fun initialSelection(update: NoteContentUpdate): TextSelection {
        match?.let { wanted ->
            match = null
            wanted.locate(update.content)?.let {
                revealPending = true
                return it
            }
        }
        val length = update.content.length
        val saved = editor.position(update.path) ?: return TextSelection.caret(0)
        return TextSelection(saved.start.coerceIn(0, length), saved.end.coerceIn(0, length))
    }

    private fun revealIfPending() {
        val shown = surface ?: return
        if (!revealPending) return
        revealPending = false
        shown.reveal(selection)
    }

    /** Re-sends text typed before the process was lost, once the note it belongs to has loaded. */
    private fun restoreUnsent() {
        val restored = unsent ?: return
        unsent = null
        if (restored == text) return
        val changes = TextChanges.diff(text, restored)
        text = restored
        selection = TextChanges.mapSelection(selection, changes)
        surface?.applyChanges(changes, selection)
        send(restored)
    }

    private fun show(
        content: String,
        selection: TextSelection,
    ) {
        sent.clear()
        text = content
        this.selection = selection
        surface?.setContent(content, selection)
    }
}
