package io.github.marcinjahn.commitnote.share

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.github.marcinjahn.commitnote.app.AppSession
import io.github.marcinjahn.commitnote.core.api.MessagePart
import io.github.marcinjahn.commitnote.core.api.ShareActionId
import io.github.marcinjahn.commitnote.core.api.ShareCopy
import io.github.marcinjahn.commitnote.ui.Heading
import io.github.marcinjahn.commitnote.ui.Progress
import io.github.marcinjahn.commitnote.ui.SecretField
import io.github.marcinjahn.commitnote.ui.ShowMessages

/** The bottom sheet that shares the note at [path] and lists the links it already has. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShareSheet(
    session: AppSession,
    path: List<String>,
    onDismiss: () -> Unit,
) {
    val viewModel: ShareSheetViewModel =
        viewModel(
            key = "share-sheet",
            factory = viewModelFactory { initializer { ShareSheetViewModel(session, path) } },
        )
    val form by viewModel.form.collectAsStateWithLifecycle()
    val shares by viewModel.shares.collectAsStateWithLifecycle()
    val dialog by viewModel.dialog.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    ShowMessages(viewModel.messages, snackbar)
    val copy = shares?.copy
    val onAction = rememberShareActions(viewModel, copy, onOpenNote = null)
    val dismiss = {
        viewModel.reset()
        onDismiss()
    }

    ModalBottomSheet(
        onDismissRequest = dismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        Column(
            modifier =
                Modifier
                    .verticalScroll(rememberScrollState())
                    .navigationBarsPadding()
                    .padding(horizontal = 16.dp)
                    .testTag("share-sheet"),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            form.title?.let { Heading(it, MaterialTheme.typography.titleLarge) }
            if (copy == null) {
                Progress("")
            } else {
                ShareForm(form, copy, viewModel)
                val own = shares?.shares.orEmpty().filter { it.notePath == path }
                if (own.isNotEmpty()) {
                    HorizontalDivider()
                    Heading(copy.sharedLinksTitle, MaterialTheme.typography.titleMedium)
                    own.forEach { row ->
                        ShareRow(
                            row = row,
                            copy = copy,
                            updating = shares?.updatingId == row.id,
                            hidden = setOf(ShareActionId.OPEN),
                            onAction = onAction,
                            modifier = Modifier.testTag("sheet-share"),
                        )
                    }
                }
            }
            SnackbarHost(snackbar)
        }
    }
    ShareDialogs(dialog, copy, viewModel)
}

@Composable
private fun ShareForm(
    form: ShareForm,
    copy: ShareCopy,
    viewModel: ShareSheetViewModel,
) {
    val context = LocalContext.current
    when (val result = form.result) {
        is ShareResult.Created -> {
            Text(copy.shareLink, style = MaterialTheme.typography.labelLarge)
            SelectionContainer {
                Text(
                    result.link,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.fillMaxWidth().testTag("share-link-text"),
                )
            }
            Button(
                onClick = { context.shareText(result.link) },
                modifier = Modifier.fillMaxWidth().testTag("share-link"),
            ) { Text(copy.shareLink) }
            result.password?.let { password ->
                OutlinedButton(
                    onClick = {
                        context.copyToClipboard(password, sensitive = true)
                        viewModel.notify(copy.passwordCopied)
                    },
                    modifier = Modifier.fillMaxWidth().testTag("share-password-copy"),
                ) { Text(copy.sharePassword) }
            }
            OutlinedButton(
                onClick = viewModel::createAnother,
                modifier = Modifier.fillMaxWidth().testTag("share-another"),
            ) { Text(copy.createAnother) }
        }

        else -> {
            Text(copy.explanation, style = MaterialTheme.typography.bodyMedium)
            OutlinedTextField(
                value = form.label,
                onValueChange = viewModel::setLabel,
                label = { Text(copy.labelField) },
                singleLine = true,
                enabled = !form.creating,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                modifier = Modifier.fillMaxWidth().testTag("share-label"),
            )
            SecretField(
                value = form.password,
                onValueChange = viewModel::setPassword,
                label = copy.passwordField,
                tag = "share-password",
                error = null,
                enabled = !form.creating,
                imeAction = ImeAction.Done,
                onIme = viewModel::create,
            )
            Text(
                copy.passwordHint,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            (result as? ShareResult.Failed)?.let { FailureMessage(it.parts) }
            Button(
                onClick = viewModel::create,
                enabled = !form.creating,
                modifier = Modifier.fillMaxWidth().testTag("share-create"),
            ) { Text(if (form.creating) copy.creating else copy.create) }
        }
    }
}

@Composable
private fun FailureMessage(parts: List<MessagePart>) {
    val linkStyle =
        TextLinkStyles(
            SpanStyle(
                color = MaterialTheme.colorScheme.primary,
                textDecoration = TextDecoration.Underline,
            ),
        )
    val text =
        buildAnnotatedString {
            parts.forEach { part ->
                when (part) {
                    is MessagePart.Text -> {
                        append(part.text)
                    }

                    is MessagePart.Link -> {
                        withLink(
                            LinkAnnotation.Url(part.href, linkStyle),
                        ) { append(part.text) }
                    }
                }
            }
        }
    Text(
        text,
        style = MaterialTheme.typography.bodyMedium.copy(color = MaterialTheme.colorScheme.error),
        modifier = Modifier.testTag("share-error"),
    )
}
