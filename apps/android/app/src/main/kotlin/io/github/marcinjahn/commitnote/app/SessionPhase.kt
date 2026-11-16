package io.github.marcinjahn.commitnote.app

import io.github.marcinjahn.commitnote.core.api.ForgeKind
import io.github.marcinjahn.commitnote.core.api.ForgeView
import io.github.marcinjahn.commitnote.core.api.RepositoryListing
import io.github.marcinjahn.commitnote.core.api.RepositoryView

sealed interface SessionPhase {
    data object Starting : SessionPhase

    /** Resuming the remembered session failed in a way that may pass. */
    data class ResumeFailed(
        val message: String,
    ) : SessionPhase

    data class StartupFailed(
        val failure: StartupFailure,
    ) : SessionPhase

    data class GettingIn(
        val step: GettingInStep,
    ) : SessionPhase

    data object Unlocked : SessionPhase

    /** [canUnlock] is false when the credentials to open the repository again are gone. */
    data class KeyChanged(
        val unsavedCount: Int,
        val message: String,
        val detail: String,
        val exportLabel: String,
        val canUnlock: Boolean,
    ) : SessionPhase
}

sealed interface StartupFailure {
    data class ApiVersionMismatch(
        val expected: Int,
        val found: Long,
    ) : StartupFailure

    data object Unloadable : StartupFailure
}

/** One step of getting into a repository; [previous] is where going back leads. */
sealed interface GettingInStep {
    val previous: GettingInStep?

    data class Login(
        val forges: List<ForgeView>,
        val preferredForge: ForgeKind?,
        val error: String?,
    ) : GettingInStep {
        override val previous: GettingInStep? get() = null
    }

    data class RepositoryPicker(
        val forge: ForgeView,
        val repositories: List<RepositoryListing>,
        override val previous: GettingInStep,
    ) : GettingInStep

    data class Unlock(
        val repository: RepositoryView,
        override val previous: GettingInStep,
    ) : GettingInStep

    data class Initialize(
        val repository: RepositoryView,
        val setUpDescription: String,
        override val previous: GettingInStep,
    ) : GettingInStep

    data class Unusable(
        val repository: RepositoryView,
        val message: String,
        val canCheckAgain: Boolean,
        val foreignHint: String?,
        override val previous: GettingInStep,
    ) : GettingInStep
}
