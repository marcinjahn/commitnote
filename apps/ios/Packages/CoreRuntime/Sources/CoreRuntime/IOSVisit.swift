import Foundation
import NativeCoreAPI

public protocol VisitSending: Sendable {
    func send(_ url: URL)
}

public final class IOSVisitSender: VisitSending, @unchecked Sendable {
    private let session: URLSession

    public init(configuration: URLSessionConfiguration = IOSVisitSender.makeConfiguration()) {
        self.session = URLSession(configuration: configuration)
    }

    public static func makeConfiguration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        configuration.timeoutIntervalForRequest = 30
        configuration.httpAdditionalHeaders = nil
        return configuration
    }

    public func send(_ url: URL) {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.httpShouldHandleCookies = false
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        session.dataTask(with: request).resume()
    }
}

public enum IOSVisit {
    public static func run(runtime: CoreRuntime, sender: VisitSending) async {
        guard let result = try? await runtime.send(AnalyticsVisit()),
            let text = result.url,
            let url = URL(string: text)
        else { return }
        sender.send(url)
    }
}
