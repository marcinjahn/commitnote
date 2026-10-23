import CWebP
import Testing

@testable import ImageCodec

private func decode(_ data: [UInt8]) -> (pixels: [UInt8], width: Int, height: Int)? {
    var w: Int32 = 0
    var h: Int32 = 0
    guard let ptr = data.withUnsafeBufferPointer({ WebPDecodeRGBA($0.baseAddress, $0.count, &w, &h) }) else {
        return nil
    }
    defer { WebPFree(ptr) }
    return (Array(UnsafeBufferPointer(start: ptr, count: Int(w) * Int(h) * 4)), Int(w), Int(h))
}

private func gradient(width: Int, height: Int, alpha: UInt8 = 255) -> [UInt8] {
    var pixels = [UInt8]()
    for y in 0..<height {
        for x in 0..<width {
            pixels += [UInt8(x * 255 / max(1, width - 1)), UInt8(y * 255 / max(1, height - 1)), 128, alpha]
        }
    }
    return pixels
}

@Suite struct WebPEncoderTests {
    @Test func encodesGradientToDecodableWebP() throws {
        let source = gradient(width: 64, height: 48)
        let data = try WebPEncoder.encode(rgba: source, width: 64, height: 48, quality: 0.85)

        #expect(Array(data[0..<4]) == Array("RIFF".utf8))
        #expect(Array(data[8..<12]) == Array("WEBP".utf8))
        let decoded = try #require(decode(data))
        #expect(decoded.width == 64)
        #expect(decoded.height == 48)
        var total = 0
        for i in 0..<source.count { total += abs(Int(source[i]) - Int(decoded.pixels[i])) }
        #expect(Double(total) / Double(source.count) < 8)
    }

    @Test func preservesAlpha() throws {
        let source = gradient(width: 32, height: 32, alpha: 128)
        let data = try WebPEncoder.encode(rgba: source, width: 32, height: 32, quality: 0.85)
        let decoded = try #require(decode(data))
        for i in stride(from: 3, to: decoded.pixels.count, by: 4) {
            #expect(abs(Int(decoded.pixels[i]) - 128) <= 8)
        }
    }

    @Test func higherQualityProducesMoreBytes() throws {
        var state: UInt64 = 12345
        var noise = [UInt8]()
        for _ in 0..<(256 * 256) {
            for _ in 0..<3 {
                state = state &* 6364136223846793005 &+ 1442695040888963407
                noise.append(UInt8(truncatingIfNeeded: state >> 33))
            }
            noise.append(255)
        }
        let high = try WebPEncoder.encode(rgba: noise, width: 256, height: 256, quality: 0.85)
        let low = try WebPEncoder.encode(rgba: noise, width: 256, height: 256, quality: 0.6)
        #expect(high.count > low.count)
    }

    @Test func rejectsInvalidInput() {
        let pixel: [UInt8] = [0, 0, 0, 255]
        #expect(throws: ImageCodecError.invalidInput) {
            try WebPEncoder.encode(rgba: pixel, width: 0, height: 1, quality: 0.8)
        }
        #expect(throws: ImageCodecError.invalidInput) {
            try WebPEncoder.encode(rgba: pixel, width: 1, height: -1, quality: 0.8)
        }
        #expect(throws: ImageCodecError.invalidInput) {
            try WebPEncoder.encode(rgba: pixel, width: 2, height: 1, quality: 0.8)
        }
        #expect(throws: ImageCodecError.invalidInput) {
            try WebPEncoder.encode(rgba: [], width: 16384, height: 1, quality: 0.8)
        }
    }

    @Test func encodesSinglePixel() throws {
        let data = try WebPEncoder.encode(rgba: [10, 20, 30, 255], width: 1, height: 1, quality: 0.85)
        let decoded = try #require(decode(data))
        #expect(decoded.width == 1)
        #expect(decoded.height == 1)
    }
}

@Suite struct PremultipliedRGBATests {
    @Test func unpremultipliesKnownValues() {
        var pixels: [UInt8] = [10, 20, 30, 0, 64, 32, 0, 128, 1, 2, 3, 255]
        PremultipliedRGBA.unpremultiply(&pixels)
        #expect(pixels == [0, 0, 0, 0, 128, 64, 0, 128, 1, 2, 3, 255])
    }

    @Test func opaquePixelsAreIdempotent() {
        let original: [UInt8] = [255, 0, 17, 255, 3, 4, 5, 255]
        var pixels = original
        PremultipliedRGBA.unpremultiply(&pixels)
        PremultipliedRGBA.unpremultiply(&pixels)
        #expect(pixels == original)
    }

    @Test func clampsOverflowingChannels() {
        var pixels: [UInt8] = [200, 0, 0, 100]
        PremultipliedRGBA.unpremultiply(&pixels)
        #expect(pixels == [255, 0, 0, 100])
    }
}
