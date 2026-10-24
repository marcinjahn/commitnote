import CoreRuntime
import Foundation
import NativeCoreAPI
import XCTest

final class StubURLProtocol: URLProtocol {
    struct Recorded {
        var request: URLRequest
        var body: Data
    }

    typealias Handler = @Sendable (URLRequest) -> Result<(HTTPURLResponse, Data), Error>

    private static let lock = NSLock()
    private static var handler: Handler?
    private static var recorded: [Recorded] = []

    static func install(_ handler: @escaping Handler) {
        lock.withLock {
            self.handler = handler
            recorded = []
        }
    }

    static func uninstall() {
        lock.withLock {
            handler = nil
            recorded = []
        }
    }

    static var requests: [Recorded] {
        lock.withLock { recorded }
    }

    override class func canInit(with request: URLRequest) -> Bool {
        guard let host = request.url?.host else { return false }
        return ["stub.invalid", "analytics.invalid"].contains(host)
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        let request = self.request
        let body = Self.readBody(of: request)
        let handler = Self.lock.withLock { () -> Handler? in
            Self.recorded.append(Recorded(request: request, body: body))
            return Self.handler
        }
        guard let handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.unknown))
            return
        }
        switch handler(request) {
        case .success(let (response, data)):
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        case .failure(let error):
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}

    private static func readBody(of request: URLRequest) -> Data {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return Data() }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}

final class HTTPTests: RuntimeTestCase {
    override func setUp() async throws {
        try await super.setUp()
        StubURLProtocol.uninstall()
    }

    override func tearDown() async throws {
        StubURLProtocol.uninstall()
        try await super.tearDown()
    }

    private func makeStubbedRuntime() async throws -> TestRuntime {
        let configuration = URLSessionHTTPClient.makeConfiguration()
        configuration.protocolClasses = [StubURLProtocol.self]
        return try await makeRuntime(http: URLSessionHTTPClient(configuration: configuration))
    }

    private static func stubResponse(
        _ url: URL, status: Int, headers: [String: String], body: String
    ) -> Result<(HTTPURLResponse, Data), Error> {
        let response = HTTPURLResponse(
            url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        return .success((response, Data(body.utf8)))
    }

    func testRequestAndResponseRoundTrip() async throws {
        StubURLProtocol.install { request in
            Self.stubResponse(
                request.url!, status: 201,
                headers: ["X-Reply": "Yes", "Content-Type": "text/plain; charset=utf-8"],
                body: "reply ✓\nsecond line")
        }
        let runtime = try await makeStubbedRuntime()

        let result = try await runtime.send(
            FakeHTTPRequest(
                method: "POST",
                url: "https://stub.invalid/echo?x=1",
                headers: ["X-Custom-Header": "Value 1", "Content-Type": "text/plain"],
                bodyText: "héllo\nbody"))

        XCTAssertEqual(result.status, 201)
        XCTAssertEqual(result.headers["x-reply"], "Yes")
        XCTAssertEqual(result.bodyText, "reply ✓\nsecond line")

        let recorded = try XCTUnwrap(StubURLProtocol.requests.first)
        XCTAssertEqual(StubURLProtocol.requests.count, 1)
        XCTAssertEqual(recorded.request.httpMethod, "POST")
        XCTAssertEqual(recorded.request.url?.absoluteString, "https://stub.invalid/echo?x=1")
        XCTAssertEqual(recorded.request.value(forHTTPHeaderField: "x-custom-header"), "Value 1")
        XCTAssertEqual(recorded.request.value(forHTTPHeaderField: "CONTENT-TYPE"), "text/plain")
        XCTAssertEqual(String(decoding: recorded.body, as: UTF8.self), "héllo\nbody")
    }

    func testBodylessRequestAndErrorStatus() async throws {
        StubURLProtocol.install { request in
            Self.stubResponse(request.url!, status: 404, headers: [:], body: "missing")
        }
        let runtime = try await makeStubbedRuntime()

        let result = try await runtime.send(
            FakeHTTPRequest(
                method: "GET", url: "https://stub.invalid/missing", headers: [:], bodyText: ""))

        XCTAssertEqual(result.status, 404)
        XCTAssertEqual(result.bodyText, "missing")
        let recorded = try XCTUnwrap(StubURLProtocol.requests.first)
        XCTAssertEqual(recorded.request.httpMethod, "GET")
        XCTAssertTrue(recorded.body.isEmpty)
    }

    func testTransportErrorSurfacesAsFailure() async throws {
        StubURLProtocol.install { _ in .failure(URLError(.notConnectedToInternet)) }
        let runtime = try await makeStubbedRuntime()

        do {
            _ = try await runtime.send(
                FakeHTTPRequest(
                    method: "GET", url: "https://stub.invalid/offline", headers: [:], bodyText: ""))
            XCTFail("The request should have failed")
        } catch let error as CoreError {
            XCTAssertTrue(
                [CoreError.Kind.network, CoreError.Kind.internal].contains(error.kind),
                "Unexpected error kind \(error.kind)")
        }
        XCTAssertEqual(StubURLProtocol.requests.count, 1)
    }
}
