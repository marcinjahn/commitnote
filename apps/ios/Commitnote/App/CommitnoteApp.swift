import SwiftUI

@main
struct CommitnoteApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var model = AppModel()

    init() {
        #if FAKE_CORE
        TestingHooks.resetStoredStateIfRequested()
        #endif
    }

    var body: some Scene {
        WindowGroup {
            RootView(model: model)
                .id(ObjectIdentifier(model))
                .task(id: ObjectIdentifier(model)) { await model.start() }
                .tint(model.appearance.tint.map { Color(uiColor: $0) })
                .onOpenURL { _ = LaunchInbox.shared.open($0) }
                #if FAKE_CORE
                .onReceive(NotificationCenter.default.publisher(for: TestingRelaunch.notification)) { _ in
                    let previous = model
                    Task {
                        TestingRelaunch.dismissPresentations()
                        await previous.stopForTesting()
                        model = AppModel()
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: TestingAction.notification)) { notification in
                    guard let action = notification.object as? TestingAction else { return }
                    let current = model
                    Task {
                        await action.run(on: current)
                        action.postDone()
                    }
                }
                #endif
        }
        .commands { AppCommands(model: model) }
    }
}
