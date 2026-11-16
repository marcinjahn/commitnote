import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct ImageSourcePresenter: ViewModifier {
    let model: AppModel
    @State private var photosPresented = false
    @State private var cameraPresented = false
    @State private var filesPresented = false
    @State private var photoSelection: [PhotosPickerItem] = []

    func body(content: Content) -> some View {
        content
            .reportsPresentation(
                .imageSource, presented: photosPresented || cameraPresented || filesPresented,
                model: model)
            .onChange(of: model.imageSourceRequest) { _, kind in
                guard let kind else { return }
                model.imageSourceRequest = nil
                switch kind {
                case .photos: photosPresented = true
                case .camera: cameraPresented = true
                case .files: filesPresented = true
                }
            }
            .photosPicker(
                isPresented: $photosPresented,
                selection: $photoSelection,
                maxSelectionCount: 10,
                selectionBehavior: .ordered,
                matching: .images,
                preferredItemEncoding: .current
            )
            .onChange(of: photoSelection) { _, items in
                guard !items.isEmpty else { return }
                photoSelection = []
                Task { await deliverPhotos(items) }
            }
            .fullScreenCover(isPresented: $cameraPresented) {
                CameraPicker { image in
                    cameraPresented = false
                    if let data = image?.jpegData(compressionQuality: 0.95) {
                        model.deliverPickedImages([ImageInput(data: data, mimeType: "image/jpeg")])
                    }
                }
                .ignoresSafeArea()
            }
            .fileImporter(
                isPresented: $filesPresented,
                allowedContentTypes: [.image],
                allowsMultipleSelection: true
            ) { result in
                guard case .success(let urls) = result, !urls.isEmpty else { return }
                Task { await deliverFiles(urls) }
            }
    }

    private func deliverPhotos(_ items: [PhotosPickerItem]) async {
        var inputs: [ImageInput] = []
        for item in items {
            guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
            let type = item.supportedContentTypes.first { $0.conforms(to: .image) }
            inputs.append(ImageInput(data: data, mimeType: type?.preferredMIMEType ?? ""))
        }
        model.deliverPickedImages(inputs)
    }

    private func deliverFiles(_ urls: [URL]) async {
        var inputs: [ImageInput] = []
        for url in urls {
            if let input = await Self.read(url) { inputs.append(input) }
        }
        model.deliverPickedImages(inputs)
    }

    private nonisolated static func read(_ url: URL) async -> ImageInput? {
        let scoped = url.startAccessingSecurityScopedResource()
        defer {
            if scoped { url.stopAccessingSecurityScopedResource() }
        }
        guard let data = try? Data(contentsOf: url) else { return nil }
        let type =
            (try? url.resourceValues(forKeys: [.contentTypeKey]))?.contentType
            ?? UTType(filenameExtension: url.pathExtension)
        return ImageInput(data: data, mimeType: type?.preferredMIMEType ?? "")
    }
}

private struct CameraPicker: UIViewControllerRepresentable {
    let onFinish: (UIImage?) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.mediaTypes = [UTType.image.identifier]
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onFinish: onFinish)
    }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate,
        UINavigationControllerDelegate
    {
        let onFinish: (UIImage?) -> Void

        init(onFinish: @escaping (UIImage?) -> Void) {
            self.onFinish = onFinish
        }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            onFinish(info[.originalImage] as? UIImage)
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            onFinish(nil)
        }
    }
}
