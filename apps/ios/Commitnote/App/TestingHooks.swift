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
        CFNotificationCenterAddObserver(
            center, nil, testingRelaunchRequested, TestingRelaunch.request as CFString, nil, .deliverImmediately)
    }

    fileprivate func apply(_ scheme: ColorScheme) {
        self.scheme = scheme
        AppearanceApplier.apply(lastAppearance)
        let style: UIUserInterfaceStyle = scheme == .dark ? .dark : .light
        let windows = AppearanceApplier.appWindows()
        // Sheets, popovers and alerts that are already up keep the style they were presented with.
        func override(_ controller: UIViewController) {
            if controller.presentingViewController != nil {
                controller.overrideUserInterfaceStyle = style
            }
            controller.children.forEach(override)
            if let presented = controller.presentedViewController, presented.presentingViewController === controller {
                override(presented)
            }
        }
        for window in windows {
            if let root = window.rootViewController { override(root) }
        }
        let name = Self.appliedPrefix + (scheme == .dark ? "dark" : "light")
        DispatchQueue.main.async {
            windows.forEach { $0.layoutIfNeeded() }
            // The keyboard runs in another process and picks up the new style only once reloaded.
            UIApplication.shared.sendAction(#selector(UIResponder.reloadInputViews), to: nil, from: nil, for: nil)
            CATransaction.flush()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                CFNotificationCenterPostNotification(
                    CFNotificationCenterGetDarwinNotifyCenter(), CFNotificationName(name as CFString), nil, nil,
                    true)
            }
        }
    }
}

/// SwiftUI's size class environment cannot be overridden from the outside, so UI tests force the
/// width through the window scene's trait overrides, which also move UIKit's own adaptive behaviour.
@MainActor
@Observable
final class TestingLayout {
    static let shared = TestingLayout()

    var forced: UIUserInterfaceSizeClass? {
        didSet { applyToScenes() }
    }

    var label: String {
        switch forced {
        case .compact: "compact"
        case .regular: "regular"
        default: "system"
        }
    }

    func cycle() {
        switch forced {
        case .compact: forced = .regular
        case .regular: forced = nil
        default: forced = .compact
        }
    }

    private func applyToScenes() {
        for scene in UIApplication.shared.connectedScenes {
            guard let windowScene = scene as? UIWindowScene else { continue }
            if let forced {
                windowScene.traitOverrides.horizontalSizeClass = forced
            } else {
                windowScene.traitOverrides.remove(UITraitHorizontalSizeClass.self)
            }
        }
    }
}

/// The scene's trait override does not reach SwiftUI's size class environment, so the forced width
/// is also handed to the notes screen directly.
struct TestingWidthOverride: ViewModifier {
    @Environment(\.horizontalSizeClass) private var system

    func body(content: Content) -> some View {
        content.environment(\.horizontalSizeClass, sizeClass)
    }

    private var sizeClass: UserInterfaceSizeClass? {
        switch TestingLayout.shared.forced {
        case .compact: .compact
        case .regular: .regular
        default: system
        }
    }
}

struct TestingWidthState: View {
    var body: some View {
        Color.clear
            .frame(width: 1, height: 1)
            .allowsHitTesting(false)
            .accessibilityElement()
            .accessibilityLabel("Width")
            .accessibilityValue(TestingLayout.shared.label)
            .accessibilityIdentifier("testing-width")
    }
}

/// UI tests restart the app's model and core in the running process instead of relaunching it,
/// which costs far less than a new process. Everything a relaunch resets is rebuilt: a new model, a
/// new core with a fresh fake forge, and new views; stored state stays, as it does across launches.
enum TestingRelaunch {
    static let request = "io.github.marcinjahn.commitnote.testing.relaunch"
    static let ready = "io.github.marcinjahn.commitnote.testing.ready"
    static let notification = Notification.Name("CommitnoteTestingRelaunch")

    /// Tells the tests the restarted app has settled: logged out, or showing notes with the last
    /// view restored.
    static func postReady() {
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(), CFNotificationName(ready as CFString), nil, nil, true)
    }

    @MainActor
    static func dismissPresentations() {
        for scene in UIApplication.shared.connectedScenes {
            guard let windowScene = scene as? UIWindowScene else { continue }
            for window in windowScene.windows {
                window.endEditing(true)
                window.rootViewController?.dismiss(animated: false)
            }
        }
    }
}

private let testingRelaunchRequested: CFNotificationCallback = { _, _, _, _, _ in
    DispatchQueue.main.async {
        NotificationCenter.default.post(name: TestingRelaunch.notification, object: nil)
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

struct TestingTypeToStartState: View {
    let model: AppModel

    var body: some View {
        Color.clear
            .frame(width: 1, height: 1)
            .allowsHitTesting(false)
            .accessibilityElement()
            .accessibilityLabel("Type to start")
            .accessibilityValue(model.typeToStartCatcherReady ? "ready" : "idle")
            .accessibilityIdentifier("testing-type-to-start")
    }
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
            Button("Switch width") {
                TestingLayout.shared.cycle()
            }
            .accessibilityIdentifier("testing-switch-width")
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
