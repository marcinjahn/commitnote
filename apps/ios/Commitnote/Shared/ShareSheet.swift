import SwiftUI
import UIKit

@MainActor
enum ShareSheet {
    static func present(url: URL, sourceRect: CGRect?) {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
        guard let window = scene?.windows.first(where: \.isKeyWindow) ?? scene?.windows.first,
            var presenter = window.rootViewController
        else {
            cleanUp(url)
            return
        }
        while let presented = presenter.presentedViewController {
            presenter = presented
        }
        let controller = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        controller.completionWithItemsHandler = { _, _, _, _ in
            cleanUp(url)
        }
        if let popover = controller.popoverPresentationController {
            popover.sourceView = presenter.view
            popover.sourceRect = sourceRect
                ?? CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
        }
        presenter.present(controller, animated: true)
    }

    private static func cleanUp(_ url: URL) {
        let manager = FileManager.default
        try? manager.removeItem(at: url)
        let directory = url.deletingLastPathComponent()
        if directory.path != NSTemporaryDirectory(), (try? manager.contentsOfDirectory(atPath: directory.path))?.isEmpty == true {
            try? manager.removeItem(at: directory)
        }
    }
}
