import SwiftUI
import UniformTypeIdentifiers

extension UTType {
    static let importableNotes: [UTType] = {
        let markdown = ["md", "markdown"].compactMap { UTType(filenameExtension: $0) }
        return [.zip] + markdown + [.plainText]
    }()
}

struct ImportPresenter: ViewModifier {
    let model: AppModel

    func body(content: Content) -> some View {
        content
            .fileImporter(
                isPresented: Binding(
                    get: { model.isImportPickerPresented },
                    set: { model.isImportPickerPresented = $0 }),
                allowedContentTypes: UTType.importableNotes,
                allowsMultipleSelection: true
            ) { result in
                guard case .success(let urls) = result, !urls.isEmpty else { return }
                Task { await model.importFiles(urls) }
            }
            .sheet(
                isPresented: Binding(
                    get: { model.importForm != nil },
                    set: { presented in
                        if !presented, model.importForm != nil { model.cancelImport() }
                    })
            ) {
                if let form = model.importForm {
                    ImportScreen(model: model, form: form)
                        .interactiveDismissDisabled(model.importBusy)
                }
            }
    }
}
