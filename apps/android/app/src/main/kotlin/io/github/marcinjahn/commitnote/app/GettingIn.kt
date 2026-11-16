package io.github.marcinjahn.commitnote.app

import io.github.marcinjahn.commitnote.core.api.CoreCommands
import io.github.marcinjahn.commitnote.core.api.ForgeKind
import io.github.marcinjahn.commitnote.core.api.ForgeView
import io.github.marcinjahn.commitnote.core.api.LoginInspectRepositoryParams
import io.github.marcinjahn.commitnote.core.api.LoginInspectRepositoryResult
import io.github.marcinjahn.commitnote.core.api.LoginListRepositoriesParams
import io.github.marcinjahn.commitnote.core.api.PassphraseParams
import io.github.marcinjahn.commitnote.core.api.Secret
import io.github.marcinjahn.commitnote.host.PersistableRememberedSession
import kotlinx.coroutines.flow.MutableStateFlow

/** What it takes to open a repository again without asking for the access token. */
class Credentials(
    val forge: ForgeKind,
    val accessToken: Secret,
    val repositoryUrl: String,
)

/**
 * The steps from an access token to an unlocked repository. Each method moves the session phase
 * to the next step; a [io.github.marcinjahn.commitnote.core.runtime.CoreException] it throws
 * belongs next to the field that caused it.
 */
class GettingIn internal constructor(
    private val session: AppSession,
    private val phase: MutableStateFlow<SessionPhase>,
    private val rememberedSession: PersistableRememberedSession,
) {
    private var forge: ForgeKind? = null
    private var accessToken: Secret? = null

    private val step: GettingInStep?
        get() = (phase.value as? SessionPhase.GettingIn)?.step

    /** Returns false when the token can open no repository at all. */
    suspend fun listRepositories(
        forge: ForgeView,
        accessToken: Secret,
    ): Boolean {
        val login = step as? GettingInStep.Login ?: return true
        val repositories =
            session
                .send(
                    CoreCommands.loginListRepositories,
                    LoginListRepositoriesParams(forge.id, accessToken),
                ).repositories
        if (repositories.isEmpty()) return false
        this.forge = forge.id
        this.accessToken = accessToken
        val single = repositories.singleOrNull()
        if (single != null) {
            inspect(single.url, previous = login)
        } else {
            show(GettingInStep.RepositoryPicker(forge, repositories, previous = login))
        }
        return true
    }

    suspend fun chooseRepository(url: String) {
        val picker = step as? GettingInStep.RepositoryPicker ?: return
        inspect(url, previous = picker)
    }

    suspend fun checkAgain() {
        val unusable = step as? GettingInStep.Unusable ?: return
        inspect(unusable.repository.url, unusable.previous)
    }

    suspend fun unlock(
        passphrase: Secret,
        remember: Boolean,
    ) {
        if (step !is GettingInStep.Unlock) return
        rememberedSession.setPersist(remember)
        session.send(CoreCommands.loginUnlock, PassphraseParams(passphrase))
        enterUnlocked()
    }

    suspend fun initialize(
        passphrase: Secret,
        remember: Boolean,
    ) {
        if (step !is GettingInStep.Initialize) return
        rememberedSession.setPersist(remember)
        session.send(CoreCommands.loginInitialize, PassphraseParams(passphrase))
        enterUnlocked()
    }

    /** Returns false when there is no earlier step. */
    fun back(): Boolean {
        val previous = step?.previous ?: return false
        show(previous)
        return true
    }

    /** Back to the first step that does not depend on the chosen repository. */
    fun chooseAnotherRepository() {
        var target = step?.previous ?: return
        while (target !is GettingInStep.RepositoryPicker && target !is GettingInStep.Login) {
            target = target.previous ?: return
        }
        show(target)
    }

    internal suspend fun open(
        credentials: Credentials,
        passphrase: Secret,
        remember: Boolean,
    ) {
        forge = credentials.forge
        accessToken = credentials.accessToken
        val result = inspectResult(credentials.repositoryUrl)
        if (result !is LoginInspectRepositoryResult.NotesRepo) {
            show(stepFor(result, previous = session.loginStep(error = null)))
            return
        }
        rememberedSession.setPersist(remember)
        session.send(CoreCommands.loginUnlock, PassphraseParams(passphrase))
        enterUnlocked()
    }

    private suspend fun inspect(
        url: String,
        previous: GettingInStep,
    ) {
        show(stepFor(inspectResult(url), previous))
    }

    private suspend fun inspectResult(url: String): LoginInspectRepositoryResult =
        session.send(
            CoreCommands.loginInspectRepository,
            LoginInspectRepositoryParams(checkNotNull(forge), checkNotNull(accessToken), url),
        )

    private fun stepFor(
        result: LoginInspectRepositoryResult,
        previous: GettingInStep,
    ): GettingInStep =
        when (result) {
            is LoginInspectRepositoryResult.NotesRepo -> {
                GettingInStep.Unlock(result.repository, previous)
            }

            is LoginInspectRepositoryResult.Uninitialized -> {
                GettingInStep.Initialize(result.repository, result.setUpDescription, previous)
            }

            is LoginInspectRepositoryResult.Unusable -> {
                GettingInStep.Unusable(
                    result.repository,
                    result.error.message,
                    result.canCheckAgain,
                    result.foreignHint,
                    previous,
                )
            }
        }

    private suspend fun enterUnlocked() {
        accessToken = null
        session.enterUnlocked()
    }

    private fun show(step: GettingInStep) {
        phase.value = SessionPhase.GettingIn(step)
    }
}
