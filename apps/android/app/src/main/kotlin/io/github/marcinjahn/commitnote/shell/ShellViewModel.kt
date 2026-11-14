package io.github.marcinjahn.commitnote.shell

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.github.marcinjahn.commitnote.CommitnoteApplication
import io.github.marcinjahn.commitnote.core.api.CoreCommands
import io.github.marcinjahn.commitnote.core.api.CoreEvent
import io.github.marcinjahn.commitnote.core.api.Empty
import io.github.marcinjahn.commitnote.core.api.ForgeKind
import io.github.marcinjahn.commitnote.core.api.LoginInspectRepositoryParams
import io.github.marcinjahn.commitnote.core.api.LoginInspectRepositoryResult
import io.github.marcinjahn.commitnote.core.api.LoginListRepositoriesParams
import io.github.marcinjahn.commitnote.core.api.PassphraseParams
import io.github.marcinjahn.commitnote.core.api.RepositoryListing
import io.github.marcinjahn.commitnote.core.api.Secret
import io.github.marcinjahn.commitnote.core.api.SessionResumeResult
import io.github.marcinjahn.commitnote.core.api.TreeNode
import io.github.marcinjahn.commitnote.core.runtime.CoreException
import io.github.marcinjahn.commitnote.core.runtime.CoreRuntime
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** Reduces core command results and events into [ShellState]; the shell reaches the tree and stops there. */
class ShellViewModel(
    private val runtimeProvider: suspend () -> CoreRuntime,
) : ViewModel() {
    private val mutableState = MutableStateFlow(ShellState())
    val state: StateFlow<ShellState> = mutableState.asStateFlow()

    private var accessToken: Secret? = null
    private var repositories: ShellScreen.Repositories? = null
    private var treePolling: Job? = null

    init {
        viewModelScope.launch {
            guarded {
                val runtime = runtimeProvider()
                launch { runtime.events.collect(::reduce) }
                resume(runtime)
            }
        }
    }

    fun selectForge(forge: ForgeKind) {
        mutableState.update { state ->
            if (state.screen is ShellScreen.Token) {
                state.copy(
                    screen = ShellScreen.Token(forge),
                )
            } else {
                state
            }
        }
    }

    fun continueWithToken(token: String) {
        val screen = mutableState.value.screen as? ShellScreen.Token ?: return
        val secret = Secret(token.trim())
        command {
            val listing =
                it.send(
                    CoreCommands.loginListRepositories,
                    LoginListRepositoriesParams(screen.forge, secret),
                )
            accessToken = secret
            show(ShellScreen.Repositories(screen.forge, listing.repositories))
        }
    }

    fun chooseRepository(repository: RepositoryListing) {
        val screen = mutableState.value.screen as? ShellScreen.Repositories ?: return
        val secret = accessToken ?: return
        command {
            val result =
                it.send(
                    CoreCommands.loginInspectRepository,
                    LoginInspectRepositoryParams(screen.forge, secret, repository.url),
                )
            when (result) {
                is LoginInspectRepositoryResult.NotesRepo -> {
                    show(
                        ShellScreen.Passphrase(result.repository),
                    )
                }

                is LoginInspectRepositoryResult.Uninitialized -> {
                    fail("The repository is empty")
                }

                is LoginInspectRepositoryResult.Unusable -> {
                    fail(result.error.message)
                }
            }
        }
    }

    fun unlock(passphrase: String) {
        if (mutableState.value.screen !is ShellScreen.Passphrase) return
        command {
            it.send(CoreCommands.loginUnlock, PassphraseParams(Secret(passphrase)))
            showTree(it)
        }
    }

    /** Returns false when there is nothing to go back to. */
    fun back(): Boolean {
        val previous =
            when (val screen = mutableState.value.screen) {
                is ShellScreen.Passphrase -> repositories
                is ShellScreen.Repositories -> ShellScreen.Token(screen.forge)
                else -> null
            } ?: return false
        mutableState.update { it.copy(screen = previous, error = null) }
        return true
    }

    private suspend fun resume(runtime: CoreRuntime) {
        when (val result = runtime.send(CoreCommands.sessionResume, Empty)) {
            SessionResumeResult.Resumed -> {
                showTree(runtime)
            }

            SessionResumeResult.None -> {
                show(ShellScreen.Token(ForgeKind.GITHUB))
            }

            is SessionResumeResult.Failed -> {
                show(ShellScreen.Token(ForgeKind.GITHUB))
                fail(result.error.message)
            }
        }
    }

    private fun showTree(runtime: CoreRuntime) {
        show(ShellScreen.Tree(null))
        treePolling?.cancel()
        treePolling =
            viewModelScope.launch {
                guarded {
                    while (isActive) {
                        val tree = runtime.send(CoreCommands.treeGet, Empty).tree
                        if (tree != null) {
                            setTree(tree)
                            return@guarded
                        }
                        delay(TREE_POLL_MILLIS)
                    }
                }
            }
    }

    private fun reduce(event: CoreEvent) {
        when (event) {
            is CoreEvent.TreeChanged -> {
                event.tree?.let(::setTree)
            }

            is CoreEvent.SessionEnded -> {
                treePolling?.cancel()
                accessToken = null
                show(ShellScreen.Token(ForgeKind.GITHUB))
            }

            else -> {}
        }
    }

    private fun setTree(nodes: List<TreeNode>) {
        mutableState.update { state ->
            if (state.screen is ShellScreen.Tree) {
                state.copy(
                    screen = ShellScreen.Tree(nodes),
                )
            } else {
                state
            }
        }
    }

    private fun show(screen: ShellScreen) {
        if (screen is ShellScreen.Repositories) repositories = screen
        mutableState.update { it.copy(screen = screen, error = null) }
    }

    private fun fail(message: String) {
        mutableState.update { it.copy(error = message) }
    }

    private fun command(block: suspend (CoreRuntime) -> Unit) {
        viewModelScope.launch {
            mutableState.update { it.copy(busy = true, error = null) }
            guarded { block(runtimeProvider()) }
            mutableState.update { it.copy(busy = false) }
        }
    }

    private suspend fun guarded(block: suspend () -> Unit) {
        try {
            block()
        } catch (error: CancellationException) {
            throw error
        } catch (error: CoreException) {
            fail(error.error.message)
        } catch (error: Exception) {
            fail(error.message ?: "Something went wrong")
        }
    }

    companion object {
        private const val TREE_POLL_MILLIS = 100L

        val Factory: ViewModelProvider.Factory =
            viewModelFactory {
                initializer {
                    val application =
                        checkNotNull(
                            this[ViewModelProvider.AndroidViewModelFactory.APPLICATION_KEY],
                        )
                    ShellViewModel((application as CommitnoteApplication)::coreRuntime)
                }
            }
    }
}
