import UIKit
import WebKit

enum PrintRendererError: Error {
    case loadFailed
    case writeFailed
}

@MainActor
enum PrintRenderer {
    private static let paper = CGRect(x: 0, y: 0, width: 595, height: 842)
    private static let margin: CGFloat = 16 * 72 / 25.4
    private static let securityPolicy =
        "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'\">"

    static func render(html: String, noteFont: String, name: String) async throws -> URL {
        let regular = NoteFontCatalog.fileURL(id: noteFont, italic: false)
        let italic = NoteFontCatalog.fileURL(id: noteFont, italic: true)
        let faces = await Task.detached(priority: .userInitiated) {
            PrintRenderer.fontFaces(regular: regular, italic: italic)
        }.value
        let document = injectHead(securityPolicy + faces, into: html)

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        let webView = WKWebView(frame: paper, configuration: configuration)
        let host = hostWindow()
        if let host {
            webView.frame = paper.offsetBy(dx: -paper.width * 4, dy: 0)
            host.addSubview(webView)
        }
        defer { webView.removeFromSuperview() }

        let loader = PageLoader()
        try await loader.load(document, into: webView)
        _ = try? await webView.callAsyncJavaScript(
            "await document.fonts.ready; return true;", contentWorld: .defaultClient)

        let data = pdfData(from: webView)
        let fileName = sanitizedFileName(name) + ".pdf"
        guard
            let url = await Task.detached(priority: .userInitiated, operation: {
                PrintRenderer.write(data, fileName: fileName)
            }).value
        else { throw PrintRendererError.writeFailed }
        return url
    }

    private static func pdfData(from webView: WKWebView) -> Data {
        let renderer = A4PageRenderer(
            paper: paper, printable: paper.insetBy(dx: margin, dy: margin))
        let formatter = webView.viewPrintFormatter()
        formatter.perPageContentInsets = .zero
        renderer.addPrintFormatter(formatter, startingAtPageAt: 0)
        let pages = max(renderer.numberOfPages, 1)
        renderer.prepare(forDrawingPages: NSRange(location: 0, length: pages))
        return UIGraphicsPDFRenderer(bounds: paper).pdfData { context in
            for page in 0..<pages {
                context.beginPage()
                renderer.drawPage(at: page, in: context.pdfContextBounds)
            }
        }
    }

    private static func hostWindow() -> UIWindow? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
        return scene?.windows.first(where: \.isKeyWindow) ?? scene?.windows.first
    }

    private static func injectHead(_ extra: String, into html: String) -> String {
        guard let head = html.range(of: "<head>") else { return extra + html }
        var result = html
        result.insert(contentsOf: extra, at: head.upperBound)
        return result
    }

    private nonisolated static func fontFaces(regular: URL?, italic: URL?) -> String {
        let faces: [(URL?, String)] = [(regular, "normal"), (italic, "italic")]
        return faces.compactMap { face -> String? in
            let (url, style) = face
            guard let url, let data = try? Data(contentsOf: url) else { return nil }
            return
                "@font-face{font-family:\"commitnote-note\";src:url(data:font/ttf;base64,\(data.base64EncodedString())) format(\"truetype\");font-style:\(style);font-weight:100 900}"
        }
        .map { (face: String) in "<style>\(face)</style>" }
        .joined()
    }

    private static func sanitizedFileName(_ name: String) -> String {
        let forbidden = CharacterSet(charactersIn: "/\\:*?\"<>|").union(.controlCharacters)
        let cleaned = name.unicodeScalars
            .map { forbidden.contains($0) ? "-" : String($0) }
            .joined()
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmed = String(cleaned.drop(while: { $0 == "." }).prefix(120))
        return trimmed.isEmpty ? "commitnote" : trimmed
    }

    private nonisolated static func write(_ data: Data, fileName: String) -> URL? {
        do {
            let directory = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(
                at: directory, withIntermediateDirectories: true)
            let url = directory.appendingPathComponent(fileName)
            try data.write(to: url, options: .atomic)
            return url
        } catch {
            return nil
        }
    }
}

private final class A4PageRenderer: UIPrintPageRenderer {
    private let paper: CGRect
    private let printable: CGRect

    init(paper: CGRect, printable: CGRect) {
        self.paper = paper
        self.printable = printable
        super.init()
    }

    override var paperRect: CGRect { paper }
    override var printableRect: CGRect { printable }
}

@MainActor
private final class PageLoader: NSObject, WKNavigationDelegate {
    private var continuation: CheckedContinuation<Void, Error>?

    func load(_ html: String, into webView: WKWebView) async throws {
        webView.navigationDelegate = self
        defer { webView.navigationDelegate = nil }
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            webView.loadHTMLString(html, baseURL: nil)
        }
    }

    func webView(
        _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction
    ) async -> WKNavigationActionPolicy {
        navigationAction.request.url?.scheme == "about" ? .allow : .cancel
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        finish(nil)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        finish(error)
    }

    func webView(
        _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        finish(error)
    }

    private func finish(_ error: Error?) {
        guard let continuation else { return }
        self.continuation = nil
        if error != nil {
            continuation.resume(throwing: PrintRendererError.loadFailed)
        } else {
            continuation.resume()
        }
    }
}
