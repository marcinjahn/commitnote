package io.github.marcinjahn.commitnote.login

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.navigation3.ui.NavDisplay
import io.github.marcinjahn.commitnote.app.AppSession
import io.github.marcinjahn.commitnote.app.GettingInStep
import io.github.marcinjahn.commitnote.app.SessionPhase
import io.github.marcinjahn.commitnote.navigation.GettingInRoute
import io.github.marcinjahn.commitnote.navigation.Initialize
import io.github.marcinjahn.commitnote.navigation.KeyChanged
import io.github.marcinjahn.commitnote.navigation.Login
import io.github.marcinjahn.commitnote.navigation.RepositoryPicker
import io.github.marcinjahn.commitnote.navigation.Startup
import io.github.marcinjahn.commitnote.navigation.StartupFailed
import io.github.marcinjahn.commitnote.navigation.Unlock
import io.github.marcinjahn.commitnote.navigation.UnusableRepository

/**
 * Every screen before the session is unlocked. The back stack follows the session phase, so it is
 * replaced whenever the phase changes and back moves the phase to the previous step.
 */
@Composable
fun GettingInDisplay(
    session: AppSession,
    phase: SessionPhase,
    onClose: () -> Unit,
) {
    NavDisplay(
        backStack = phase.gettingInStack(),
        onBack = { session.gettingIn.back() },
        entryDecorators =
            listOf(
                rememberSaveableStateHolderNavEntryDecorator(),
                rememberViewModelStoreNavEntryDecorator(),
            ),
        entryProvider =
            entryProvider<GettingInRoute> {
                entry<Startup> { StartupScreen(session, phase as? SessionPhase.ResumeFailed) }
                entry<StartupFailed> {
                    retained(phase) {
                        it as? SessionPhase.StartupFailed
                    }?.let { StartupFailedScreen(it.failure, onClose) }
                }
                entry<KeyChanged> {
                    retained(
                        phase,
                    ) { it as? SessionPhase.KeyChanged }?.let { KeyChangedScreen(session, it) }
                }
                entry<Login> {
                    retained(
                        phase,
                    ) { it.step<GettingInStep.Login>() }?.let { LoginScreen(session, it) }
                }
                entry<RepositoryPicker> {
                    retained(phase) {
                        it.step<GettingInStep.RepositoryPicker>()
                    }?.let { RepositoryPickerScreen(session, it) }
                }
                entry<Unlock> {
                    retained(
                        phase,
                    ) { it.step<GettingInStep.Unlock>() }?.let { UnlockScreen(session, it) }
                }
                entry<Initialize> {
                    retained(
                        phase,
                    ) { it.step<GettingInStep.Initialize>() }?.let { InitializeScreen(session, it) }
                }
                entry<UnusableRepository> {
                    retained(
                        phase,
                    ) { it.step<GettingInStep.Unusable>() }?.let {
                        UnusableRepositoryScreen(
                            session,
                            it,
                        )
                    }
                }
            },
    )
}

private fun SessionPhase.gettingInStack(): List<GettingInRoute> =
    when (this) {
        is SessionPhase.GettingIn -> {
            generateSequence(step) { it.previous }.map { it.route() }.toList().asReversed()
        }

        is SessionPhase.StartupFailed -> {
            listOf(StartupFailed)
        }

        is SessionPhase.KeyChanged -> {
            listOf(KeyChanged)
        }

        SessionPhase.Starting, is SessionPhase.ResumeFailed, SessionPhase.Unlocked -> {
            listOf(Startup)
        }
    }

private fun GettingInStep.route(): GettingInRoute =
    when (this) {
        is GettingInStep.Login -> Login
        is GettingInStep.RepositoryPicker -> RepositoryPicker
        is GettingInStep.Unlock -> Unlock
        is GettingInStep.Initialize -> Initialize
        is GettingInStep.Unusable -> UnusableRepository
    }

/** The step of this type on the way to the current one, which is where a back gesture leads. */
private inline fun <reified S : GettingInStep> SessionPhase.step(): S? {
    val current = (this as? SessionPhase.GettingIn)?.step ?: return null
    return generateSequence(current) { it.previous }.filterIsInstance<S>().firstOrNull()
}

private class Retained<T> {
    var value: T? = null
}

/**
 * The part of the phase a screen shows, kept after the phase moves on so the screen can finish its
 * exit animation with its last content.
 */
@Composable
private fun <T : Any> retained(
    phase: SessionPhase,
    select: (SessionPhase) -> T?,
): T? {
    val holder = remember { Retained<T>() }
    select(phase)?.let { holder.value = it }
    return holder.value
}
