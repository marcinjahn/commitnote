import NativeCoreAPI
import SwiftUI

struct FolderPickerSheet: View {
    let title: String
    let loadTargets: () async -> [MoveTargetView]
    let onPick: ([String]) async -> String?
    @Environment(\.dismiss) private var dismiss
    @State private var targets: [MoveTargetView]?
    @State private var error: String?
    @State private var picking = false

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }
                            .accessibilityIdentifier("folder-picker-cancel-button")
                    }
                }
                .task { targets = await loadTargets() }
        }
        .presentationDetents([.medium, .large])
    }

    @ViewBuilder
    private var content: some View {
        if let targets {
            List {
                Section {
                    ForEach(targets, id: \.path) { target in
                        row(target)
                    }
                } footer: {
                    if let error {
                        Text(error)
                            .foregroundStyle(.red)
                            .accessibilityIdentifier("folder-picker-error")
                    }
                }
            }
        } else {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func row(_ target: MoveTargetView) -> some View {
        Button {
            pick(target.path)
        } label: {
            Label(target.label, systemImage: target.path.isEmpty ? "tray" : "folder")
                .padding(.leading, CGFloat(target.depth) * 16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
        }
        .foregroundStyle(target.disabled ? HierarchicalShapeStyle.secondary : .primary)
        .disabled(target.disabled || picking)
        .accessibilityLabel(target.label)
        .accessibilityIdentifier("folder-picker-row")
    }

    private func pick(_ path: [String]) {
        guard !picking else { return }
        picking = true
        error = nil
        Task {
            let message = await onPick(path)
            picking = false
            if let message {
                error = message
            } else {
                dismiss()
            }
        }
    }
}
