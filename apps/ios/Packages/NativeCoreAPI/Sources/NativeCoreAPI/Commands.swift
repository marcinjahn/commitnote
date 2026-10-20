public enum NativeCoreAPIVersion {
    public static let current = 2
}

public protocol NativeCoreCommand: Encodable, Sendable {
    associatedtype Result: Decodable & Sendable
    static var name: String { get }
}

public struct ForgesList: NativeCoreCommand {
    public static let name = "forges.list"
    public struct Result: Codable, Equatable, Sendable {
        public var forges: [ForgeView]
    }
    public init() {}
}

public struct LoginLastRepository: NativeCoreCommand {
    public static let name = "login.lastRepository"
    public struct Result: Codable, Equatable, Sendable {
        public var repoUrl: String?
        public var forge: ForgeID?

        public init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            repoUrl = try container.decodeIfPresent(String.self, forKey: .repoUrl)
            forge = try container.decodeIfPresent(ForgeID.self, forKey: .forge)
        }

        private enum CodingKeys: String, CodingKey {
            case repoUrl, forge
        }

        public func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(repoUrl, forKey: .repoUrl)
            try container.encode(forge, forKey: .forge)
        }
    }
    public init() {}
}

public struct LoginListRepositories: NativeCoreCommand {
    public static let name = "login.listRepositories"
    public struct Result: Codable, Equatable, Sendable {
        public var repositories: [RepositoryListing]
    }
    public var forge: ForgeID
    public var accessToken: String
    public init(forge: ForgeID, accessToken: String) {
        self.forge = forge
        self.accessToken = accessToken
    }
}

public struct LoginInspectRepository: NativeCoreCommand {
    public static let name = "login.inspectRepository"
    public typealias Result = InspectionResult
    public var forge: ForgeID
    public var accessToken: String
    public var repositoryUrl: String
    public init(forge: ForgeID, accessToken: String, repositoryUrl: String) {
        self.forge = forge
        self.accessToken = accessToken
        self.repositoryUrl = repositoryUrl
    }
}

public struct LoginUnlock: NativeCoreCommand {
    public static let name = "login.unlock"
    public typealias Result = LoggedIn
    public var passphrase: String
    public init(passphrase: String) { self.passphrase = passphrase }
}

public struct LoginInitialize: NativeCoreCommand {
    public static let name = "login.initialize"
    public typealias Result = LoggedIn
    public var passphrase: String
    public init(passphrase: String) { self.passphrase = passphrase }
}

public struct PassphraseStrengthCheck: NativeCoreCommand {
    public static let name = "passphrase.strength"
    public typealias Result = PassphraseStrength
    public var passphrase: String
    public var repositoryLabel: String
    public init(passphrase: String, repositoryLabel: String) {
        self.passphrase = passphrase
        self.repositoryLabel = repositoryLabel
    }
}

public struct SessionResume: NativeCoreCommand {
    public static let name = "session.resume"
    public typealias Result = ResumeResult
    public init() {}
}

public struct SessionLogout: NativeCoreCommand {
    public static let name = "session.logout"
    public struct Result: Codable, Equatable, Sendable {
        public var outcome: LogoutOutcome
    }
    public var anyway: Bool
    public init(anyway: Bool) { self.anyway = anyway }
}

public struct TreeGet: NativeCoreCommand {
    public static let name = "tree.get"
    public struct Result: Codable, Equatable, Sendable {
        public var tree: [TreeNode]?

        public init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            tree = try container.decodeIfPresent([TreeNode].self, forKey: .tree)
        }

        private enum CodingKeys: String, CodingKey {
            case tree
        }

        public func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(tree, forKey: .tree)
        }
    }
    public init() {}
}

public struct NoteOpen: NativeCoreCommand {
    public static let name = "note.open"
    public struct Result: Codable, Equatable, Sendable {
        public var note: OpenNote?

        public init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            note = try container.decodeIfPresent(OpenNote.self, forKey: .note)
        }

        private enum CodingKeys: String, CodingKey {
            case note
        }

        public func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(note, forKey: .note)
        }
    }
    public var path: [String]?
    public init(path: [String]?) { self.path = path }

    private enum CodingKeys: String, CodingKey {
        case path
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(path, forKey: .path)
    }
}

public struct SyncRefresh: NativeCoreCommand {
    public static let name = "sync.refresh"
    public typealias Result = Empty
    public init() {}
}

public struct NoteEdit: NativeCoreCommand {
    public static let name = "note.edit"
    public typealias Result = Empty
    public var path: [String]
    public var text: String
    public init(path: [String], text: String) {
        self.path = path
        self.text = text
    }
}

public struct SyncFlush: NativeCoreCommand {
    public static let name = "sync.flush"
    public struct Result: Codable, Equatable, Sendable {
        public var result: FlushOutcome
    }
    public init() {}
}

public struct SyncRetry: NativeCoreCommand {
    public static let name = "sync.retry"
    public typealias Result = Empty
    public init() {}
}

public struct ConflictResolve: NativeCoreCommand {
    public static let name = "conflict.resolve"
    public typealias Result = Empty
    public var path: [String]
    public var resolution: ConflictResolution
    public init(path: [String], resolution: ConflictResolution) {
        self.path = path
        self.resolution = resolution
    }
}

public struct DraftStart: NativeCoreCommand {
    public static let name = "draft.start"
    public struct Result: Codable, Equatable, Sendable {
        public var draft: NoteDraft
    }
    public var parent: [String]
    public init(parent: [String]) { self.parent = parent }
}

public struct DraftCommitName: NativeCoreCommand {
    public static let name = "draft.commitName"
    public struct Result: Codable, Equatable, Sendable {
        public var outcome: NoteDraftOutcome
    }
    public var name: String
    public init(name: String) { self.name = name }
}

public struct DraftContent: NativeCoreCommand {
    public static let name = "draft.content"
    public struct Result: Codable, Equatable, Sendable {
        public var outcome: NoteDraftOutcome
    }
    public var name: String
    public var content: String
    public init(name: String, content: String) {
        self.name = name
        self.content = content
    }
}

public struct DraftLeave: NativeCoreCommand {
    public static let name = "draft.leave"
    public typealias Result = Empty
    public init() {}
}

public struct FolderCreate: NativeCoreCommand {
    public static let name = "folder.create"
    public struct Result: Codable, Equatable, Sendable {
        public var outcome: FolderCreateOutcome
    }
    public var parent: [String]
    public var name: String
    public init(parent: [String], name: String) {
        self.parent = parent
        self.name = name
    }
}

public struct ExportNotes: NativeCoreCommand {
    public static let name = "export.notes"
    public typealias Result = ExportedArchive
    public init() {}
}

public struct LifecycleSetVisible: NativeCoreCommand {
    public static let name = "lifecycle.setVisible"
    public typealias Result = Empty
    public var visible: Bool
    public init(visible: Bool) { self.visible = visible }
}

public struct LifecycleSetOnline: NativeCoreCommand {
    public static let name = "lifecycle.setOnline"
    public typealias Result = Empty
    public var online: Bool
    public init(online: Bool) { self.online = online }
}

public struct DeviceName: NativeCoreCommand {
    public static let name = "device.name"
    public struct Result: Codable, Equatable, Sendable {
        public var name: String
    }
    public init() {}
}

public struct NoticesDismiss: NativeCoreCommand {
    public static let name = "notices.dismiss"
    public typealias Result = Empty
    public var id: String
    public init(id: String) { self.id = id }
}

public enum NativeCoreCommands {
    public static let names: [String] = [
        ForgesList.name,
        LoginLastRepository.name,
        LoginListRepositories.name,
        LoginInspectRepository.name,
        LoginUnlock.name,
        LoginInitialize.name,
        PassphraseStrengthCheck.name,
        SessionResume.name,
        SessionLogout.name,
        TreeGet.name,
        NoteOpen.name,
        SyncRefresh.name,
        NoteEdit.name,
        SyncFlush.name,
        SyncRetry.name,
        ConflictResolve.name,
        ExportNotes.name,
        DraftStart.name,
        DraftCommitName.name,
        DraftContent.name,
        DraftLeave.name,
        FolderCreate.name,
        LifecycleSetVisible.name,
        LifecycleSetOnline.name,
        DeviceName.name,
        NoticesDismiss.name,
    ]
}
