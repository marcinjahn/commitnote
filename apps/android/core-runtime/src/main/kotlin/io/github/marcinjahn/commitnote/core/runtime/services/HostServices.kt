package io.github.marcinjahn.commitnote.core.runtime.services

/** The platform services behind the core's `host` object; the runtime itself provides the clock and log. */
data class HostServices(
    val crypto: CryptoService,
    val random: RandomService,
    val http: HttpService,
    val rememberedSession: RememberedSessionService,
    val blobCache: BlobCacheService,
    val deviceSettings: DeviceSettingsService,
    val stagedInputs: StagedInputsService,
    val imageCodec: ImageCodecService,
)
