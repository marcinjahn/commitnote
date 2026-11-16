package io.github.marcinjahn.commitnote.share

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CollectionInfo
import androidx.compose.ui.semantics.collectionInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.github.marcinjahn.commitnote.R
import io.github.marcinjahn.commitnote.app.AppSession
import io.github.marcinjahn.commitnote.ui.ErrorText
import io.github.marcinjahn.commitnote.ui.Progress
import io.github.marcinjahn.commitnote.ui.ScreenScaffold
import io.github.marcinjahn.commitnote.ui.ShowMessages

/** Every share of the notes, with the actions the core offers for each. */
@Composable
fun SharedLinksScreen(
    session: AppSession,
    onBack: () -> Unit,
    onOpenNote: (List<String>) -> Unit,
) {
    val viewModel: SharesViewModel =
        viewModel(factory = viewModelFactory { initializer { SharesViewModel(session) } })
    val shares by viewModel.shares.collectAsStateWithLifecycle()
    val dialog by viewModel.dialog.collectAsStateWithLifecycle()
    val version by viewModel.version.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    ShowMessages(viewModel.messages, snackbar)
    val current = shares
    val onAction = rememberShareActions(viewModel, current?.copy, onOpenNote)

    val shownVersion = version
    if (shownVersion != null && current != null) {
        BackHandler(onBack = viewModel::closeVersion)
        SharedVersionScreen(
            state = shownVersion,
            copy = current.copy,
            onRetry = viewModel::reloadVersion,
            onBack = viewModel::closeVersion,
        )
        return
    }

    ScreenScaffold(
        title = current?.copy?.sharedLinksTitle ?: stringResource(R.string.shared_links_title),
        onBack = onBack,
        snackbar = snackbar,
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            if (current == null) {
                Box(
                    modifier = Modifier.padding(24.dp),
                ) { Progress(stringResource(R.string.shared_links_loading)) }
            } else {
                LazyColumn(
                    modifier =
                        Modifier
                            .fillMaxSize()
                            .semantics {
                                collectionInfo =
                                    CollectionInfo(rowCount = current.shares.size, columnCount = 1)
                            }.testTag("shared-links-list"),
                ) {
                    current.unreadable?.let { message ->
                        item(key = "unreadable") {
                            Box(modifier = Modifier.padding(16.dp)) { ErrorText(message) }
                        }
                    }
                    if (current.shares.isEmpty()) {
                        item(key = "empty") {
                            Text(
                                current.copy.sharedLinksEmpty,
                                style = MaterialTheme.typography.bodyLarge,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier =
                                    Modifier
                                        .fillMaxWidth()
                                        .padding(
                                            24.dp,
                                        ).testTag("shared-links-empty"),
                            )
                        }
                    }
                    items(current.shares, key = { it.id }) { row ->
                        ShareRow(
                            row = row,
                            copy = current.copy,
                            updating = current.updatingId == row.id,
                            hidden = emptySet(),
                            onAction = onAction,
                            modifier = Modifier.testTag("shared-link"),
                        )
                        HorizontalDivider()
                    }
                }
            }
        }
    }
    ShareDialogs(dialog, current?.copy, viewModel)
}
