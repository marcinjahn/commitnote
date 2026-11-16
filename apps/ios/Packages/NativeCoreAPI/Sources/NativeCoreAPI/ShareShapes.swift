public enum ShareActionID: String, Codable, Equatable, Sendable {
    case copyLink = "copy-link"
    case copyPassword = "copy-password"
    case update
    case view
    case open
    case rename
    case revoke
}

public struct ShareActionView: Codable, Equatable, Sendable, Identifiable {
    public var id: ShareActionID
    public var label: String
    public var disabled: Bool
    public var destructive: Bool

    public init(id: ShareActionID, label: String, disabled: Bool, destructive: Bool) {
        self.id = id
        self.label = label
        self.disabled = disabled
        self.destructive = destructive
    }
}

public struct ShareRowView: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var title: String
    public var label: String?
    public var date: String
    public var passwordProtected: Bool
    public var link: String
    public var password: String?
    public var notePath: [String]?
    public var menuLabel: String
    public var actions: [ShareActionView]

    public init(
        id: String, title: String, label: String?, date: String, passwordProtected: Bool,
        link: String, password: String?, notePath: [String]?, menuLabel: String,
        actions: [ShareActionView]
    ) {
        self.id = id
        self.title = title
        self.label = label
        self.date = date
        self.passwordProtected = passwordProtected
        self.link = link
        self.password = password
        self.notePath = notePath
        self.menuLabel = menuLabel
        self.actions = actions
    }

    private enum CodingKeys: String, CodingKey {
        case id, title, label, date, passwordProtected, link, password, notePath, menuLabel, actions
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decode(String.self, forKey: .title)
        label = try container.decodeIfPresent(String.self, forKey: .label)
        date = try container.decode(String.self, forKey: .date)
        passwordProtected = try container.decode(Bool.self, forKey: .passwordProtected)
        link = try container.decode(String.self, forKey: .link)
        password = try container.decodeIfPresent(String.self, forKey: .password)
        notePath = try container.decodeIfPresent([String].self, forKey: .notePath)
        menuLabel = try container.decode(String.self, forKey: .menuLabel)
        actions = try container.decode([ShareActionView].self, forKey: .actions)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(title, forKey: .title)
        try container.encode(label, forKey: .label)
        try container.encode(date, forKey: .date)
        try container.encode(passwordProtected, forKey: .passwordProtected)
        try container.encode(link, forKey: .link)
        try container.encode(password, forKey: .password)
        try container.encode(notePath, forKey: .notePath)
        try container.encode(menuLabel, forKey: .menuLabel)
        try container.encode(actions, forKey: .actions)
    }
}

public struct ShareCopy: Codable, Equatable, Sendable {
    public struct RevokeCopy: Codable, Equatable, Sendable {
        public var title: String
        public var message: String
        public var confirmLabel: String

        public init(title: String, message: String, confirmLabel: String) {
            self.title = title
            self.message = message
            self.confirmLabel = confirmLabel
        }
    }

    public struct RenameCopy: Codable, Equatable, Sendable {
        public var title: String
        public var fieldLabel: String
        public var confirmLabel: String

        public init(title: String, fieldLabel: String, confirmLabel: String) {
            self.title = title
            self.fieldLabel = fieldLabel
            self.confirmLabel = confirmLabel
        }
    }

    public var explanation: String
    public var labelField: String
    public var passwordField: String
    public var passwordHint: String
    public var create: String
    public var creating: String
    public var createAnother: String
    public var shareLink: String
    public var sharePassword: String
    public var sharedLinksTitle: String
    public var sharedLinksEmpty: String
    public var passwordProtected: String
    public var updating: String
    public var linkCopied: String
    public var passwordCopied: String
    public var revoke: RevokeCopy
    public var rename: RenameCopy
    public var sharedVersionTitle: String
    public var loadingSharedVersion: String

    public init(
        explanation: String, labelField: String, passwordField: String, passwordHint: String,
        create: String, creating: String, createAnother: String, shareLink: String,
        sharePassword: String, sharedLinksTitle: String, sharedLinksEmpty: String,
        passwordProtected: String, updating: String, linkCopied: String, passwordCopied: String,
        revoke: RevokeCopy, rename: RenameCopy, sharedVersionTitle: String,
        loadingSharedVersion: String
    ) {
        self.explanation = explanation
        self.labelField = labelField
        self.passwordField = passwordField
        self.passwordHint = passwordHint
        self.create = create
        self.creating = creating
        self.createAnother = createAnother
        self.shareLink = shareLink
        self.sharePassword = sharePassword
        self.sharedLinksTitle = sharedLinksTitle
        self.sharedLinksEmpty = sharedLinksEmpty
        self.passwordProtected = passwordProtected
        self.updating = updating
        self.linkCopied = linkCopied
        self.passwordCopied = passwordCopied
        self.revoke = revoke
        self.rename = rename
        self.sharedVersionTitle = sharedVersionTitle
        self.loadingSharedVersion = loadingSharedVersion
    }
}

public struct SharesChanged: Codable, Equatable, Sendable {
    public var shares: [ShareRowView]
    public var unreadable: String?
    public var updatingId: String?
    public var copy: ShareCopy

    public init(
        shares: [ShareRowView], unreadable: String?, updatingId: String?, copy: ShareCopy
    ) {
        self.shares = shares
        self.unreadable = unreadable
        self.updatingId = updatingId
        self.copy = copy
    }

    private enum CodingKeys: String, CodingKey {
        case shares, unreadable, updatingId, copy
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        shares = try container.decode([ShareRowView].self, forKey: .shares)
        unreadable = try container.decodeIfPresent(String.self, forKey: .unreadable)
        updatingId = try container.decodeIfPresent(String.self, forKey: .updatingId)
        copy = try container.decode(ShareCopy.self, forKey: .copy)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(shares, forKey: .shares)
        try container.encode(unreadable, forKey: .unreadable)
        try container.encode(updatingId, forKey: .updatingId)
        try container.encode(copy, forKey: .copy)
    }
}

public enum ShareCreateOutcome: Codable, Equatable, Sendable {
    case created(link: String, password: String?)
    case error(parts: [MessagePart])

    private enum CodingKeys: String, CodingKey {
        case kind, link, password, parts
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .kind) {
        case "created":
            self = .created(
                link: try container.decode(String.self, forKey: .link),
                password: try container.decodeIfPresent(String.self, forKey: .password))
        case "error":
            self = .error(parts: try container.decode([MessagePart].self, forKey: .parts))
        case let other:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: container, debugDescription: "Unknown share create outcome \(other)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .created(let link, let password):
            try container.encode("created", forKey: .kind)
            try container.encode(link, forKey: .link)
            try container.encode(password, forKey: .password)
        case .error(let parts):
            try container.encode("error", forKey: .kind)
            try container.encode(parts, forKey: .parts)
        }
    }
}

public enum ShareRenameOutcome: Codable, Equatable, Sendable {
    case ok
    case error(message: String)

    private enum CodingKeys: String, CodingKey {
        case kind, message
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .kind) {
        case "ok":
            self = .ok
        case "error":
            self = .error(message: try container.decode(String.self, forKey: .message))
        case let other:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: container, debugDescription: "Unknown share rename outcome \(other)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .ok:
            try container.encode("ok", forKey: .kind)
        case .error(let message):
            try container.encode("error", forKey: .kind)
            try container.encode(message, forKey: .message)
        }
    }
}

public enum SharedVersionOutcome: Codable, Equatable, Sendable {
    case readable(name: String?, content: String, date: String)
    case message(String)
    case failed(message: String)

    private enum CodingKeys: String, CodingKey {
        case kind, name, content, date, message
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .kind) {
        case "readable":
            self = .readable(
                name: try container.decodeIfPresent(String.self, forKey: .name),
                content: try container.decode(String.self, forKey: .content),
                date: try container.decode(String.self, forKey: .date))
        case "message":
            self = .message(try container.decode(String.self, forKey: .message))
        case "failed":
            self = .failed(message: try container.decode(String.self, forKey: .message))
        case let other:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: container, debugDescription: "Unknown shared version outcome \(other)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .readable(let name, let content, let date):
            try container.encode("readable", forKey: .kind)
            try container.encode(name, forKey: .name)
            try container.encode(content, forKey: .content)
            try container.encode(date, forKey: .date)
        case .message(let message):
            try container.encode("message", forKey: .kind)
            try container.encode(message, forKey: .message)
        case .failed(let message):
            try container.encode("failed", forKey: .kind)
            try container.encode(message, forKey: .message)
        }
    }
}
