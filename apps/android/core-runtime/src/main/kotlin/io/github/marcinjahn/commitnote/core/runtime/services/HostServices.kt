package io.github.marcinjahn.commitnote.core.runtime.services

data class HostServices(
    val crypto: CryptoService,
    val random: RandomService,
    val http: HttpService,
    val clock: ClockService,
    val rememberedSession: RememberedSessionService,
    val blobCache: BlobCacheService,
    val deviceSettings: DeviceSettingsService,
    val log: LogService,
    val stagedInputs: StagedInputsService,
    val imageCodec: ImageCodecService,
)
