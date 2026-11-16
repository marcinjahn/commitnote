package io.github.marcinjahn.commitnote.core.api

import kotlinx.serialization.serializer

private inline fun <reified P, reified R> command(name: String): CoreCommand<P, R> =
    CoreCommand(name, serializer<P>(), serializer<R>())

/** Every command of the native core API, in the order `api.ts` declares them. */
object CoreCommands {
    val forgesList = command<Empty, ForgesListResult>("forges.list")
    val loginLastRepository = command<Empty, LoginLastRepositoryResult>("login.lastRepository")
    val loginListRepositories =
        command<LoginListRepositoriesParams, LoginListRepositoriesResult>("login.listRepositories")
    val loginInspectRepository =
        command<LoginInspectRepositoryParams, LoginInspectRepositoryResult>(
            "login.inspectRepository",
        )
    val loginUnlock = command<PassphraseParams, LoggedIn>("login.unlock")
    val loginInitialize = command<PassphraseParams, LoggedIn>("login.initialize")
    val passphraseStrength =
        command<PassphraseStrengthParams, PassphraseStrengthResult>("passphrase.strength")
    val sessionResume = command<SessionResumeParams, SessionResumeResult>("session.resume")
    val sessionLogout = command<SessionLogoutParams, SessionLogoutResult>("session.logout")
    val treeGet = command<Empty, TreeGetResult>("tree.get")
    val noteOpen = command<NoteOpenParams, NoteOpenResult>("note.open")
    val syncRefresh = command<Empty, Empty>("sync.refresh")
    val noteEdit = command<NoteEditParams, Empty>("note.edit")
    val syncFlush = command<Empty, SyncFlushResult>("sync.flush")
    val syncRetry = command<Empty, Empty>("sync.retry")
    val conflictResolve = command<ConflictResolveParams, Empty>("conflict.resolve")
    val exportNotes = command<ExportNotesParams, ExportedArchive>("export.notes")
    val draftStart = command<DraftStartParams, DraftStartResult>("draft.start")
    val draftCommitName = command<DraftCommitNameParams, DraftOutcomeResult>("draft.commitName")
    val draftContent = command<DraftContentParams, DraftOutcomeResult>("draft.content")
    val draftLeave = command<Empty, Empty>("draft.leave")
    val folderCreate = command<FolderCreateParams, FolderCreateResult>("folder.create")
    val lifecycleSetVisible = command<LifecycleSetVisibleParams, Empty>("lifecycle.setVisible")
    val lifecycleSetOnline = command<LifecycleSetOnlineParams, Empty>("lifecycle.setOnline")
    val deviceName = command<Empty, DeviceNameResult>("device.name")
    val noticesDismiss = command<NoticeIdParams, Empty>("notices.dismiss")
    val noticesPerform = command<NoticeIdParams, Empty>("notices.perform")
    val nodeRename = command<NodeRenameParams, StructureOutcomeResult>("node.rename")
    val nodeMove = command<NodeMoveParams, StructureOutcomeResult>("node.move")
    val nodePlace = command<NodePlaceParams, StructureOutcomeResult>("node.place")
    val nodeMoveSibling = command<NodeMoveSiblingParams, NodeMoveSiblingResult>("node.moveSibling")
    val nodeMoveTargets = command<PathParams, MoveTargetsResult>("node.moveTargets")
    val nodeTrashPreview = command<PathParams, NodeTrashPreviewResult>("node.trashPreview")
    val nodeTrash = command<NodeTrashParams, NodeTrashResult>("node.trash")
    val nodeSetColorTag = command<NodeSetColorTagParams, StructureOutcomeResult>("node.setColorTag")
    val trashRestoreTargets =
        command<TrashRestoreTargetsParams, MoveTargetsResult>("trash.restoreTargets")
    val trashRestore = command<TrashRestoreParams, StructureOutcomeResult>("trash.restore")
    val trashDelete = command<TrashEntryParams, Empty>("trash.delete")
    val trashEmpty = command<Empty, Empty>("trash.empty")
    val tagsSetFilter = command<TagsSetFilterParams, Empty>("tags.setFilter")
    val searchOpen = command<Empty, Empty>("search.open")
    val searchClose = command<Empty, Empty>("search.close")
    val searchQuery = command<SearchQueryParams, SearchQueryResult>("search.query")
    val noteRename = command<NoteRenameParams, NoteRenameResult>("note.rename")
    val noteStats = command<PathParams, NoteStatsResult>("note.stats")
    val noteDates = command<PathParams, NoteDatesResult>("note.dates")
    val imageRead = command<ImageReadParams, ImageReadResult>("image.read")
    val imageInsert = command<ImageInsertParams, ImageInsertResult>("image.insert")
    val imageClonePasted =
        command<ImageClonePastedParams, ImageClonePastedResult>("image.clonePasted")
    val historyOpen = command<PathParams, Empty>("history.open")
    val historyClose = command<Empty, Empty>("history.close")
    val historyLoadMore = command<Empty, Empty>("history.loadMore")
    val historyRetry = command<Empty, Empty>("history.retry")
    val historyPreview = command<HistoryVersionParams, HistoryPreviewResult>("history.preview")
    val historyRestore = command<HistoryVersionParams, HistoryRestoreResult>("history.restore")
    val shareForm = command<PathParams, ShareFormResult>("share.form")
    val shareCreate = command<ShareCreateParams, ShareCreateResult>("share.create")
    val shareUpdate = command<ShareIdParams, Empty>("share.update")
    val shareRename = command<ShareRenameParams, ShareRenameResult>("share.rename")
    val shareRevoke = command<ShareIdParams, Empty>("share.revoke")
    val shareSharedVersion = command<ShareIdParams, ShareSharedVersionResult>("share.sharedVersion")
    val lastViewLoad = command<Empty, LastViewLoadResult>("lastView.load")
    val lastViewSave = command<LastViewState, Empty>("lastView.save")
    val earlyDraftHandOff =
        command<EarlyDraftHandOffParams, EarlyDraftHandOffResult>("earlyDraft.handOff")
    val launchDeliver = command<LaunchDeliverParams, Empty>("launch.deliver")
    val launchAttach = command<LaunchAttachParams, Empty>("launch.attach")
    val launchDetach = command<Empty, Empty>("launch.detach")
    val settingsOpen = command<Empty, SettingsOpenResult>("settings.open")
    val settingsChange = command<SettingsChangeParams, Empty>("settings.change")
    val settingsSetScope = command<SettingsSetScopeParams, Empty>("settings.setScope")
    val settingsRetry = command<Empty, Empty>("settings.retry")
    val settingsFlush = command<Empty, Empty>("settings.flush")
    val deviceSetName = command<DeviceSetNameParams, DeviceNameResult>("device.setName")
    val lastViewSetEnabled = command<LastViewSetEnabledParams, Empty>("lastView.setEnabled")
    val analyticsVisit = command<AnalyticsVisitParams, AnalyticsVisitResult>("analytics.visit")
    val printRender = command<PrintRenderParams, PrintRenderResult>("print.render")
    val importReadArchive =
        command<ImportReadArchiveParams, ImportArchiveOutcome>("import.readArchive")
    val importPreview = command<ImportPreviewParams, ImportPreviewResult>("import.preview")
    val importCommit = command<ImportCommitParams, ImportOutcomeResult>("import.commit")
    val importCancel = command<Empty, Empty>("import.cancel")
    val importDropFiles = command<ImportDropFilesParams, ImportOutcomeResult>("import.dropFiles")
    val importEnableAtomic = command<Empty, ImportEnableAtomicResult>("import.enableAtomic")
    val importSaveWithoutAtomic = command<Empty, Empty>("import.saveWithoutAtomic")
    val passphraseChangeForm = command<Empty, PassphraseChangeFormResult>("passphrase.changeForm")
    val passphrasePrepareChange =
        command<PassphraseChangePrepareParams, PassphraseChangeOutcomeResult>(
            "passphrase.prepareChange",
        )
    val passphraseCommitChange =
        command<Empty, PassphraseChangeOutcomeResult>("passphrase.commitChange")
    val passphraseSettle = command<Empty, PassphraseChangeOutcomeResult>("passphrase.settle")
    val passphraseCancelChange = command<Empty, Empty>("passphrase.cancelChange")
    val passphraseEnableAtomic =
        command<Empty, PassphraseEnableAtomicResult>("passphrase.enableAtomic")

    val all: List<CoreCommand<*, *>> =
        listOf(
            forgesList,
            loginLastRepository,
            loginListRepositories,
            loginInspectRepository,
            loginUnlock,
            loginInitialize,
            passphraseStrength,
            sessionResume,
            sessionLogout,
            treeGet,
            noteOpen,
            syncRefresh,
            noteEdit,
            syncFlush,
            syncRetry,
            conflictResolve,
            exportNotes,
            draftStart,
            draftCommitName,
            draftContent,
            draftLeave,
            folderCreate,
            lifecycleSetVisible,
            lifecycleSetOnline,
            deviceName,
            noticesDismiss,
            noticesPerform,
            nodeRename,
            nodeMove,
            nodePlace,
            nodeMoveSibling,
            nodeMoveTargets,
            nodeTrashPreview,
            nodeTrash,
            nodeSetColorTag,
            trashRestoreTargets,
            trashRestore,
            trashDelete,
            trashEmpty,
            tagsSetFilter,
            searchOpen,
            searchClose,
            searchQuery,
            noteRename,
            noteStats,
            noteDates,
            imageRead,
            imageInsert,
            imageClonePasted,
            historyOpen,
            historyClose,
            historyLoadMore,
            historyRetry,
            historyPreview,
            historyRestore,
            shareForm,
            shareCreate,
            shareUpdate,
            shareRename,
            shareRevoke,
            shareSharedVersion,
            lastViewLoad,
            lastViewSave,
            earlyDraftHandOff,
            launchDeliver,
            launchAttach,
            launchDetach,
            settingsOpen,
            settingsChange,
            settingsSetScope,
            settingsRetry,
            settingsFlush,
            deviceSetName,
            lastViewSetEnabled,
            analyticsVisit,
            printRender,
            importReadArchive,
            importPreview,
            importCommit,
            importCancel,
            importDropFiles,
            importEnableAtomic,
            importSaveWithoutAtomic,
            passphraseChangeForm,
            passphrasePrepareChange,
            passphraseCommitChange,
            passphraseSettle,
            passphraseCancelChange,
            passphraseEnableAtomic,
        )
}

/** Test-only commands, served by the fake core bundle. */
object FakeCoreCommands {
    val saveNote = command<FakeSaveNoteParams, Empty>("fake.saveNote")
    val exportRepo = command<FakeExportRepoParams, FakeExportRepoResult>("fake.exportRepo")
    val expectedSampleNotes =
        command<Empty, FakeExpectedSampleNotesResult>("fake.expectedSampleNotes")
    val checkVectors = command<FakeCheckVectorsParams, FakeCheckVectorsResult>("fake.checkVectors")
    val httpRequest = command<FakeHttpRequestParams, FakeHttpRequestResult>("fake.httpRequest")
    val timerProbe = command<FakeTimerProbeParams, FakeTimerProbeResult>("fake.timerProbe")
    val remoteEdit = command<FakeRemoteEditParams, Empty>("fake.remoteEdit")
    val changeRepoKey = command<FakeChangeRepoKeyParams, Empty>("fake.changeRepoKey")
    val failNext = command<FakeFailNextParams, Empty>("fake.failNext")
    val clearFailures = command<FakeClearFailuresParams, Empty>("fake.clearFailures")
    val shareNote = command<FakeShareNoteParams, Empty>("fake.shareNote")
    val holdLoading = command<Empty, Empty>("fake.holdLoading")
    val releaseLoading = command<Empty, Empty>("fake.releaseLoading")
    val holdRefresh = command<Empty, Empty>("fake.holdRefresh")
    val releaseRefresh = command<Empty, Empty>("fake.releaseRefresh")
    val hasCachedTree =
        command<FakeHasCachedTreeParams, FakeHasCachedTreeResult>("fake.hasCachedTree")
    val processImage = command<FakeProcessImageParams, FakeProcessImageResult>("fake.processImage")
    val importArchive = command<Empty, ImportArchiveOutcome>("fake.importArchive")

    val all: List<CoreCommand<*, *>> =
        listOf(
            saveNote,
            exportRepo,
            expectedSampleNotes,
            checkVectors,
            httpRequest,
            timerProbe,
            remoteEdit,
            changeRepoKey,
            failNext,
            clearFailures,
            shareNote,
            holdLoading,
            releaseLoading,
            holdRefresh,
            releaseRefresh,
            hasCachedTree,
            processImage,
            importArchive,
        )
}
