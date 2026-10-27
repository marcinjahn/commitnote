import Foundation
import NativeCoreAPI

public enum LaunchLink {
    public static let scheme = "commitnote"

    public static func action(from url: URL) -> LaunchAction? {
        guard url.scheme?.lowercased() == scheme else { return nil }
        if let host = url.host?.lowercased(), let action = LaunchAction(rawValue: host) {
            return action
        }
        guard let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
            let item = items.first(where: { $0.name == "action" }),
            let value = item.value
        else { return nil }
        return LaunchAction(rawValue: value)
    }
}
