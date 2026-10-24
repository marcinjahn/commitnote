import CoreRuntime
import Foundation
import NativeCoreAPI
import XCTest

private final class RecordingSender: VisitSending, @unchecked Sendable {
    private let lock = NSLock()
    private var urls: [URL] = []

    var sent: [URL] { lock.withLock { urls } }

    func send(_ url: URL) {
        lock.withLock { urls.append(url) }
    }
}

final class IOSVisitTests: RuntimeTestCase {
    private static let expectedURL = "https://analytics.invalid/count?p=%2Fapp%2Fios&t=App%20(iOS)"

    override func setUp() async throws {
        try await super.setUp()
        StubURLProtocol.uninstall()
    }

    override func tearDown() async throws {
        StubURLProtocol.uninstall()
        try await super.tearDown()
    }

    private func stubbedSender() -> IOSVisitSender {
        StubURLProtocol.install { request in
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [:])!
            return .success((response, Data()))
        }
        let configuration = IOSVisitSender.makeConfiguration()
        configuration.protocolClasses = [StubURLProtocol.self]
        return IOSVisitSender(configuration: configuration)
    }

    private func firstRecordedRequest() async throws -> URLRequest {
        try await poll(
            timeout: .seconds(10), interval: .milliseconds(250), description: "the visit request"
        ) {
            StubURLProtocol.requests.first?.request
        }
    }

    func testVisitSendsExactAnonymousRequest() async throws {
        let runtime = try await makeRuntime()

        await IOSVisit.run(runtime: runtime.core, sender: stubbedSender())

        let request = try await firstRecordedRequest()
        XCTAssertEqual(StubURLProtocol.requests.count, 1)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.absoluteString, Self.expectedURL)
        XCTAssertNil(request.httpBody)
        XCTAssertNil(request.httpBodyStream)
        let headerNames = Set((request.allHTTPHeaderFields ?? [:]).keys.map { $0.lowercased() })
        for forbidden in ["cookie", "referer", "authorization"] {
            XCTAssertFalse(headerNames.contains(forbidden), "Unexpected \(forbidden) header")
        }
    }

    func testOptedOutVisitSendsNothing() async throws {
        let runtime = try await makeRuntime()
        _ = try await runtime.send(AnalyticsSetCounted(counted: false))
        let sender = RecordingSender()

        let result = try await runtime.send(AnalyticsVisit())
        await IOSVisit.run(runtime: runtime.core, sender: sender)

        XCTAssertNil(result.url)
        XCTAssertTrue(sender.sent.isEmpty)
    }

    func testOptingBackInSendsVisit() async throws {
        let runtime = try await makeRuntime()
        _ = try await runtime.send(AnalyticsSetCounted(counted: false))
        _ = try await runtime.send(AnalyticsSetCounted(counted: true))
        let sender = RecordingSender()

        await IOSVisit.run(runtime: runtime.core, sender: sender)

        XCTAssertEqual(sender.sent.map(\.absoluteString), [Self.expectedURL])
    }
}
