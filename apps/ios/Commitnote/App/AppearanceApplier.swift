import UIKit

@MainActor
enum AppearanceApplier {
    static func apply(_ appearance: AppAppearance) {
        var style = appearance.interfaceStyle
        #if FAKE_CORE
        TestingAppearance.shared.lastAppearance = appearance
        switch TestingAppearance.shared.scheme {
        case .light: style = .light
        case .dark: style = .dark
        default: break
        }
        #endif
        let tint = appearance.tint
        for window in appWindows() {
            window.overrideUserInterfaceStyle = style
            window.tintColor = tint
            #if FAKE_CORE
            if let speed = TestingHooks.animationSpeed {
                window.layer.speed = speed
            }
            #endif
        }
    }

    /// The scene also lists the system's keyboard and text effects windows, which sit above the
    /// normal level and follow the style of the view they serve.
    static func appWindows() -> [UIWindow] {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .filter { $0.windowLevel == .normal }
    }
}
