import SwiftUI
import UIKit

private struct ViewerItem: Identifiable {
    let id: String
}

extension View {
    func imageViewer(model: AppModel) -> some View {
        fullScreenCover(
            item: Binding<ViewerItem?>(
                get: { model.viewerImageId.map(ViewerItem.init) },
                set: { model.viewerImageId = $0?.id }
            )
        ) { item in
            ImageViewer(model: model, imageId: item.id)
        }
    }
}

struct ImageViewer: View {
    let model: AppModel
    let imageId: String
    @State private var image: UIImage?
    @State private var loaded = false

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let image {
                ZoomableImage(image: image)
                    .ignoresSafeArea()
            } else if loaded {
                Text("Image unavailable")
                    .foregroundStyle(.white.opacity(0.7))
                    .accessibilityIdentifier("image-viewer-unavailable")
            } else {
                ProgressView().tint(.white)
            }
        }
        .overlay(alignment: .topTrailing) {
            Button("Done") { model.viewerImageId = nil }
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(Color.white.opacity(0.18))
                .padding()
                .accessibilityIdentifier("image-viewer-done")
        }
        .tint(.white)
        .preferredColorScheme(.dark)
        .task(id: imageId) {
            image = await model.image(for: imageId)
            loaded = true
        }
    }
}

private struct ZoomableImage: UIViewRepresentable {
    let image: UIImage

    func makeUIView(context: Context) -> ZoomScrollView {
        ZoomScrollView(image: image)
    }

    func updateUIView(_ view: ZoomScrollView, context: Context) {}
}

private final class ZoomScrollView: UIScrollView, UIScrollViewDelegate {
    private let imageView: UIImageView
    private var configuredSize = CGSize.zero

    init(image: UIImage) {
        imageView = UIImageView(image: image)
        super.init(frame: .zero)
        imageView.frame = CGRect(origin: .zero, size: image.size)
        imageView.isAccessibilityElement = true
        imageView.accessibilityLabel = "Image"
        imageView.accessibilityTraits = .image
        addSubview(imageView)
        delegate = self
        backgroundColor = .black
        showsHorizontalScrollIndicator = false
        showsVerticalScrollIndicator = false
        contentInsetAdjustmentBehavior = .never
        bouncesZoom = true
        accessibilityIdentifier = "image-viewer"
        let doubleTap = UITapGestureRecognizer(target: self, action: #selector(toggleZoom(_:)))
        doubleTap.numberOfTapsRequired = 2
        addGestureRecognizer(doubleTap)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        if bounds.size != configuredSize {
            configureZoomScales()
        }
        centerImage()
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? {
        imageView
    }

    func scrollViewDidZoom(_ scrollView: UIScrollView) {
        centerImage()
    }

    private func configureZoomScales() {
        let imageSize = imageView.bounds.size
        guard bounds.width > 0, bounds.height > 0, imageSize.width > 0, imageSize.height > 0 else {
            return
        }
        configuredSize = bounds.size
        let fit = min(bounds.width / imageSize.width, bounds.height / imageSize.height)
        minimumZoomScale = fit
        maximumZoomScale = fit * 4
        zoomScale = fit
    }

    private func centerImage() {
        var frame = imageView.frame
        frame.origin.x = max((bounds.width - frame.width) / 2, 0)
        frame.origin.y = max((bounds.height - frame.height) / 2, 0)
        imageView.frame = frame
    }

    @objc private func toggleZoom(_ gesture: UITapGestureRecognizer) {
        let animated = !UIAccessibility.isReduceMotionEnabled
        if zoomScale > minimumZoomScale * 1.01 {
            setZoomScale(minimumZoomScale, animated: animated)
            return
        }
        let target = minimumZoomScale * 2.5
        let point = gesture.location(in: imageView)
        let size = CGSize(width: bounds.width / target, height: bounds.height / target)
        zoom(
            to: CGRect(
                x: point.x - size.width / 2, y: point.y - size.height / 2,
                width: size.width, height: size.height),
            animated: animated)
    }
}
