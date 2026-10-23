import CoreGraphics
import Foundation
import ImageIO
import NativeCoreAPI
import UIKit
import UniformTypeIdentifiers
import XCTest

struct PixelColor: Equatable {
    var red: UInt8
    var green: UInt8
    var blue: UInt8
    var alpha: UInt8
}

enum TestImages {
    static func render(
        width: Int, height: Int, opaque: Bool = true,
        draw: (CGContext, CGSize) -> Void
    ) -> CGImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = opaque
        let size = CGSize(width: width, height: height)
        let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
            draw(context.cgContext, size)
        }
        return image.cgImage!
    }

    static func photo(width: Int, height: Int) -> CGImage {
        render(width: width, height: height) { context, size in
            let colors = [UIColor.systemOrange.cgColor, UIColor.systemTeal.cgColor] as CFArray
            let gradient = CGGradient(
                colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1])!
            context.drawLinearGradient(
                gradient, start: .zero, end: CGPoint(x: size.width, y: size.height), options: [])
            let text = "Commitnote" as NSString
            text.draw(
                at: CGPoint(x: size.width / 8, y: size.height / 3),
                withAttributes: [
                    .font: UIFont.boldSystemFont(ofSize: size.height / 6),
                    .foregroundColor: UIColor.white,
                ])
        }
    }

    static func encode(
        _ image: CGImage, as type: UTType, properties: [CFString: Any] = [:]
    ) throws -> Data {
        let data = NSMutableData()
        guard
            let destination = CGImageDestinationCreateWithData(
                data, type.identifier as CFString, 1, nil)
        else {
            throw TestTimeout(description: "No image destination for \(type.identifier)")
        }
        CGImageDestinationAddImage(destination, image, properties as CFDictionary)
        guard CGImageDestinationFinalize(destination) else {
            throw TestTimeout(description: "Encoding \(type.identifier) failed")
        }
        return data as Data
    }

    static func decode(_ data: Data) throws -> CGImage {
        guard let image = UIImage(data: data)?.cgImage else {
            throw TestTimeout(description: "The system decoder rejected the image")
        }
        return image
    }

    static func pixel(_ image: CGImage, x: Int, y: Int) -> PixelColor {
        var bytes = [UInt8](repeating: 0, count: 4)
        bytes.withUnsafeMutableBytes { buffer in
            let context = CGContext(
                data: buffer.baseAddress, width: 1, height: 1, bitsPerComponent: 8,
                bytesPerRow: 4, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            context.draw(
                image,
                in: CGRect(x: -x, y: -(image.height - 1 - y), width: image.width, height: image.height))
        }
        return PixelColor(red: bytes[0], green: bytes[1], blue: bytes[2], alpha: bytes[3])
    }

    static func fitWithin(width: Int, height: Int, maxLongEdge: Int) -> (width: Int, height: Int) {
        let longEdge = max(width, height)
        if longEdge <= maxLongEdge { return (width, height) }
        let scale = Double(maxLongEdge) / Double(longEdge)
        func scaled(_ value: Int) -> Int {
            value == longEdge ? maxLongEdge : max(1, Int((Double(value) * scale).rounded()))
        }
        return (scaled(width), scaled(height))
    }

    static func size(of reference: String) throws -> (id: String, width: Int, height: Int) {
        let pattern = try NSRegularExpression(pattern: #"image:([a-z2-7]{26})#(\d+)x(\d+)"#)
        guard let match = pattern.firstMatch(in: reference, range: NSRange(reference.startIndex..., in: reference))
        else {
            throw TestTimeout(description: "Not an image reference")
        }
        func group(_ index: Int) throws -> String {
            guard let range = Range(match.range(at: index), in: reference) else {
                throw TestTimeout(description: "Not an image reference")
            }
            return String(reference[range])
        }
        guard let width = Int(try group(2)), let height = Int(try group(3)) else {
            throw TestTimeout(description: "Not an image reference")
        }
        return (try group(1), width, height)
    }
}

final class ImageCodecTests: RuntimeTestCase {
    private func process(
        _ runtime: TestRuntime, _ data: Data, type: String, profile: FakeProcessImage.Profile
    ) async throws -> FakeProcessImage.Processed {
        try await runtime.send(
            FakeProcessImage(base64: data.base64EncodedString(), type: type, profile: profile)
        ).result
    }

    private func decodedOutput(_ result: FakeProcessImage.Processed) throws -> (Data, CGImage) {
        let data = try XCTUnwrap(result.base64.flatMap { Data(base64Encoded: $0) })
        return (data, try TestImages.decode(data))
    }

    func testLargePhotoIsDownscaledToTheNoteProfile() async throws {
        let runtime = try await makeRuntime()
        let jpeg = try TestImages.encode(
            TestImages.photo(width: 4032, height: 3024), as: .jpeg,
            properties: [kCGImageDestinationLossyCompressionQuality: 0.9])

        let result = try await process(runtime, jpeg, type: "image/jpeg", profile: .note)

        XCTAssertTrue(result.ok)
        XCTAssertEqual(result.type, "image/webp")
        XCTAssertEqual(result.width, 2560)
        XCTAssertEqual(result.height, 1920)
        let (data, decoded) = try decodedOutput(result)
        XCTAssertEqual(decoded.width, 2560)
        XCTAssertEqual(decoded.height, 1920)
        XCTAssertLessThanOrEqual(data.count, 2 * 1024 * 1024)
    }

    func testExifOrientationIsApplied() async throws {
        let runtime = try await makeRuntime()
        let stored = TestImages.render(width: 300, height: 200) { context, _ in
            context.setFillColor(UIColor.red.cgColor)
            context.fill(CGRect(x: 0, y: 0, width: 150, height: 200))
            context.setFillColor(UIColor.blue.cgColor)
            context.fill(CGRect(x: 150, y: 0, width: 150, height: 200))
        }
        let jpeg = try TestImages.encode(
            stored, as: .jpeg,
            properties: [
                kCGImagePropertyOrientation: 6,
                kCGImageDestinationLossyCompressionQuality: 0.95,
            ])

        let result = try await process(runtime, jpeg, type: "image/jpeg", profile: .note)

        XCTAssertEqual(result.width, 200)
        XCTAssertEqual(result.height, 300)
        let (_, decoded) = try decodedOutput(result)
        XCTAssertEqual(decoded.width, 200)
        XCTAssertEqual(decoded.height, 300)

        func expectedColor(displayedY: Int) -> (red: Bool, blue: Bool) {
            let storedX = displayedY
            return storedX < 150 ? (true, false) : (false, true)
        }
        for displayedY in [20, 280] {
            let pixel = TestImages.pixel(decoded, x: 20, y: displayedY)
            let expected = expectedColor(displayedY: displayedY)
            if expected.red {
                XCTAssertGreaterThan(pixel.red, 200)
                XCTAssertLessThan(pixel.blue, 60)
            } else {
                XCTAssertGreaterThan(pixel.blue, 200)
                XCTAssertLessThan(pixel.red, 60)
            }
        }
    }

    func testAlphaSurvives() async throws {
        let runtime = try await makeRuntime()
        let source = TestImages.render(width: 64, height: 64, opaque: false) { context, _ in
            context.setFillColor(UIColor.green.cgColor)
            context.fill(CGRect(x: 32, y: 0, width: 32, height: 64))
        }
        let png = try TestImages.encode(source, as: .png)

        let result = try await process(runtime, png, type: "image/png", profile: .note)

        XCTAssertEqual(result.type, "image/webp")
        let (_, decoded) = try decodedOutput(result)
        XCTAssertLessThanOrEqual(TestImages.pixel(decoded, x: 8, y: 32).alpha, 8)
        XCTAssertGreaterThanOrEqual(TestImages.pixel(decoded, x: 56, y: 32).alpha, 247)
    }

    func testShareProfileAndGif() async throws {
        let runtime = try await makeRuntime()
        let jpeg = try TestImages.encode(
            TestImages.photo(width: 4032, height: 3024), as: .jpeg,
            properties: [kCGImageDestinationLossyCompressionQuality: 0.9])

        let shared = try await process(runtime, jpeg, type: "image/jpeg", profile: .share)

        XCTAssertEqual(shared.type, "image/webp")
        XCTAssertEqual(shared.width, 1600)
        XCTAssertEqual(shared.height, 1200)

        let gif = try TestImages.encode(TestImages.photo(width: 48, height: 32), as: .gif)
        let kept = try await process(runtime, gif, type: "image/gif", profile: .note)

        XCTAssertEqual(kept.type, "image/gif")
        XCTAssertEqual(kept.width, 48)
        XCTAssertEqual(kept.height, 32)
        let bytes = try XCTUnwrap(kept.base64.flatMap { Data(base64Encoded: $0) })
        XCTAssertEqual(Array(bytes.prefix(4)), Array("GIF8".utf8))
    }

    func testHeicIsAcceptedWhenTheSimulatorCanWriteIt() async throws {
        let writable = CGImageDestinationCopyTypeIdentifiers() as? [String] ?? []
        try XCTSkipUnless(
            writable.contains(UTType.heic.identifier), "This simulator cannot write HEIC")
        let runtime = try await makeRuntime()
        let heic = try TestImages.encode(TestImages.photo(width: 640, height: 480), as: .heic)

        let result = try await process(runtime, heic, type: "image/heic", profile: .note)

        XCTAssertTrue(result.ok)
        XCTAssertEqual(result.type, "image/webp")
        XCTAssertEqual(result.width, 640)
        XCTAssertEqual(result.height, 480)
    }

    func testImageInsertAndShareWithTheRealCodec() async throws {
        let runtime = try await makeRuntime()
        try await runtime.logIn(repo: "sample/notes", passphrase: sampleNotesPassphrase)
        let text = try await runtime.openNoteLoaded(["Welcome"])
        let png = try TestImages.encode(TestImages.photo(width: 3000, height: 2000), as: .png)
        let expected = TestImages.fitWithin(width: 3000, height: 2000, maxLongEdge: 2560)
        XCTAssertEqual(expected.width, 2560)
        XCTAssertEqual(expected.height, 1707)

        let input = runtime.core.stageImageInput(png, type: "image/png")
        let references = try await runtime.send(ImageInsert(inputs: [input])).references

        let reference = try XCTUnwrap(references.first)
        XCTAssertEqual(references.count, 1)
        let parsed = try TestImages.size(of: reference)
        XCTAssertEqual(parsed.width, expected.width)
        XCTAssertEqual(parsed.height, expected.height)

        _ = try await runtime.send(NoteEdit(path: ["Welcome"], text: "\(text)\n\(reference)\n"))
        let flushed = try await runtime.send(SyncFlush()).result
        XCTAssertEqual(flushed, .saved)

        let read = try await runtime.send(ImageRead(imageId: parsed.id))
        let payload = try XCTUnwrap(read.image)
        XCTAssertEqual(payload.type, .webp)
        let decoded = try TestImages.decode(try XCTUnwrap(Data(base64Encoded: payload.base64)))
        XCTAssertEqual(decoded.width, expected.width)
        XCTAssertEqual(decoded.height, expected.height)

        let outcome = try await runtime.send(
            ShareCreate(path: ["Welcome"], password: "", label: "Photo")
        ).outcome
        guard case .created = outcome else {
            return XCTFail("The share was not created: \(outcome)")
        }
    }
}
