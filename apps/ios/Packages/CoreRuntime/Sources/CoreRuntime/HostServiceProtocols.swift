import Foundation
import NativeCoreAPI
import Synchronization

public struct RememberedSessionMaterial: Codable, Equatable, Sendable {
    public struct Coordinates: Codable, Equatable, Sendable {
        public var forge: ForgeID
        public var owner: String
        public var repo: String

        public init(forge: ForgeID, owner: String, repo: String) {
            self.forge = forge
            self.owner = owner
            self.repo = repo
        }
    }

    public struct Keys: Codable, Equatable, Sendable {
        public var contentKey: Data
        public var nameKey: Data
        public var nameIvKey: Data
        public var keyCheckKey: Data

        public init(contentKey: Data, nameKey: Data, nameIvKey: Data, keyCheckKey: Data) {
            self.contentKey = contentKey
            self.nameKey = nameKey
            self.nameIvKey = nameIvKey
            self.keyCheckKey = keyCheckKey
        }
    }

    public var repoUrl: String
    public var coordinates: Coordinates
    public var accessToken: String
    public var keys: Keys

    public init(repoUrl: String, coordinates: Coordinates, accessToken: String, keys: Keys) {
        self.repoUrl = repoUrl
        self.coordinates = coordinates
        self.accessToken = accessToken
        self.keys = keys
    }
}

public protocol RememberedSessionStorage: Sendable {
    func save(_ record: RememberedSessionMaterial) throws
    func load() throws -> RememberedSessionMaterial?
    func clear() throws
}

public struct BlobCacheEntry: Equatable, Sendable {
    public var bytes: Data
    public var text: Bool
    public var lastUsedAt: Double

    public init(bytes: Data, text: Bool, lastUsedAt: Double) {
        self.bytes = bytes
        self.text = text
        self.lastUsedAt = lastUsedAt
    }
}

public struct BlobCacheListing: Equatable, Sendable {
    public var blobSha: String
    public var size: Int
    public var lastUsedAt: Double

    public init(blobSha: String, size: Int, lastUsedAt: Double) {
        self.blobSha = blobSha
        self.size = size
        self.lastUsedAt = lastUsedAt
    }
}

public protocol BlobCacheStorage: Sendable {
    func get(repoKey: String, blobSha: String) throws -> BlobCacheEntry?
    func put(repoKey: String, blobSha: String, entry: BlobCacheEntry) throws
    func touch(repoKey: String, blobSha: String, lastUsedAt: Double) throws
    func delete(repoKey: String, blobSha: String) throws
    func list(repoKey: String) throws -> [BlobCacheListing]
    func listRepos() throws -> [String]
    func deleteRepo(repoKey: String) throws
    func flush() throws
}

public protocol DeviceSettingsStorage: Sendable {
    func getItem(_ key: String) -> String?
    func setItem(_ key: String, _ value: String)
    func removeItem(_ key: String)
}

public struct HostHTTPRequest: Equatable, Sendable {
    public var method: String
    public var url: URL
    public var headers: [String: String]
    public var body: Data?

    public init(method: String, url: URL, headers: [String: String], body: Data?) {
        self.method = method
        self.url = url
        self.headers = headers
        self.body = body
    }
}

public struct HostHTTPResponse: Equatable, Sendable {
    public var status: Int
    public var headers: [String: String]
    public var body: Data

    public init(status: Int, headers: [String: String], body: Data) {
        self.status = status
        self.headers = headers
        self.body = body
    }
}

/// Throws only on transport failure; every HTTP status is a response.
public protocol HTTPClient: Sendable {
    func send(_ request: HostHTTPRequest) async throws -> HostHTTPResponse
}

public final class InMemoryRememberedSessionStorage: RememberedSessionStorage {
    private let record: Mutex<RememberedSessionMaterial?>

    public init(_ record: RememberedSessionMaterial? = nil) {
        self.record = Mutex(record)
    }

    public func save(_ record: RememberedSessionMaterial) {
        self.record.withLock { $0 = record }
    }

    public func load() -> RememberedSessionMaterial? {
        record.withLock { $0 }
    }

    public func clear() {
        record.withLock { $0 = nil }
    }
}

public final class InMemoryBlobCacheStorage: BlobCacheStorage {
    private let repos = Mutex<[String: [String: BlobCacheEntry]]>([:])

    public init() {}

    public func get(repoKey: String, blobSha: String) -> BlobCacheEntry? {
        repos.withLock { $0[repoKey]?[blobSha] }
    }

    public func put(repoKey: String, blobSha: String, entry: BlobCacheEntry) {
        repos.withLock { $0[repoKey, default: [:]][blobSha] = entry }
    }

    public func touch(repoKey: String, blobSha: String, lastUsedAt: Double) {
        repos.withLock { $0[repoKey]?[blobSha]?.lastUsedAt = lastUsedAt }
    }

    public func delete(repoKey: String, blobSha: String) {
        repos.withLock { _ = $0[repoKey]?.removeValue(forKey: blobSha) }
    }

    public func list(repoKey: String) -> [BlobCacheListing] {
        repos.withLock { repos in
            (repos[repoKey] ?? [:])
                .map { BlobCacheListing(blobSha: $0.key, size: $0.value.bytes.count, lastUsedAt: $0.value.lastUsedAt) }
                .sorted { $0.blobSha < $1.blobSha }
        }
    }

    public func listRepos() -> [String] {
        repos.withLock { $0.keys.sorted() }
    }

    public func deleteRepo(repoKey: String) {
        repos.withLock { _ = $0.removeValue(forKey: repoKey) }
    }

    public func flush() {}
}

public final class InMemoryDeviceSettingsStorage: DeviceSettingsStorage {
    private let items: Mutex<[String: String]>

    public init(_ items: [String: String] = [:]) {
        self.items = Mutex(items)
    }

    public func getItem(_ key: String) -> String? {
        items.withLock { $0[key] }
    }

    public func setItem(_ key: String, _ value: String) {
        items.withLock { $0[key] = value }
    }

    public func removeItem(_ key: String) {
        items.withLock { _ = $0.removeValue(forKey: key) }
    }
}

public enum InMemoryHTTPClientError: Error, Equatable, Sendable {
    case notConfigured
}

public struct InMemoryHTTPClient: HTTPClient {
    private let respond: @Sendable (HostHTTPRequest) throws -> HostHTTPResponse

    public init(
        respond: @escaping @Sendable (HostHTTPRequest) throws -> HostHTTPResponse = { _ in
            throw InMemoryHTTPClientError.notConfigured
        }
    ) {
        self.respond = respond
    }

    public init(stub response: HostHTTPResponse) {
        self.respond = { _ in response }
    }

    public func send(_ request: HostHTTPRequest) async throws -> HostHTTPResponse {
        try respond(request)
    }
}
