import XCTest

/// Captures the showcase repo for the store listing and the landing page; the "iOS screenshots"
/// workflow runs only this class.
final class StoreScreenshotTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testCaptureStoreScreens() {
        let app = launchApp(reset: true)
        logInToNotes(Fixture.showcase, in: app)
        expandFolder("Projects", in: app)
        expandFolder("Travel", in: app)
        waitFor(note("Packing list", in: app))
        snapshotBothAppearances("store-tree")

        openNote("Weather station", startingWith: "# Weather station", in: app)
        snapshotBothAppearances("store-note")
    }
}
