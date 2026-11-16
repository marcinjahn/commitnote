public enum PremultipliedRGBA {
    public static func unpremultiply(_ pixels: inout [UInt8]) {
        let count = pixels.count - pixels.count % 4
        var index = 0
        while index < count {
            let alpha = Int(pixels[index + 3])
            if alpha == 0 {
                pixels[index] = 0
                pixels[index + 1] = 0
                pixels[index + 2] = 0
            } else if alpha < 255 {
                for channel in 0..<3 {
                    let value = Int(pixels[index + channel])
                    pixels[index + channel] = UInt8(min(255, (value * 255 + alpha / 2) / alpha))
                }
            }
            index += 4
        }
    }
}
