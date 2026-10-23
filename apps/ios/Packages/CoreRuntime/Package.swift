// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "CoreRuntime",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [
        .library(name: "CoreRuntime", targets: ["CoreRuntime"])
    ],
    dependencies: [
        .package(path: "../CommitnoteCrypto"),
        .package(path: "../ImageCodec"),
        .package(path: "../NativeCoreAPI"),
    ],
    targets: [
        .target(
            name: "CoreRuntime",
            dependencies: [
                .product(name: "CommitnoteCrypto", package: "CommitnoteCrypto"),
                .product(name: "ImageCodec", package: "ImageCodec"),
                .product(name: "NativeCoreAPI", package: "NativeCoreAPI"),
            ]
        )
    ],
    swiftLanguageModes: [.v5]
)
