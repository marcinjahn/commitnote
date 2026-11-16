import Foundation
import NativeCoreAPI
import UIKit

struct AppAppearance: Codable, Equatable {
    static let cacheKey = "commitnote.appearance"
    static let standard = AppAppearance(
        colorMode: "system", accentLight: nil, accentDark: nil, noteFont: "inter")

    var colorMode: String
    var accentLight: String?
    var accentDark: String?
    var noteFont: String

    var interfaceStyle: UIUserInterfaceStyle {
        switch colorMode {
        case "light": .light
        case "dark": .dark
        default: .unspecified
        }
    }

    var tint: UIColor? {
        guard let light = accentLight ?? accentDark, let dark = accentDark ?? accentLight,
            let lightColor = Self.color(hex: light), let darkColor = Self.color(hex: dark)
        else { return nil }
        return UIColor { traits in
            traits.userInterfaceStyle == .dark ? darkColor : lightColor
        }
    }

    init(colorMode: String, accentLight: String?, accentDark: String?, noteFont: String) {
        self.colorMode = colorMode
        self.accentLight = accentLight
        self.accentDark = accentDark
        self.noteFont = noteFont
    }

    init(values: SettingsValues, accents: [AccentOptionView], fallback: AppAppearance) {
        var accentLight = fallback.accentLight
        var accentDark = fallback.accentDark
        if !accents.isEmpty {
            let option = accents.first { $0.id == values.accentColor }
            accentLight = option?.light
            accentDark = option?.dark
        }
        self.init(
            colorMode: values.colorMode, accentLight: accentLight, accentDark: accentDark,
            noteFont: values.noteFont)
    }

    static func loadCached(from defaults: UserDefaults = .standard) -> AppAppearance? {
        guard let data = defaults.data(forKey: cacheKey) else { return nil }
        return try? JSONDecoder().decode(AppAppearance.self, from: data)
    }

    func saveCache(to defaults: UserDefaults = .standard) {
        guard let data = try? JSONEncoder().encode(self) else { return }
        defaults.set(data, forKey: Self.cacheKey)
    }

    static func color(hex: String) -> UIColor? {
        var digits = hex
        if digits.hasPrefix("#") { digits.removeFirst() }
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return nil }
        return UIColor(
            red: CGFloat((value >> 16) & 0xFF) / 255,
            green: CGFloat((value >> 8) & 0xFF) / 255,
            blue: CGFloat(value & 0xFF) / 255,
            alpha: 1)
    }
}
