package io.github.marcinjahn.commitnote.passphrase

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.marcinjahn.commitnote.app.AppSession
import io.github.marcinjahn.commitnote.core.api.CoreCommands
import io.github.marcinjahn.commitnote.core.api.CoreEvent
import io.github.marcinjahn.commitnote.core.api.Empty
import io.github.marcinjahn.commitnote.core.api.PassphraseChangeFormResult
import io.github.marcinjahn.commitnote.core.api.PassphraseChangeOutcome
import io.github.marcinjahn.commitnote.core.api.PassphraseChangePrepareParams
import io.github.marcinjahn.commitnote.core.api.PassphraseStrengthResult
import io.github.marcinjahn.commitnote.core.api.Secret
import io.github.marcinjahn.commitnote.core.runtime.CoreException
import io.github.marcinjahn.commitnote.ui.PassphraseStrengthTracker
import io.github.marcinjahn.commitnote.ui.UiText
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Where the passphrase change is; every stage but [Form] and [Setup] waits for the core. */
sealed interface ChangeStage {
    data object Form : ChangeStage

    data object Working : ChangeStage

    data class Review(
        val summary: String,
        val carriedOver: List<String>,
        val historyWarning: String?,
    ) : ChangeStage

    data class Setup(
        val canConfigure: Boolean,
        val message: String,
        val actionLabel: String,
    ) : ChangeStage

    data class Unsettled(
        val message: String,
    ) : ChangeStage

    data object Done : ChangeStage
}

data class ChangeState(
    val stage: ChangeStage = ChangeStage.Form,
    val error: UiText? = null,
    val checking: Boolean = false,
    val clearCurrent: Boolean = false,
)

/** What the form needs to change the passphrase, with the form's text kept on the screen. */
class PassphraseChangeViewModel(
    private val session: AppSession,
) : ViewModel() {
    private val mutableForm = MutableStateFlow<PassphraseChangeFormResult?>(null)
    val form: StateFlow<PassphraseChangeFormResult?> = mutableForm.asStateFlow()

    private val mutableState = MutableStateFlow(ChangeState())
    val state: StateFlow<ChangeState> = mutableState.asStateFlow()

    val progress: StateFlow<CoreEvent.PassphraseChangeProgress?> =
        session.screens.passphraseProgress

    private val strengthTracker = PassphraseStrengthTracker(session, viewModelScope)
    val strength: StateFlow<PassphraseStrengthResult?> = strengthTracker.strength

    init {
        session.screens.clearPassphraseProgress()
        viewModelScope.launch {
            session.editor.flush()
            try {
                mutableForm.value = session.send(CoreCommands.passphraseChangeForm, Empty)
            } catch (failure: CoreException) {
                mutableState.update { it.copy(error = UiText.Plain(failure.error.message)) }
            }
        }
    }

    fun newPassphraseChanged(passphrase: String) {
        val label = form.value?.repositoryLabel ?: return
        strengthTracker.passphraseChanged(passphrase, label)
    }

    fun clearCurrentHandled() = mutableState.update { it.copy(clearCurrent = false) }

    fun prepare(
        current: String,
        next: String,
        repeated: String,
        removeHistory: Boolean,
    ) {
        val copy = form.value?.copy ?: return
        val invalid =
            when {
                current.isEmpty() -> copy.enterCurrentPassphrase
                next != repeated -> copy.passphrasesDiffer
                else -> null
            }
        if (invalid != null) {
            mutableState.update { it.copy(stage = ChangeStage.Form, error = UiText.Plain(invalid)) }
            return
        }
        run(ChangeStage.Form) {
            session
                .send(
                    CoreCommands.passphrasePrepareChange,
                    PassphraseChangePrepareParams(Secret(current), Secret(next), removeHistory),
                ).outcome
        }
    }

    fun commit() {
        if (state.value.stage !is ChangeStage.Review) return
        run(state.value.stage) { session.send(CoreCommands.passphraseCommitChange, Empty).outcome }
    }

    /** Asks the core whether an interrupted change went through. */
    fun settle() {
        val current = state.value
        if (current.stage !is ChangeStage.Unsettled || current.checking) return
        mutableState.update { it.copy(checking = true) }
        viewModelScope.launch {
            applyOutcome(
                current.stage,
            ) { session.send(CoreCommands.passphraseSettle, Empty).outcome }
            mutableState.update { it.copy(checking = false) }
        }
    }

    /** Turns atomic saving on, then submits the form again. */
    fun enableAtomic(
        current: String,
        next: String,
        repeated: String,
        removeHistory: Boolean,
    ) {
        if (state.value.stage !is ChangeStage.Setup) return
        startWork()
        viewModelScope.launch {
            val failure =
                try {
                    session.send(CoreCommands.passphraseEnableAtomic, Empty).error
                } catch (failure: CoreException) {
                    failure.error.message
                }
            if (failure == null) {
                mutableState.update { it.copy(stage = ChangeStage.Form) }
                prepare(current, next, repeated, removeHistory)
            } else {
                mutableState.update {
                    it.copy(
                        stage = ChangeStage.Form,
                        error = UiText.Plain(failure),
                    )
                }
            }
        }
    }

    fun logOut() = session.launchInSession { session.logOut(anyway = true) }

    fun cancelReview() {
        if (state.value.stage !is ChangeStage.Review) return
        mutableState.update { it.copy(stage = ChangeStage.Form, error = null) }
        session.launchInSession { session.send(CoreCommands.passphraseCancelChange, Empty) }
    }

    /** Whether leaving now is allowed; it is not while the core works or an outcome is unknown. */
    fun canLeave(): Boolean =
        when (state.value.stage) {
            ChangeStage.Working, is ChangeStage.Unsettled -> false
            else -> true
        }

    override fun onCleared() {
        if (state.value.stage is ChangeStage.Review) {
            session.launchInSession { session.send(CoreCommands.passphraseCancelChange, Empty) }
        }
        session.screens.clearPassphraseProgress()
    }

    private fun startWork() {
        session.screens.clearPassphraseProgress()
        mutableState.update { it.copy(stage = ChangeStage.Working, error = null) }
    }

    private fun run(
        previous: ChangeStage,
        operation: suspend () -> PassphraseChangeOutcome,
    ) {
        startWork()
        mutableState.update { it.copy(clearCurrent = false) }
        viewModelScope.launch { applyOutcome(previous, operation) }
    }

    private suspend fun applyOutcome(
        previous: ChangeStage,
        operation: suspend () -> PassphraseChangeOutcome,
    ) {
        val outcome =
            try {
                operation()
            } catch (error: CancellationException) {
                throw error
            } catch (failure: CoreException) {
                mutableState.update {
                    it.copy(stage = previous, error = UiText.Plain(failure.error.message))
                }
                return
            }
        mutableState.update { it.apply(outcome) }
    }

    private fun ChangeState.apply(outcome: PassphraseChangeOutcome) =
        when (outcome) {
            is PassphraseChangeOutcome.Review -> {
                copy(
                    stage =
                        ChangeStage.Review(
                            outcome.summary,
                            outcome.carriedOver,
                            outcome.historyWarning,
                        ),
                    error = null,
                )
            }

            PassphraseChangeOutcome.Changed -> {
                copy(stage = ChangeStage.Done, error = null)
            }

            is PassphraseChangeOutcome.Failed -> {
                copy(
                    stage = ChangeStage.Form,
                    error = UiText.Plain(outcome.message),
                    clearCurrent = outcome.clearCurrent,
                )
            }

            is PassphraseChangeOutcome.NeedsSetup -> {
                copy(
                    stage =
                        ChangeStage.Setup(
                            outcome.canConfigure,
                            outcome.message,
                            outcome.actionLabel,
                        ),
                    error = null,
                )
            }

            is PassphraseChangeOutcome.Unsettled -> {
                copy(stage = ChangeStage.Unsettled(outcome.message), error = null)
            }
        }
}
