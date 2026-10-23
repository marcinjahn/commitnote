#if FAKE_CORE
import CoreRuntime
import Foundation
import NativeCoreAPI
import SwiftUI
import UIKit

enum TestingHooks {
    private nonisolated(unsafe) static var storedStateWasReset = false

    static func resetStoredStateIfRequested(
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) {
        if environment["COMMITNOTE_UI_TEST_RESET"] == "1", !storedStateWasReset {
            storedStateWasReset = true
            CoreRuntimeConfiguration.resetStoredState()
        }
    }

    static var holdLoadingRequested: Bool {
        ProcessInfo.processInfo.environment["COMMITNOTE_UI_HOLD_LOADING"] == "1"
    }

    static var editorHooksRequested: Bool {
        ProcessInfo.processInfo.environment["COMMITNOTE_UI_EDITOR_HOOKS"] == "1"
    }

    /// UI tests run the app's own animations faster, so XCTest's waits for them end sooner.
    static var animationSpeed: Float? {
        ProcessInfo.processInfo.environment["COMMITNOTE_UI_ANIMATION_SPEED"].flatMap { Float($0) }
    }

    static var requestedColorScheme: ColorScheme? {
        switch ProcessInfo.processInfo.environment["COMMITNOTE_UI_APPEARANCE"] {
        case "light": .light
        case "dark": .dark
        default: nil
        }
    }
}

/// Screenshot tests switch between light and dark on the screen they show instead of walking
/// every flow twice. The request and its acknowledgement are Darwin notifications, which the
/// test runner and the app on one simulator both see.
@MainActor
@Observable
final class TestingAppearance {
    static let shared = TestingAppearance()
    static let requestPrefix = "io.github.marcinjahn.commitnote.testing.appearance."
    static let appliedPrefix = "io.github.marcinjahn.commitnote.testing.appearance-applied."

    private(set) var scheme = TestingHooks.requestedColorScheme
    @ObservationIgnored var lastAppearance = AppAppearance.standard
    @ObservationIgnored private var listening = false

    func startListening() {
        guard !listening else { return }
        listening = true
        let center = CFNotificationCenterGetDarwinNotifyCenter()
        for name in ["light", "dark"] {
            CFNotificationCenterAddObserver(
                center, nil, testingAppearanceRequested, (Self.requestPrefix + name) as CFString, nil,
                .deliverImmediately)
        }
    }

    fileprivate func apply(_ scheme: ColorScheme) {
        self.scheme = scheme
        AppearanceApplier.apply(lastAppearance)
        let style: UIUserInterfaceStyle = scheme == .dark ? .dark : .light
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
        // Sheets, popovers and alerts that are already up keep the style they were presented with.
        for window in windows {
            var presented = window.rootViewController?.presentedViewController
            while let controller = presented {
                controller.overrideUserInterfaceStyle = style
                presented = controller.presentedViewController
            }
        }
        let name = Self.appliedPrefix + (scheme == .dark ? "dark" : "light")
        DispatchQueue.main.async {
            windows.forEach { $0.layoutIfNeeded() }
            // The keyboard runs in another process and picks up the new style only once reloaded.
            UIApplication.shared.sendAction(#selector(UIResponder.reloadInputViews), to: nil, from: nil, for: nil)
            CATransaction.flush()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                CFNotificationCenterPostNotification(
                    CFNotificationCenterGetDarwinNotifyCenter(), CFNotificationName(name as CFString), nil, nil,
                    true)
            }
        }
    }
}

private let testingAppearanceRequested: CFNotificationCallback = { _, _, name, _, _ in
    guard let raw = name.map({ $0.rawValue as String }) else { return }
    let scheme: ColorScheme = raw.hasSuffix("dark") ? .dark : .light
    DispatchQueue.main.async {
        MainActor.assumeIsolated { TestingAppearance.shared.apply(scheme) }
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

struct FakeShareNote: NativeCoreCommand {
    static let name = "fake.shareNote"
    typealias Result = Empty
    var path: [String]
}

struct FakeImportArchive: NativeCoreCommand {
    static let name = "fake.importArchive"
    typealias Result = ImportArchiveOutcome
}

struct FakeHoldLoading: NativeCoreCommand {
    static let name = "fake.holdLoading"
    typealias Result = Empty
}

struct FakeReleaseLoading: NativeCoreCommand {
    static let name = "fake.releaseLoading"
    typealias Result = Empty
}

struct TestingLoadingBar: View {
    let model: AppModel

    private static let repo = "sample/notes"

    var body: some View {
        HStack(spacing: 12) {
            Button("Finish loading") {
                Task { await model.sendTesting(FakeReleaseLoading()) }
            }
            .accessibilityIdentifier("testing-finish-loading")
            Button("Fail loading") {
                Task {
                    await model.sendTesting(
                        FakeFailNext(
                            repo: Self.repo, operation: "inspect", kind: "Network", count: 1000))
                    await model.sendTesting(FakeReleaseLoading())
                }
            }
            .accessibilityIdentifier("testing-fail-loading")
            Button("Stop failing") {
                Task {
                    await model.sendTesting(
                        FakeClearFailures(repo: Self.repo, operation: "inspect"))
                }
            }
            .accessibilityIdentifier("testing-stop-failing-loading")
        }
        .buttonStyle(.bordered)
        .font(.footnote)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("testing-loading-bar")
    }
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
            Button("Share Welcome") {
                Task { await model.sendTesting(FakeShareNote(path: ["Welcome"])) }
            }
            .accessibilityIdentifier("testing-share-note")
            Button("Fail next share") {
                Task {
                    await model.sendTesting(
                        FakeFailNext(
                            repo: Self.repo, operation: "createShare", kind: "Forbidden", count: 1))
                }
            }
            .accessibilityIdentifier("testing-share-permission")
            Button("Import sample archive") {
                Task { await model.importSampleArchive() }
            }
            .accessibilityIdentifier("testing-import-archive")
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
