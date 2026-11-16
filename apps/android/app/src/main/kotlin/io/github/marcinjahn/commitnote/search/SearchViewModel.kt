package io.github.marcinjahn.commitnote.search

import androidx.lifecycle.viewModelScope
import io.github.marcinjahn.commitnote.app.AppSession
import io.github.marcinjahn.commitnote.core.api.CoreCommands
import io.github.marcinjahn.commitnote.core.api.CoreEvent
import io.github.marcinjahn.commitnote.core.api.Empty
import io.github.marcinjahn.commitnote.core.api.SearchQueryParams
import io.github.marcinjahn.commitnote.core.api.SearchResults
import io.github.marcinjahn.commitnote.core.api.SearchRow
import io.github.marcinjahn.commitnote.editor.NoteMatch
import io.github.marcinjahn.commitnote.ui.ActionViewModel
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.launch

/**
 * The search screen. The core keeps a search open while the screen shows; its results follow the
 * query, and again the indexing progress while it is partial.
 */
@OptIn(FlowPreview::class)
class SearchViewModel(
    private val session: AppSession,
) : ActionViewModel() {
    private val mutableQuery = MutableStateFlow("")
    val query: StateFlow<String> = mutableQuery.asStateFlow()

    private val mutableResults = MutableStateFlow<SearchResults?>(null)
    val results: StateFlow<SearchResults?> = mutableResults.asStateFlow()

    val status: StateFlow<CoreEvent.SearchStatusChanged?> = session.screens.searchStatus

    init {
        viewModelScope.launch {
            reporting { session.send(CoreCommands.searchOpen, Empty) }
            combine(
                mutableQuery.debounce { if (it.isEmpty()) 0L else QUERY_DEBOUNCE_MS },
                status,
            ) { text, _ -> text }
                .collectLatest { text -> reporting { runQuery(text) } }
        }
    }

    fun setQuery(text: String) {
        mutableQuery.value = text
    }

    private suspend fun runQuery(text: String) {
        mutableResults.value =
            session.send(CoreCommands.searchQuery, SearchQueryParams(text)).results
    }

    override fun onCleared() {
        session.launchInSession { session.send(CoreCommands.searchClose, Empty) }
    }

    private companion object {
        const val QUERY_DEBOUNCE_MS = 250L
    }
}

/** What to reveal in the note a content result opens, taken from the first match of its snippet. */
fun SearchRow.noteMatch(): NoteMatch? {
    val parts = snippet ?: return null
    val index = parts.indexOfFirst { it.match }
    if (index < 0) return null
    val before = parts.take(index).joinToString("") { it.text }
    return NoteMatch(before.takeLast(MATCH_CONTEXT), parts[index].text)
}

private const val MATCH_CONTEXT = 40
