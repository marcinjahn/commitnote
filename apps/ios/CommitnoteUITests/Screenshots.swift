import XCTest

extension XCTestCase {
    func snapshot(_ name: String, appearance: Appearance) {
        let device = isPad ? "ipad" : "iphone"
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = "\(device)-\(appearance.rawValue)-\(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
