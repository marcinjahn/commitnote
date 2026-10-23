import UIKit

@MainActor
enum AppearanceApplier {
    static func apply(_ appearance: AppAppearance) {
        var style = appearance.interfaceStyle
        #if FAKE_CORE
        switch TestingHooks.requestedColorScheme {
        case .light: style = .light
        case .dark: style = .dark
        default: break
        }
        #endif
        let tint = appearance.tint
        for scene in UIApplication.shared.connectedScenes {
            guard let windowScene = scene as? UIWindowScene else { continue }
            for window in windowScene.windows {
                window.overrideUserInterfaceStyle = style
                window.tintColor = tint
                #if FAKE_CORE
                if let speed = TestingHooks.animationSpeed {
                    window.layer.speed = speed
                }
                #endif
            }
        }
    }
}
