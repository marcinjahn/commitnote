// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "CommitnoteCrypto",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [
        .library(name: "CommitnoteCrypto", targets: ["CommitnoteCrypto"])
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-crypto.git", from: "3.0.0")
    ],
    targets: [
        .target(
            name: "CArgon2",
            path: "Sources/CArgon2",
            exclude: ["VENDORED.md", "LICENSE"],
            cSettings: [.define("ARGON2_NO_THREADS")]
        ),
        .target(
            name: "CommitnoteCrypto",
            dependencies: [
                "CArgon2",
                .product(name: "Crypto", package: "swift-crypto"),
            ]
        ),
        .testTarget(
            name: "CommitnoteCryptoTests",
            dependencies: ["CommitnoteCrypto"]
        ),
    ],
    swiftLanguageModes: [.v6]
)
