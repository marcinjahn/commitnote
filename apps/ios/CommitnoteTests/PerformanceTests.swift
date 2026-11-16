import Foundation
import NativeCoreAPI
import XCTest

final class PerformanceTests: RuntimeTestCase {
    private static let runs = 3
    private static let repo = "sample/large-tree"

    private struct Report: Encodable {
        var device: String
        var runs: Int
        var resumeMs: Double
        var cachedResumeMs: Double
        var unlockMs: Double
        var treeGetMs: Double
        var openNoteMs: Double
    }

    private func median(_ values: [Double]) -> Double {
        let sorted = values.sorted()
        return sorted[sorted.count / 2]
    }

    private func deepestNote(in nodes: [TreeNode]) -> [String]? {
        notePaths(in: nodes).max { $0.count < $1.count }
    }

    func testLargeTreeTimings() async throws {
        let warmUp = try await makeRuntime()
        try await warmUp.logIn(repo: Self.repo, passphrase: sampleNotesPassphrase)
        await warmUp.stop()

        var unlock: [Double] = []
        var resume: [Double] = []
        var cachedResume: [Double] = []
        var treeGet: [Double] = []
        var openNote: [Double] = []
        var device = ""

        for _ in 0..<Self.runs {
            let services = newServices()
            let runtime = try await makeRuntime(services: services)
            device = ProcessInfo.processInfo.environment["SIMULATOR_DEVICE_NAME"] ?? runtime.deviceModel

            let (tree, unlockMs) = try await timed {
                try await runtime.logIn(
                    repo: Self.repo, passphrase: sampleNotesPassphrase)
            }
            unlock.append(unlockMs)

            let (_, treeGetMs) = try await timed { try await runtime.send(TreeGet()) }
            treeGet.append(treeGetMs)

            let path = try XCTUnwrap(deepestNote(in: tree))
            let (_, openNoteMs) = try await timed { try await runtime.openNoteLoaded(path) }
            openNote.append(openNoteMs)
            await runtime.stop()

            let resumed = try await makeRuntime(services: services)
            let (result, resumeMs) = try await timed {
                let result = try await resumed.send(SessionResume(fromCache: false))
                _ = try await resumed.waitForTree()
                return result
            }
            XCTAssertEqual(result, .resumed)
            resume.append(resumeMs)
            _ = try await poll(
                timeout: .seconds(10), interval: .milliseconds(100), description: "the kept tree"
            ) {
                try await resumed.send(FakeHasCachedTree(repo: Self.repo)).cached ? true : nil
            }
            await resumed.stop()

            let cached = try await makeRuntime(services: services)
            let (cachedResult, cachedResumeMs) = try await timed {
                let result = try await cached.send(SessionResume(fromCache: true))
                _ = try await cached.waitForTree()
                return result
            }
            XCTAssertEqual(cachedResult, .resumed)
            cachedResume.append(cachedResumeMs)
            await cached.stop()
        }

        let report = Report(
            device: device,
            runs: Self.runs,
            resumeMs: median(resume),
            cachedResumeMs: median(cachedResume),
            unlockMs: median(unlock),
            treeGetMs: median(treeGet),
            openNoteMs: median(openNote))
        try ReadBackOutput.write(report, fileName: "perf.json", subdirectory: "perf", to: self)
        print(
            "PERF device=\(report.device) runs=\(report.runs) resumeMs=\(report.resumeMs) "
                + "cachedResumeMs=\(report.cachedResumeMs) "
                + "unlockMs=\(report.unlockMs) treeGetMs=\(report.treeGetMs) openNoteMs=\(report.openNoteMs)")
    }
}
