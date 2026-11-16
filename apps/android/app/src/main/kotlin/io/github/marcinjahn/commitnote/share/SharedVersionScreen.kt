package io.github.marcinjahn.commitnote.share

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import io.github.marcinjahn.commitnote.R
import io.github.marcinjahn.commitnote.core.api.ShareCopy
import io.github.marcinjahn.commitnote.core.api.SharedVersionOutcome
import io.github.marcinjahn.commitnote.ui.ErrorText
import io.github.marcinjahn.commitnote.ui.LocalNoteFontFamily
import io.github.marcinjahn.commitnote.ui.Progress
import io.github.marcinjahn.commitnote.ui.ScreenScaffold

/** The text of the version of a note that a share link currently shows. */
@Composable
fun SharedVersionScreen(
    state: SharedVersionState,
    copy: ShareCopy,
    onRetry: () -> Unit,
    onBack: () -> Unit,
) {
    ScreenScaffold(title = copy.sharedVersionTitle, onBack = onBack) { padding ->
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp)
                    .testTag("shared-version"),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            when (val outcome = state.outcome) {
                null -> {
                    if (state.loading) Progress(copy.loadingSharedVersion)
                }

                is SharedVersionOutcome.Readable -> {
                    Text(
                        outcome.name ?: state.title,
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        outcome.date,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    SelectionContainer {
                        Text(
                            outcome.content,
                            style =
                                MaterialTheme.typography.bodyMedium.copy(
                                    fontFamily = LocalNoteFontFamily.current,
                                ),
                            modifier =
                                Modifier.fillMaxWidth().testTag(
                                    "shared-version-content",
                                ),
                        )
                    }
                }

                is SharedVersionOutcome.Message -> {
                    Text(
                        outcome.message,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                is SharedVersionOutcome.Failed -> {
                    ErrorText(outcome.message)
                    TextButton(onClick = onRetry) { Text(stringResource(R.string.action_retry)) }
                }
            }
        }
    }
}
