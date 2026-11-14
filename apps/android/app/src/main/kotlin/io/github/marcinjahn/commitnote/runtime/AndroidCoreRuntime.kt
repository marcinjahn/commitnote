package io.github.marcinjahn.commitnote.runtime

import android.content.Context
import io.github.marcinjahn.commitnote.BuildConfig
import io.github.marcinjahn.commitnote.core.runtime.CoreRuntime
import io.github.marcinjahn.commitnote.core.runtime.services.BlobCacheService
import io.github.marcinjahn.commitnote.core.runtime.services.HostServices
import io.github.marcinjahn.commitnote.core.runtime.services.ImageCodecService
import io.github.marcinjahn.commitnote.core.runtime.services.JcaCryptoService
import io.github.marcinjahn.commitnote.core.runtime.services.OkHttpHttpService
import io.github.marcinjahn.commitnote.core.runtime.services.SecureRandomService
import io.github.marcinjahn.commitnote.core.runtime.services.StagedInputsService
import io.github.marcinjahn.commitnote.host.KeystoreRememberedSession
import io.github.marcinjahn.commitnote.host.PlatformImageCodec
import io.github.marcinjahn.commitnote.host.SharedPreferencesDeviceSettings

private const val CORE_BUNDLE_ASSET = "commitnote-core.js"

/** The services of this device; [imageCodec] is replaceable so tests can run without real images. */
fun androidHostServices(
    context: Context,
    blobCache: BlobCacheService,
    stagedInputs: StagedInputsService,
    imageCodec: ImageCodecService = PlatformImageCodec(),
): HostServices =
    HostServices(
        crypto = JcaCryptoService(),
        random = SecureRandomService(),
        http = OkHttpHttpService(),
        rememberedSession = KeystoreRememberedSession(context),
        blobCache = blobCache,
        deviceSettings = SharedPreferencesDeviceSettings(context),
        stagedInputs = stagedInputs,
        imageCodec = imageCodec,
    )

/** Reads the bundle and ICU data from the app's assets, so call it off the main thread. */
fun createAndroidCoreRuntime(
    context: Context,
    services: HostServices,
): CoreRuntime {
    val icuData = IcuDataInstaller(context, BuildConfig.VERSION_CODE).install()
    val bundle = context.assets.open(CORE_BUNDLE_ASSET).use { it.readBytes().decodeToString() }
    return CoreRuntime(
        services = services,
        bundleSource = bundle,
        icuDataPath = icuData.toPath(),
        logger = AndroidLogService(debugEnabled = BuildConfig.DEBUG),
    )
}
