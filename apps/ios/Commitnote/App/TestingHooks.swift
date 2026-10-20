#if FAKE_CORE
import CoreRuntime
import Foundation
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
#endif
