import MarkdownStyling
import UIKit

enum EditorImageState {
    case loading
    case loaded(UIImage)
    case unavailable

    var accessibilityValue: String {
        switch self {
        case .loading: "loading"
        case .loaded: "loaded"
        case .unavailable: "unavailable"
        }
    }
}

@MainActor
final class EditorImageStore {
    var load: (@MainActor (String) async -> UIImage?)?
    var didResolve: (@MainActor (String) -> Void)?
    private var states: [String: EditorImageState] = [:]

    nonisolated init() {}

    func state(for imageId: String) -> EditorImageState {
        states[imageId] ?? .loading
    }

    func request(_ imageIds: [String]) {
        for imageId in imageIds where states[imageId] == nil {
            start(imageId)
        }
    }

    func retry(_ imageId: String) {
        guard case .unavailable = states[imageId] else { return }
        start(imageId)
        didResolve?(imageId)
    }

    func reset() {
        states = [:]
    }

    private func start(_ imageId: String) {
        states[imageId] = .loading
        let load = self.load
        Task { [weak self] in
            let image = await load?(imageId)
            guard let self, case .loading = self.states[imageId] else { return }
            self.states[imageId] = image.map(EditorImageState.loaded) ?? EditorImageState.unavailable
            self.didResolve?(imageId)
        }
    }
}

/// One image drawn below a paragraph, with its box size fixed when the paragraph was styled.
struct PreviewImageBox: Equatable {
    static let gap: CGFloat = 8
    static let unavailableText = "Image unavailable"
    private static let unsizedHeight: CGFloat = 160

    var imageId: String
    var alt: String
    var size: CGSize

    var accessibilityLabel: String { alt.isEmpty ? "Image" : alt }

    static func spacing(for boxes: [PreviewImageBox]) -> CGFloat {
        boxes.reduce(gap) { $0 + $1.size.height + gap }
    }

    /// `available` is the line width; `scale` maps the reference's pixel dimensions to points.
    static func size(
        for reference: ImageReference, state: EditorImageState, available: CGFloat, compact: Bool, scale: CGFloat
    ) -> CGSize {
        var pixels: CGSize?
        if let width = reference.width, let height = reference.height, width > 0, height > 0 {
            pixels = CGSize(width: width, height: height)
        } else if case .loaded(let image) = state {
            pixels = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
        }
        guard let pixels, pixels.width > 0, pixels.height > 0 else {
            return CGSize(width: max(0, available), height: unsizedHeight)
        }
        let maxHeight: CGFloat = compact ? 260 : 360
        var width = min(pixels.width / max(1, scale), maxHeight * pixels.width / pixels.height)
        if available > 0 {
            width = min(width, available)
        }
        width = max(1, width.rounded(.down))
        return CGSize(width: width, height: max(1, (width * pixels.height / pixels.width).rounded()))
    }
}

final class PreviewImageList: NSObject {
    let boxes: [PreviewImageBox]

    init(_ boxes: [PreviewImageBox]) {
        self.boxes = boxes
    }

    override func isEqual(_ object: Any?) -> Bool {
        (object as? PreviewImageList)?.boxes == boxes
    }

    override var hash: Int {
        boxes.first?.imageId.hashValue ?? 0
    }
}
