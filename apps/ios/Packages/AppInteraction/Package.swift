// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "AppInteraction",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [
        .library(name: "AppInteraction", targets: ["AppInteraction"])
    ],
    dependencies: [
        .package(path: "../NativeCoreAPI")
    ],
    targets: [
        .target(
            name: "AppInteraction",
            dependencies: [.product(name: "NativeCoreAPI", package: "NativeCoreAPI")]
        ),
        .testTarget(
            name: "AppInteractionTests",
            dependencies: ["AppInteraction", .product(name: "NativeCoreAPI", package: "NativeCoreAPI")]
        ),
    ],
    swiftLanguageModes: [.v6]
)
