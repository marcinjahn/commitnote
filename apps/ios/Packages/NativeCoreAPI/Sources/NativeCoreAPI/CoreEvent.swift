public struct LoadingProgress: Codable, Equatable, Sendable {
    public var step: LoadingStep
    public var message: String
}

public struct TreeChanged: Codable, Equatable, Sendable {
    public var tree: [TreeNode]?

    private enum CodingKeys: String, CodingKey {
        case tree
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        tree = try container.decodeIfPresent([TreeNode].self, forKey: .tree)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(tree, forKey: .tree)
    }
}

public struct NoteChanged: Codable, Equatable, Sendable {
    public var note: OpenNote?

    private enum CodingKeys: String, CodingKey {
        case note
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        note = try container.decodeIfPresent(OpenNote.self, forKey: .note)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(note, forKey: .note)
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

    private enum CodingKeys: String, CodingKey {
        case online, refreshing, treeLoaded, lastRefreshError
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        online = try container.decode(Bool.self, forKey: .online)
        refreshing = try container.decode(Bool.self, forKey: .refreshing)
        treeLoaded = try container.decode(Bool.self, forKey: .treeLoaded)
        lastRefreshError = try container.decodeIfPresent(CoreError.self, forKey: .lastRefreshError)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(online, forKey: .online)
        try container.encode(refreshing, forKey: .refreshing)
        try container.encode(treeLoaded, forKey: .treeLoaded)
        try container.encode(lastRefreshError, forKey: .lastRefreshError)
    }
}

public struct Notice: Codable, Equatable, Sendable {
    public var id: String
    public var tone: NoticeTone
    public var message: String
    public var persistent: Bool
}

public struct NoticeCleared: Codable, Equatable, Sendable {
    public var id: String
}

public struct KeyChanged: Codable, Equatable, Sendable {
    public var unsavedCount: Int
    public var message: String
    public var detail: String
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
    case noteChanged(NoteChanged)
    case noteContentChangedRemotely(RemoteNoteChange)
    case syncStateChanged(SyncStateChanged)
    case notice(Notice)
    case noticeCleared(NoticeCleared)
    case keyChanged(KeyChanged)
    case sessionEnded(SessionEnded)
    case unknown(name: String)

    public static let knownNames: [String] = [
        "loadingProgress", "treeChanged", "noteChanged", "noteContentChangedRemotely",
        "syncStateChanged", "notice", "noticeCleared", "keyChanged", "sessionEnded",
    ]

    public var name: String {
        switch self {
        case .loadingProgress: "loadingProgress"
        case .treeChanged: "treeChanged"
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
