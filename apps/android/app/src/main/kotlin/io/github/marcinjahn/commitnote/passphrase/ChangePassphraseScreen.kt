package io.github.marcinjahn.commitnote.passphrase

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.github.marcinjahn.commitnote.R
import io.github.marcinjahn.commitnote.app.AppSession
import io.github.marcinjahn.commitnote.core.api.CoreEvent
import io.github.marcinjahn.commitnote.core.api.PassphraseChangeCopy
import io.github.marcinjahn.commitnote.core.api.PassphraseChangeFormResult
import io.github.marcinjahn.commitnote.core.api.PassphraseStrengthResult
import io.github.marcinjahn.commitnote.ui.ErrorText
import io.github.marcinjahn.commitnote.ui.FormScaffold
import io.github.marcinjahn.commitnote.ui.Progress
import io.github.marcinjahn.commitnote.ui.SecretField
import io.github.marcinjahn.commitnote.ui.StrengthMeter
import io.github.marcinjahn.commitnote.ui.SwitchRow

@Composable
fun ChangePassphraseScreen(
    session: AppSession,
    onBack: () -> Unit,
) {
    val viewModel: PassphraseChangeViewModel =
        viewModel(factory = viewModelFactory { initializer { PassphraseChangeViewModel(session) } })
    val form by viewModel.form.collectAsStateWithLifecycle()
    val state by viewModel.state.collectAsStateWithLifecycle()
    val progress by viewModel.progress.collectAsStateWithLifecycle()
    val strength by viewModel.strength.collectAsStateWithLifecycle()

    var current by remember { mutableStateOf("") }
    var next by remember { mutableStateOf("") }
    var repeated by remember { mutableStateOf("") }
    var removeHistory by remember { mutableStateOf(false) }

    val canRemoveHistory = form?.canRemoveHistory == true
    val submit = {
        viewModel.prepare(current, next, repeated, canRemoveHistory && removeHistory)
    }
    val locked = !viewModel.canLeave()
    BackHandler(enabled = locked) {}

    LaunchedEffect(next) { viewModel.newPassphraseChanged(next) }
    LaunchedEffect(state.clearCurrent) {
        if (state.clearCurrent) {
            current = ""
            viewModel.clearCurrentHandled()
        }
    }
    LaunchedEffect(state.stage) {
        if (state.stage == ChangeStage.Done) onBack()
    }

    val loaded = form
    FormScaffold(
        title = loaded?.copy?.title ?: stringResource(R.string.change_passphrase_title),
        onBack = onBack.takeUnless { locked },
    ) {
        if (loaded == null) {
            state.error?.let { ErrorText(it.resolve(), Modifier.testTag("change-error")) }
            return@FormScaffold
        }
        val copy = loaded.copy
        when (val stage = state.stage) {
            ChangeStage.Form -> {
                FormStage(
                    form = loaded,
                    state = state,
                    values =
                        FormValues(
                            current = current,
                            next = next,
                            repeated = repeated,
                            removeHistory = removeHistory,
                        ),
                    strength = strength,
                    onCurrent = { current = it },
                    onNext = { next = it },
                    onRepeated = { repeated = it },
                    onRemoveHistory = { removeHistory = it },
                    onSubmit = submit,
                )
            }

            ChangeStage.Working -> {
                WorkingStage(copy, progress)
            }

            is ChangeStage.Review -> {
                ReviewStage(
                    copy,
                    stage,
                    state,
                    onConfirm = viewModel::commit,
                    onCancel = viewModel::cancelReview,
                )
            }

            is ChangeStage.Setup -> {
                SetupStage(copy, stage, state) {
                    viewModel.enableAtomic(
                        current,
                        next,
                        repeated,
                        canRemoveHistory && removeHistory,
                    )
                }
            }

            is ChangeStage.Unsettled -> {
                UnsettledStage(
                    copy,
                    stage,
                    state,
                    onCheck = viewModel::settle,
                    onLogOut = viewModel::logOut,
                )
            }

            ChangeStage.Done -> {
                Unit
            }
        }
    }
}

private data class FormValues(
    val current: String,
    val next: String,
    val repeated: String,
    val removeHistory: Boolean,
)

@Composable
private fun ColumnScope.FormStage(
    form: PassphraseChangeFormResult,
    state: ChangeState,
    values: FormValues,
    strength: PassphraseStrengthResult?,
    onCurrent: (String) -> Unit,
    onNext: (String) -> Unit,
    onRepeated: (String) -> Unit,
    onRemoveHistory: (Boolean) -> Unit,
    onSubmit: () -> Unit,
) {
    val copy = form.copy
    Text(copy.intro, style = MaterialTheme.typography.bodyMedium)
    SecretField(
        value = values.current,
        onValueChange = onCurrent,
        label = copy.currentLabel,
        tag = "change-current",
        error = null,
        enabled = true,
        imeAction = ImeAction.Next,
        onIme = {},
    )
    SecretField(
        value = values.next,
        onValueChange = onNext,
        label = copy.newLabel,
        tag = "change-new",
        error = null,
        enabled = true,
        imeAction = ImeAction.Next,
        onIme = {},
    )
    Text(
        copy.newHint,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    if (values.next.isNotEmpty()) strength?.let { StrengthMeter(it) }
    SecretField(
        value = values.repeated,
        onValueChange = onRepeated,
        label = copy.repeatLabel,
        tag = "change-repeat",
        error = null,
        enabled = true,
        imeAction = ImeAction.Go,
        onIme = onSubmit,
    )
    if (form.canRemoveHistory) {
        SwitchRow(
            label = copy.removeHistoryLabel,
            supporting = copy.removeHistoryDescription,
            checked = values.removeHistory,
            tag = "change-remove-history",
            onCheckedChange = onRemoveHistory,
        )
    }
    Notices(copy)
    state.error?.let { ErrorText(it.resolve(), Modifier.testTag("change-error")) }
    Button(onClick = onSubmit, modifier = Modifier.fillMaxWidth().testTag("change-continue")) {
        Text(copy.continueLabel)
    }
}

@Composable
private fun Notices(copy: PassphraseChangeCopy) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        listOf(copy.otherDevicesWarning, copy.versionHistoryNotice).forEach {
            Text(
                it,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun ColumnScope.WorkingStage(
    copy: PassphraseChangeCopy,
    progress: CoreEvent.PassphraseChangeProgress?,
) {
    val done = progress?.done
    val total = progress?.total
    val message = progress?.message ?: copy.startingLabel
    Column(
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.fillMaxWidth(),
    ) {
        if (done != null && total != null && total > 0) {
            LinearProgressIndicator(
                progress = { done.toFloat() / total },
                modifier = Modifier.fillMaxWidth(),
            )
            Text(
                message,
                textAlign = TextAlign.Center,
                modifier = Modifier.testTag("change-progress"),
            )
        } else {
            Progress(message)
        }
    }
}

@Composable
private fun ColumnScope.ReviewStage(
    copy: PassphraseChangeCopy,
    review: ChangeStage.Review,
    state: ChangeState,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
) {
    Text(
        review.summary,
        style = MaterialTheme.typography.bodyLarge,
        modifier = Modifier.testTag("change-summary"),
    )
    review.carriedOver.forEach { Text(it, style = MaterialTheme.typography.bodyMedium) }
    review.historyWarning?.let { ErrorText(it) }
    Notices(copy)
    state.error?.let { ErrorText(it.resolve(), Modifier.testTag("change-error")) }
    Button(onClick = onConfirm, modifier = Modifier.fillMaxWidth().testTag("change-confirm")) {
        Text(copy.confirmLabel)
    }
    OutlinedButton(
        onClick = onCancel,
        modifier = Modifier.fillMaxWidth().testTag("change-cancel"),
    ) {
        Text(copy.cancelLabel)
    }
}

@Composable
private fun ColumnScope.SetupStage(
    copy: PassphraseChangeCopy,
    setup: ChangeStage.Setup,
    state: ChangeState,
    onEnable: () -> Unit,
) {
    Text(setup.message, modifier = Modifier.testTag("change-setup-message"))
    state.error?.let { ErrorText(it.resolve(), Modifier.testTag("change-error")) }
    if (setup.canConfigure) {
        Button(
            onClick = onEnable,
            modifier = Modifier.fillMaxWidth().testTag("change-enable-atomic"),
        ) {
            Text(copy.enableAtomicLabel)
        }
    }
}

@Composable
private fun ColumnScope.UnsettledStage(
    copy: PassphraseChangeCopy,
    unsettled: ChangeStage.Unsettled,
    state: ChangeState,
    onCheck: () -> Unit,
    onLogOut: () -> Unit,
) {
    Text(unsettled.message, modifier = Modifier.testTag("change-unsettled-message"))
    state.error?.let { ErrorText(it.resolve(), Modifier.testTag("change-error")) }
    Button(
        onClick = onCheck,
        enabled = !state.checking,
        modifier = Modifier.fillMaxWidth().testTag("change-check-again"),
    ) {
        Text(if (state.checking) copy.checkingLabel else copy.checkAgainLabel)
    }
    OutlinedButton(
        onClick = onLogOut,
        enabled = !state.checking,
        modifier = Modifier.fillMaxWidth().testTag("change-log-out"),
    ) {
        Text(copy.logOutLabel)
    }
}
