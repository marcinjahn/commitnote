package io.github.marcinjahn.commitnote.testing

import io.github.marcinjahn.commitnote.CommitnoteApplication
import io.github.marcinjahn.commitnote.core.api.CoreCommands
import io.github.marcinjahn.commitnote.core.api.Empty
import io.github.marcinjahn.commitnote.core.api.FakeCoreCommands
import io.github.marcinjahn.commitnote.core.api.FakeHasCachedTreeParams
import io.github.marcinjahn.commitnote.core.api.ForgeKind
import io.github.marcinjahn.commitnote.core.api.LastViewState
import io.github.marcinjahn.commitnote.core.api.LoginInspectRepositoryParams
import io.github.marcinjahn.commitnote.core.api.LoginListRepositoriesParams
import io.github.marcinjahn.commitnote.core.api.PassphraseParams
import io.github.marcinjahn.commitnote.core.api.Secret
import io.github.marcinjahn.commitnote.core.runtime.CoreRuntime
import io.github.marcinjahn.commitnote.core.runtime.LaunchVisit
import io.github.marcinjahn.commitnote.core.runtime.services.BlobCacheService
import io.github.marcinjahn.commitnote.core.runtime.services.DeviceSettingsService
import io.github.marcinjahn.commitnote.core.runtime.services.FileBlobCacheService
import io.github.marcinjahn.commitnote.core.runtime.services.RememberedSessionService
import io.github.marcinjahn.commitnote.core.runtime.testing.FakeCoreRuntimes
import io.github.marcinjahn.commitnote.core.runtime.testing.InMemoryDeviceSettingsService
import io.github.marcinjahn.commitnote.core.runtime.testing.InMemoryRememberedSessionService
import io.github.marcinjahn.commitnote.core.runtime.testing.RecordingLogService
import io.github.marcinjahn.commitnote.core.runtime.testing.RecordingVisitSender
import io.github.marcinjahn.commitnote.host.PersistableRememberedSession
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.nio.file.Files
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds
import kotlin.time.TimeMark
import kotlin.time.TimeSource

const val FAKE_ACCESS_TOKEN = "fake-access-token"
const val SAMPLE_REPOSITORY = "sample/notes"
const val FOREIGN_REPOSITORY = "sample/foreign"
const val SAMPLE_PASSPHRASE = "sample notes repo passphrase"

/** Runs the app on the fake core bundle, with a remembered session that lives in memory. */
open class TestApp : CommitnoteApplication() {
    protected open val bundleSource: String get() = FakeCoreRuntimes.fakeBundle

    protected val deviceSettings: DeviceSettingsService = InMemoryDeviceSettingsService()

    protected val blobCache: BlobCacheService =
        FileBlobCacheService(Files.createTempDirectory("commitnote-blob-cache"))

    override val rememberedSession: PersistableRememberedSession by lazy {
        createRememberedSession()
    }

    protected open fun createRememberedSession(): PersistableRememberedSession =
        InMemoryPersistableRememberedSession()

    override fun createCoreRuntime(): CoreRuntime =
        FakeCoreRuntimes.create(
            FakeCoreRuntimes.hostServices(
                rememberedSession = rememberedSession,
                blobCache = blobCache,
                deviceSettings = deviceSettings,
                stagedInputs = stagedInputs,
            ),
            bundleSource = bundleSource,
        )

    override fun createLaunchVisit(): LaunchVisit =
        LaunchVisit(RecordingVisitSender(), RecordingLogService(), screenWidth = null)
}

class BadBundleTestApp : TestApp() {
    override val bundleSource: String get() = "this is not a core bundle"
}

/**
 * Starts with the sample repository already remembered and its tree kept, as after an earlier run
 * of the app.
 */
class ResumingTestApp : TestApp() {
    override fun createRememberedSession(): PersistableRememberedSession =
        InMemoryPersistableRememberedSession().also {
            rememberSampleRepository(it, deviceSettings, blobCache)
        }
}

/** Resumes the sample repository, whose last session left the Welcome note open. */
class LastViewTestApp : TestApp() {
    override fun createRememberedSession(): PersistableRememberedSession =
        InMemoryPersistableRememberedSession().also {
            rememberSampleRepository(it, deviceSettings, blobCache) { leaveLastViewNote() }
        }

    companion object {
        val LAST_VIEW_NOTE = listOf("Welcome")
    }
}

/**
 * Resumes the sample repository with the Welcome note open, as [LastViewTestApp] does, and records
 * when the app created its core so a test can time the start.
 */
abstract class TimedStartTestApp : TestApp() {
    @Volatile
    var coreCreatedAt: TimeMark? = null
        private set

    override fun createCoreRuntime(): CoreRuntime {
        coreCreatedAt = TimeSource.Monotonic.markNow()
        return super.createCoreRuntime()
    }
}

/**
 * Starts with the tree of an earlier run kept on the device and holds every forge check of the
 * start, so the notes can only come from the kept tree until the test releases the refresh.
 */
class CachedStartTestApp : TimedStartTestApp() {
    override fun createRememberedSession(): PersistableRememberedSession =
        InMemoryPersistableRememberedSession().also {
            rememberSampleRepository(it, deviceSettings, blobCache) { leaveLastViewNote() }
        }

    override suspend fun beforeResume(runtime: CoreRuntime) {
        runtime.send(FakeCoreCommands.holdRefresh, Empty)
    }
}

/** Starts with nothing kept on the device, so the start loads the notes from the forge. */
class UncachedStartTestApp : TimedStartTestApp() {
    override fun createRememberedSession(): PersistableRememberedSession =
        InMemoryPersistableRememberedSession().also {
            rememberSampleRepository(it, deviceSettings, blobCache) {
                leaveLastViewNote()
                forgetKeptTree()
            }
        }
}

private suspend fun CoreRuntime.leaveLastViewNote() {
    val view = LastViewState(note = LastViewTestApp.LAST_VIEW_NOTE, folders = emptyList())
    send(CoreCommands.lastViewSave, view)
    while (send(CoreCommands.lastViewLoad, Empty).view?.note != LastViewTestApp.LAST_VIEW_NOTE) {
        delay(50.milliseconds)
    }
}

/** Holding the loading forgets the kept trees. */
private suspend fun CoreRuntime.forgetKeptTree() {
    send(FakeCoreCommands.holdLoading, Empty)
    send(FakeCoreCommands.releaseLoading, Empty)
}

private suspend fun CoreRuntime.awaitKeptTree() {
    while (!send(
            FakeCoreCommands.hasCachedTree,
            FakeHasCachedTreeParams(SAMPLE_REPOSITORY),
        ).cached
    ) {
        delay(50.milliseconds)
    }
}

class InMemoryPersistableRememberedSession(
    private val store: InMemoryRememberedSessionService = InMemoryRememberedSessionService(),
) : PersistableRememberedSession,
    RememberedSessionService by store {
    override fun setPersist(persist: Boolean) = Unit
}

private fun rememberSampleRepository(
    store: RememberedSessionService,
    deviceSettings: DeviceSettingsService,
    blobCache: BlobCacheService,
    afterUnlock: suspend CoreRuntime.() -> Unit = {},
) {
    runBlocking {
        withTimeout(60.seconds) {
            val runtime =
                FakeCoreRuntimes.start(
                    FakeCoreRuntimes.hostServices(
                        rememberedSession = store,
                        blobCache = blobCache,
                        deviceSettings = deviceSettings,
                    ),
                )
            try {
                val token = Secret(FAKE_ACCESS_TOKEN)
                val repository =
                    runtime
                        .send(
                            CoreCommands.loginListRepositories,
                            LoginListRepositoriesParams(ForgeKind.GITHUB, token),
                        ).repositories
                        .single { it.url.endsWith("/$SAMPLE_REPOSITORY") }
                runtime.send(
                    CoreCommands.loginInspectRepository,
                    LoginInspectRepositoryParams(ForgeKind.GITHUB, token, repository.url),
                )
                runtime.send(CoreCommands.loginUnlock, PassphraseParams(Secret(SAMPLE_PASSPHRASE)))
                while (runtime.send(CoreCommands.treeGet, Empty).tree ==
                    null
                ) {
                    delay(50.milliseconds)
                }
                runtime.awaitKeptTree()
                runtime.afterUnlock()
            } finally {
                runtime.stop()
            }
        }
    }
}
