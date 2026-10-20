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
                .task { await model.start() }
                #if FAKE_CORE
                .preferredColorScheme(TestingHooks.requestedColorScheme)
                #endif
        }
    }
}
