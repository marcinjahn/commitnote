// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "EditorText",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [
        .library(name: "EditorText", targets: ["EditorText"])
    ],
    targets: [
        .target(name: "EditorText"),
        .testTarget(
            name: "EditorTextTests",
            dependencies: ["EditorText"]
        ),
    ],
    swiftLanguageModes: [.v6]
)
