package io.github.marcinjahn.commitnote.history

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.github.marcinjahn.commitnote.R
import io.github.marcinjahn.commitnote.app.AppSession
import io.github.marcinjahn.commitnote.core.api.HistoryPhase
import io.github.marcinjahn.commitnote.core.api.HistoryRow
import io.github.marcinjahn.commitnote.core.api.HistoryVersionView
import io.github.marcinjahn.commitnote.core.api.HistoryView
import io.github.marcinjahn.commitnote.ui.ErrorText
import io.github.marcinjahn.commitnote.ui.Heading
import io.github.marcinjahn.commitnote.ui.ScreenScaffold
import io.github.marcinjahn.commitnote.ui.ShowMessages

/** The version history of the note at [path]; [onBack] leaves it. */
@Composable
fun HistoryScreen(
    session: AppSession,
    path: List<String>,
    onBack: () -> Unit,
) {
    val viewModel: HistoryViewModel =
        viewModel(
            factory = viewModelFactory { initializer { HistoryViewModel(session, path) } },
        )
    val history by viewModel.history.collectAsStateWithLifecycle()
    val preview by viewModel.preview.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    ShowMessages(viewModel.messages, snackbar)
    LaunchedEffect(viewModel) { viewModel.leaveRequests.collect { onBack() } }

    val open = preview
    BackHandler(enabled = open != null, onBack = viewModel::closeVersion)
    ScreenScaffold(
        title = open?.version?.time ?: stringResource(R.string.history_title),
        onBack = if (open != null) viewModel::closeVersion else onBack,
        snackbar = snackbar,
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            if (open != null) {
                VersionPreviewScreen(
                    state = open,
                    onRestoreTitle = viewModel::setRestoreTitle,
                    onRetry = viewModel::reloadPreview,
                    onRestore = viewModel::restore,
                )
            } else {
                HistoryContent(
                    history = history,
                    onOpenVersion = viewModel::openVersion,
                    onLoadMore = viewModel::loadMore,
                    onRetry = viewModel::retry,
                )
            }
        }
    }
}

@Composable
private fun HistoryContent(
    history: HistoryView?,
    onOpenVersion: (HistoryVersionView) -> Unit,
    onLoadMore: () -> Unit,
    onRetry: () -> Unit,
) {
    when (history?.phase) {
        null -> {
            CenteredProgress()
        }

        HistoryPhase.SAVING -> {
            CenteredProgress(history.message)
        }

        HistoryPhase.UNSAVED -> {
            Text(
                history.message.orEmpty(),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(24.dp).testTag("history-message"),
            )
        }

        HistoryPhase.READY -> {
            HistoryList(history, onOpenVersion, onLoadMore, onRetry)
        }
    }
}

@Composable
private fun CenteredProgress(message: String? = null) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator()
        message?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
    }
}

@Composable
private fun HistoryList(
    history: HistoryView,
    onOpenVersion: (HistoryVersionView) -> Unit,
    onLoadMore: () -> Unit,
    onRetry: () -> Unit,
) {
    var expanded by rememberSaveable { mutableStateOf(setOf<String>()) }
    LazyColumn(modifier = Modifier.fillMaxSize().testTag("history-list")) {
        history.sections.forEach { section ->
            item(key = "section:${section.title}") {
                Heading(
                    section.title,
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
            items(section.rows, key = { it.key() }) { row ->
                when (row) {
                    is HistoryRow.Single -> {
                        VersionRow(row.version, onClick = { onOpenVersion(row.version) })
                    }

                    is HistoryRow.Session -> {
                        val isOpen = row.key() in expanded
                        SessionRow(row, isOpen) {
                            expanded = if (isOpen) expanded - row.key() else expanded + row.key()
                        }
                        if (isOpen) {
                            row.versions.forEach { version ->
                                VersionRow(
                                    version,
                                    indented = true,
                                    onClick = { onOpenVersion(version) },
                                )
                            }
                        }
                    }
                }
                HorizontalDivider()
            }
        }
        item(key = "footer") {
            HistoryFooter(history, onLoadMore, onRetry)
        }
    }
}

private fun HistoryRow.key(): String =
    when (this) {
        is HistoryRow.Single -> "single:${version.sha}"
        is HistoryRow.Session -> "session:${versions.firstOrNull()?.sha ?: title}"
    }

@Composable
private fun SessionRow(
    row: HistoryRow.Session,
    expanded: Boolean,
    onToggle: () -> Unit,
) {
    val state =
        stringResource(if (expanded) R.string.node_expanded else R.string.node_collapsed)
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
        modifier =
            Modifier
                .fillMaxWidth()
                .clickable(
                    onClickLabel =
                        stringResource(
                            if (expanded) R.string.node_collapse else R.string.node_expand,
                        ),
                    onClick = onToggle,
                ).heightIn(min = 48.dp)
                .padding(horizontal = 16.dp, vertical = 12.dp)
                .semantics { stateDescription = state }
                .testTag("history-session"),
    ) {
        Text(row.title, style = MaterialTheme.typography.bodyLarge)
        if (row.shared) Badge(stringResource(R.string.history_shared))
    }
}

@Composable
private fun VersionRow(
    version: HistoryVersionView,
    indented: Boolean = false,
    onClick: () -> Unit,
) {
    Column(
        verticalArrangement = Arrangement.spacedBy(4.dp),
        modifier =
            Modifier
                .fillMaxWidth()
                .clickable(onClick = onClick)
                .heightIn(min = 48.dp)
                .padding(
                    start = if (indented) 32.dp else 16.dp,
                    end = 16.dp,
                    top = 12.dp,
                    bottom = 12.dp,
                ).semantics { stateDescription = version.dateTime }
                .testTag("history-version"),
    ) {
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(version.time, style = MaterialTheme.typography.bodyLarge)
            if (version.current) Badge(stringResource(R.string.history_current))
            if (version.shared) Badge(stringResource(R.string.history_shared))
        }
        if (version.events.isNotEmpty()) {
            Text(
                version.events.joinToString(", "),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        version.name?.let {
            Text(
                it,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun Badge(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier =
            Modifier
                .border(1.dp, MaterialTheme.colorScheme.outline)
                .padding(horizontal = 6.dp, vertical = 2.dp),
    )
}

@Composable
private fun HistoryFooter(
    history: HistoryView,
    onLoadMore: () -> Unit,
    onRetry: () -> Unit,
) {
    val versionCount = history.sections.sumOf { section -> section.rows.size }
    LaunchedEffect(versionCount, history.canLoadMore, history.loading, history.error) {
        if (history.canLoadMore && !history.loading && history.error == null) onLoadMore()
    }
    Column(
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.fillMaxWidth().padding(16.dp),
    ) {
        when {
            history.error != null -> {
                ErrorText(history.error.orEmpty())
                TextButton(onClick = onRetry, modifier = Modifier.testTag("history-retry")) {
                    Text(stringResource(R.string.action_retry))
                }
            }

            history.end != null -> {
                Text(
                    history.end.orEmpty(),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.testTag("history-end"),
                )
            }

            history.canLoadMore -> {
                Button(
                    onClick = onLoadMore,
                    enabled = !history.loading,
                    modifier = Modifier.testTag("history-load-more"),
                ) {
                    Text(stringResource(R.string.history_load_more))
                }
            }

            history.loading -> {
                CircularProgressIndicator()
            }
        }
    }
}
