import CoreGraphics
import Foundation
import ImageCodec
import ImageIO

public struct SystemImageCodec: ImageCodecService {
    public init() {}

    public func decode(_ data: Data) throws -> DecodedImage {
        let options: [CFString: Any] = [kCGImageSourceShouldCache: false]
        guard let source = CGImageSourceCreateWithData(data as CFData, options as CFDictionary),
            CGImageSourceGetCount(source) > 0,
            CGImageSourceGetType(source) != nil,
            let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any],
            let pixelWidth = properties[kCGImagePropertyPixelWidth as String] as? Int,
            let pixelHeight = properties[kCGImagePropertyPixelHeight as String] as? Int,
            pixelWidth > 0, pixelHeight > 0
        else {
            throw ImageCodecError.invalidInput
        }
        let orientation = properties[kCGImagePropertyOrientation as String] as? Int ?? 1
        let rotated = (5...8).contains(orientation)
        return DecodedImage(
            source: source,
            width: rotated ? pixelHeight : pixelWidth,
            height: rotated ? pixelWidth : pixelHeight)
    }

    public func encodeWebP(_ image: DecodedImage, width: Int, height: Int, quality: Double) throws -> Data {
        guard width > 0, height > 0 else { throw ImageCodecError.invalidInput }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: max(width, height),
        ]
        guard let thumbnail = CGImageSourceCreateThumbnailAtIndex(image.source, 0, options as CFDictionary),
            let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
            let context = CGContext(
                data: nil,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: 0,
                space: colorSpace,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue)
        else {
            throw ImageCodecError.encodingFailed
        }
        let rect = CGRect(x: 0, y: 0, width: width, height: height)
        context.clear(rect)
        context.interpolationQuality = .high
        context.draw(thumbnail, in: rect)
        guard let base = context.data else { throw ImageCodecError.encodingFailed }

        let rowBytes = width * 4
        let bytesPerRow = context.bytesPerRow
        guard bytesPerRow >= rowBytes else { throw ImageCodecError.encodingFailed }
        var pixels = [UInt8](repeating: 0, count: rowBytes * height)
        pixels.withUnsafeMutableBytes { destination in
            guard let target = destination.baseAddress else { return }
            for row in 0..<height {
                target.advanced(by: row * rowBytes)
                    .copyMemory(from: base.advanced(by: row * bytesPerRow), byteCount: rowBytes)
            }
        }
        PremultipliedRGBA.unpremultiply(&pixels)
        return Data(try WebPEncoder.encode(rgba: pixels, width: width, height: height, quality: quality))
    }
}
