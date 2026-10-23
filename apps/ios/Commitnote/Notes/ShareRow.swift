import NativeCoreAPI
import SwiftUI

struct ShareRow: View {
    let model: AppModel
    let row: ShareRowView
    let copy: ShareCopy
    var hiddenActions: Set<ShareActionID> = []
    let onViewSharedVersion: (ShareRowView) -> Void
    @State private var renaming = false
    @State private var confirmingRevoke = false

    var body: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.title)
                    .lineLimit(2)
                if let secondary {
                    Text(secondary)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if model.updatingShareId == row.id {
                    Text(copy.updating)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
            if row.passwordProtected {
                Image(systemName: "lock")
                    .foregroundStyle(.secondary)
                    .accessibilityLabel(copy.passwordProtected)
            }
            Menu {
                actionButtons
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(row.menuLabel)
            .accessibilityIdentifier("share-row-menu")
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("share-row")
        .contextMenu { actionButtons }
        .sheet(isPresented: $renaming) {
            ShareRenameSheet(model: model, row: row, copy: copy.rename)
        }
        .confirmationDialog(
            copy.revoke.title,
            isPresented: $confirmingRevoke,
            titleVisibility: .visible
        ) {
            Button(copy.revoke.confirmLabel, role: .destructive) {
                model.revokeShare(id: row.id)
            }
            .accessibilityIdentifier("share-revoke-confirm")
        } message: {
            Text(copy.revoke.message)
        }
    }

    private var secondary: String? {
        var parts: [String] = []
        if let label = row.label, !label.isEmpty, label != row.title { parts.append(label) }
        parts.append(row.date)
        return parts.joined(separator: " · ")
    }

    @ViewBuilder
    private var actionButtons: some View {
        ForEach(row.actions.filter { !hiddenActions.contains($0.id) }) { action in
            Button(action.label, role: action.destructive ? .destructive : nil) {
                perform(action.id)
            }
            .disabled(action.disabled)
            .accessibilityIdentifier("share-action-\(action.id.rawValue)")
        }
    }

    private func perform(_ id: ShareActionID) {
        switch id {
        case .copyLink: model.copyShareLink(row)
        case .copyPassword: model.copySharePassword(row)
        case .update: model.updateShare(id: row.id)
        case .view: onViewSharedVersion(row)
        case .open: model.openSharedNote(row)
        case .rename: renaming = true
        case .revoke: confirmingRevoke = true
        }
    }
}

private struct ShareRenameSheet: View {
    let model: AppModel
    let row: ShareRowView
    let copy: ShareCopy.RenameCopy
    @Environment(\.dismiss) private var dismiss
    @State private var label: String
    @State private var error: String?
    @State private var saving = false
    @FocusState private var focused: Bool

    init(model: AppModel, row: ShareRowView, copy: ShareCopy.RenameCopy) {
        self.model = model
        self.row = row
        self.copy = copy
        _label = State(initialValue: row.label ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(copy.fieldLabel, text: $label)
                        .focused($focused)
                        .submitLabel(.done)
                        .onSubmit { save() }
                        .accessibilityIdentifier("share-rename-field")
                } footer: {
                    if let error {
                        Text(error)
                            .foregroundStyle(.red)
                            .accessibilityIdentifier("share-rename-error")
                    }
                }
            }
            .navigationTitle(copy.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(copy.confirmLabel) { save() }
                        .disabled(saving)
                        .accessibilityIdentifier("share-rename-confirm")
                }
            }
            .onChange(of: label) { error = nil }
            .onAppear { focused = true }
        }
        .presentationDetents([.medium])
    }

    private func save() {
        guard !saving else { return }
        saving = true
        Task {
            let message = await model.renameShare(id: row.id, label: label)
            saving = false
            if let message {
                error = message
            } else {
                dismiss()
            }
        }
    }
}
