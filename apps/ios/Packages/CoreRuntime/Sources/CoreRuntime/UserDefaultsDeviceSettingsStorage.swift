import Foundation

public final class UserDefaultsDeviceSettingsStorage: DeviceSettingsStorage {
    public static let knownKeyPrefix = "commitnote."

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func getItem(_ key: String) -> String? {
        defaults.string(forKey: key)
    }

    public func setItem(_ key: String, _ value: String) {
        defaults.set(value, forKey: key)
    }

    public func removeItem(_ key: String) {
        defaults.removeObject(forKey: key)
    }

    public func removeAllCommitnoteKeys() {
        for key in defaults.dictionaryRepresentation().keys where key.hasPrefix(Self.knownKeyPrefix) {
            defaults.removeObject(forKey: key)
        }
    }
}
