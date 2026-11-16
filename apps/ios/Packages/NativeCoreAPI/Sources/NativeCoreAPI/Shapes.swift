public enum LaunchAction: String, Codable, Sendable, CaseIterable {
    case newNote = "new-note"
    case search
}

public enum ForgeID: String, Codable, Equatable, Sendable {
    case github
    case gitlab
}

public indirect enum TreeNode: Codable, Equatable, Sendable {
    case folder(name: String, path: [String], noteCount: Int, children: [TreeNode])
    case note(name: String, path: [String], colorTag: ColorTag?, shared: Bool)

    private enum CodingKeys: String, CodingKey {
        case kind, name, path, noteCount, children, colorTag, shared
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let name = try container.decode(String.self, forKey: .name)
        let path = try container.decode([String].self, forKey: .path)
        switch try container.decode(String.self, forKey: .kind) {
        case "folder":
            self = .folder(
                name: name,
                path: path,
                noteCount: try container.decode(Int.self, forKey: .noteCount),
                children: try container.decode([TreeNode].self, forKey: .children)
            )
        case "note":
            self = .note(
                name: name,
                path: path,
                colorTag: try container.decodeIfPresent(ColorTag.self, forKey: .colorTag),
                shared: try container.decode(Bool.self, forKey: .shared)
            )
        case let other:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: container, debugDescription: "Unknown tree node kind \(other)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .folder(let name, let path, let noteCount, let children):
            try container.encode("folder", forKey: .kind)
            try container.encode(name, forKey: .name)
            try container.encode(path, forKey: .path)
            try container.encode(noteCount, forKey: .noteCount)
            try container.encode(children, forKey: .children)
        case .note(let name, let path, let colorTag, let shared):
            try container.encode("note", forKey: .kind)
            try container.encode(name, forKey: .name)
            try container.encode(path, forKey: .path)
            try container.encode(colorTag, forKey: .colorTag)
            try container.encode(shared, forKey: .shared)
        }
    }
}

public enum OpenNote: Codable, Equatable, Sendable {
    case loading(path: [String])
    case loaded(
        path: [String], content: String, conflict: OpenNoteConflict?, colorTag: ColorTag?, shared: Bool)
    case missing(path: [String], message: String)
    case trashed(path: [String], message: String)
    case failed(path: [String], message: String, error: CoreError)

    private enum CodingKeys: String, CodingKey {
        case state, path, content, conflict, colorTag, shared, message, error
    }

    public var path: [String] {
        switch self {
        case .loading(let path), .loaded(let path, _, _, _, _), .missing(let path, _),
            .trashed(let path, _), .failed(let path, _, _):
            return path
        }
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let path = try container.decode([String].self, forKey: .path)
        switch try container.decode(String.self, forKey: .state) {
        case "loading":
            self = .loading(path: path)
        case "loaded":
            self = .loaded(
                path: path,
                content: try container.decode(String.self, forKey: .content),
                conflict: try container.decodeIfPresent(OpenNoteConflict.self, forKey: .conflict),
                colorTag: try container.decodeIfPresent(ColorTag.self, forKey: .colorTag),
                shared: try container.decode(Bool.self, forKey: .shared))
        case "missing":
            self = .missing(path: path, message: try container.decode(String.self, forKey: .message))
        case "trashed":
            self = .trashed(path: path, message: try container.decode(String.self, forKey: .message))
        case "failed":
            self = .failed(
                path: path,
                message: try container.decode(String.self, forKey: .message),
                error: try container.decode(CoreError.self, forKey: .error)
            )
        case let other:
            throw DecodingError.dataCorruptedError(
                forKey: .state, in: container, debugDescription: "Unknown note state \(other)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .loading(let path):
            try container.encode("loading", forKey: .state)
            try container.encode(path, forKey: .path)
        case .loaded(let path, let content, let conflict, let colorTag, let shared):
            try container.encode("loaded", forKey: .state)
            try container.encode(path, forKey: .path)
            try container.encode(content, forKey: .content)
            try container.encode(conflict, forKey: .conflict)
            try container.encode(colorTag, forKey: .colorTag)
            try container.encode(shared, forKey: .shared)
        case .missing(let path, let message):
            try container.encode("missing", forKey: .state)
            try container.encode(path, forKey: .path)
            try container.encode(message, forKey: .message)
        case .trashed(let path, let message):
            try container.encode("trashed", forKey: .state)
            try container.encode(path, forKey: .path)
            try container.encode(message, forKey: .message)
        case .failed(let path, let message, let error):
            try container.encode("failed", forKey: .state)
            try container.encode(path, forKey: .path)
            try container.encode(message, forKey: .message)
            try container.encode(error, forKey: .error)
        }
    }
}

public struct RepositoryView: Codable, Equatable, Sendable {
    public var label: String
    public var url: String
    public var `private`: Bool
    public var publicWarning: String?

    public init(label: String, url: String, private isPrivate: Bool, publicWarning: String?) {
        self.label = label
        self.url = url
        self.private = isPrivate
        self.publicWarning = publicWarning
    }

    private enum CodingKeys: String, CodingKey {
        case label, url, `private`, publicWarning
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        label = try container.decode(String.self, forKey: .label)
        url = try container.decode(String.self, forKey: .url)
        `private` = try container.decode(Bool.self, forKey: .private)
        publicWarning = try container.decodeIfPresent(String.self, forKey: .publicWarning)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(label, forKey: .label)
        try container.encode(url, forKey: .url)
        try container.encode(`private`, forKey: .private)
        try container.encode(publicWarning, forKey: .publicWarning)
    }
}

public struct ForgeView: Codable, Equatable, Sendable {
    public var id: ForgeID
    public var name: String
    public var accessTokenHint: String
    public var accessTokenCreationUrl: String
    public var repositoryCreationUrl: String
}

public struct RepositoryListing: Codable, Equatable, Sendable {
    public var url: String
    public var label: String
    public var `private`: Bool
}

public struct LoggedIn: Codable, Equatable, Sendable {
    public var kind: String
}

public struct Empty: Codable, Equatable, Sendable {
    public init() {}
}

public enum InspectionResult: Codable, Equatable, Sendable {
    case notesRepo(repository: RepositoryView)
    case uninitialized(repository: RepositoryView, setUpDescription: String)
    case unusable(
        repository: RepositoryView, error: CoreError, canCheckAgain: Bool, foreignHint: String?)

    private enum CodingKeys: String, CodingKey {
        case kind, repository, setUpDescription, error, canCheckAgain, foreignHint
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let repository = try container.decode(RepositoryView.self, forKey: .repository)
        switch try container.decode(String.self, forKey: .kind) {
        case "notesRepo":
            self = .notesRepo(repository: repository)
        case "uninitialized":
            self = .uninitialized(
                repository: repository,
                setUpDescription: try container.decode(String.self, forKey: .setUpDescription))
        case "unusable":
            self = .unusable(
                repository: repository,
                error: try container.decode(CoreError.self, forKey: .error),
                canCheckAgain: try container.decode(Bool.self, forKey: .canCheckAgain),
                foreignHint: try container.decodeIfPresent(String.self, forKey: .foreignHint))
        case let other:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: container, debugDescription: "Unknown inspection kind \(other)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .notesRepo(let repository):
            try container.encode("notesRepo", forKey: .kind)
            try container.encode(repository, forKey: .repository)
        case .uninitialized(let repository, let setUpDescription):
            try container.encode("uninitialized", forKey: .kind)
            try container.encode(repository, forKey: .repository)
            try container.encode(setUpDescription, forKey: .setUpDescription)
        case .unusable(let repository, let error, let canCheckAgain, let foreignHint):
            try container.encode("unusable", forKey: .kind)
            try container.encode(repository, forKey: .repository)
            try container.encode(error, forKey: .error)
            try container.encode(canCheckAgain, forKey: .canCheckAgain)
            try container.encode(foreignHint, forKey: .foreignHint)
        }
    }
}

public enum ResumeResult: Codable, Equatable, Sendable {
    case none
    case resumed
    case failed(error: CoreError, canRetry: Bool)

    private enum CodingKeys: String, CodingKey {
        case kind, error, canRetry
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .kind) {
        case "none":
            self = .none
        case "resumed":
            self = .resumed
        case "failed":
            self = .failed(
                error: try container.decode(CoreError.self, forKey: .error),
                canRetry: try container.decode(Bool.self, forKey: .canRetry))
        case let other:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: container, debugDescription: "Unknown resume kind \(other)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .none:
            try container.encode("none", forKey: .kind)
        case .resumed:
            try container.encode("resumed", forKey: .kind)
        case .failed(let error, let canRetry):
            try container.encode("failed", forKey: .kind)
            try container.encode(error, forKey: .error)
            try container.encode(canRetry, forKey: .canRetry)
        }
    }
}

public struct PassphraseStrength: Codable, Equatable, Sendable {
    public var score: Int
    public var label: String
    public var filledSegments: Int
    public var weak: Bool
    public var warning: String
}

public enum LoadingStep: String, Codable, Equatable, Sendable {
    case listingRepositories
    case checkingRepository
    case derivingKeys
    case initializing
}

public enum NoticeTone: String, Codable, Equatable, Sendable {
    case info
    case warning
    case error
    case success
}

public enum RemoteChange: String, Codable, Equatable, Sendable {
    case updated
    case relocated
    case trashed
}

public struct OpenNoteConflict: Codable, Equatable, Sendable {
    public var otherDevice: String?
    public var heading: String
    public var text: String
    public var keepThisLabel: String
    public var keepOtherLabel: String
    public var editMergedLabel: String
    public var editHint: String
    public var merged: String
    public var editing: Bool

    public init(
        otherDevice: String?, heading: String, text: String, keepThisLabel: String,
        keepOtherLabel: String, editMergedLabel: String, editHint: String, merged: String,
        editing: Bool
    ) {
        self.otherDevice = otherDevice
        self.heading = heading
        self.text = text
        self.keepThisLabel = keepThisLabel
        self.keepOtherLabel = keepOtherLabel
        self.editMergedLabel = editMergedLabel
        self.editHint = editHint
        self.merged = merged
        self.editing = editing
    }

    private enum CodingKeys: String, CodingKey {
        case otherDevice, heading, text, keepThisLabel, keepOtherLabel, editMergedLabel, editHint,
            merged, editing
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        otherDevice = try container.decodeIfPresent(String.self, forKey: .otherDevice)
        heading = try container.decode(String.self, forKey: .heading)
        text = try container.decode(String.self, forKey: .text)
        keepThisLabel = try container.decode(String.self, forKey: .keepThisLabel)
        keepOtherLabel = try container.decode(String.self, forKey: .keepOtherLabel)
        editMergedLabel = try container.decode(String.self, forKey: .editMergedLabel)
        editHint = try container.decode(String.self, forKey: .editHint)
        merged = try container.decode(String.self, forKey: .merged)
        editing = try container.decode(Bool.self, forKey: .editing)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(otherDevice, forKey: .otherDevice)
        try container.encode(heading, forKey: .heading)
        try container.encode(text, forKey: .text)
        try container.encode(keepThisLabel, forKey: .keepThisLabel)
        try container.encode(keepOtherLabel, forKey: .keepOtherLabel)
        try container.encode(editMergedLabel, forKey: .editMergedLabel)
        try container.encode(editHint, forKey: .editHint)
        try container.encode(merged, forKey: .merged)
        try container.encode(editing, forKey: .editing)
    }
}

public struct RemoteTextEdit: Codable, Equatable, Sendable {
    public var from: Int
    public var to: Int
    public var insert: String

    public init(from: Int, to: Int, insert: String) {
        self.from = from
        self.to = to
        self.insert = insert
    }
}

public enum OutOfSyncReason: String, Codable, Equatable, Sendable {
    case pending
    case failed
    case conflict
}

public enum SyncState: Codable, Equatable, Sendable {
    case synced
    case syncing
    case outOfSync(OutOfSyncReason)

    private enum CodingKeys: String, CodingKey {
        case kind, reason
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .kind) {
        case "synced":
            self = .synced
        case "syncing":
            self = .syncing
        case "out-of-sync":
            self = .outOfSync(try container.decode(OutOfSyncReason.self, forKey: .reason))
        case let other:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: container, debugDescription: "Unknown sync state kind \(other)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .synced:
            try container.encode("synced", forKey: .kind)
        case .syncing:
            try container.encode("syncing", forKey: .kind)
        case .outOfSync(let reason):
            try container.encode("out-of-sync", forKey: .kind)
            try container.encode(reason, forKey: .reason)
        }
    }
}

public struct SyncStatusMenuItem: Codable, Equatable, Sendable {
    public var id: String
    public var label: String
    public var path: [String]?

    public init(id: String, label: String, path: [String]?) {
        self.id = id
        self.label = label
        self.path = path
    }

    private enum CodingKeys: String, CodingKey {
        case id, label, path
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        label = try container.decode(String.self, forKey: .label)
        path = try container.decodeIfPresent([String].self, forKey: .path)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(label, forKey: .label)
        try container.encode(path, forKey: .path)
    }
}

public struct NoticeAction: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, Equatable, Sendable {
        case openNote
        case undo
    }

    public var kind: Kind
    public var label: String
    public var path: [String]?

    public init(kind: Kind, label: String, path: [String]? = nil) {
        self.kind = kind
        self.label = label
        self.path = path
    }
}

public enum FlushOutcome: Codable, Equatable, Sendable {
    case saved
    case unsaved(count: Int)

    private enum CodingKeys: String, CodingKey {
        case kind, count
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .kind) {
        case "saved":
            self = .saved
        case "unsaved":
            self = .unsaved(count: try container.decode(Int.self, forKey: .count))
        case let other:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: container, debugDescription: "Unknown flush outcome \(other)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .saved:
            try container.encode("saved", forKey: .kind)
        case .unsaved(let count):
            try container.encode("unsaved", forKey: .kind)
            try container.encode(count, forKey: .count)
        }
    }
}

public enum ConflictResolution: String, Codable, Equatable, Sendable {
    case keepMine
    case keepTheirs
    case editMerged
}

public enum LogoutOutcome: Codable, Equatable, Sendable {
    case loggedOut
    case unsaved(count: Int, message: String)

    private enum CodingKeys: String, CodingKey {
        case kind, count, message
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .kind) {
        case "loggedOut":
            self = .loggedOut
        case "unsaved":
            self = .unsaved(
                count: try container.decode(Int.self, forKey: .count),
                message: try container.decode(String.self, forKey: .message))
        case let other:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: container, debugDescription: "Unknown logout outcome \(other)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .loggedOut:
            try container.encode("loggedOut", forKey: .kind)
        case .unsaved(let count, let message):
            try container.encode("unsaved", forKey: .kind)
            try container.encode(count, forKey: .count)
            try container.encode(message, forKey: .message)
        }
    }
}

public struct NoteDraft: Codable, Equatable, Sendable {
    public var parent: [String]
    public var name: String

    public init(parent: [String], name: String) {
        self.parent = parent
        self.name = name
    }
}

public enum NoteDraftOutcome: Codable, Equatable, Sendable {
    case none
    case error(message: String)
    case created(path: [String], fieldError: String?)

    private enum CodingKeys: String, CodingKey {
        case kind, message, path, fieldError
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .kind) {
        case "none":
            self = .none
        case "error":
            self = .error(message: try container.decode(String.self, forKey: .message))
        case "created":
            self = .created(
                path: try container.decode([String].self, forKey: .path),
                fieldError: try container.decodeIfPresent(String.self, forKey: .fieldError))
        case let other:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: container, debugDescription: "Unknown draft outcome \(other)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .none:
            try container.encode("none", forKey: .kind)
        case .error(let message):
            try container.encode("error", forKey: .kind)
            try container.encode(message, forKey: .message)
        case .created(let path, let fieldError):
            try container.encode("created", forKey: .kind)
            try container.encode(path, forKey: .path)
            try container.encode(fieldError, forKey: .fieldError)
        }
    }
}

public enum FolderCreateOutcome: Codable, Equatable, Sendable {
    case created(path: [String])
    case error(message: String)

    private enum CodingKeys: String, CodingKey {
        case kind, path, message
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .kind) {
        case "created":
            self = .created(path: try container.decode([String].self, forKey: .path))
        case "error":
            self = .error(message: try container.decode(String.self, forKey: .message))
        case let other:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: container,
                debugDescription: "Unknown folder create outcome \(other)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .created(let path):
            try container.encode("created", forKey: .kind)
            try container.encode(path, forKey: .path)
        case .error(let message):
            try container.encode("error", forKey: .kind)
            try container.encode(message, forKey: .message)
        }
    }
}

public struct ExportedArchive: Codable, Equatable, Sendable {
    public var fileName: String
    public var mimeType: String
    public var base64: String

    public init(fileName: String, mimeType: String = "application/zip", base64: String) {
        self.fileName = fileName
        self.mimeType = mimeType
        self.base64 = base64
    }
}

public enum ColorTag: String, Codable, Equatable, Sendable, CaseIterable {
    case red
    case orange
    case yellow
    case green
    case blue
    case purple
}

public struct TagOption: Codable, Equatable, Sendable {
    public var tag: ColorTag
    public var label: String

    public init(tag: ColorTag, label: String) {
        self.tag = tag
        self.label = label
    }
}

public enum StructureOutcome: Codable, Equatable, Sendable {
    case ok(path: [String])
    case error(message: String)

    private enum CodingKeys: String, CodingKey {
        case kind, path, message
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .kind) {
        case "ok":
            self = .ok(path: try container.decode([String].self, forKey: .path))
        case "error":
            self = .error(message: try container.decode(String.self, forKey: .message))
        case let other:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: container, debugDescription: "Unknown structure outcome \(other)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .ok(let path):
            try container.encode("ok", forKey: .kind)
            try container.encode(path, forKey: .path)
        case .error(let message):
            try container.encode("error", forKey: .kind)
            try container.encode(message, forKey: .message)
        }
    }
}

public enum SiblingMoveOutcome: Codable, Equatable, Sendable {
    case none
    case ok(path: [String])
    case error(message: String)

    private enum CodingKeys: String, CodingKey {
        case kind, path, message
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .kind) {
        case "none":
            self = .none
        case "ok":
            self = .ok(path: try container.decode([String].self, forKey: .path))
        case "error":
            self = .error(message: try container.decode(String.self, forKey: .message))
        case let other:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: container, debugDescription: "Unknown sibling move outcome \(other)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .none:
            try container.encode("none", forKey: .kind)
        case .ok(let path):
            try container.encode("ok", forKey: .kind)
            try container.encode(path, forKey: .path)
        case .error(let message):
            try container.encode("error", forKey: .kind)
            try container.encode(message, forKey: .message)
        }
    }
}

public enum SiblingDirection: String, Codable, Equatable, Sendable {
    case up
    case down
}

public struct MoveTargetView: Codable, Equatable, Sendable {
    public var path: [String]
    public var label: String
    public var depth: Int
    public var disabled: Bool

    public init(path: [String], label: String, depth: Int, disabled: Bool) {
        self.path = path
        self.label = label
        self.depth = depth
        self.disabled = disabled
    }
}

public struct TrashPreview: Codable, Equatable, Sendable {
    public var title: String
    public var message: String
    public var confirmLabel: String
    public var itemCount: Int
    public var shareCount: Int

    public init(
        title: String, message: String, confirmLabel: String, itemCount: Int, shareCount: Int
    ) {
        self.title = title
        self.message = message
        self.confirmLabel = confirmLabel
        self.itemCount = itemCount
        self.shareCount = shareCount
    }
}

public enum TrashOutcome: Codable, Equatable, Sendable {
    case trashed(entryId: String)
    case deleted
    case confirm(preview: TrashPreview)
    case error(message: String)

    private enum CodingKeys: String, CodingKey {
        case kind, entryId, preview, message
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .kind) {
        case "trashed":
            self = .trashed(entryId: try container.decode(String.self, forKey: .entryId))
        case "deleted":
            self = .deleted
        case "confirm":
            self = .confirm(preview: try container.decode(TrashPreview.self, forKey: .preview))
        case "error":
            self = .error(message: try container.decode(String.self, forKey: .message))
        case let other:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: container, debugDescription: "Unknown trash outcome \(other)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .trashed(let entryId):
            try container.encode("trashed", forKey: .kind)
            try container.encode(entryId, forKey: .entryId)
        case .deleted:
            try container.encode("deleted", forKey: .kind)
        case .confirm(let preview):
            try container.encode("confirm", forKey: .kind)
            try container.encode(preview, forKey: .preview)
        case .error(let message):
            try container.encode("error", forKey: .kind)
            try container.encode(message, forKey: .message)
        }
    }
}

public enum TrashNodeKind: String, Codable, Equatable, Sendable {
    case note
    case folder
}

public struct TrashItemView: Codable, Equatable, Sendable {
    public var kind: TrashNodeKind
    public var name: String
    public var subPath: [String]
    public var children: [TrashItemView]

    public init(kind: TrashNodeKind, name: String, subPath: [String], children: [TrashItemView]) {
        self.kind = kind
        self.name = name
        self.subPath = subPath
        self.children = children
    }
}

public struct TrashEntryView: Codable, Equatable, Sendable {
    public var id: String
    public var kind: TrashNodeKind
    public var name: String
    public var originalFolder: String
    public var daysLeft: String
    public var colorTag: ColorTag?
    public var children: [TrashItemView]

    public init(
        id: String, kind: TrashNodeKind, name: String, originalFolder: String, daysLeft: String,
        colorTag: ColorTag?, children: [TrashItemView]
    ) {
        self.id = id
        self.kind = kind
        self.name = name
        self.originalFolder = originalFolder
        self.daysLeft = daysLeft
        self.colorTag = colorTag
        self.children = children
    }

    private enum CodingKeys: String, CodingKey {
        case id, kind, name, originalFolder, daysLeft, colorTag, children
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        kind = try container.decode(TrashNodeKind.self, forKey: .kind)
        name = try container.decode(String.self, forKey: .name)
        originalFolder = try container.decode(String.self, forKey: .originalFolder)
        daysLeft = try container.decode(String.self, forKey: .daysLeft)
        colorTag = try container.decodeIfPresent(ColorTag.self, forKey: .colorTag)
        children = try container.decode([TrashItemView].self, forKey: .children)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(kind, forKey: .kind)
        try container.encode(name, forKey: .name)
        try container.encode(originalFolder, forKey: .originalFolder)
        try container.encode(daysLeft, forKey: .daysLeft)
        try container.encode(colorTag, forKey: .colorTag)
        try container.encode(children, forKey: .children)
    }
}

public struct TrashConfirmationText: Codable, Equatable, Sendable {
    public var title: String
    public var message: String

    public init(title: String, message: String) {
        self.title = title
        self.message = message
    }
}

public struct SearchRange: Codable, Equatable, Sendable {
    public var start: Int
    public var end: Int

    public init(start: Int, end: Int) {
        self.start = start
        self.end = end
    }

    public init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        start = try container.decode(Int.self)
        end = try container.decode(Int.self)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.unkeyedContainer()
        try container.encode(start)
        try container.encode(end)
    }
}

public struct SnippetPart: Codable, Equatable, Sendable {
    public var text: String
    public var match: Bool

    public init(text: String, match: Bool) {
        self.text = text
        self.match = match
    }
}

public struct SearchRow: Codable, Equatable, Sendable {
    public var path: [String]
    public var name: String
    public var folder: String?
    public var nameRanges: [SearchRange]
    public var snippet: [SnippetPart]?
    public var colorTag: ColorTag?

    public init(
        path: [String], name: String, folder: String?, nameRanges: [SearchRange],
        snippet: [SnippetPart]?, colorTag: ColorTag?
    ) {
        self.path = path
        self.name = name
        self.folder = folder
        self.nameRanges = nameRanges
        self.snippet = snippet
        self.colorTag = colorTag
    }

    private enum CodingKeys: String, CodingKey {
        case path, name, folder, nameRanges, snippet, colorTag
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        path = try container.decode([String].self, forKey: .path)
        name = try container.decode(String.self, forKey: .name)
        folder = try container.decodeIfPresent(String.self, forKey: .folder)
        nameRanges = try container.decode([SearchRange].self, forKey: .nameRanges)
        snippet = try container.decodeIfPresent([SnippetPart].self, forKey: .snippet)
        colorTag = try container.decodeIfPresent(ColorTag.self, forKey: .colorTag)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(path, forKey: .path)
        try container.encode(name, forKey: .name)
        try container.encode(folder, forKey: .folder)
        try container.encode(nameRanges, forKey: .nameRanges)
        try container.encode(snippet, forKey: .snippet)
        try container.encode(colorTag, forKey: .colorTag)
    }
}

public struct SearchCopy: Codable, Equatable, Sendable {
    public var recentHeading: String
    public var namesHeading: String
    public var contentsHeading: String
    public var noMatches: String
    public var stillReading: String
    public var hint: String

    public init(
        recentHeading: String, namesHeading: String, contentsHeading: String, noMatches: String,
        stillReading: String, hint: String
    ) {
        self.recentHeading = recentHeading
        self.namesHeading = namesHeading
        self.contentsHeading = contentsHeading
        self.noMatches = noMatches
        self.stillReading = stillReading
        self.hint = hint
    }
}

public struct SearchResults: Codable, Equatable, Sendable {
    public var recent: [SearchRow]
    public var names: [SearchRow]
    public var contents: [SearchRow]
    public var countText: String?
    public var namesMore: String?
    public var contentsMore: String?
    public var copy: SearchCopy

    public init(
        recent: [SearchRow], names: [SearchRow], contents: [SearchRow], countText: String?,
        namesMore: String?, contentsMore: String?, copy: SearchCopy
    ) {
        self.recent = recent
        self.names = names
        self.contents = contents
        self.countText = countText
        self.namesMore = namesMore
        self.contentsMore = contentsMore
        self.copy = copy
    }

    private enum CodingKeys: String, CodingKey {
        case recent, names, contents, countText, namesMore, contentsMore, copy
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        recent = try container.decode([SearchRow].self, forKey: .recent)
        names = try container.decode([SearchRow].self, forKey: .names)
        contents = try container.decode([SearchRow].self, forKey: .contents)
        countText = try container.decodeIfPresent(String.self, forKey: .countText)
        namesMore = try container.decodeIfPresent(String.self, forKey: .namesMore)
        contentsMore = try container.decodeIfPresent(String.self, forKey: .contentsMore)
        copy = try container.decode(SearchCopy.self, forKey: .copy)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(recent, forKey: .recent)
        try container.encode(names, forKey: .names)
        try container.encode(contents, forKey: .contents)
        try container.encode(countText, forKey: .countText)
        try container.encode(namesMore, forKey: .namesMore)
        try container.encode(contentsMore, forKey: .contentsMore)
        try container.encode(copy, forKey: .copy)
    }
}

public struct DetailItemText: Codable, Equatable, Sendable {
    public var label: String
    public var value: String

    public init(label: String, value: String) {
        self.label = label
        self.value = value
    }
}

public enum NameCommitOutcome: Codable, Equatable, Sendable {
    case none
    case restore
    case error(message: String)
    case ok(path: [String])

    private enum CodingKeys: String, CodingKey {
        case kind, message, path
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .kind) {
        case "none":
            self = .none
        case "restore":
            self = .restore
        case "error":
            self = .error(message: try container.decode(String.self, forKey: .message))
        case "ok":
            self = .ok(path: try container.decode([String].self, forKey: .path))
        case let other:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: container, debugDescription: "Unknown name commit outcome \(other)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .none:
            try container.encode("none", forKey: .kind)
        case .restore:
            try container.encode("restore", forKey: .kind)
        case .error(let message):
            try container.encode("error", forKey: .kind)
            try container.encode(message, forKey: .message)
        case .ok(let path):
            try container.encode("ok", forKey: .kind)
            try container.encode(path, forKey: .path)
        }
    }
}

public struct ImagePayload: Codable, Equatable, Sendable {
    public enum MediaType: String, Codable, Equatable, Sendable {
        case webp = "image/webp"
        case gif = "image/gif"
    }

    public var type: MediaType
    public var base64: String

    public init(type: MediaType, base64: String) {
        self.type = type
        self.base64 = base64
    }
}

public struct LastView: Codable, Equatable, Sendable {
    public var note: [String]?
    public var folders: [[String]]

    public init(note: [String]?, folders: [[String]]) {
        self.note = note
        self.folders = folders
    }

    private enum CodingKeys: String, CodingKey {
        case note, folders
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        note = try container.decodeIfPresent([String].self, forKey: .note)
        folders = try container.decode([[String]].self, forKey: .folders)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(note, forKey: .note)
        try container.encode(folders, forKey: .folders)
    }
}

public enum EarlyDraftOutcome: Codable, Equatable, Sendable {
    case none
    case draft(name: String, error: String?)
    case created(path: [String], fieldError: String?)

    private enum CodingKeys: String, CodingKey {
        case kind, name, error, path, fieldError
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .kind) {
        case "none":
            self = .none
        case "draft":
            self = .draft(
                name: try container.decode(String.self, forKey: .name),
                error: try container.decodeIfPresent(String.self, forKey: .error))
        case "created":
            self = .created(
                path: try container.decode([String].self, forKey: .path),
                fieldError: try container.decodeIfPresent(String.self, forKey: .fieldError))
        case let other:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: container, debugDescription: "Unknown early draft outcome \(other)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .none:
            try container.encode("none", forKey: .kind)
        case .draft(let name, let error):
            try container.encode("draft", forKey: .kind)
            try container.encode(name, forKey: .name)
            try container.encode(error, forKey: .error)
        case .created(let path, let fieldError):
            try container.encode("created", forKey: .kind)
            try container.encode(path, forKey: .path)
            try container.encode(fieldError, forKey: .fieldError)
        }
    }
}

public struct NoteStatsResult: Codable, Equatable, Sendable {
    public var words: DetailItemText
    public var tasks: DetailItemText?

    public init(words: DetailItemText, tasks: DetailItemText?) {
        self.words = words
        self.tasks = tasks
    }

    private enum CodingKeys: String, CodingKey {
        case words, tasks
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        words = try container.decode(DetailItemText.self, forKey: .words)
        tasks = try container.decodeIfPresent(DetailItemText.self, forKey: .tasks)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(words, forKey: .words)
        try container.encode(tasks, forKey: .tasks)
    }
}

public struct NoteDatesResult: Codable, Equatable, Sendable {
    public var notSaved: Bool
    public var created: DetailItemText?
    public var updated: DetailItemText?

    public init(notSaved: Bool, created: DetailItemText?, updated: DetailItemText?) {
        self.notSaved = notSaved
        self.created = created
        self.updated = updated
    }

    private enum CodingKeys: String, CodingKey {
        case notSaved, created, updated
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        notSaved = try container.decode(Bool.self, forKey: .notSaved)
        created = try container.decodeIfPresent(DetailItemText.self, forKey: .created)
        updated = try container.decodeIfPresent(DetailItemText.self, forKey: .updated)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(notSaved, forKey: .notSaved)
        try container.encode(created, forKey: .created)
        try container.encode(updated, forKey: .updated)
    }
}
