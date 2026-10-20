#if FAKE_CORE
import CoreRuntime
import Foundation
import NativeCoreAPI
import SwiftUI

enum TestingHooks {
    static func resetStoredStateIfRequested(
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) {
        if environment["COMMITNOTE_UI_TEST_RESET"] == "1" {
            CoreRuntimeConfiguration.resetStoredState()
        }
    }

    static var requestedColorScheme: ColorScheme? {
        switch ProcessInfo.processInfo.environment["COMMITNOTE_UI_APPEARANCE"] {
        case "light": .light
        case "dark": .dark
        default: nil
        }
    }
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

struct TestingMenu: View {
    let model: AppModel

    private static let repo = "sample/notes"
    private static let welcomeLines = [
        "# Welcome",
        "",
        "This is your **notes** repo, encrypted end to end. Some *emphasis*, ~~strikethrough~~, and `inline code`.",
        "",
        "```js",
        "console.log(\"hello\");",
        "```",
        "",
        "See the [commitnote project](https://github.com/example/commitnote) for details.",
        "",
        "> Notes stay private even to the forge that hosts them.",
        "",
        "- First bullet",
        "- Second bullet",
        "",
        "1. First step",
        "2. Second step",
        "",
        "- [x] Done task",
        "- [ ] Open task",
        "",
        "| Column A | Column B |",
        "| --- | --- |",
        "| 1 | 2 |",
        "",
    ]

    var body: some View {
        Menu("Testing", systemImage: "wrench.and.screwdriver") {
            Button("Remote edit") {
                Task { await remoteEdit(replacing: 0, with: "Edited on another device") }
            }
            .accessibilityIdentifier("testing-remote-edit")
            Button("Remote edit and refresh") {
                Task {
                    await remoteEdit(
                        replacing: Self.welcomeLines.count - 1, with: "Appended on another device")
                    await model.sendTesting(SyncRefresh())
                }
            }
            .accessibilityIdentifier("testing-remote-edit-refresh")
            Button("Change passphrase elsewhere") {
                Task { await model.sendTesting(FakeChangeRepoKey(repo: Self.repo)) }
            }
            .accessibilityIdentifier("testing-change-key")
            Button("Fail saves") {
                Task {
                    await model.sendTesting(
                        FakeFailNext(
                            repo: Self.repo, operation: "commit", kind: "Network", count: 1000))
                }
            }
            .accessibilityIdentifier("testing-fail-saves")
            Button("Stop failing saves") {
                Task {
                    await model.sendTesting(
                        FakeClearFailures(repo: Self.repo, operation: "commit"))
                }
            }
            .accessibilityIdentifier("testing-stop-failing")
            Button(model.forcedOffline ? "Go online" : "Go offline") {
                Task { await model.setForcedOffline(!model.forcedOffline) }
            }
            .accessibilityIdentifier("testing-offline")
        }
        .accessibilityIdentifier("testing-menu")
    }

    private func remoteEdit(replacing index: Int, with line: String) async {
        var lines = Self.welcomeLines
        lines[index] = line
        await model.sendTesting(
            FakeRemoteEdit(
                repo: Self.repo, path: ["Welcome"], text: lines.joined(separator: "\n"),
                device: "Other iPhone"))
    }
}
#endif
