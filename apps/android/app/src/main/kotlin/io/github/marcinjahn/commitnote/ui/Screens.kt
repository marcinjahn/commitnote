package io.github.marcinjahn.commitnote.ui

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import io.github.marcinjahn.commitnote.R
import kotlinx.coroutines.flow.Flow

/** A screen with a top bar, a back arrow and a snackbar host, around a [content] of its own layout. */
@Composable
fun ScreenScaffold(
    title: String,
    onBack: () -> Unit,
    snackbar: SnackbarHostState? = null,
    actions: @Composable RowScope.() -> Unit = {},
    content: @Composable (PaddingValues) -> Unit,
) {
    Scaffold(
        topBar = {
            CommitnoteTopBar(
                title = title,
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            stringResource(R.string.action_back),
                        )
                    }
                },
                actions = actions,
            )
        },
        snackbarHost = { snackbar?.let { SnackbarHost(it) } },
        content = content,
    )
}

/** Shows each of [messages] in [snackbar]. */
@Composable
fun ShowMessages(
    messages: Flow<UiText>,
    snackbar: SnackbarHostState,
) {
    val context = LocalContext.current
    LaunchedEffect(messages) {
        messages.collect { snackbar.showSnackbar(it.resolve(context)) }
    }
}
