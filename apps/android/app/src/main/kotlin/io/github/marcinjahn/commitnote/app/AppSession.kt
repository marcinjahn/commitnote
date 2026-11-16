package io.github.marcinjahn.commitnote.app

import io.github.marcinjahn.commitnote.core.api.CoreCommand
import io.github.marcinjahn.commitnote.core.api.CoreCommands
import io.github.marcinjahn.commitnote.core.api.CoreEvent
import io.github.marcinjahn.commitnote.core.api.Empty
import io.github.marcinjahn.commitnote.core.api.ExportNotesParams
import io.github.marcinjahn.commitnote.core.api.ExportedArchive
import io.github.marcinjahn.commitnote.core.api.LaunchAction
import io.github.marcinjahn.commitnote.core.api.LaunchAttachParams
import io.github.marcinjahn.commitnote.core.api.LaunchDeliverParams
import io.github.marcinjahn.commitnote.core.api.LifecycleSetOnlineParams
import io.github.marcinjahn.commitnote.core.api.LifecycleSetVisibleParams
import io.github.marcinjahn.commitnote.core.api.LogoutOutcome
import io.github.marcinjahn.commitnote.core.api.NativePlatform
import io.github.marcinjahn.commitnote.core.api.NoticeIdParams
import io.github.marcinjahn.commitnote.core.api.Secret
import io.github.marcinjahn.commitnote.core.api.SessionLogoutParams
import io.github.marcinjahn.commitnote.core.api.SessionResumeParams
import io.github.marcinjahn.commitnote.core.api.SessionResumeResult
import io.github.marcinjahn.commitnote.core.api.SettingsView
import io.github.marcinjahn.commitnote.core.runtime.CoreException
import io.github.marcinjahn.commitnote.core.runtime.CoreRuntime
import io.github.marcinjahn.commitnote.core.runtime.CoreStartException
import io.github.marcinjahn.commitnote.core.runtime.LaunchVisit
import io.github.marcinjahn.commitnote.core.runtime.services.StagedInputsService
import io.github.marcinjahn.commitnote.host.PersistableRememberedSession
import io.github.marcinjahn.commitnote.ui.UiText
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

/**
 * The one core session of the process. It starts the runtime, reduces core events and command
 * results into one state flow per area, and owns the transitions between session phases. Call it
 * from the main thread.
 */
class AppSession(
    private val createRuntime: () -> CoreRuntime,
    private val rememberedSession: PersistableRememberedSession,
    private val deviceModel: String,
    private val stagedInputs: StagedInputsService,
    private val launchVisit: LaunchVisit,
    private val scope: CoroutineScope,
    private val beforeResume: suspend (CoreRuntime) -> Unit = {},
) : CoreSender {
    private val runtime = CompletableDeferred<CoreRuntime>()

    private val mutablePhase = MutableStateFlow<SessionPhase>(SessionPhase.Starting)
    val phase: StateFlow<SessionPhase> = mutablePhase.asStateFlow()

    private val mutableTree = MutableStateFlow(TreeState())
    val tree: StateFlow<TreeState> = mutableTree.asStateFlow()

    private val mutableSync = MutableStateFlow<CoreEvent.SyncStateChanged?>(null)
    val sync: StateFlow<CoreEvent.SyncStateChanged?> = mutableSync.asStateFlow()

    private val mutableNotices = MutableStateFlow<List<CoreEvent.Notice>>(emptyList())
    val notices: StateFlow<List<CoreEvent.Notice>> = mutableNotices.asStateFlow()

    private val mutableAppearance = MutableStateFlow(Appearance())
    val appearance: StateFlow<Appearance> = mutableAppearance.asStateFlow()

    private val mutableLoading = MutableStateFlow<String?>(null)
    val loading: StateFlow<String?> = mutableLoading.asStateFlow()

    private val mutableTypeToStart = MutableStateFlow(true)
    val typeToStart: StateFlow<Boolean> = mutableTypeToStart.asStateFlow()

    val screens = ScreenStates()

    val lastView = LastViewTracker(this, scope)

    val editor = EditorSession(this, stagedInputs, lastView, scope)

    private val restoreRequests = Channel<List<String>>(Channel.CONFLATED)

    /** The note the last session left open, for the UI to open after an unlock. */
    val restoreNote: Flow<List<String>> = restoreRequests.receiveAsFlow()

    private val launchRequests = Channel<LaunchAction>(Channel.UNLIMITED)

    /** The launch actions the core hands over while the tree is showing, for the UI to navigate to. */
    val launchNavigation: Flow<LaunchAction> = launchRequests.receiveAsFlow()

    val gettingIn = GettingIn(this, mutablePhase, rememberedSession)

    private val pendingLaunches = ArrayDeque<LaunchAction>()
    private var visible: Boolean? = null
    private var online: Boolean? = null
    private var keyChangeCredentials: Credentials? = null
    private var loggedOutForKeyChange = false
    private var treeReadyHandled = false

    init {
        scope.launch { boot() }
    }

    override suspend fun <P, R> send(
        command: CoreCommand<P, R>,
        params: P,
    ): R = runtime.await().send(command, params)

    fun retryResume() {
        scope.launchReporting { resume() }
    }

    /** Ends the session and routes to login, unless edits would be lost. */
    suspend fun logOut(anyway: Boolean): LogoutOutcome {
        val outcome = send(CoreCommands.sessionLogout, SessionLogoutParams(anyway)).outcome
        if (outcome == LogoutOutcome.LoggedOut) leaveUnlocked()
        return outcome
    }

    /** Runs [block] in the session, so that it outlives the screen that asked; failures are dropped. */
    fun launchInSession(block: suspend () -> Unit) {
        scope.launchReporting(block)
    }

    fun setVisible(visible: Boolean) {
        this.visible = visible
        if (!runtime.isCompleted) return
        scope.launchReporting {
            send(CoreCommands.lifecycleSetVisible, LifecycleSetVisibleParams(visible))
            if (!visible &&
                phase.value == SessionPhase.Unlocked
            ) {
                editor.flush()
                lastView.save()
                send(CoreCommands.settingsFlush, Empty)
                send(CoreCommands.syncFlush, Empty)
            }
        }
    }

    fun setOnline(online: Boolean) {
        this.online = online
        if (!runtime.isCompleted) return
        scope.launchReporting {
            send(
                CoreCommands.lifecycleSetOnline,
                LifecycleSetOnlineParams(online),
            )
        }
    }

    /** Queues [action] until the session is unlocked. */
    fun deliverLaunch(action: LaunchAction) {
        pendingLaunches += action
        if (phase.value == SessionPhase.Unlocked) scope.launchReporting { deliverPendingLaunches() }
    }

    /** Tells the core whether a screen that can act on launch actions is showing. */
    fun setLaunchTarget(showing: Boolean) {
        scope.launchReporting {
            if (showing) {
                send(CoreCommands.launchAttach, LaunchAttachParams(LaunchAction.entries))
            } else {
                send(CoreCommands.launchDetach, Empty)
            }
        }
    }

    suspend fun dismissNotice(id: String) {
        send(CoreCommands.noticesDismiss, NoticeIdParams(id))
    }

    suspend fun performNotice(id: String) {
        send(CoreCommands.syncFlush, Empty)
        send(CoreCommands.noticesPerform, NoticeIdParams(id))
    }

    suspend fun exportNotes(includeImages: Boolean): ExportedArchive =
        send(CoreCommands.exportNotes, ExportNotesParams(includeImages))

    /**
     * Stages [files] for the core while [block] runs with their ids, and drops whatever the core
     * did not take.
     */
    suspend fun <R> withStagedFiles(
        files: List<StagedFile>,
        block: suspend (List<String>) -> R,
    ): R {
        val ids = files.map { UUID.randomUUID().toString() }
        files.forEachIndexed {
            index,
            file,
            ->
            stagedInputs.stage(ids[index], file.bytes, file.type)
        }
        try {
            return block(ids)
        } finally {
            ids.forEach(stagedInputs::take)
        }
    }

    /** Leaves a session whose key changed and opens the repository again with the new passphrase. */
    suspend fun unlockWithNewKey(
        passphrase: Secret,
        remember: Boolean,
    ) {
        val credentials = checkNotNull(keyChangeCredentials)
        endKeyChangedSession()
        gettingIn.open(credentials, passphrase, remember)
    }

    /** Drops the session, unsaved edits included, and starts logging in from scratch. */
    suspend fun abandonSession() {
        if (phase.value is SessionPhase.KeyChanged) {
            endKeyChangedSession()
        } else {
            send(CoreCommands.sessionLogout, SessionLogoutParams(anyway = true))
        }
        enterLogin(error = null)
    }

    internal suspend fun loginStep(error: String?): GettingInStep.Login {
        val forges = send(CoreCommands.forgesList, Empty).forges
        val last = send(CoreCommands.loginLastRepository, Empty)
        return GettingInStep.Login(forges, last.forge, error)
    }

    internal suspend fun enterUnlocked() {
        keyChangeCredentials = null
        loggedOutForKeyChange = false
        mutableLoading.value = null
        mutablePhase.value = SessionPhase.Unlocked
        scope.launchReporting {
            val opened = send(CoreCommands.settingsOpen, Empty)
            screens.openSettings(opened)
            applySettings(opened.view.values)
        }
        if (tree.value.nodes == null) {
            scope.launchReporting {
                val nodes = send(CoreCommands.treeGet, Empty).tree
                if (nodes != null) mutableTree.update { it.copy(nodes = it.nodes ?: nodes) }
                onTreeReady()
            }
        } else {
            onTreeReady()
        }
        deliverPendingLaunches()
    }

    private suspend fun boot() {
        val created =
            try {
                withContext(Dispatchers.IO) { createRuntime() }
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                fail(StartupFailure.Unloadable)
                return
            }
        scope.launch(start = CoroutineStart.UNDISPATCHED) { created.events.collect(::reduce) }
        try {
            created.start(NativePlatform.ANDROID, deviceModel)
        } catch (error: CoreStartException) {
            fail(
                if (error is CoreStartException.ApiVersionMismatch) {
                    StartupFailure.ApiVersionMismatch(error.expected, error.found)
                } else {
                    StartupFailure.Unloadable
                },
            )
            return
        }
        runtime.complete(created)
        scope.launch { launchVisit.run(created) }
        visible?.let(::setVisible)
        online?.let(::setOnline)
        beforeResume(created)
        resume()
    }

    private fun fail(failure: StartupFailure) {
        runtime.completeExceptionally(IllegalStateException("The core runtime did not start"))
        mutablePhase.value = SessionPhase.StartupFailed(failure)
    }

    private suspend fun resume() {
        mutablePhase.value = SessionPhase.Starting
        val result =
            try {
                send(CoreCommands.sessionResume, SessionResumeParams(fromCache = true))
            } catch (error: CoreException) {
                SessionResumeResult.Failed(error.error, canRetry = false)
            }
        when (result) {
            SessionResumeResult.None -> {
                enterLogin(error = null)
            }

            SessionResumeResult.Resumed -> {
                if (phase.value !is SessionPhase.KeyChanged) enterUnlocked()
            }

            is SessionResumeResult.Failed -> {
                if (result.canRetry) {
                    mutablePhase.value = SessionPhase.ResumeFailed(result.error.message)
                } else {
                    enterLogin(result.error.message)
                }
            }
        }
    }

    private suspend fun enterLogin(error: String?) {
        editor.reset()
        lastView.reset()
        treeReadyHandled = false
        mutableTree.value = TreeState()
        mutableSync.value = null
        mutableNotices.value = emptyList()
        mutableLoading.value = null
        screens.reset()
        pendingLaunches.clear()
        keyChangeCredentials = null
        loggedOutForKeyChange = false
        mutablePhase.value = SessionPhase.GettingIn(loginStep(error))
    }

    /** Both the logout result and `sessionEnded` end an unlocked session; the first one wins. */
    private fun leaveUnlocked() {
        if (phase.value != SessionPhase.Unlocked) return
        mutablePhase.value = SessionPhase.Starting
        scope.launchReporting { enterLogin(error = null) }
    }

    private suspend fun endKeyChangedSession() {
        if (loggedOutForKeyChange) return
        send(CoreCommands.sessionLogout, SessionLogoutParams(anyway = true))
        loggedOutForKeyChange = true
        mutablePhase.update { phase ->
            if (phase is SessionPhase.KeyChanged) phase.copy(exportLabel = "") else phase
        }
    }

    /**
     * Once per unlock, after the tree has loaded: hands a new note typed meanwhile to the core, or
     * else restores the view the last session left.
     */
    private fun onTreeReady() {
        if (treeReadyHandled || phase.value != SessionPhase.Unlocked ||
            tree.value.nodes == null
        ) {
            return
        }
        treeReadyHandled = true
        scope.launchReporting {
            if (editor.handOffEarlyDraft()) {
                lastView.startTracking()
                return@launchReporting
            }
            val note = lastView.restore()
            if (note != null &&
                editor.state.value.target == EditorTarget.None
            ) {
                restoreRequests.trySend(note)
            }
        }
    }

    private fun applySettings(values: SettingsView.Values) {
        mutableAppearance.value = Appearance.from(values)
        mutableTypeToStart.value = values.typeToStart
    }

    private suspend fun deliverPendingLaunches() {
        while (pendingLaunches.isNotEmpty()) {
            send(CoreCommands.launchDeliver, LaunchDeliverParams(pendingLaunches.removeFirst()))
        }
    }

    private fun reduce(event: CoreEvent) {
        when (event) {
            is CoreEvent.LoadingProgress -> {
                mutableLoading.value = event.message
            }

            is CoreEvent.TreeChanged -> {
                mutableTree.value = TreeState.from(event)
                onTreeReady()
            }

            is CoreEvent.SyncStateChanged -> {
                mutableSync.value = event
            }

            is CoreEvent.Notice -> {
                mutableNotices.update { notices ->
                    if (notices.any { it.id == event.id }) {
                        notices.map { if (it.id == event.id) event else it }
                    } else {
                        notices + event
                    }
                }
            }

            is CoreEvent.NoticeCleared -> {
                mutableNotices.update { notices -> notices.filterNot { it.id == event.id } }
            }

            is CoreEvent.KeyChanged -> {
                reduceKeyChanged(event)
            }

            is CoreEvent.SessionEnded -> {
                leaveUnlocked()
            }

            is CoreEvent.SettingsChanged -> {
                screens.reduce(event)
                applySettings(event.view.values)
            }

            is CoreEvent.NoteChanged -> {
                editor.onNoteChanged(event)
            }

            is CoreEvent.NoteContentChangedRemotely -> {
                editor.showMessage(UiText.Plain(event.message))
            }

            is CoreEvent.LaunchAction -> {
                launchRequests.trySend(event.action)
            }

            else -> {
                screens.reduce(event)
            }
        }
    }

    private fun reduceKeyChanged(event: CoreEvent.KeyChanged) {
        val current = phase.value as? SessionPhase.KeyChanged
        if (current == null) keyChangeCredentials = rememberedCredentials()
        if (current != null && loggedOutForKeyChange) return
        mutablePhase.value =
            SessionPhase.KeyChanged(
                unsavedCount = event.unsavedCount,
                message = event.message,
                detail = event.detail,
                exportLabel = event.exportLabel,
                canUnlock = keyChangeCredentials != null,
            )
    }

    private fun rememberedCredentials(): Credentials? =
        try {
            rememberedSession.load()?.let {
                Credentials(it.coordinates.forge, it.accessToken, it.repoUrl)
            }
        } catch (_: Exception) {
            null
        }

    /** Fire-and-forget work; the core reports its failures through events and notices. */
    private fun CoroutineScope.launchReporting(block: suspend () -> Unit) =
        launch {
            try {
                block()
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
            }
        }
}
