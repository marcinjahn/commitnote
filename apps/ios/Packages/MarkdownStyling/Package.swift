// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "MarkdownStyling",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [
        .library(name: "MarkdownStyling", targets: ["MarkdownStyling"])
    ],
    dependencies: [
        .package(path: "../EditorText")
    ],
    targets: [
        .target(
            name: "MarkdownStyling",
            dependencies: [.product(name: "EditorText", package: "EditorText")]
        ),
        .testTarget(
            name: "MarkdownStylingTests",
            dependencies: ["MarkdownStyling"]
        ),
    ],
    swiftLanguageModes: [.v6]
)
