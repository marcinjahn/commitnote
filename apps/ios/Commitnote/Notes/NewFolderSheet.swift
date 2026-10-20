import SwiftUI

struct NewFolderSheet: View {
    let model: AppModel
    let parent: [String]
    let onCreated: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var error: String?
    @State private var creating = false
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Folder name", text: $name)
                        .focused($focused)
                        .submitLabel(.done)
                        .onSubmit { create() }
                        .accessibilityIdentifier("new-folder-name-field")
                } footer: {
                    if let error {
                        Text(error)
                            .foregroundStyle(.red)
                            .accessibilityIdentifier("new-folder-error")
                    }
                }
            }
            .navigationTitle("New folder")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .accessibilityIdentifier("new-folder-cancel-button")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") { create() }
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || creating)
                        .accessibilityIdentifier("new-folder-create-button")
                }
            }
            .onChange(of: name) { error = nil }
            .onAppear { focused = true }
        }
        .presentationDetents([.medium])
    }

    private func create() {
        guard !creating, !name.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        creating = true
        Task {
            let message = await model.createFolder(parent: parent, name: name)
            creating = false
            if let message {
                error = message
            } else {
                onCreated()
                dismiss()
            }
        }
    }
}
