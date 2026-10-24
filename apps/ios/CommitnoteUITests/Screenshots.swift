import XCTest

private let appearanceRequestPrefix = "io.github.marcinjahn.commitnote.testing.appearance."
private let appearanceAppliedPrefix = "io.github.marcinjahn.commitnote.testing.appearance-applied."

private nonisolated(unsafe) var appliedAppearance: String?

private let appearanceApplied: CFNotificationCallback = { _, _, name, _, _ in
    appliedAppearance = name.map { $0.rawValue as String }
}

private let appearanceObserver: Void = {
    for appearance in [Appearance.light, Appearance.dark] {
        CFNotificationCenterAddObserver(
            CFNotificationCenterGetDarwinNotifyCenter(), nil, appearanceApplied,
            (appearanceAppliedPrefix + appearance.rawValue) as CFString, nil, .deliverImmediately)
    }
}()

extension XCTestCase {
    func snapshot(_ name: String, appearance: Appearance) {
        let device = isPad ? "ipad" : "iphone"
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = "\(device)-\(appearance.rawValue)-\(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// Captures the screen in light, switches the running app to dark for a second capture, and
    /// switches it back, so each screen is reached once for both appearances.
    func snapshotBothAppearances(_ name: String, file: StaticString = #filePath, line: UInt = #line) {
        snapshot(name, appearance: .light)
        switchAppearance(.dark, file: file, line: line)
        snapshot(name, appearance: .dark)
        switchAppearance(.light, file: file, line: line)
    }

    func switchAppearance(_ appearance: Appearance, file: StaticString = #filePath, line: UInt = #line) {
        _ = appearanceObserver
        appliedAppearance = nil
        let applied = (0..<3).contains { _ in
            CFNotificationCenterPostNotification(
                CFNotificationCenterGetDarwinNotifyCenter(),
                CFNotificationName((appearanceRequestPrefix + appearance.rawValue) as CFString), nil, nil, true)
            return poll(timeout: 5) { appliedAppearance == appearanceAppliedPrefix + appearance.rawValue }
        }
        XCTAssertTrue(applied, "The app switched to \(appearance.rawValue)", file: file, line: line)
    }
}
