import NativeCoreAPI
import SwiftUI
import UniformTypeIdentifiers

struct ArchiveDocument: FileDocument {
    static let readableContentTypes: [UTType] = [.zip]

    let data: Data

    init(data: Data) {
        self.data = data
    }

    init(configuration: ReadConfiguration) throws {
        data = configuration.file.regularFileContents ?? Data()
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}

private struct ArchiveExport {
    let document: ArchiveDocument
    let fileName: String
}

struct DataSection: View {
    let model: AppModel
    let copy: SettingsCopy
    let view: SettingsView
    @State private var exportButtonFrame: CGRect?
    @State private var fileExport: ArchiveExport?

    var body: some View {
        Section(copy.sections.dataSecurity) {
            exportMenu
            if model.exportState == .failed {
                Text(copy.data.exportFailed)
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("settings-export-error")
            }
            Button(model.isImporting ? copy.data.importingLabel : copy.data.importLabel) {
                model.isImportPickerPresented = true
            }
            .disabled(!view.canImport)
            .accessibilityIdentifier("settings-import-button")
            Button(copy.data.changePassphraseLabel) {
                Task { await model.openChangePassphrase() }
            }
            .disabled(!view.canChangePassphrase)
            .accessibilityIdentifier("settings-change-passphrase-button")
        }
        .fileExporter(
            isPresented: Binding(
                get: { fileExport != nil }, set: { if !$0 { fileExport = nil } }),
            document: fileExport?.document,
            contentType: .zip,
            defaultFilename: fileExport?.fileName
        ) { _ in
            fileExport = nil
        }
    }

    private var exporting: Bool { model.exportState == .exporting }

    private var exportMenu: some View {
        Menu {
            Button(copy.data.exportShareLabel, systemImage: "square.and.arrow.up") {
                Task {
                    if let url = await model.exportArchive() {
                        ShareSheet.present(url: url, sourceRect: exportButtonFrame)
                    }
                }
            }
            .accessibilityIdentifier("settings-export-share")
            Button(copy.data.exportFilesLabel, systemImage: "folder") {
                Task { await saveToFiles() }
            }
            .accessibilityIdentifier("settings-export-files")
        } label: {
            Text(exporting ? copy.data.exportingLabel : copy.data.exportLabel)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
        }
        .disabled(!view.canExport || exporting)
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: {
            exportButtonFrame = $0
        }
        .accessibilityIdentifier("settings-export-button")
    }

    private func saveToFiles() async {
        guard let url = await model.exportArchive() else { return }
        let loaded = await Task.detached { try? Data(contentsOf: url) }.value
        try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
        guard let loaded else { return }
        fileExport = ArchiveExport(
            document: ArchiveDocument(data: loaded),
            fileName: url.deletingPathExtension().lastPathComponent)
    }
}
