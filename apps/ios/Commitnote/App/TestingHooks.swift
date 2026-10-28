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
        for action in TestingAction.allCases {
            CFNotificationCenterAddObserver(
                center, nil, testingActionRequested, (TestingAction.requestPrefix + action.rawValue) as CFString, nil,
                .deliverImmediately)
        }
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

private let testingActionRequested: CFNotificationCallback = { _, _, name, _, _ in
    guard let raw = name.map({ $0.rawValue as String }),
        let action = TestingAction(rawValue: String(raw.dropFirst(TestingAction.requestPrefix.count)))
    else { return }
    DispatchQueue.main.async {
        NotificationCenter.default.post(name: TestingAction.notification, object: action)
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

/// The UI tests run these through Darwin notifications and wait for the acknowledgement, which
/// arrives once the action has finished. The Testing menu offers the same actions by hand, but
/// with the keyboard up it scrolls, and a tap on an item can close it without running the item.
enum TestingAction: String, CaseIterable, Sendable {
    case remoteEdit = "testing-remote-edit"
    case remoteEditAndRefresh = "testing-remote-edit-refresh"
    case changeKey = "testing-change-key"
    case failSaves = "testing-fail-saves"
    case stopFailingSaves = "testing-stop-failing"
    case shareNote = "testing-share-note"
    case failNextShare = "testing-share-permission"
    case importArchive = "testing-import-archive"
    case toggleOffline = "testing-offline"
    case switchWidth = "testing-switch-width"

    static let requestPrefix = "io.github.marcinjahn.commitnote.testing.action."
    static let donePrefix = "io.github.marcinjahn.commitnote.testing.action-done."
    static let notification = Notification.Name("CommitnoteTestingAction")

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

    @MainActor
    func title(for model: AppModel) -> String {
        switch self {
        case .remoteEdit: "Remote edit"
        case .remoteEditAndRefresh: "Remote edit and refresh"
        case .changeKey: "Change passphrase elsewhere"
        case .failSaves: "Fail saves"
        case .stopFailingSaves: "Stop failing saves"
        case .shareNote: "Share Welcome"
        case .failNextShare: "Fail next share"
        case .importArchive: "Import sample archive"
        case .toggleOffline: model.forcedOffline ? "Go online" : "Go offline"
        case .switchWidth: "Switch width"
        }
    }

    @MainActor
    func run(on model: AppModel) async {
        switch self {
        case .remoteEdit:
            await Self.remoteEdit(replacing: 0, with: "Edited on another device", on: model)
        case .remoteEditAndRefresh:
            await Self.remoteEdit(
                replacing: Self.welcomeLines.count - 1, with: "Appended on another device", on: model)
            await model.sendTesting(SyncRefresh())
        case .changeKey:
            await model.sendTesting(FakeChangeRepoKey(repo: Self.repo))
        case .failSaves:
            await model.sendTesting(FakeFailNext(repo: Self.repo, operation: "commit", kind: "Network", count: 1000))
        case .stopFailingSaves:
            await model.sendTesting(FakeClearFailures(repo: Self.repo, operation: "commit"))
        case .shareNote:
            await model.sendTesting(FakeShareNote(path: ["Welcome"]))
        case .failNextShare:
            await model.sendTesting(
                FakeFailNext(repo: Self.repo, operation: "createShare", kind: "Forbidden", count: 1))
        case .importArchive:
            await model.importSampleArchive()
        case .toggleOffline:
            await model.setForcedOffline(!model.forcedOffline)
        case .switchWidth:
            TestingLayout.shared.cycle()
        }
    }

    func postDone() {
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(), CFNotificationName((Self.donePrefix + rawValue) as CFString),
            nil, nil, true)
    }

    @MainActor
    private static func remoteEdit(replacing index: Int, with line: String, on model: AppModel) async {
        var lines = welcomeLines
        lines[index] = line
        await model.sendTesting(
            FakeRemoteEdit(
                repo: repo, path: ["Welcome"], text: lines.joined(separator: "\n"), device: "Other iPhone"))
    }
}

struct TestingMenu: View {
    let model: AppModel

    var body: some View {
        Menu("Testing", systemImage: "wrench.and.screwdriver") {
            ForEach(TestingAction.allCases, id: \.self) { action in
                Button(action.title(for: model)) {
                    Task { await action.run(on: model) }
                }
                .accessibilityIdentifier(action.rawValue)
            }
        }
        .accessibilityIdentifier("testing-menu")
    }
}
#endif
