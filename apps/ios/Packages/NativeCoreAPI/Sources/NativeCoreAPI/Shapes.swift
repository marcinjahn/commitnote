public enum ForgeID: String, Codable, Equatable, Sendable {
    case github
    case gitlab
}

public indirect enum TreeNode: Codable, Equatable, Sendable {
    case folder(name: String, path: [String], noteCount: Int, children: [TreeNode])
    case note(name: String, path: [String])

    private enum CodingKeys: String, CodingKey {
        case kind, name, path, noteCount, children
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
            self = .note(name: name, path: path)
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
        case .note(let name, let path):
            try container.encode("note", forKey: .kind)
            try container.encode(name, forKey: .name)
            try container.encode(path, forKey: .path)
        }
    }
}

public enum OpenNote: Codable, Equatable, Sendable {
    case loading(path: [String])
    case loaded(path: [String], content: String)
    case missing(path: [String], message: String)
    case trashed(path: [String], message: String)
    case failed(path: [String], message: String, error: CoreError)

    private enum CodingKeys: String, CodingKey {
        case state, path, content, message, error
    }

    public var path: [String] {
        switch self {
        case .loading(let path), .loaded(let path, _), .missing(let path, _),
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
            self = .loaded(path: path, content: try container.decode(String.self, forKey: .content))
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
        case .loaded(let path, let content):
            try container.encode("loaded", forKey: .state)
            try container.encode(path, forKey: .path)
            try container.encode(content, forKey: .content)
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
