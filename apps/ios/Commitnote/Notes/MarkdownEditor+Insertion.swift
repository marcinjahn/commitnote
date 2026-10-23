import UIKit
import UniformTypeIdentifiers

enum EditorImageItems {
    /// `UTType.image` itself is never used: its MIME type is empty.
    static func imageType(of provider: NSItemProvider) -> UTType? {
        provider.registeredTypeIdentifiers.lazy.compactMap { UTType($0) }.first { $0.conforms(to: .image) }
    }

    @MainActor
    static func load(_ providers: [NSItemProvider]) async -> [ImageInput] {
        var inputs: [ImageInput] = []
        for provider in providers {
            guard let type = imageType(of: provider) else { continue }
            let data: Data? = await withCheckedContinuation { continuation in
                _ = provider.loadDataRepresentation(forTypeIdentifier: type.identifier) { data, _ in
                    continuation.resume(returning: data)
                }
            }
            if let data {
                inputs.append(ImageInput(data: data, mimeType: type.preferredMIMEType ?? ""))
            }
        }
        return inputs
    }
}

/// Drops of images are inserted as references by the coordinator. UIKit still runs every dropped
/// item through the paste delegate, so the image items' own text or URL representations are
/// suppressed there.
@MainActor
final class EditorImageDropDelegate: NSObject, UITextDropDelegate, UITextPasteDelegate {
    private static let treeNodeType = "io.github.marcinjahn.commitnote.tree-node"

    weak var textView: MarkdownTextView?
    private var pendingDroppedImages = 0

    func reset() {
        pendingDroppedImages = 0
    }

    func textDroppableView(
        _ textDroppableView: UIView & UITextDroppable, proposalForDrop drop: UITextDropRequest
    ) -> UITextDropProposal {
        let session = drop.dropSession
        if session.hasItemsConforming(toTypeIdentifiers: [Self.treeNodeType]) {
            return UITextDropProposal(operation: .forbidden)
        }
        if session.hasItemsConforming(toTypeIdentifiers: [UTType.image.identifier]) {
            let proposal = UITextDropProposal(operation: .copy)
            proposal.dropAction = .insert
            return proposal
        }
        return drop.suggestedProposal
    }

    func textDroppableView(_ textDroppableView: UIView & UITextDroppable, willPerformDrop drop: UITextDropRequest) {
        guard let textView else { return }
        let providers = drop.dropSession.items.map(\.itemProvider).filter {
            EditorImageItems.imageType(of: $0) != nil
        }
        pendingDroppedImages = providers.count
        guard !providers.isEmpty else { return }
        let offset = textView.offset(from: textView.beginningOfDocument, to: drop.dropPosition)
        textView.imageDropHandler?(offset, providers)
    }

    func textPasteConfigurationSupporting(
        _ textPasteConfigurationSupporting: UITextPasteConfigurationSupporting, transform item: UITextPasteItem
    ) {
        if pendingDroppedImages > 0, EditorImageItems.imageType(of: item.itemProvider) != nil {
            pendingDroppedImages -= 1
            item.setNoResult()
        } else {
            item.setDefaultResult()
        }
    }
}
