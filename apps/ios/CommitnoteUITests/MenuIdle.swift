import ObjectiveC
import XCTest

/// Before and after every interaction XCTest waits for the app's run loop and then for its
/// animations to go idle. While a tree note's context menu is open the app never reports its
/// animations as finished, so each interaction there sat out XCTest's 60-second animation timeout.
/// Inside `whileMenuIsOpen` the first wait is a full one, so the menu opens on a settled screen;
/// after it only the run loop waits remain, and every step still waits for the elements it needs.
/// On iPad a text selection or caret move sometimes leaves the app never reporting idle animations
/// again until its process is relaunched, so once a full wait has run into the timeout, the rest of
/// that launch skips the animation part as well, across in-process restarts too: they keep the
/// process, and the next test's first interaction would otherwise sit out the timeout again.
private enum MenuIdle {
    case off
    case armed
    case skipping
}

private var menuIdle = MenuIdle.off
private var animationsStuck = false
/// How many of XCTest's waits for idle animations have run into their timeout.
private(set) var animationTimeouts = 0
private let animationTimeoutSeen: TimeInterval = 55

private func includesAnimations(_ requested: Bool) -> Bool {
    if animationsStuck {
        return false
    }
    switch menuIdle {
    case .off:
        return requested
    case .armed:
        menuIdle = .skipping
        return requested
    case .skipping:
        return false
    }
}

private func noteTimeout(_ included: Bool, since start: Date) {
    if included, Date().timeIntervalSince(start) >= animationTimeoutSeen {
        animationsStuck = true
        animationTimeouts += 1
        print("MENU-IDLE: animations never went idle; skipping animation waits until the next launch")
    }
}

private let animationIdleSwitch: Bool = {
    guard let process = NSClassFromString("XCUIApplicationProcess") else {
        print("MENU-IDLE: XCUIApplicationProcess not found")
        return false
    }
    let withPreEvent = NSSelectorFromString("waitForQuiescenceIncludingAnimationsIdle:isPreEvent:")
    let plain = NSSelectorFromString("waitForQuiescenceIncludingAnimationsIdle:")
    if let method = class_getInstanceMethod(process, withPreEvent) {
        typealias Wait = @convention(c) (AnyObject, Selector, Bool, Bool) -> Void
        let original = unsafeBitCast(method_getImplementation(method), to: Wait.self)
        let replacement: @convention(block) (AnyObject, Bool, Bool) -> Void = { receiver, animations, preEvent in
            let include = includesAnimations(animations)
            let start = Date()
            original(receiver, withPreEvent, include, preEvent)
            noteTimeout(include, since: start)
        }
        method_setImplementation(method, imp_implementationWithBlock(replacement))
        return true
    }
    if let method = class_getInstanceMethod(process, plain) {
        typealias Wait = @convention(c) (AnyObject, Selector, Bool) -> Void
        let original = unsafeBitCast(method_getImplementation(method), to: Wait.self)
        let replacement: @convention(block) (AnyObject, Bool) -> Void = { receiver, animations in
            let include = includesAnimations(animations)
            let start = Date()
            original(receiver, plain, include)
            noteTimeout(include, since: start)
        }
        method_setImplementation(method, imp_implementationWithBlock(replacement))
        return true
    }
    var count: UInt32 = 0
    let methods = class_copyMethodList(process, &count)
    defer { free(methods) }
    let names = (0..<Int(count)).compactMap { index in
        methods.map { NSStringFromSelector(method_getName($0[index])) }
    }
    print("MENU-IDLE: no quiescence wait to switch; candidates: \(names.filter { $0.contains("Quiescence") })")
    return false
}()

func prepareAnimationIdleForLaunch() {
    _ = animationIdleSwitch
    animationsStuck = false
}

extension XCTestCase {
    func whileMenuIsOpen<Result>(_ body: () throws -> Result) rethrows -> Result {
        _ = animationIdleSwitch
        guard menuIdle == .off else {
            return try body()
        }
        menuIdle = .armed
        defer { menuIdle = .off }
        return try body()
    }

    /// For reopening a menu once the previous one is gone.
    func waitFullyBeforeNextMenuEvent() {
        if menuIdle == .skipping {
            menuIdle = .armed
        }
    }

    /// What a menu interaction presents is not covered by XCTest's animation wait, and a pushed
    /// screen can still be sliding in once its elements exist, so either may still be moving.
    func waitUntilSettled(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        var previous = CGRect.null
        XCTAssertTrue(
            poll(timeout: 20) {
                let frame = element.frame
                defer { previous = frame }
                return frame == previous && !frame.isEmpty
            }, "Expected \(element) to settle", file: file, line: line)
    }
}
