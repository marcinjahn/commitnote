public enum NativeCoreAPIVersion {
    public static let current = 3
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

public struct NodeRename: NativeCoreCommand {
    public static let name = "node.rename"
    public struct Result: Codable, Equatable, Sendable {
        public var outcome: StructureOutcome
    }
    public var path: [String]
    public var name: String
    public init(path: [String], name: String) {
        self.path = path
        self.name = name
    }
}

public struct NodeMove: NativeCoreCommand {
    public static let name = "node.move"
    public struct Result: Codable, Equatable, Sendable {
        public var outcome: StructureOutcome
    }
    public var path: [String]
    public var parent: [String]
    public init(path: [String], parent: [String]) {
        self.path = path
        self.parent = parent
    }
}

public struct NodePlace: NativeCoreCommand {
    public static let name = "node.place"
    public struct Result: Codable, Equatable, Sendable {
        public var outcome: StructureOutcome
    }
    public var path: [String]
    public var parent: [String]
    public var before: String?
    public init(path: [String], parent: [String], before: String?) {
        self.path = path
        self.parent = parent
        self.before = before
    }

    private enum CodingKeys: String, CodingKey {
        case path, parent, before
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(path, forKey: .path)
        try container.encode(parent, forKey: .parent)
        try container.encode(before, forKey: .before)
    }
}

public struct NodeMoveSibling: NativeCoreCommand {
    public static let name = "node.moveSibling"
    public struct Result: Codable, Equatable, Sendable {
        public var outcome: SiblingMoveOutcome
    }
    public var path: [String]
    public var direction: SiblingDirection
    public init(path: [String], direction: SiblingDirection) {
        self.path = path
        self.direction = direction
    }
}

public struct NodeMoveTargets: NativeCoreCommand {
    public static let name = "node.moveTargets"
    public struct Result: Codable, Equatable, Sendable {
        public var targets: [MoveTargetView]
    }
    public var path: [String]
    public init(path: [String]) {
        self.path = path
    }
}

public struct NodeTrashPreview: NativeCoreCommand {
    public static let name = "node.trashPreview"
    public struct Result: Codable, Equatable, Sendable {
        public var preview: TrashPreview
    }
    public var path: [String]
    public init(path: [String]) {
        self.path = path
    }
}

public struct NodeTrash: NativeCoreCommand {
    public static let name = "node.trash"
    public struct Result: Codable, Equatable, Sendable {
        public var outcome: TrashOutcome
    }
    public var path: [String]
    public var shareCount: Int
    public init(path: [String], shareCount: Int) {
        self.path = path
        self.shareCount = shareCount
    }
}

public struct NodeSetColorTag: NativeCoreCommand {
    public static let name = "node.setColorTag"
    public struct Result: Codable, Equatable, Sendable {
        public var outcome: StructureOutcome
    }
    public var path: [String]
    public var tag: ColorTag?
    public init(path: [String], tag: ColorTag?) {
        self.path = path
        self.tag = tag
    }

    private enum CodingKeys: String, CodingKey {
        case path, tag
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(path, forKey: .path)
        try container.encode(tag, forKey: .tag)
    }
}

public struct NoticesPerform: NativeCoreCommand {
    public static let name = "notices.perform"
    public typealias Result = Empty
    public var id: String
    public init(id: String) {
        self.id = id
    }
}

public struct TrashRestoreTargets: NativeCoreCommand {
    public static let name = "trash.restoreTargets"
    public struct Result: Codable, Equatable, Sendable {
        public var targets: [MoveTargetView]
    }
    public var entryId: String
    public var subPath: [String]
    public init(entryId: String, subPath: [String]) {
        self.entryId = entryId
        self.subPath = subPath
    }
}

public struct TrashRestore: NativeCoreCommand {
    public static let name = "trash.restore"
    public struct Result: Codable, Equatable, Sendable {
        public var outcome: StructureOutcome
    }
    public var entryId: String
    public var subPath: [String]
    public var parent: [String]
    public init(entryId: String, subPath: [String], parent: [String]) {
        self.entryId = entryId
        self.subPath = subPath
        self.parent = parent
    }
}

public struct TrashDelete: NativeCoreCommand {
    public static let name = "trash.delete"
    public typealias Result = Empty
    public var entryId: String
    public init(entryId: String) {
        self.entryId = entryId
    }
}

public struct TrashEmpty: NativeCoreCommand {
    public static let name = "trash.empty"
    public typealias Result = Empty
    public init() {}
}

public struct TagsSetFilter: NativeCoreCommand {
    public static let name = "tags.setFilter"
    public typealias Result = Empty
    public var tag: ColorTag?
    public init(tag: ColorTag?) {
        self.tag = tag
    }

    private enum CodingKeys: String, CodingKey {
        case tag
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(tag, forKey: .tag)
    }
}

public struct SearchOpen: NativeCoreCommand {
    public static let name = "search.open"
    public typealias Result = Empty
    public init() {}
}

public struct SearchClose: NativeCoreCommand {
    public static let name = "search.close"
    public typealias Result = Empty
    public init() {}
}

public struct SearchQuery: NativeCoreCommand {
    public static let name = "search.query"
    public struct Result: Codable, Equatable, Sendable {
        public var results: SearchResults
    }
    public var query: String
    public init(query: String) {
        self.query = query
    }
}

public struct NoteRename: NativeCoreCommand {
    public static let name = "note.rename"
    public struct Result: Codable, Equatable, Sendable {
        public var outcome: NameCommitOutcome
    }
    public var path: [String]
    public var name: String
    public init(path: [String], name: String) {
        self.path = path
        self.name = name
    }
}

public struct NoteStats: NativeCoreCommand {
    public static let name = "note.stats"
    public typealias Result = NoteStatsResult
    public var path: [String]
    public init(path: [String]) {
        self.path = path
    }
}

public struct NoteDates: NativeCoreCommand {
    public static let name = "note.dates"
    public typealias Result = NoteDatesResult
    public var path: [String]
    public init(path: [String]) {
        self.path = path
    }
}

public struct ImageRead: NativeCoreCommand {
    public static let name = "image.read"
    public struct Result: Codable, Equatable, Sendable {
        public var image: ImagePayload?

        public init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            image = try container.decodeIfPresent(ImagePayload.self, forKey: .image)
        }

        private enum CodingKeys: String, CodingKey {
            case image
        }

        public func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(image, forKey: .image)
        }
    }
    public var imageId: String
    public init(imageId: String) {
        self.imageId = imageId
    }
}

public struct LastViewLoad: NativeCoreCommand {
    public static let name = "lastView.load"
    public struct Result: Codable, Equatable, Sendable {
        public var view: LastView?

        public init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            view = try container.decodeIfPresent(LastView.self, forKey: .view)
        }

        private enum CodingKeys: String, CodingKey {
            case view
        }

        public func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(view, forKey: .view)
        }
    }
    public init() {}
}

public struct LastViewSave: NativeCoreCommand {
    public static let name = "lastView.save"
    public typealias Result = Empty
    public var note: [String]?
    public var folders: [[String]]
    public init(note: [String]?, folders: [[String]]) {
        self.note = note
        self.folders = folders
    }

    private enum CodingKeys: String, CodingKey {
        case note, folders
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(note, forKey: .note)
        try container.encode(folders, forKey: .folders)
    }
}

public struct EarlyDraftHandOff: NativeCoreCommand {
    public static let name = "earlyDraft.handOff"
    public struct Result: Codable, Equatable, Sendable {
        public var outcome: EarlyDraftOutcome
    }
    public var name: String
    public var body: String
    public var nameConfirmed: Bool
    public init(name: String, body: String, nameConfirmed: Bool) {
        self.name = name
        self.body = body
        self.nameConfirmed = nameConfirmed
    }
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
        NoticesPerform.name,
        NodeRename.name,
        NodeMove.name,
        NodePlace.name,
        NodeMoveSibling.name,
        NodeMoveTargets.name,
        NodeTrashPreview.name,
        NodeTrash.name,
        NodeSetColorTag.name,
        TrashRestoreTargets.name,
        TrashRestore.name,
        TrashDelete.name,
        TrashEmpty.name,
        TagsSetFilter.name,
        SearchOpen.name,
        SearchClose.name,
        SearchQuery.name,
        NoteRename.name,
        NoteStats.name,
        NoteDates.name,
        ImageRead.name,
        LastViewLoad.name,
        LastViewSave.name,
        EarlyDraftHandOff.name,
    ]
}
