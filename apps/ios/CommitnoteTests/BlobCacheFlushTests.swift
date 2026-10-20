import CoreRuntime
import Foundation
import XCTest

final class BlobCacheFlushTests: RuntimeTestCase {
    func testHostStorageFlushPersistsTouchedRecency() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("commitnote-blob-flush-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let storage = FileBlobCacheStorage(root: root)
        let repoKey = "sample/notes"
        try storage.put(
            repoKey: repoKey, blobSha: "older",
            entry: BlobCacheEntry(bytes: Data("one".utf8), text: true, lastUsedAt: 100))
        try storage.put(
            repoKey: repoKey, blobSha: "newer",
            entry: BlobCacheEntry(bytes: Data("two".utf8), text: true, lastUsedAt: 200))

        try storage.touch(repoKey: repoKey, blobSha: "older", lastUsedAt: 300)

        let stale = try recency(FileBlobCacheStorage(root: root), repoKey)
        XCTAssertEqual(stale["older"], 100)

        var configuration = newServices().configuration(
            bundleURL: try TestResources.coreBundleURL,
            deviceModel: await TestResources.deviceModel(),
            http: URLSessionHTTPClient())
        configuration.blobCache = storage
        let runtime = TestRuntime(configuration: configuration)
        try await runtime.core.start()
        await runtime.core.flushHostStorage()
        await runtime.stop()

        let fresh = try recency(FileBlobCacheStorage(root: root), repoKey)
        XCTAssertEqual(fresh["older"], 300)
        XCTAssertEqual(fresh["newer"], 200)
        XCTAssertGreaterThan(try XCTUnwrap(fresh["older"]), try XCTUnwrap(fresh["newer"]))
    }

    private func recency(_ storage: FileBlobCacheStorage, _ repoKey: String) throws -> [String: Double] {
        Dictionary(
            uniqueKeysWithValues: try storage.list(repoKey: repoKey).map { ($0.blobSha, $0.lastUsedAt) })
    }
}
