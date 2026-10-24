import NativeCoreAPI
import SwiftUI

private enum ImportChoice: String {
    case newFolder
    case existing
}

struct ImportScreen: View {
    let model: AppModel
    let form: ImportForm
    @State private var choice = ImportChoice.newFolder
    @State private var folderName: String
    @State private var selectedFolder: [String]

    init(model: AppModel, form: ImportForm) {
        self.model = model
        self.form = form
        _folderName = State(initialValue: form.defaultFolderName)
        _selectedFolder = State(initialValue: form.targets.first?.path ?? [])
    }

    private var copy: ImportFormCopy { form.copy }

    private var destination: ImportDestinationView {
        switch choice {
        case .newFolder:
            return .newFolder(parent: [], name: folderName.trimmingCharacters(in: .whitespaces))
        case .existing:
            return selectedFolder.isEmpty ? .root : .folder(path: selectedFolder)
        }
    }

    private var hasValidDestination: Bool {
        switch destination {
        case .newFolder(_, let name): return !name.isEmpty
        case .root, .folder: return true
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                stageContent
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(copy.cancelLabel) { model.cancelImport() }
                        .accessibilityIdentifier("import-cancel")
                }
            }
            .accessibilityIdentifier("import-screen")
        }
        .presentationDetents([.large])
    }

    private var title: String {
        if model.importSetup != nil { return copy.setupTitle }
        if model.importOffersRename { return copy.conflictsTitle }
        return copy.title
    }

    @ViewBuilder
    private var stageContent: some View {
        if let setup = model.importSetup {
            Section {
                Text(setup.message)
                    .accessibilityIdentifier("import-message")
                if setup.canConfigure {
                    Button(copy.enableAtomicLabel) {
                        Task { await model.enableAtomicAndRetry() }
                    }
                    .disabled(model.importBusy)
                    .accessibilityIdentifier("import-enable-atomic")
                }
            }
        } else if model.importOffersRename {
            Section {
                if let message = model.importOutcomeMessage {
                    Text(message)
                        .accessibilityIdentifier("import-message")
                }
                Button(copy.renameLabel) {
                    Task { await model.commitImport(destination, policy: .rename) }
                }
                .disabled(model.importBusy)
                .accessibilityIdentifier("import-rename")
            }
        } else {
            formContent
        }
    }

    @ViewBuilder
    private var formContent: some View {
        Section {
            Text(form.fileName)
            if let skipped = form.skipped {
                Text(skipped)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("import-skipped")
            }
            if form.empty {
                Text(copy.emptyText)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("import-empty")
            }
        }
        if !form.empty {
            Section {
                Picker(copy.intoLabel, selection: $choice) {
                    Text(copy.newFolderLabel).tag(ImportChoice.newFolder)
                    Text(copy.existingFolderLabel).tag(ImportChoice.existing)
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("import-target")
                switch choice {
                case .newFolder:
                    TextField(copy.folderNameLabel, text: $folderName)
                        .accessibilityIdentifier("import-folder-name")
                case .existing:
                    ForEach(Array(form.targets.enumerated()), id: \.offset) { index, target in
                        folderRow(target, isRoot: index == 0)
                    }
                }
            } header: {
                Text(copy.intoLabel)
            }
            Section {
                if let preview = model.importPreview {
                    Text(preview)
                        .accessibilityIdentifier("import-preview")
                }
                if let message = model.importOutcomeMessage {
                    Text(message)
                        .foregroundStyle(.red)
                        .accessibilityIdentifier("import-message")
                }
                Button(model.importBusy ? copy.importingLabel : copy.importLabel) {
                    Task { await model.commitImport(destination, policy: .stop) }
                }
                .disabled(model.importBusy || !hasValidDestination)
                .accessibilityIdentifier("import-confirm")
            }
            .task(id: destination) {
                await model.previewImport(destination)
            }
        }
    }

    private func folderRow(_ target: ImportTargetView, isRoot: Bool) -> some View {
        Button {
            selectedFolder = target.path
        } label: {
            HStack {
                Text(isRoot ? copy.rootLabel : target.label)
                Spacer()
                if selectedFolder == target.path {
                    Image(systemName: "checkmark")
                        .foregroundStyle(Color.accentColor)
                }
            }
            .padding(.leading, CGFloat(target.depth) * 16)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selectedFolder == target.path ? .isSelected : [])
        .accessibilityIdentifier(
            isRoot ? "import-folder-root" : "import-folder-\(target.depth)-\(target.label)")
    }
}
