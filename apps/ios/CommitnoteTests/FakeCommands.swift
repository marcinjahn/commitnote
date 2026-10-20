import Foundation
import NativeCoreAPI

struct FakeSaveNote: NativeCoreCommand {
    static let name = "fake.saveNote"
    typealias Result = Empty
    var path: [String]
    var text: String
}

struct FakeRemoteEdit: NativeCoreCommand {
    static let name = "fake.remoteEdit"
    typealias Result = Empty
    var repo: String
    var path: [String]
    var text: String
    var device: String
}

struct FakeChangeRepoKey: NativeCoreCommand {
    static let name = "fake.changeRepoKey"
    typealias Result = Empty
    var repo: String
}

struct FakeFailNext: NativeCoreCommand {
    static let name = "fake.failNext"
    typealias Result = Empty
    var repo: String
    var operation: String
    var kind: String
    var count: Int
}

struct FakeClearFailures: NativeCoreCommand {
    static let name = "fake.clearFailures"
    typealias Result = Empty
    var repo: String
    var operation: String
}

struct FakeExportRepo: NativeCoreCommand {
    static let name = "fake.exportRepo"
    struct Result: Decodable, Sendable {
        var exported: String
    }
    var repoKey: String
}

struct FakeExpectedSampleNotes: NativeCoreCommand {
    static let name = "fake.expectedSampleNotes"
    struct SampleNote: Decodable, Sendable {
        var path: [String]
        var text: String
    }
    struct Result: Decodable, Sendable {
        var notes: [SampleNote]
    }
}

struct FakeCheckVectors: NativeCoreCommand {
    static let name = "fake.checkVectors"
    struct Result: Decodable, Sendable {
        var checked: Int
        var failures: [String]
    }
    var files: [String: JSONValue]
}

struct FakeHTTPRequest: NativeCoreCommand {
    static let name = "fake.httpRequest"
    struct Result: Decodable, Sendable {
        var status: Int
        var headers: [String: String]
        var bodyText: String
    }
    var method: String
    var url: String
    var headers: [String: String]
    var bodyText: String
}

struct FakeTimerProbe: NativeCoreCommand {
    static let name = "fake.timerProbe"
    struct Result: Decodable, Sendable {
        var fired: [Int]
    }
    var delaysMs: [Int]
    var cancelIndex: Int?

    private enum CodingKeys: String, CodingKey {
        case delaysMs, cancelIndex
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(delaysMs, forKey: .delaysMs)
        try container.encode(cancelIndex, forKey: .cancelIndex)
    }
}
