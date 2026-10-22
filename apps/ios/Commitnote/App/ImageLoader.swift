import Foundation
import NativeCoreAPI
import UIKit

@MainActor
final class ImageLoader {
    typealias Fetch = @MainActor (String) async -> ImagePayload?

    private let fetch: Fetch
    private let cache = NSCache<NSString, UIImage>()
    private var inFlight: [String: Task<UIImage?, Never>] = [:]
    private var generation = 0
    private var memoryWarningObserver: NSObjectProtocol?

    init(fetch: @escaping Fetch) {
        self.fetch = fetch
        memoryWarningObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.cache.removeAllObjects() }
        }
    }

    func image(for imageId: String) async -> UIImage? {
        if let cached = cache.object(forKey: imageId as NSString) { return cached }
        if let pending = inFlight[imageId] { return await pending.value }

        let started = generation
        let fetch = self.fetch
        let task = Task<UIImage?, Never> {
            guard let payload = await fetch(imageId) else { return nil }
            return await Self.decode(payload.base64)
        }
        inFlight[imageId] = task
        let image = await task.value
        guard started == generation else { return image }
        inFlight[imageId] = nil
        if let image {
            cache.setObject(image, forKey: imageId as NSString)
        }
        return image
    }

    func clear() {
        generation += 1
        inFlight = [:]
        cache.removeAllObjects()
    }

    private nonisolated static func decode(_ base64: String) async -> UIImage? {
        guard let data = Data(base64Encoded: base64) else { return nil }
        return UIImage(data: data)
    }
}
