// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "NativeCoreAPI",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [
        .library(name: "NativeCoreAPI", targets: ["NativeCoreAPI"])
    ],
    targets: [
        .target(name: "NativeCoreAPI"),
        .testTarget(
            name: "NativeCoreAPITests",
            dependencies: ["NativeCoreAPI"]
        ),
    ],
    swiftLanguageModes: [.v6]
)
