import NativeCoreAPI
import SwiftUI

struct TrashView: View {
    let model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var restoreRequest: RestoreRequest?
    @State private var deleteRequest: TrashEntryView?
    @State private var confirmingEmpty = false

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Trash")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }
                            .accessibilityIdentifier("trash-done")
                    }
                    ToolbarItem(placement: .destructiveAction) {
                        Button("Empty trash", role: .destructive) { confirmingEmpty = true }
                            .disabled(model.trashEntries.isEmpty)
                            .accessibilityIdentifier("trash-empty-button")
                    }
                }
        }
        .sheet(item: $restoreRequest) { request in
            FolderPickerSheet(
                title: "Restore to",
                loadTargets: {
                    await model.restoreTargets(entryId: request.entryId, subPath: request.subPath)
                },
                onPick: { parent in
                    await model.restore(
                        entryId: request.entryId, subPath: request.subPath, to: parent)
                })
        }
        .confirmationDialog(
            model.trashDeleteConfirmation?.title ?? "",
            isPresented: deleteDialogPresented,
            titleVisibility: .visible,
            presenting: deleteRequest
        ) { entry in
            Button("Delete permanently", role: .destructive) {
                Task { await model.deleteFromTrash(entryId: entry.id) }
            }
            .accessibilityIdentifier("trash-delete-confirm")
        } message: { _ in
            Text(model.trashDeleteConfirmation?.message ?? "")
        }
        .confirmationDialog(
            model.trashEmptyConfirmation?.title ?? "",
            isPresented: $confirmingEmpty,
            titleVisibility: .visible
        ) {
            Button("Empty trash", role: .destructive) {
                Task { await model.emptyTrash() }
            }
            .accessibilityIdentifier("trash-empty-confirm")
        } message: {
            Text(model.trashEmptyConfirmation?.message ?? "")
        }
    }

    @ViewBuilder
    private var content: some View {
        if model.trashEntries.isEmpty {
            Text("Trash is empty")
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityIdentifier("trash-empty")
        } else {
            List(model.trashEntries, id: \.id) { entry in
                entryRow(entry)
            }
        }
    }

    @ViewBuilder
    private func entryRow(_ entry: TrashEntryView) -> some View {
        if entry.kind == .folder && !entry.children.isEmpty {
            DisclosureGroup {
                ForEach(entry.children, id: \.subPath) { item in
                    TrashItemRow(item: item) { subPath in
                        restoreRequest = RestoreRequest(entryId: entry.id, subPath: subPath)
                    }
                }
            } label: {
                entryLabel(entry)
                    .modifier(entryActions(entry))
            }
        } else {
            entryLabel(entry)
                .modifier(entryActions(entry))
        }
    }

    private func entryLabel(_ entry: TrashEntryView) -> some View {
        HStack(spacing: 8) {
            Image(systemName: entry.kind == .folder ? "folder" : "doc.text")
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.name)
                Text(subtitle(entry))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            if let tag = entry.colorTag {
                TagDot(tag: tag)
                    .accessibilityHidden(true)
            }
            Menu {
                actionButtons(entry)
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Actions")
            .accessibilityIdentifier("trash-entry-menu")
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(entry.name)
        .accessibilityIdentifier("trash-entry")
    }

    private func subtitle(_ entry: TrashEntryView) -> String {
        entry.originalFolder.isEmpty ? entry.daysLeft : "\(entry.originalFolder) · \(entry.daysLeft)"
    }

    @ViewBuilder
    private func actionButtons(_ entry: TrashEntryView) -> some View {
        Button("Restore to…", systemImage: "arrow.uturn.backward") {
            restoreRequest = RestoreRequest(entryId: entry.id, subPath: [])
        }
        .accessibilityIdentifier("trash-restore")
        Button("Delete permanently", systemImage: "trash", role: .destructive) {
            deleteRequest = entry
        }
        .accessibilityIdentifier("trash-delete")
    }

    private func entryActions(_ entry: TrashEntryView) -> EntryActions {
        EntryActions(
            restore: { restoreRequest = RestoreRequest(entryId: entry.id, subPath: []) },
            delete: { deleteRequest = entry })
    }

    private var deleteDialogPresented: Binding<Bool> {
        Binding(
            get: { deleteRequest != nil },
            set: { if !$0 { deleteRequest = nil } })
    }
}

private struct RestoreRequest: Identifiable {
    let entryId: String
    let subPath: [String]
    var id: String { entryId + "/" + subPath.joined(separator: "/") }
}

private struct EntryActions: ViewModifier {
    let restore: () -> Void
    let delete: () -> Void

    func body(content: Content) -> some View {
        content
            .contextMenu {
                Button("Restore to…", systemImage: "arrow.uturn.backward", action: restore)
                Button("Delete permanently", systemImage: "trash", role: .destructive, action: delete)
            }
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                Button("Delete permanently", systemImage: "trash", role: .destructive, action: delete)
                Button("Restore", systemImage: "arrow.uturn.backward", action: restore)
                    .tint(.blue)
            }
    }
}

private struct TrashItemRow: View {
    let item: TrashItemView
    let restore: ([String]) -> Void

    var body: some View {
        if item.kind == .folder && !item.children.isEmpty {
            DisclosureGroup {
                ForEach(item.children, id: \.subPath) { child in
                    TrashItemRow(item: child, restore: restore)
                }
            } label: {
                label
            }
        } else {
            label
        }
    }

    private var label: some View {
        Label(item.name, systemImage: item.kind == .folder ? "folder" : "doc.text")
            .accessibilityElement(children: .combine)
            .accessibilityLabel(item.name)
            .accessibilityIdentifier("trash-item")
            .contextMenu {
                Button("Restore to…", systemImage: "arrow.uturn.backward") { restore(item.subPath) }
                    .accessibilityIdentifier("trash-restore")
            }
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                Button("Restore", systemImage: "arrow.uturn.backward") { restore(item.subPath) }
                    .tint(.blue)
            }
    }
}
