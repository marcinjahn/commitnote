package io.github.marcinjahn.commitnote.search

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CollectionInfo
import androidx.compose.ui.semantics.collectionInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.github.marcinjahn.commitnote.R
import io.github.marcinjahn.commitnote.app.AppSession
import io.github.marcinjahn.commitnote.core.api.ColorTag
import io.github.marcinjahn.commitnote.core.api.NameRange
import io.github.marcinjahn.commitnote.core.api.SearchResults
import io.github.marcinjahn.commitnote.core.api.SearchRow
import io.github.marcinjahn.commitnote.core.api.SnippetPart
import io.github.marcinjahn.commitnote.editor.NoteMatch
import io.github.marcinjahn.commitnote.tree.TagDot
import io.github.marcinjahn.commitnote.tree.rememberTagLabel
import io.github.marcinjahn.commitnote.ui.Heading
import io.github.marcinjahn.commitnote.ui.ScreenScaffold
import io.github.marcinjahn.commitnote.ui.ShowMessages

/** Searches note names and contents; [onOpen] shows a result's note, at its match if it has one. */
@Composable
fun SearchScreen(
    session: AppSession,
    onBack: () -> Unit,
    onOpen: (path: List<String>, match: NoteMatch?) -> Unit,
) {
    val viewModel: SearchViewModel =
        viewModel(factory = viewModelFactory { initializer { SearchViewModel(session) } })
    val query by viewModel.query.collectAsStateWithLifecycle()
    val results by viewModel.results.collectAsStateWithLifecycle()
    val status by viewModel.status.collectAsStateWithLifecycle()
    val tree by session.tree.collectAsStateWithLifecycle()
    val tagLabel = rememberTagLabel(tree)
    val snackbar = remember { SnackbarHostState() }
    ShowMessages(viewModel.messages, snackbar)
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }

    ScreenScaffold(
        title = stringResource(R.string.menu_search),
        onBack = onBack,
        snackbar = snackbar,
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            OutlinedTextField(
                value = query,
                onValueChange = viewModel::setQuery,
                label = { Text(results?.copy?.hint ?: stringResource(R.string.search_hint)) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp)
                        .focusRequester(focus)
                        .testTag("search-field"),
            )
            status?.takeIf { it.status != null }?.let {
                IndexingStatus(
                    it.status.orEmpty(),
                    it.progress,
                )
            }
            results?.let { found ->
                ResultList(
                    results = found,
                    blank = query.isBlank(),
                    partial = status?.partial == true,
                    tagLabel = tagLabel,
                    onOpen = onOpen,
                )
            }
        }
    }
}

@Composable
private fun IndexingStatus(
    text: String,
    progress: Double?,
) {
    Column(
        verticalArrangement = Arrangement.spacedBy(6.dp),
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(
                    horizontal = 16.dp,
                    vertical = 8.dp,
                ).testTag("search-status"),
    ) {
        Text(
            text,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (progress != null) {
            LinearProgressIndicator(
                progress = { progress.toFloat() },
                modifier = Modifier.fillMaxWidth(),
            )
        } else {
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
        }
    }
}

@Composable
private fun ResultList(
    results: SearchResults,
    blank: Boolean,
    partial: Boolean,
    tagLabel: (ColorTag) -> String,
    onOpen: (List<String>, NoteMatch?) -> Unit,
) {
    val sections =
        if (blank) {
            listOf(Section(results.copy.recentHeading, results.recent, null, "search-recent-row"))
        } else {
            listOf(
                Section(
                    results.copy.namesHeading,
                    results.names,
                    results.namesMore,
                    "search-name-row",
                ),
                Section(
                    results.copy.contentsHeading,
                    results.contents,
                    results.contentsMore,
                    "search-content-row",
                ),
            )
        }
    val rowCount = sections.sumOf { it.rows.size }
    LazyColumn(
        modifier =
            Modifier
                .fillMaxSize()
                .semantics { collectionInfo = CollectionInfo(rowCount, 1) }
                .testTag("search-results"),
    ) {
        sections.filter { it.rows.isNotEmpty() }.forEach { section ->
            item(key = "heading:${section.heading}") {
                Heading(
                    section.heading,
                    MaterialTheme.typography.titleSmall,
                    modifier =
                        Modifier.fillMaxWidth().padding(
                            start = 16.dp,
                            top = 16.dp,
                            end = 16.dp,
                            bottom = 4.dp,
                        ),
                )
            }
            items(section.rows.size, key = { "${section.tag}:${section.rows[it].path}" }) { index ->
                val row = section.rows[index]
                ResultRow(row, section.tag, tagLabel) { onOpen(row.path, row.noteMatch()) }
                HorizontalDivider()
            }
            section.more?.let { more ->
                item(key = "more:${section.heading}") { FootNote(more) }
            }
        }
        if (!blank && rowCount == 0) {
            item(key = "none") {
                FootNote(
                    if (partial) results.copy.stillReading else results.copy.noMatches,
                    "search-empty",
                )
            }
        }
        results.countText?.takeIf { !blank && rowCount > 0 }?.let { count ->
            item(key = "count") { FootNote(count) }
        }
    }
}

private class Section(
    val heading: String,
    val rows: List<SearchRow>,
    val more: String?,
    val tag: String,
)

@Composable
private fun FootNote(
    text: String,
    tag: String = "search-note",
) {
    Text(
        text,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.fillMaxWidth().padding(16.dp).testTag(tag),
    )
}

@Composable
private fun ResultRow(
    row: SearchRow,
    tag: String,
    tagLabel: (ColorTag) -> String,
    onClick: () -> Unit,
) {
    val highlight =
        SpanStyle(
            fontWeight = FontWeight.Bold,
            background = MaterialTheme.colorScheme.primary.copy(alpha = HIGHLIGHT_ALPHA),
        )
    Column(
        verticalArrangement = Arrangement.spacedBy(2.dp),
        modifier =
            Modifier
                .fillMaxWidth()
                .clickable(onClick = onClick)
                .heightIn(min = 56.dp)
                .padding(horizontal = 16.dp, vertical = 8.dp)
                .testTag(tag),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                highlightedName(row.name, row.nameRanges, highlight),
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.weight(1f, fill = false),
            )
            row.colorTag?.let { tagged ->
                TagDot(tagged, Modifier.semantics { contentDescription = tagLabel(tagged) })
            }
        }
        row.folder?.takeIf { it.isNotBlank() }?.let {
            Text(
                it,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        row.snippet?.let { parts ->
            Text(
                highlightedSnippet(parts, highlight),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

private fun highlightedName(
    name: String,
    ranges: List<NameRange>,
    highlight: SpanStyle,
): AnnotatedString =
    buildAnnotatedString {
        append(name)
        ranges.forEach { range ->
            val start = range.start.coerceIn(0, name.length)
            val end = range.end.coerceIn(start, name.length)
            addStyle(highlight, start, end)
        }
    }

private fun highlightedSnippet(
    parts: List<SnippetPart>,
    highlight: SpanStyle,
): AnnotatedString =
    buildAnnotatedString {
        parts.forEach { part ->
            if (part.match) withStyle(highlight) { append(part.text) } else append(part.text)
        }
    }

private const val HIGHLIGHT_ALPHA = 0.25f
