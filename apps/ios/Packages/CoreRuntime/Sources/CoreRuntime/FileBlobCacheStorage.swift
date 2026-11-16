import CommitnoteCrypto
import Foundation

public final class FileBlobCacheStorage: BlobCacheStorage, @unchecked Sendable {
    private struct IndexEntry: Codable {
        var size: Int
        var lastUsedAt: Double
        var text: Bool
    }

    private struct RepoIndex: Codable {
        var repoKey: String
        var blobs: [String: IndexEntry]
    }

    public static var defaultRoot: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("blob-cache", isDirectory: true)
    }

    private static let indexName = "index.json"

    private let root: URL
    private let lock = NSLock()
    private var indexes: [String: RepoIndex] = [:]
    private var dirty: Set<String> = []

    public init(root: URL = FileBlobCacheStorage.defaultRoot) {
        self.root = root
    }

    public func get(repoKey: String, blobSha: String) throws -> BlobCacheEntry? {
        try locked {
            var index = try loadIndex(repoKey: repoKey)
            guard let entry = index.blobs[blobSha] else { return nil }
            guard let bytes = try? Data(contentsOf: blobURL(repoKey: repoKey, blobSha: blobSha)) else {
                index.blobs.removeValue(forKey: blobSha)
                indexes[repoKey] = index
                dirty.insert(repoKey)
                return nil
            }
            return BlobCacheEntry(bytes: bytes, text: entry.text, lastUsedAt: entry.lastUsedAt)
        }
    }

    public func put(repoKey: String, blobSha: String, entry: BlobCacheEntry) throws {
        try locked {
            var index = try loadIndex(repoKey: repoKey)
            try FileManager.default.createDirectory(
                at: repoDirectory(repoKey), withIntermediateDirectories: true)
            try entry.bytes.write(to: blobURL(repoKey: repoKey, blobSha: blobSha), options: .atomic)
            index.blobs[blobSha] = IndexEntry(
                size: entry.bytes.count, lastUsedAt: entry.lastUsedAt, text: entry.text)
            indexes[repoKey] = index
            try saveIndex(index)
        }
    }

    public func touch(repoKey: String, blobSha: String, lastUsedAt: Double) throws {
        try locked {
            var index = try loadIndex(repoKey: repoKey)
            guard index.blobs[blobSha] != nil else { return }
            index.blobs[blobSha]?.lastUsedAt = lastUsedAt
            indexes[repoKey] = index
            dirty.insert(repoKey)
        }
    }

    public func delete(repoKey: String, blobSha: String) throws {
        try locked {
            var index = try loadIndex(repoKey: repoKey)
            try removeIfExists(blobURL(repoKey: repoKey, blobSha: blobSha))
            if index.blobs.removeValue(forKey: blobSha) != nil {
                indexes[repoKey] = index
                try saveIndex(index)
            }
        }
    }

    public func list(repoKey: String) throws -> [BlobCacheListing] {
        try locked {
            try loadIndex(repoKey: repoKey).blobs
                .map { BlobCacheListing(blobSha: $0.key, size: $0.value.size, lastUsedAt: $0.value.lastUsedAt) }
                .sorted { $0.blobSha < $1.blobSha }
        }
    }

    public func listRepos() throws -> [String] {
        try locked {
            guard
                let directories = try? FileManager.default.contentsOfDirectory(
                    at: root, includingPropertiesForKeys: nil)
            else { return [] }
            var keys: [String] = []
            for directory in directories {
                guard let index = readIndex(at: directory) else {
                    try removeIfExists(directory)
                    continue
                }
                keys.append(index.repoKey)
            }
            return keys.sorted()
        }
    }

    public func deleteRepo(repoKey: String) throws {
        try locked {
            indexes.removeValue(forKey: repoKey)
            dirty.remove(repoKey)
            try removeIfExists(repoDirectory(repoKey))
        }
    }

    public func removeAll() throws {
        try locked {
            indexes.removeAll()
            dirty.removeAll()
            try removeIfExists(root)
        }
    }

    public func flush() throws {
        try locked {
            for repoKey in dirty {
                if let index = indexes[repoKey] {
                    try saveIndex(index)
                }
            }
            dirty.removeAll()
        }
    }

    private func locked<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    private func repoDirectory(_ repoKey: String) -> URL {
        let digest = Digest.sha256(Data(repoKey.utf8))
        let name = digest.map { String(format: "%02x", $0) }.joined()
        return root.appendingPathComponent(name, isDirectory: true)
    }

    private func blobURL(repoKey: String, blobSha: String) -> URL {
        repoDirectory(repoKey).appendingPathComponent(blobSha, isDirectory: false)
    }

    private func readIndex(at directory: URL) -> RepoIndex? {
        guard
            let data = try? Data(contentsOf: directory.appendingPathComponent(Self.indexName)),
            let index = try? JSONDecoder().decode(RepoIndex.self, from: data)
        else { return nil }
        return index
    }

    private func loadIndex(repoKey: String) throws -> RepoIndex {
        if let cached = indexes[repoKey] { return cached }
        let directory = repoDirectory(repoKey)
        if let index = readIndex(at: directory), index.repoKey == repoKey {
            indexes[repoKey] = index
            return index
        }
        try removeIfExists(directory)
        let fresh = RepoIndex(repoKey: repoKey, blobs: [:])
        indexes[repoKey] = fresh
        return fresh
    }

    private func saveIndex(_ index: RepoIndex) throws {
        let directory = repoDirectory(index.repoKey)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(index)
        try data.write(to: directory.appendingPathComponent(Self.indexName), options: .atomic)
        dirty.remove(index.repoKey)
    }

    private func removeIfExists(_ url: URL) throws {
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        try FileManager.default.removeItem(at: url)
    }
}
