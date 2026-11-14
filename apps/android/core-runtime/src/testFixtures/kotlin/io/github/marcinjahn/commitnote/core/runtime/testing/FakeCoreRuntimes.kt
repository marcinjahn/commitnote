package io.github.marcinjahn.commitnote.core.runtime.testing

import io.github.marcinjahn.commitnote.core.api.NativePlatform
import io.github.marcinjahn.commitnote.core.runtime.CoreRuntime
import io.github.marcinjahn.commitnote.core.runtime.services.BlobCacheService
import io.github.marcinjahn.commitnote.core.runtime.services.CryptoService
import io.github.marcinjahn.commitnote.core.runtime.services.DeviceSettingsService
import io.github.marcinjahn.commitnote.core.runtime.services.FileBlobCacheService
import io.github.marcinjahn.commitnote.core.runtime.services.HostServices
import io.github.marcinjahn.commitnote.core.runtime.services.HttpService
import io.github.marcinjahn.commitnote.core.runtime.services.ImageCodecService
import io.github.marcinjahn.commitnote.core.runtime.services.InMemoryStagedInputs
import io.github.marcinjahn.commitnote.core.runtime.services.JcaCryptoService
import io.github.marcinjahn.commitnote.core.runtime.services.LogService
import io.github.marcinjahn.commitnote.core.runtime.services.OkHttpHttpService
import io.github.marcinjahn.commitnote.core.runtime.services.RandomService
import io.github.marcinjahn.commitnote.core.runtime.services.RememberedSessionService
import io.github.marcinjahn.commitnote.core.runtime.services.SecureRandomService
import io.github.marcinjahn.commitnote.core.runtime.services.StagedInputsService
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.Path
import kotlin.io.path.readText

/**
 * Builds runtimes over the fake core bundle with JVM services. The bundle and ICU data paths come
 * from the `commitnote.fakeCoreBundle`, `commitnote.coreBundle` and `commitnote.icuData` system
 * properties the build sets for tests.
 */
object FakeCoreRuntimes {
    const val DEVICE_MODEL = "Android test device"

    val fakeBundle: String by lazy { Path(property("commitnote.fakeCoreBundle")).readText() }

    val realBundle: String by lazy { Path(property("commitnote.coreBundle")).readText() }

    val icuData: Path by lazy { Path(property("commitnote.icuData")) }

    /** [blobCacheDirectory] defaults to a new temporary directory. */
    fun hostServices(
        blobCacheDirectory: Path = Files.createTempDirectory("commitnote-blob-cache"),
        crypto: CryptoService = JcaCryptoService(),
        random: RandomService = SecureRandomService(),
        http: HttpService = OkHttpHttpService(),
        rememberedSession: RememberedSessionService = InMemoryRememberedSessionService(),
        blobCache: BlobCacheService = FileBlobCacheService(blobCacheDirectory),
        deviceSettings: DeviceSettingsService = InMemoryDeviceSettingsService(),
        stagedInputs: StagedInputsService = InMemoryStagedInputs(),
        imageCodec: ImageCodecService = FakeImageCodecService(),
    ): HostServices =
        HostServices(
            crypto = crypto,
            random = random,
            http = http,
            rememberedSession = rememberedSession,
            blobCache = blobCache,
            deviceSettings = deviceSettings,
            stagedInputs = stagedInputs,
            imageCodec = imageCodec,
        )

    fun create(
        services: HostServices = hostServices(),
        logger: LogService = RecordingLogService(),
        bundleSource: String = fakeBundle,
    ): CoreRuntime = CoreRuntime(services, bundleSource, icuData, logger)

    /** Creates a runtime and starts it as the Android platform. */
    suspend fun start(
        services: HostServices = hostServices(),
        logger: LogService = RecordingLogService(),
        bundleSource: String = fakeBundle,
    ): CoreRuntime =
        create(services, logger, bundleSource).also {
            it.start(NativePlatform.ANDROID, DEVICE_MODEL)
        }

    private fun property(name: String): String =
        checkNotNull(System.getProperty(name)) { "The $name system property is not set" }
}
