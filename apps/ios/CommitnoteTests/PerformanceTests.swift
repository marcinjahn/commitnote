import Foundation
import NativeCoreAPI
import XCTest

final class PerformanceTests: RuntimeTestCase {
    private static let runs = 3

    private struct Report: Encodable {
        var device: String
        var runs: Int
        var resumeMs: Double
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
        try await warmUp.logIn(repo: "sample/large-tree", passphrase: sampleNotesPassphrase)
        await warmUp.stop()

        var unlock: [Double] = []
        var resume: [Double] = []
        var treeGet: [Double] = []
        var openNote: [Double] = []
        var device = ""

        for _ in 0..<Self.runs {
            let services = newServices()
            let runtime = try await makeRuntime(services: services)
            device = ProcessInfo.processInfo.environment["SIMULATOR_DEVICE_NAME"] ?? runtime.deviceModel

            let (tree, unlockMs) = try await timed {
                try await runtime.logIn(
                    repo: "sample/large-tree", passphrase: sampleNotesPassphrase)
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
                let result = try await resumed.send(SessionResume())
                _ = try await resumed.waitForTree()
                return result
            }
            XCTAssertEqual(result, .resumed)
            resume.append(resumeMs)
            await resumed.stop()
        }

        let report = Report(
            device: device,
            runs: Self.runs,
            resumeMs: median(resume),
            unlockMs: median(unlock),
            treeGetMs: median(treeGet),
            openNoteMs: median(openNote))
        try ReadBackOutput.write(report, fileName: "perf.json", subdirectory: "perf", to: self)
        print(
            "PERF device=\(report.device) runs=\(report.runs) resumeMs=\(report.resumeMs) "
                + "unlockMs=\(report.unlockMs) treeGetMs=\(report.treeGetMs) openNoteMs=\(report.openNoteMs)")
    }
}
