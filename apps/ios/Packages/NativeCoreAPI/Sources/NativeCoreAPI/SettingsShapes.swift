public enum SettingScope: String, Codable, Equatable, Sendable {
    case synced
    case device
}

public enum SettingKeyView: String, Codable, Equatable, Sendable {
    case colorMode
    case accentColor
    case noteFont
    case newNotePlacement
    case newFolderPlacement
    case typeToStart
}

public enum ScopedSettingKey: String, Codable, Equatable, Sendable {
    case colorMode
    case accentColor
    case noteFont
    case typeToStart
}

public struct SettingOptionView: Decodable, Equatable, Sendable {
    public var id: String
    public var label: String
    public var description: String?
}

public struct AccentOptionView: Decodable, Equatable, Sendable {
    public var id: String
    public var label: String
    public var light: String?
    public var dark: String?
}

public struct SettingChoiceCopy: Decodable, Equatable, Sendable {
    public var label: String
    public var options: [SettingOptionView]
}

public struct AccentChoiceCopy: Decodable, Equatable, Sendable {
    public var label: String
    public var options: [AccentOptionView]
}

public struct NoteFontCopy: Decodable, Equatable, Sendable {
    public var label: String
    public var options: [SettingOptionView]
    public var previewHeading: String
    public var previewBody: String
    public var previewCode: String
}

public struct SettingsSectionTitles: Decodable, Equatable, Sendable {
    public var appearance: String
    public var editor: String
    public var notes: String
    public var thisDevice: String
    public var dataSecurity: String
}

public struct SettingScopeLabels: Decodable, Equatable, Sendable {
    public var synced: String
    public var device: String
}

public struct DeviceNameCopy: Decodable, Equatable, Sendable {
    public var label: String
    public var hint: String
    public var maxLength: Int
}

public struct ReopenLastViewCopy: Decodable, Equatable, Sendable {
    public var label: String
}

public struct AnalyticsCopy: Decodable, Equatable, Sendable {
    public var label: String
    public var hint: String
}

public struct TypeToStartCopy: Decodable, Equatable, Sendable {
    public var label: String
    public var hint: String
}

public struct SettingsDataCopy: Decodable, Equatable, Sendable {
    public var exportLabel: String
    public var exportingLabel: String
    public var exportShareLabel: String
    public var exportFilesLabel: String
    public var exportFailed: String
    public var importLabel: String
    public var importingLabel: String
    public var changePassphraseLabel: String
}

public struct SettingsCopy: Decodable, Equatable, Sendable {
    public var title: String
    public var intro: String
    public var sections: SettingsSectionTitles
    public var scopeLabels: SettingScopeLabels
    public var colorMode: SettingChoiceCopy
    public var accentColor: AccentChoiceCopy
    public var noteFont: NoteFontCopy
    public var editorUnavailable: String
    public var newNotePlacement: SettingChoiceCopy
    public var newFolderPlacement: SettingChoiceCopy
    public var deviceName: DeviceNameCopy
    public var typeToStart: TypeToStartCopy
    public var reopenLastView: ReopenLastViewCopy
    public var analytics: AnalyticsCopy
    public var data: SettingsDataCopy
    public var retryLabel: String
}

public struct SettingsValues: Decodable, Equatable, Sendable {
    public var colorMode: String
    public var accentColor: String
    public var noteFont: String
    public var newNotePlacement: String
    public var newFolderPlacement: String
    public var typeToStart: Bool
}

public struct SettingsScopes: Decodable, Equatable, Sendable {
    public var colorMode: SettingScope
    public var accentColor: SettingScope
    public var noteFont: SettingScope
    public var typeToStart: SettingScope
}

public struct SettingsView: Decodable, Equatable, Sendable {
    public var values: SettingsValues
    public var scopes: SettingsScopes
    public var deviceName: String
    public var automaticDeviceName: String
    public var reopenLastView: Bool
    public var analyticsCounted: Bool
    public var canExport: Bool
    public var canImport: Bool
    public var canChangePassphrase: Bool
}

public enum SettingsSaveState: String, Decodable, Equatable, Sendable {
    case synced
    case syncing
    case pending
    case failed
}

public struct SettingsSaveView: Decodable, Equatable, Sendable {
    public var state: SettingsSaveState
    public var label: String
    public var detail: String
    public var canRetry: Bool
}
