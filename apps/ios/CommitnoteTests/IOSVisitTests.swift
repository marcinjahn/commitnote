import CoreRuntime
import Foundation
import XCTest

final class IOSVisitTests: RuntimeTestCase {
    private static let expectedURL = "https://analytics.invalid/count?p=%2Fapp%2Fios&t=App%20(iOS)&s=390"

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

        await IOSVisit.run(runtime: runtime.core, sender: stubbedSender(), screenWidth: 390)

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
}
