// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ImageCodec",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [
        .library(name: "ImageCodec", targets: ["ImageCodec"])
    ],
    targets: [
        .target(
            name: "CWebP",
            path: "Sources/CWebP",
            exclude: ["VENDORED.md", "COPYING", "PATENTS"],
            publicHeadersPath: "src/webp",
            cSettings: [.headerSearchPath(".")],
            linkerSettings: [.linkedLibrary("m", .when(platforms: [.linux]))]
        ),
        .target(
            name: "ImageCodec",
            dependencies: ["CWebP"]
        ),
        .testTarget(
            name: "ImageCodecTests",
            dependencies: ["ImageCodec", "CWebP"]
        ),
    ],
    swiftLanguageModes: [.v6]
)
