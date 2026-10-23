public enum ImportPolicy: String, Codable, Equatable, Sendable {
    case stop
    case rename
}

public enum ImportDropSource: String, Codable, Equatable, Sendable {
    case picker
    case tree
}

public struct ImportDroppedFile: Encodable, Equatable, Sendable {
    public var input: String
    public var name: String

    public init(input: String, name: String) {
        self.input = input
        self.name = name
    }
}

public enum ImportDestinationView: Encodable, Equatable, Sendable {
    case root
    case folder(path: [String])
    case newFolder(parent: [String], name: String)

    private enum CodingKeys: String, CodingKey {
        case kind, path, parent, name
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .root:
            try container.encode("root", forKey: .kind)
        case .folder(let path):
            try container.encode("folder", forKey: .kind)
            try container.encode(path, forKey: .path)
        case .newFolder(let parent, let name):
            try container.encode("newFolder", forKey: .kind)
            try container.encode(parent, forKey: .parent)
            try container.encode(name, forKey: .name)
        }
    }
}

public struct ImportTargetView: Decodable, Equatable, Sendable {
    public var path: [String]
    public var label: String
    public var depth: Int
}

public struct ImportFormCopy: Decodable, Equatable, Sendable {
    public var title: String
    public var conflictsTitle: String
    public var setupTitle: String
    public var intoLabel: String
    public var newFolderLabel: String
    public var folderNameLabel: String
    public var existingFolderLabel: String
    public var rootLabel: String
    public var emptyText: String
    public var importLabel: String
    public var importingLabel: String
    public var renameLabel: String
    public var enableAtomicLabel: String
    public var cancelLabel: String
}

public struct ImportForm: Decodable, Equatable, Sendable {
    public var fileName: String
    public var defaultFolderName: String
    public var skipped: String?
    public var empty: Bool
    public var targets: [ImportTargetView]
    public var copy: ImportFormCopy
}

public enum ImportArchiveOutcome: Decodable, Equatable, Sendable {
    case ready(form: ImportForm)
    case error(message: String)

    private enum CodingKeys: String, CodingKey {
        case kind, form, message
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .kind) {
        case "ready":
            self = .ready(form: try container.decode(ImportForm.self, forKey: .form))
        case "error":
            self = .error(message: try container.decode(String.self, forKey: .message))
        case let other:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: container,
                debugDescription: "Unknown import archive outcome \(other)")
        }
    }
}

public enum ImportOutcomeView: Decodable, Equatable, Sendable {
    case queued(expand: [String]?)
    case conflicts(count: Int, message: String)
    case needsSetup(canConfigure: Bool, message: String, actionLabel: String)
    case error(message: String)

    private enum CodingKeys: String, CodingKey {
        case kind, expand, count, message, canConfigure, actionLabel
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .kind) {
        case "queued":
            self = .queued(expand: try container.decodeIfPresent([String].self, forKey: .expand))
        case "conflicts":
            self = .conflicts(
                count: try container.decode(Int.self, forKey: .count),
                message: try container.decode(String.self, forKey: .message))
        case "needsSetup":
            self = .needsSetup(
                canConfigure: try container.decode(Bool.self, forKey: .canConfigure),
                message: try container.decode(String.self, forKey: .message),
                actionLabel: try container.decode(String.self, forKey: .actionLabel))
        case "error":
            self = .error(message: try container.decode(String.self, forKey: .message))
        case let other:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: container, debugDescription: "Unknown import outcome \(other)")
        }
    }
}

public struct AtomicBlockedView: Decodable, Equatable, Sendable {
    public var title: String
    public var message: String
    public var enableLabel: String
    public var saveWithoutLabel: String
    public var canConfigure: Bool
}

public struct PassphraseChangeCopy: Decodable, Equatable, Sendable {
    public var title: String
    public var intro: String
    public var currentLabel: String
    public var newLabel: String
    public var repeatLabel: String
    public var newHint: String
    public var removeHistoryLabel: String
    public var removeHistoryDescription: String
    public var historyWarning: String
    public var otherDevicesWarning: String
    public var versionHistoryNotice: String
    public var continueLabel: String
    public var confirmLabel: String
    public var cancelLabel: String
    public var checkAgainLabel: String
    public var checkingLabel: String
    public var startingLabel: String
    public var enableAtomicLabel: String
    public var passphrasesDiffer: String
    public var enterCurrentPassphrase: String
}

public enum PassphraseChangeOutcome: Decodable, Equatable, Sendable {
    case review(summary: String, carriedOver: [String], historyWarning: String?)
    case changed
    case failed(message: String, clearCurrent: Bool)
    case needsSetup(canConfigure: Bool, message: String, actionLabel: String)
    case unsettled(message: String)

    private enum CodingKeys: String, CodingKey {
        case kind, summary, carriedOver, historyWarning, message, clearCurrent, canConfigure,
            actionLabel
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .kind) {
        case "review":
            self = .review(
                summary: try container.decode(String.self, forKey: .summary),
                carriedOver: try container.decode([String].self, forKey: .carriedOver),
                historyWarning: try container.decodeIfPresent(String.self, forKey: .historyWarning))
        case "changed":
            self = .changed
        case "failed":
            self = .failed(
                message: try container.decode(String.self, forKey: .message),
                clearCurrent: try container.decode(Bool.self, forKey: .clearCurrent))
        case "needsSetup":
            self = .needsSetup(
                canConfigure: try container.decode(Bool.self, forKey: .canConfigure),
                message: try container.decode(String.self, forKey: .message),
                actionLabel: try container.decode(String.self, forKey: .actionLabel))
        case "unsettled":
            self = .unsettled(message: try container.decode(String.self, forKey: .message))
        case let other:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: container,
                debugDescription: "Unknown passphrase change outcome \(other)")
        }
    }
}
