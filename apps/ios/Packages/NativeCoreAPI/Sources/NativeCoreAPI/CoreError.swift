public struct CoreError: Error, Codable, Equatable, Sendable {
    public var kind: String
    public var message: String
    public var transient: Bool
    public var retryAfterMs: Int?
    public var formatVersion: Int?

    public init(
        kind: String,
        message: String,
        transient: Bool,
        retryAfterMs: Int? = nil,
        formatVersion: Int? = nil
    ) {
        self.kind = kind
        self.message = message
        self.transient = transient
        self.retryAfterMs = retryAfterMs
        self.formatVersion = formatVersion
    }
}

extension CoreError {
    public enum Kind {
        public static let unauthorized = "unauthorized"
        public static let noAccess = "noAccess"
        public static let forbidden = "forbidden"
        public static let notFound = "notFound"
        public static let rateLimited = "rateLimited"
        public static let network = "network"
        public static let server = "server"
        public static let readOnly = "readOnly"
        public static let foreign = "foreign"
        public static let noMainBranch = "noMainBranch"
        public static let newerFormat = "newerFormat"
        public static let wrongPassphrase = "wrongPassphrase"
        public static let initializationRaced = "initializationRaced"
        public static let repositoryChanged = "repositoryChanged"
        public static let treeTruncated = "treeTruncated"
        public static let undecryptable = "undecryptable"
        public static let keyChanged = "keyChanged"
        public static let unknownCommand = "unknownCommand"
        public static let invalidParams = "invalidParams"
        public static let notReady = "notReady"
        public static let `internal` = "internal"
    }
}
