package io.github.marcinjahn.commitnote.tree

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudDone
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.CloudSync
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.marcinjahn.commitnote.R
import io.github.marcinjahn.commitnote.core.api.CoreEvent
import io.github.marcinjahn.commitnote.core.api.SyncState

/** The compact sync state for the top app bar, with a retry when the core offers one. */
@Composable
fun SyncStatus(
    sync: CoreEvent.SyncStateChanged,
    onRetry: () -> Unit,
) {
    val outOfSync = sync.state is SyncState.OutOfSync
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            modifier =
                Modifier
                    .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite }
                    .testTag("sync-status"),
        ) {
            Icon(
                when {
                    !sync.online -> Icons.Filled.CloudOff
                    sync.state == SyncState.Syncing -> Icons.Filled.CloudSync
                    outOfSync -> Icons.Filled.ErrorOutline
                    else -> Icons.Filled.CloudDone
                },
                contentDescription = null,
                tint =
                    if (outOfSync) {
                        MaterialTheme.colorScheme.error
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                modifier = Modifier.size(18.dp),
            )
            Text(
                sync.label.ifEmpty {
                    if (sync.online) "" else stringResource(R.string.sync_offline)
                },
                style = MaterialTheme.typography.labelMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.widthIn(max = 160.dp),
            )
        }
        if (sync.canRetry) {
            TextButton(onClick = onRetry, modifier = Modifier.testTag("sync-retry")) {
                Text(stringResource(R.string.action_retry))
            }
        }
    }
}
