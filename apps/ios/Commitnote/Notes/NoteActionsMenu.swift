import SwiftUI
import UIKit

struct NoteActionsMenu: View {
    let model: AppModel
    @State private var frame: CGRect?

    var body: some View {
        if model.editorTarget != .none {
            Menu {
                Menu("Insert image", systemImage: "photo") {
                    Button("Photo Library", systemImage: "photo.on.rectangle") {
                        model.imageSourceRequest = .photos
                    }
                    .accessibilityIdentifier("insert-image-photos")
                    if UIImagePickerController.isSourceTypeAvailable(.camera) {
                        Button("Take Photo", systemImage: "camera") {
                            model.imageSourceRequest = .camera
                        }
                        .accessibilityIdentifier("insert-image-camera")
                    }
                    Button("Choose File", systemImage: "folder") {
                        model.imageSourceRequest = .files
                    }
                    .accessibilityIdentifier("insert-image-files")
                }
                .accessibilityIdentifier("note-insert-image-menu")
                Button("Print", systemImage: "printer") {
                    Task { await model.printNote(sourceRect: frame) }
                }
                .disabled(model.printState == .rendering)
                .accessibilityIdentifier("note-print-button")
                if !model.editorTarget.isDraft {
                    Button("Version history", systemImage: "clock.arrow.circlepath") {
                        Task { await model.openHistory() }
                    }
                    .accessibilityIdentifier("note-history-button")
                    Button("Share", systemImage: "square.and.arrow.up") {
                        Task { await model.presentShare() }
                    }
                    .accessibilityIdentifier("note-share-button")
                }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { frame = $0 }
            .accessibilityLabel("Note actions")
            .accessibilityIdentifier("note-actions-menu")
        }
    }
}
