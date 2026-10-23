public enum MessagePart: Codable, Equatable, Sendable {
    case text(String)
    case link(text: String, href: String)

    private enum CodingKeys: String, CodingKey {
        case kind, text, href
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let text = try container.decode(String.self, forKey: .text)
        switch try container.decode(String.self, forKey: .kind) {
        case "text":
            self = .text(text)
        case "link":
            self = .link(text: text, href: try container.decode(String.self, forKey: .href))
        case let other:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: container, debugDescription: "Unknown message part kind \(other)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .text(let text):
            try container.encode("text", forKey: .kind)
            try container.encode(text, forKey: .text)
        case .link(let text, let href):
            try container.encode("link", forKey: .kind)
            try container.encode(text, forKey: .text)
            try container.encode(href, forKey: .href)
        }
    }
}

public enum HistoryPhase: String, Codable, Equatable, Sendable {
    case saving
    case unsaved
    case ready
}

public struct HistoryVersionView: Codable, Equatable, Sendable, Identifiable {
    public var sha: String
    public var time: String
    public var dateTime: String
    public var current: Bool
    public var shared: Bool
    public var events: [String]
    public var name: String?

    public var id: String { sha }

    public init(
        sha: String, time: String, dateTime: String, current: Bool, shared: Bool, events: [String],
        name: String?
    ) {
        self.sha = sha
        self.time = time
        self.dateTime = dateTime
        self.current = current
        self.shared = shared
        self.events = events
        self.name = name
    }

    private enum CodingKeys: String, CodingKey {
        case sha, time, dateTime, current, shared, events, name
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        sha = try container.decode(String.self, forKey: .sha)
        time = try container.decode(String.self, forKey: .time)
        dateTime = try container.decode(String.self, forKey: .dateTime)
        current = try container.decode(Bool.self, forKey: .current)
        shared = try container.decode(Bool.self, forKey: .shared)
        events = try container.decode([String].self, forKey: .events)
        name = try container.decodeIfPresent(String.self, forKey: .name)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sha, forKey: .sha)
        try container.encode(time, forKey: .time)
        try container.encode(dateTime, forKey: .dateTime)
        try container.encode(current, forKey: .current)
        try container.encode(shared, forKey: .shared)
        try container.encode(events, forKey: .events)
        try container.encode(name, forKey: .name)
    }
}

public enum HistoryRow: Codable, Equatable, Sendable {
    case single(HistoryVersionView)
    case session(title: String, shared: Bool, versions: [HistoryVersionView])

    private enum CodingKeys: String, CodingKey {
        case kind, version, title, shared, versions
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .kind) {
        case "single":
            self = .single(try container.decode(HistoryVersionView.self, forKey: .version))
        case "session":
            self = .session(
                title: try container.decode(String.self, forKey: .title),
                shared: try container.decode(Bool.self, forKey: .shared),
                versions: try container.decode([HistoryVersionView].self, forKey: .versions))
        case let other:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: container, debugDescription: "Unknown history row kind \(other)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .single(let version):
            try container.encode("single", forKey: .kind)
            try container.encode(version, forKey: .version)
        case .session(let title, let shared, let versions):
            try container.encode("session", forKey: .kind)
            try container.encode(title, forKey: .title)
            try container.encode(shared, forKey: .shared)
            try container.encode(versions, forKey: .versions)
        }
    }
}

public struct HistorySection: Codable, Equatable, Sendable, Identifiable {
    public var title: String
    public var rows: [HistoryRow]

    public var id: String { title }

    public init(title: String, rows: [HistoryRow]) {
        self.title = title
        self.rows = rows
    }
}

public struct HistoryView: Codable, Equatable, Sendable {
    public var path: [String]
    public var phase: HistoryPhase
    public var message: String?
    public var sections: [HistorySection]
    public var loading: Bool
    public var error: String?
    public var end: String?
    public var canLoadMore: Bool

    public init(
        path: [String], phase: HistoryPhase, message: String?, sections: [HistorySection],
        loading: Bool, error: String?, end: String?, canLoadMore: Bool
    ) {
        self.path = path
        self.phase = phase
        self.message = message
        self.sections = sections
        self.loading = loading
        self.error = error
        self.end = end
        self.canLoadMore = canLoadMore
    }

    private enum CodingKeys: String, CodingKey {
        case path, phase, message, sections, loading, error, end, canLoadMore
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        path = try container.decode([String].self, forKey: .path)
        phase = try container.decode(HistoryPhase.self, forKey: .phase)
        message = try container.decodeIfPresent(String.self, forKey: .message)
        sections = try container.decode([HistorySection].self, forKey: .sections)
        loading = try container.decode(Bool.self, forKey: .loading)
        error = try container.decodeIfPresent(String.self, forKey: .error)
        end = try container.decodeIfPresent(String.self, forKey: .end)
        canLoadMore = try container.decode(Bool.self, forKey: .canLoadMore)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(path, forKey: .path)
        try container.encode(phase, forKey: .phase)
        try container.encode(message, forKey: .message)
        try container.encode(sections, forKey: .sections)
        try container.encode(loading, forKey: .loading)
        try container.encode(error, forKey: .error)
        try container.encode(end, forKey: .end)
        try container.encode(canLoadMore, forKey: .canLoadMore)
    }
}

public struct HistoryChanged: Codable, Equatable, Sendable {
    public var history: HistoryView?

    public init(history: HistoryView?) {
        self.history = history
    }

    private enum CodingKeys: String, CodingKey {
        case history
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        history = try container.decodeIfPresent(HistoryView.self, forKey: .history)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(history, forKey: .history)
    }
}

public struct DiffSegment: Codable, Equatable, Sendable {
    public var text: String
    public var changed: Bool

    public init(text: String, changed: Bool) {
        self.text = text
        self.changed = changed
    }
}

public enum DiffLineView: Codable, Equatable, Sendable {
    case same(text: String)
    case added(segments: [DiffSegment])
    case removed(segments: [DiffSegment])

    private enum CodingKeys: String, CodingKey {
        case kind, text, segments
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .kind) {
        case "same":
            self = .same(text: try container.decode(String.self, forKey: .text))
        case "added":
            self = .added(segments: try container.decode([DiffSegment].self, forKey: .segments))
        case "removed":
            self = .removed(segments: try container.decode([DiffSegment].self, forKey: .segments))
        case let other:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: container, debugDescription: "Unknown diff line kind \(other)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .same(let text):
            try container.encode("same", forKey: .kind)
            try container.encode(text, forKey: .text)
        case .added(let segments):
            try container.encode("added", forKey: .kind)
            try container.encode(segments, forKey: .segments)
        case .removed(let segments):
            try container.encode("removed", forKey: .kind)
            try container.encode(segments, forKey: .segments)
        }
    }
}

public enum DiffItemView: Codable, Equatable, Sendable {
    case line(DiffLineView)
    case fold(label: String, lines: [DiffLineView])

    private enum CodingKeys: String, CodingKey {
        case kind, line, label, lines
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .kind) {
        case "line":
            self = .line(try container.decode(DiffLineView.self, forKey: .line))
        case "fold":
            self = .fold(
                label: try container.decode(String.self, forKey: .label),
                lines: try container.decode([DiffLineView].self, forKey: .lines))
        case let other:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: container, debugDescription: "Unknown diff item kind \(other)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .line(let line):
            try container.encode("line", forKey: .kind)
            try container.encode(line, forKey: .line)
        case .fold(let label, let lines):
            try container.encode("fold", forKey: .kind)
            try container.encode(label, forKey: .label)
            try container.encode(lines, forKey: .lines)
        }
    }
}

public enum PreviewBody: Codable, Equatable, Sendable {
    case tooLarge(message: String)
    case unchanged(message: String)
    case diff(items: [DiffItemView], finalNewline: String?)

    private enum CodingKeys: String, CodingKey {
        case kind, message, items, finalNewline
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .kind) {
        case "tooLarge":
            self = .tooLarge(message: try container.decode(String.self, forKey: .message))
        case "unchanged":
            self = .unchanged(message: try container.decode(String.self, forKey: .message))
        case "diff":
            self = .diff(
                items: try container.decode([DiffItemView].self, forKey: .items),
                finalNewline: try container.decodeIfPresent(String.self, forKey: .finalNewline))
        case let other:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: container, debugDescription: "Unknown preview body kind \(other)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .tooLarge(let message):
            try container.encode("tooLarge", forKey: .kind)
            try container.encode(message, forKey: .message)
        case .unchanged(let message):
            try container.encode("unchanged", forKey: .kind)
            try container.encode(message, forKey: .message)
        case .diff(let items, let finalNewline):
            try container.encode("diff", forKey: .kind)
            try container.encode(items, forKey: .items)
            try container.encode(finalNewline, forKey: .finalNewline)
        }
    }
}

public struct RestoreAvailability: Codable, Equatable, Sendable {
    public var label: String
    public var enabled: Bool
    public var reason: String?

    public init(label: String, enabled: Bool, reason: String?) {
        self.label = label
        self.enabled = enabled
        self.reason = reason
    }

    private enum CodingKeys: String, CodingKey {
        case label, enabled, reason
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        label = try container.decode(String.self, forKey: .label)
        enabled = try container.decode(Bool.self, forKey: .enabled)
        reason = try container.decodeIfPresent(String.self, forKey: .reason)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(label, forKey: .label)
        try container.encode(enabled, forKey: .enabled)
        try container.encode(reason, forKey: .reason)
    }
}

public enum VersionPreview: Codable, Equatable, Sendable {
    case failed(message: String)
    case undecryptable(message: String)
    case closed(message: String)
    case version(
        titleChange: String?, body: PreviewBody, restoreTitle: String?, restore: RestoreAvailability)

    private enum CodingKeys: String, CodingKey {
        case kind, message, titleChange, body, restoreTitle, restore
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .kind) {
        case "failed":
            self = .failed(message: try container.decode(String.self, forKey: .message))
        case "undecryptable":
            self = .undecryptable(message: try container.decode(String.self, forKey: .message))
        case "closed":
            self = .closed(message: try container.decode(String.self, forKey: .message))
        case "version":
            self = .version(
                titleChange: try container.decodeIfPresent(String.self, forKey: .titleChange),
                body: try container.decode(PreviewBody.self, forKey: .body),
                restoreTitle: try container.decodeIfPresent(String.self, forKey: .restoreTitle),
                restore: try container.decode(RestoreAvailability.self, forKey: .restore))
        case let other:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: container, debugDescription: "Unknown version preview kind \(other)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .failed(let message):
            try container.encode("failed", forKey: .kind)
            try container.encode(message, forKey: .message)
        case .undecryptable(let message):
            try container.encode("undecryptable", forKey: .kind)
            try container.encode(message, forKey: .message)
        case .closed(let message):
            try container.encode("closed", forKey: .kind)
            try container.encode(message, forKey: .message)
        case .version(let titleChange, let body, let restoreTitle, let restore):
            try container.encode("version", forKey: .kind)
            try container.encode(titleChange, forKey: .titleChange)
            try container.encode(body, forKey: .body)
            try container.encode(restoreTitle, forKey: .restoreTitle)
            try container.encode(restore, forKey: .restore)
        }
    }
}

public enum HistoryRestoreOutcome: Codable, Equatable, Sendable {
    case restored
    case blocked(message: String)
    case error(message: String)
    case closed

    private enum CodingKeys: String, CodingKey {
        case kind, message
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .kind) {
        case "restored":
            self = .restored
        case "blocked":
            self = .blocked(message: try container.decode(String.self, forKey: .message))
        case "error":
            self = .error(message: try container.decode(String.self, forKey: .message))
        case "closed":
            self = .closed
        case let other:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: container, debugDescription: "Unknown restore outcome kind \(other)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .restored:
            try container.encode("restored", forKey: .kind)
        case .blocked(let message):
            try container.encode("blocked", forKey: .kind)
            try container.encode(message, forKey: .message)
        case .error(let message):
            try container.encode("error", forKey: .kind)
            try container.encode(message, forKey: .message)
        case .closed:
            try container.encode("closed", forKey: .kind)
        }
    }
}
