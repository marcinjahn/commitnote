package io.github.marcinjahn.commitnote.history

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import io.github.marcinjahn.commitnote.R
import io.github.marcinjahn.commitnote.core.api.DiffItemView
import io.github.marcinjahn.commitnote.core.api.DiffLineView
import io.github.marcinjahn.commitnote.core.api.DiffSegment
import io.github.marcinjahn.commitnote.core.api.PreviewBody
import io.github.marcinjahn.commitnote.core.api.VersionPreview
import io.github.marcinjahn.commitnote.ui.ErrorText
import io.github.marcinjahn.commitnote.ui.LocalDarkTheme

/** What changed in one version, with the action to restore it. */
@Composable
fun VersionPreviewScreen(
    state: VersionPreviewState,
    onRestoreTitle: (Boolean) -> Unit,
    onRetry: () -> Unit,
    onRestore: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxSize().testTag("history-preview")) {
        Column(
            modifier =
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            when (val preview = state.preview) {
                null -> {
                    if (state.loading) {
                        CircularProgressIndicator(
                            modifier = Modifier.testTag("history-preview-loading"),
                        )
                    } else {
                        TextButton(
                            onClick = onRetry,
                        ) { Text(stringResource(R.string.action_retry)) }
                    }
                }

                is VersionPreview.Failed -> {
                    ErrorText(preview.message)
                    TextButton(
                        onClick = onRetry,
                        modifier = Modifier.testTag("history-preview-retry"),
                    ) { Text(stringResource(R.string.action_retry)) }
                }

                is VersionPreview.Undecryptable -> {
                    Message(preview.message)
                }

                is VersionPreview.Closed -> {
                    Message(preview.message)
                }

                is VersionPreview.Version -> {
                    preview.titleChange?.let {
                        Text(
                            it,
                            style = MaterialTheme.typography.titleMedium,
                            modifier = Modifier.testTag("history-title-change"),
                        )
                    }
                    PreviewBodyView(preview.body)
                }
            }
        }
        val version = state.preview as? VersionPreview.Version
        if (version != null) {
            HorizontalDivider()
            RestoreBar(version, state, onRestoreTitle, onRestore)
        }
    }
}

@Composable
private fun Message(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RestoreBar(
    version: VersionPreview.Version,
    state: VersionPreviewState,
    onRestoreTitle: (Boolean) -> Unit,
    onRestore: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        (state.restoreMessage ?: version.restore.reason)?.let {
            Text(
                it,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.testTag("history-restore-reason"),
            )
        }
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(16.dp, Alignment.End),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            itemVerticalAlignment = Alignment.CenterVertically,
        ) {
            version.restoreTitle?.let { label ->
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                    modifier =
                        Modifier
                            .heightIn(min = 48.dp)
                            .toggleable(
                                state.restoreTitle,
                                role = Role.Switch,
                                onValueChange = onRestoreTitle,
                            ).testTag("history-restore-title"),
                ) {
                    Text(label, style = MaterialTheme.typography.bodyLarge)
                    Switch(checked = state.restoreTitle, onCheckedChange = null)
                }
            }
            Button(
                onClick = onRestore,
                enabled = version.restore.enabled && !state.restoring,
                modifier = Modifier.testTag("history-restore"),
            ) {
                if (state.restoring) {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp))
                }
                Text(
                    version.restore.label,
                    modifier = Modifier.padding(start = if (state.restoring) 8.dp else 0.dp),
                )
            }
        }
    }
}

@Composable
private fun PreviewBodyView(body: PreviewBody) {
    when (body) {
        is PreviewBody.TooLarge -> {
            Message(body.message)
        }

        is PreviewBody.Unchanged -> {
            Message(body.message)
        }

        is PreviewBody.Diff -> {
            Column(modifier = Modifier.fillMaxWidth().testTag("history-diff")) {
                body.items.forEach { item ->
                    when (item) {
                        is DiffItemView.Line -> DiffLine(item.line)
                        is DiffItemView.Fold -> DiffFold(item)
                    }
                }
                body.finalNewline?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun DiffFold(fold: DiffItemView.Fold) {
    var open by rememberSaveable(fold.label) { mutableStateOf(false) }
    val state = stringResource(if (open) R.string.node_expanded else R.string.node_collapsed)
    Text(
        fold.label,
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier =
            Modifier
                .fillMaxWidth()
                .clickable(
                    onClickLabel =
                        stringResource(
                            if (open) R.string.node_collapse else R.string.node_expand,
                        ),
                    onClick = { open = !open },
                ).heightIn(min = 48.dp)
                .padding(vertical = 12.dp)
                .semantics { stateDescription = state },
    )
    if (open) fold.lines.forEach { DiffLine(it) }
}

@Composable
private fun DiffLine(line: DiffLineView) {
    val dark = LocalDarkTheme.current
    val kind =
        when (line) {
            is DiffLineView.Same -> DiffKind.Same
            is DiffLineView.Added -> DiffKind.Added
            is DiffLineView.Removed -> DiffKind.Removed
        }
    val tint = kind.tint(dark)
    val emphasis = kind.emphasis(dark)
    val text: AnnotatedString =
        when (line) {
            is DiffLineView.Same -> AnnotatedString(line.text.ifEmpty { " " })
            is DiffLineView.Added -> segments(line.segments, emphasis)
            is DiffLineView.Removed -> segments(line.segments, emphasis)
        }
    val state = kind.label?.let { stringResource(it) }
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .background(tint)
                .semantics(mergeDescendants = true) { state?.let { stateDescription = it } }
                .testTag("history-diff-line"),
    ) {
        Text(
            kind.marker,
            style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
            modifier = Modifier.padding(horizontal = 4.dp).clearAndSetSemantics {},
        )
        Text(
            text,
            style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
            modifier = Modifier.weight(1f),
        )
    }
}

private fun segments(
    segments: List<DiffSegment>,
    emphasis: Color,
): AnnotatedString =
    buildAnnotatedString {
        segments.forEach { segment ->
            if (segment.changed) {
                withStyle(SpanStyle(background = emphasis)) { append(segment.text) }
            } else {
                append(segment.text)
            }
        }
        if (length == 0) append(" ")
    }

private enum class DiffKind(
    val marker: String,
    val label: Int?,
    private val hue: Color?,
) {
    Same(" ", null, null),
    Added("+", R.string.history_diff_added, Color(0xFF218358)),
    Removed("-", R.string.history_diff_removed, Color(0xFFCE2C31)),
    ;

    fun tint(dark: Boolean): Color =
        hue?.copy(alpha = if (dark) 0.22f else 0.14f) ?: Color.Transparent

    fun emphasis(dark: Boolean): Color =
        hue?.copy(alpha = if (dark) 0.5f else 0.35f) ?: Color.Transparent
}
