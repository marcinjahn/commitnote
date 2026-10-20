import Foundation

public struct CoreRuntimeConfiguration: Sendable {
    public var bundleURL: URL
    public var deviceModel: String
    public var rememberedSession: any RememberedSessionStorage
    public var blobCache: any BlobCacheStorage
    public var deviceSettings: any DeviceSettingsStorage
    public var http: any HTTPClient

    public init(
        bundleURL: URL,
        deviceModel: String,
        rememberedSession: any RememberedSessionStorage = KeychainRememberedSessionStorage(),
        blobCache: any BlobCacheStorage = FileBlobCacheStorage(),
        deviceSettings: any DeviceSettingsStorage = UserDefaultsDeviceSettingsStorage(),
        http: any HTTPClient = URLSessionHTTPClient()
    ) {
        self.bundleURL = bundleURL
        self.deviceModel = deviceModel
        self.rememberedSession = rememberedSession
        self.blobCache = blobCache
        self.deviceSettings = deviceSettings
        self.http = http
    }

    public static func production(bundleURL: URL, deviceModel: String) -> CoreRuntimeConfiguration {
        CoreRuntimeConfiguration(
            bundleURL: bundleURL,
            deviceModel: deviceModel,
            rememberedSession: KeychainRememberedSessionStorage(),
            blobCache: FileBlobCacheStorage(),
            deviceSettings: UserDefaultsDeviceSettingsStorage(),
            http: URLSessionHTTPClient()
        )
    }

    public static func resetStoredState(
        keychainService: String = KeychainRememberedSessionStorage.defaultService,
        blobCacheRoot: URL = FileBlobCacheStorage.defaultRoot,
        defaults: UserDefaults = .standard
    ) {
        try? KeychainRememberedSessionStorage(service: keychainService).clear()
        try? FileBlobCacheStorage(root: blobCacheRoot).removeAll()
        UserDefaultsDeviceSettingsStorage(defaults: defaults).removeAllCommitnoteKeys()
    }
}
