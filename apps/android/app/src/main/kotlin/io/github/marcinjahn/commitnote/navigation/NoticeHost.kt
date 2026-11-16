package io.github.marcinjahn.commitnote.navigation

import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.marcinjahn.commitnote.app.AppSession
import io.github.marcinjahn.commitnote.core.api.NoticeAction
import io.github.marcinjahn.commitnote.core.runtime.CoreException

/**
 * Shows the core's notices one at a time. A notice the core clears disappears with it, because the
 * snackbar of a notice that is no longer first is cancelled.
 */
@Composable
fun NoticeHost(
    session: AppSession,
    onOpenNote: (List<String>) -> Unit,
    modifier: Modifier = Modifier,
) {
    val notices by session.notices.collectAsStateWithLifecycle()
    val hostState = remember { SnackbarHostState() }
    val notice = notices.firstOrNull()

    LaunchedEffect(notice?.id) {
        notice ?: return@LaunchedEffect
        val action = notice.action
        val result =
            hostState.showSnackbar(
                message = notice.message,
                actionLabel =
                    when (action) {
                        is NoticeAction.OpenNote -> action.label
                        is NoticeAction.Undo -> action.label
                        null -> null
                    },
                withDismissAction = true,
                duration =
                    if (notice.persistent) SnackbarDuration.Indefinite else SnackbarDuration.Long,
            )
        try {
            when {
                result == SnackbarResult.Dismissed -> {
                    session.dismissNotice(notice.id)
                }

                action is NoticeAction.OpenNote -> {
                    onOpenNote(action.path)
                    session.dismissNotice(notice.id)
                }

                else -> {
                    session.performNotice(notice.id)
                }
            }
        } catch (_: CoreException) {
        }
    }

    SnackbarHost(hostState, modifier = modifier) { data ->
        Snackbar(data, modifier = Modifier.testTag("notice"))
    }
}
