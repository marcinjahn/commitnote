package io.github.marcinjahn.commitnote.core.api

import kotlinx.serialization.serializer

private inline fun <reified P, reified R> command(name: String): CoreCommand<P, R> =
    CoreCommand(name, serializer<P>(), serializer<R>())

/** The commands this module has typed descriptors for; the rest of the API is added over time. */
object CoreCommands {
    val loginListRepositories =
        command<LoginListRepositoriesParams, LoginListRepositoriesResult>("login.listRepositories")
    val loginInspectRepository =
        command<LoginInspectRepositoryParams, LoginInspectRepositoryResult>(
            "login.inspectRepository",
        )
    val loginUnlock = command<PassphraseParams, LoggedIn>("login.unlock")
    val loginInitialize = command<PassphraseParams, LoggedIn>("login.initialize")
    val sessionResume = command<Empty, SessionResumeResult>("session.resume")
    val sessionLogout = command<SessionLogoutParams, SessionLogoutResult>("session.logout")
    val treeGet = command<Empty, TreeGetResult>("tree.get")
    val noteOpen = command<NoteOpenParams, NoteOpenResult>("note.open")
    val noteEdit = command<NoteEditParams, Empty>("note.edit")
    val syncRefresh = command<Empty, Empty>("sync.refresh")
    val syncFlush = command<Empty, SyncFlushResult>("sync.flush")
    val lifecycleSetVisible = command<LifecycleSetVisibleParams, Empty>("lifecycle.setVisible")
    val lifecycleSetOnline = command<LifecycleSetOnlineParams, Empty>("lifecycle.setOnline")
    val deviceName = command<Empty, DeviceNameResult>("device.name")

    val all: List<CoreCommand<*, *>> =
        listOf(
            loginListRepositories,
            loginInspectRepository,
            loginUnlock,
            loginInitialize,
            sessionResume,
            sessionLogout,
            treeGet,
            noteOpen,
            noteEdit,
            syncRefresh,
            syncFlush,
            lifecycleSetVisible,
            lifecycleSetOnline,
            deviceName,
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
    val processImage = command<FakeProcessImageParams, FakeProcessImageResult>("fake.processImage")

    val all: List<CoreCommand<*, *>> =
        listOf(
            saveNote,
            exportRepo,
            expectedSampleNotes,
            checkVectors,
            httpRequest,
            timerProbe,
            remoteEdit,
            processImage,
        )
}
