import CWebP

public enum WebPEncoder {
    private static let maxDimension = 16383

    public static func encode(rgba: [UInt8], width: Int, height: Int, quality: Double) throws -> [UInt8] {
        guard width > 0, height > 0, width <= maxDimension, height <= maxDimension,
            rgba.count == width * height * 4
        else {
            throw ImageCodecError.invalidInput
        }
        let clamped = quality.isNaN ? 0 : min(100, max(0, quality * 100))

        var output: UnsafeMutablePointer<UInt8>?
        let size = rgba.withUnsafeBufferPointer { buffer in
            WebPEncodeRGBA(buffer.baseAddress, Int32(width), Int32(height), Int32(width * 4), Float(clamped), &output)
        }
        guard size > 0, let output else {
            if let output { WebPFree(output) }
            throw ImageCodecError.encodingFailed
        }
        defer { WebPFree(output) }
        return Array(UnsafeBufferPointer(start: output, count: size))
    }
}
