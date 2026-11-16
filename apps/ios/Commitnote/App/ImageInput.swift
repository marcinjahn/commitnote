import Foundation

struct ImageInput: Sendable, Equatable {
    let data: Data
    let mimeType: String
}

enum ImageSourceKind: Sendable {
    case photos, camera, files
}

struct PickedImages: Identifiable, Equatable {
    let id = UUID()
    let inputs: [ImageInput]
}
