import NativeCoreAPI
import SwiftUI

struct TreeView: View {
    let model: AppModel
    @Binding var selection: [String]?
    @Binding var expanded: Set<[String]>
    @State private var folderSheet: FolderSheetTarget?

    var body: some View {
        content
            .navigationTitle("Notes")
            .sheet(item: $folderSheet) { target in
                NewFolderSheet(model: model, parent: target.parent) {
                    if !target.parent.isEmpty {
                        for length in 1...target.parent.count {
                            expanded.insert(Array(target.parent.prefix(length)))
                        }
                    }
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    SyncStatusButton(model: model)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("New note", systemImage: "square.and.pencil") {
                        Task { await model.startDraft(parent: []) }
                    }
                    .accessibilityIdentifier("new-note-button")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("New folder", systemImage: "folder.badge.plus") {
                            folderSheet = FolderSheetTarget(parent: [])
                        }
                        .accessibilityIdentifier("new-folder-button")
                        Button("Refresh", systemImage: "arrow.clockwise") {
                            Task { try? await model.refresh() }
                        }
                        .accessibilityIdentifier("refresh-button")
                        Button("Log out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
                            Task { await model.logOut() }
                        }
                        .accessibilityIdentifier("log-out-button")
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .accessibilityLabel("Menu")
                    }
                    .accessibilityIdentifier("notes-menu-button")
                }
            }
    }

    @ViewBuilder
    private var content: some View {
        if let tree = model.tree {
            if tree.isEmpty {
                placeholder("No notes yet, create one", identifier: "notes-empty")
            } else {
                List(selection: $selection) {
                    TreeRows(model: model, nodes: tree, expanded: $expanded, folderSheet: $folderSheet)
                }
                .listStyle(.sidebar)
                .refreshable { try? await model.refresh() }
                .accessibilityIdentifier("notes-tree")
            }
        } else if let message = model.treeLoadError {
            placeholder(message, identifier: "notes-error")
        } else {
            VStack(spacing: 12) {
                ProgressView()
                Text("Loading notes…")
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func placeholder(_ text: String, identifier: String) -> some View {
        ScrollView {
            Text(text)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .padding()
                .frame(maxWidth: .infinity)
                .accessibilityIdentifier(identifier)
        }
        .refreshable { try? await model.refresh() }
    }
}

private struct FolderSheetTarget: Identifiable {
    let parent: [String]
    var id: [String] { parent }
}

private struct TreeRows: View {
    let model: AppModel
    let nodes: [TreeNode]
    @Binding var expanded: Set<[String]>
    @Binding var folderSheet: FolderSheetTarget?

    var body: some View {
        ForEach(nodes, id: \.path) { node in
            switch node {
            case .folder(let name, let path, let noteCount, let children):
                DisclosureGroup(isExpanded: isExpanded(path)) {
                    TreeRows(model: model, nodes: children, expanded: $expanded, folderSheet: $folderSheet)
                } label: {
                    HStack {
                        Label {
                            Text(name)
                                .accessibilityIdentifier("tree-folder")
                                .accessibilityLabel(name)
                        } icon: {
                            Image(systemName: "folder")
                        }
                        if !expanded.contains(path) {
                            Spacer()
                            Text("\(noteCount)")
                                .foregroundStyle(.secondary)
                                .accessibilityIdentifier("tree-folder-count")
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        withAnimation { toggle(path) }
                    }
                    .contextMenu {
                        Button("New note", systemImage: "square.and.pencil") {
                            Task { await model.startDraft(parent: path) }
                        }
                        .accessibilityIdentifier("folder-new-note")
                        Button("New folder", systemImage: "folder.badge.plus") {
                            folderSheet = FolderSheetTarget(parent: path)
                        }
                        .accessibilityIdentifier("folder-new-folder")
                    }
                }
            case .note(let name, let path, _, _):
                Label(name, systemImage: "doc.text")
                    .tag(Optional(path))
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel(name)
                    .accessibilityIdentifier("tree-note")
            }
        }
    }

    private func toggle(_ path: [String]) {
        if expanded.contains(path) {
            expanded.remove(path)
        } else {
            expanded.insert(path)
        }
    }

    private func isExpanded(_ path: [String]) -> Binding<Bool> {
        Binding(
            get: { expanded.contains(path) },
            set: { open in
                if open {
                    expanded.insert(path)
                } else {
                    expanded.remove(path)
                }
            })
    }
}

private extension TreeNode {
    var path: [String] {
        switch self {
        case .folder(_, let path, _, _), .note(_, let path, _, _):
            return path
        }
    }
}
