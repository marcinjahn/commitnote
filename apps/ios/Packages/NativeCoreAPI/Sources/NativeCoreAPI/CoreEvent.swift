public struct LoadingProgress: Codable, Equatable, Sendable {
    public var step: LoadingStep
    public var message: String
}

public struct TreeChanged: Codable, Equatable, Sendable {
    public var tree: [TreeNode]?
    public var tagFilter: ColorTag?
    public var usedTags: [ColorTag]
    public var tagsWritable: Bool
    public var tagOptions: [TagOption]

    public init(
        tree: [TreeNode]?, tagFilter: ColorTag?, usedTags: [ColorTag], tagsWritable: Bool,
        tagOptions: [TagOption]
    ) {
        self.tree = tree
        self.tagFilter = tagFilter
        self.usedTags = usedTags
        self.tagsWritable = tagsWritable
        self.tagOptions = tagOptions
    }

    private enum CodingKeys: String, CodingKey {
        case tree, tagFilter, usedTags, tagsWritable, tagOptions
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        tree = try container.decodeIfPresent([TreeNode].self, forKey: .tree)
        tagFilter = try container.decodeIfPresent(ColorTag.self, forKey: .tagFilter)
        usedTags = try container.decode([ColorTag].self, forKey: .usedTags)
        tagsWritable = try container.decode(Bool.self, forKey: .tagsWritable)
        tagOptions = try container.decode([TagOption].self, forKey: .tagOptions)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(tree, forKey: .tree)
        try container.encode(tagFilter, forKey: .tagFilter)
        try container.encode(usedTags, forKey: .usedTags)
        try container.encode(tagsWritable, forKey: .tagsWritable)
        try container.encode(tagOptions, forKey: .tagOptions)
    }
}

public struct TrashChanged: Codable, Equatable, Sendable {
    public var entries: [TrashEntryView]
    public var deleteConfirmation: TrashConfirmationText
    public var emptyConfirmation: TrashConfirmationText

    public init(
        entries: [TrashEntryView], deleteConfirmation: TrashConfirmationText,
        emptyConfirmation: TrashConfirmationText
    ) {
        self.entries = entries
        self.deleteConfirmation = deleteConfirmation
        self.emptyConfirmation = emptyConfirmation
    }
}

public struct SearchStatusChanged: Codable, Equatable, Sendable {
    public var status: String?
    public var progress: Double?
    public var partial: Bool

    public init(status: String?, progress: Double?, partial: Bool) {
        self.status = status
        self.progress = progress
        self.partial = partial
    }

    private enum CodingKeys: String, CodingKey {
        case status, progress, partial
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        status = try container.decodeIfPresent(String.self, forKey: .status)
        progress = try container.decodeIfPresent(Double.self, forKey: .progress)
        partial = try container.decode(Bool.self, forKey: .partial)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(status, forKey: .status)
        try container.encode(progress, forKey: .progress)
        try container.encode(partial, forKey: .partial)
    }
}

public struct NoteChanged: Codable, Equatable, Sendable {
    public var note: OpenNote?
    public var edits: [RemoteTextEdit]?

    private enum CodingKeys: String, CodingKey {
        case note, edits
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        note = try container.decodeIfPresent(OpenNote.self, forKey: .note)
        edits = try container.decodeIfPresent([RemoteTextEdit].self, forKey: .edits)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(note, forKey: .note)
        try container.encode(edits, forKey: .edits)
    }
}

public struct RemoteNoteChange: Codable, Equatable, Sendable {
    public var change: RemoteChange
    public var message: String
}

public struct SyncStateChanged: Codable, Equatable, Sendable {
    public var online: Bool
    public var refreshing: Bool
    public var treeLoaded: Bool
    public var lastRefreshError: CoreError?
    public var state: SyncState
    public var label: String
    public var status: String?
    public var unsavedCount: Int
    public var canRetry: Bool
    public var unsavedMenu: [SyncStatusMenuItem]

    private enum CodingKeys: String, CodingKey {
        case online, refreshing, treeLoaded, lastRefreshError, state, label, status, unsavedCount,
            canRetry, unsavedMenu
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        online = try container.decode(Bool.self, forKey: .online)
        refreshing = try container.decode(Bool.self, forKey: .refreshing)
        treeLoaded = try container.decode(Bool.self, forKey: .treeLoaded)
        lastRefreshError = try container.decodeIfPresent(CoreError.self, forKey: .lastRefreshError)
        state = try container.decode(SyncState.self, forKey: .state)
        label = try container.decode(String.self, forKey: .label)
        status = try container.decodeIfPresent(String.self, forKey: .status)
        unsavedCount = try container.decode(Int.self, forKey: .unsavedCount)
        canRetry = try container.decode(Bool.self, forKey: .canRetry)
        unsavedMenu = try container.decode([SyncStatusMenuItem].self, forKey: .unsavedMenu)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(online, forKey: .online)
        try container.encode(refreshing, forKey: .refreshing)
        try container.encode(treeLoaded, forKey: .treeLoaded)
        try container.encode(lastRefreshError, forKey: .lastRefreshError)
        try container.encode(state, forKey: .state)
        try container.encode(label, forKey: .label)
        try container.encode(status, forKey: .status)
        try container.encode(unsavedCount, forKey: .unsavedCount)
        try container.encode(canRetry, forKey: .canRetry)
        try container.encode(unsavedMenu, forKey: .unsavedMenu)
    }
}

public struct Notice: Codable, Equatable, Sendable {
    public var id: String
    public var tone: NoticeTone
    public var message: String
    public var persistent: Bool
    public var action: NoticeAction?

    private enum CodingKeys: String, CodingKey {
        case id, tone, message, persistent, action
    }

    public init(
        id: String, tone: NoticeTone, message: String, persistent: Bool, action: NoticeAction?
    ) {
        self.id = id
        self.tone = tone
        self.message = message
        self.persistent = persistent
        self.action = action
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        tone = try container.decode(NoticeTone.self, forKey: .tone)
        message = try container.decode(String.self, forKey: .message)
        persistent = try container.decode(Bool.self, forKey: .persistent)
        action = try container.decodeIfPresent(NoticeAction.self, forKey: .action)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(tone, forKey: .tone)
        try container.encode(message, forKey: .message)
        try container.encode(persistent, forKey: .persistent)
        try container.encode(action, forKey: .action)
    }
}

public struct NoticeCleared: Codable, Equatable, Sendable {
    public var id: String
}

public struct KeyChanged: Codable, Equatable, Sendable {
    public var unsavedCount: Int
    public var message: String
    public var detail: String
    public var exportLabel: String
}

public enum SessionEndReason: String, Codable, Equatable, Sendable {
    case loggedOut
}

public struct SessionEnded: Codable, Equatable, Sendable {
    public var reason: SessionEndReason
}

public enum CoreEvent: Decodable, Equatable, Sendable {
    case loadingProgress(LoadingProgress)
    case treeChanged(TreeChanged)
    case trashChanged(TrashChanged)
    case searchStatusChanged(SearchStatusChanged)
    case noteChanged(NoteChanged)
    case noteContentChangedRemotely(RemoteNoteChange)
    case syncStateChanged(SyncStateChanged)
    case notice(Notice)
    case noticeCleared(NoticeCleared)
    case keyChanged(KeyChanged)
    case sessionEnded(SessionEnded)
    case unknown(name: String)

    public static let knownNames: [String] = [
        "loadingProgress", "treeChanged", "trashChanged", "searchStatusChanged", "noteChanged",
        "noteContentChangedRemotely", "syncStateChanged", "notice", "noticeCleared", "keyChanged",
        "sessionEnded",
    ]

    public var name: String {
        switch self {
        case .loadingProgress: "loadingProgress"
        case .treeChanged: "treeChanged"
        case .trashChanged: "trashChanged"
        case .searchStatusChanged: "searchStatusChanged"
        case .noteChanged: "noteChanged"
        case .noteContentChangedRemotely: "noteContentChangedRemotely"
        case .syncStateChanged: "syncStateChanged"
        case .notice: "notice"
        case .noticeCleared: "noticeCleared"
        case .keyChanged: "keyChanged"
        case .sessionEnded: "sessionEnded"
        case .unknown(let name): name
        }
    }

    private enum CodingKeys: String, CodingKey {
        case event, payload
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let name = try container.decode(String.self, forKey: .event)
        switch name {
        case "loadingProgress":
            self = .loadingProgress(try container.decode(LoadingProgress.self, forKey: .payload))
        case "treeChanged":
            self = .treeChanged(try container.decode(TreeChanged.self, forKey: .payload))
        case "trashChanged":
            self = .trashChanged(try container.decode(TrashChanged.self, forKey: .payload))
        case "searchStatusChanged":
            self = .searchStatusChanged(
                try container.decode(SearchStatusChanged.self, forKey: .payload))
        case "noteChanged":
            self = .noteChanged(try container.decode(NoteChanged.self, forKey: .payload))
        case "noteContentChangedRemotely":
            self = .noteContentChangedRemotely(
                try container.decode(RemoteNoteChange.self, forKey: .payload))
        case "syncStateChanged":
            self = .syncStateChanged(try container.decode(SyncStateChanged.self, forKey: .payload))
        case "notice":
            self = .notice(try container.decode(Notice.self, forKey: .payload))
        case "noticeCleared":
            self = .noticeCleared(try container.decode(NoticeCleared.self, forKey: .payload))
        case "keyChanged":
            self = .keyChanged(try container.decode(KeyChanged.self, forKey: .payload))
        case "sessionEnded":
            self = .sessionEnded(try container.decode(SessionEnded.self, forKey: .payload))
        default:
            self = .unknown(name: name)
        }
    }
}
