import SwiftUI

struct RenameSheet: View {
    let originalName: String
    let onSave: (String) async -> String?
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var selection: SwiftUI.TextSelection?
    @State private var error: String?
    @State private var saving = false
    @FocusState private var focused: Bool

    init(name: String, onSave: @escaping (String) async -> String?) {
        originalName = name
        self.onSave = onSave
        _name = State(initialValue: name)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name, selection: $selection)
                        .focused($focused)
                        .submitLabel(.done)
                        .onSubmit { save() }
                        .accessibilityIdentifier("rename-field")
                } footer: {
                    if let error {
                        Text(error)
                            .foregroundStyle(.red)
                            .accessibilityIdentifier("rename-error")
                    }
                }
            }
            .navigationTitle("Rename")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .accessibilityIdentifier("rename-cancel-button")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled(trimmed.isEmpty || saving)
                        .accessibilityIdentifier("rename-save-button")
                }
            }
            .onChange(of: name) { error = nil }
            .onAppear {
                focused = true
                selection = SwiftUI.TextSelection(range: name.startIndex..<name.endIndex)
            }
        }
        .presentationDetents([.medium])
    }

    private var trimmed: String {
        name.trimmingCharacters(in: .whitespaces)
    }

    private func save() {
        guard !saving, !trimmed.isEmpty else { return }
        if name == originalName {
            dismiss()
            return
        }
        saving = true
        Task {
            let message = await onSave(name)
            saving = false
            if let message {
                error = message
            } else {
                dismiss()
            }
        }
    }
}
