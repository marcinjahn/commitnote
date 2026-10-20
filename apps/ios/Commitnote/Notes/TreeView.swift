import NativeCoreAPI
import SwiftUI

struct TreeView: View {
    let model: AppModel
    @Binding var selection: [String]?
    @Binding var expanded: Set<[String]>

    var body: some View {
        content
            .navigationTitle("Notes")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
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
                placeholder("No notes yet.", identifier: "notes-empty")
            } else {
                List(selection: $selection) {
                    TreeRows(nodes: tree, expanded: $expanded)
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

private struct TreeRows: View {
    let nodes: [TreeNode]
    @Binding var expanded: Set<[String]>

    var body: some View {
        ForEach(nodes, id: \.path) { node in
            switch node {
            case .folder(let name, let path, let noteCount, let children):
                DisclosureGroup(isExpanded: isExpanded(path)) {
                    TreeRows(nodes: children, expanded: $expanded)
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
                }
            case .note(let name, let path):
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
        case .folder(_, let path, _, _), .note(_, let path):
            return path
        }
    }
}
