import SwiftUI
import UIKit

@MainActor
enum ShareSheet {
    static func present(url: URL, sourceRect: CGRect?) {
        guard let presenter = topPresenter() else {
            cleanUp(url)
            return
        }
        present(items: [url], from: presenter, sourceRect: sourceRect) { cleanUp(url) }
    }

    static func present(items: [Any], sourceRect: CGRect?) {
        guard let presenter = topPresenter() else { return }
        present(items: items, from: presenter, sourceRect: sourceRect, completion: nil)
    }

    private static func topPresenter() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
        guard let window = scene?.windows.first(where: \.isKeyWindow) ?? scene?.windows.first,
            var presenter = window.rootViewController
        else { return nil }
        while let presented = presenter.presentedViewController {
            presenter = presented
        }
        return presenter
    }

    private static func present(
        items: [Any], from presenter: UIViewController, sourceRect: CGRect?,
        completion: (() -> Void)?
    ) {
        let controller = UIActivityViewController(activityItems: items, applicationActivities: nil)
        if let completion {
            controller.completionWithItemsHandler = { _, _, _, _ in completion() }
        }
        if let popover = controller.popoverPresentationController {
            popover.sourceView = presenter.view
            popover.sourceRect = sourceRect
                ?? CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
        }
        presenter.present(controller, animated: !UIAccessibility.isReduceMotionEnabled)
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
