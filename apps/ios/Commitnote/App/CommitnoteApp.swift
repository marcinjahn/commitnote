import SwiftUI

@main
struct CommitnoteApp: App {
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
                #if FAKE_CORE
                .onReceive(NotificationCenter.default.publisher(for: TestingRelaunch.notification)) { _ in
                    let previous = model
                    Task {
                        TestingRelaunch.dismissPresentations()
                        await previous.stopForTesting()
                        model = AppModel()
                    }
                }
                #endif
        }
    }
}
