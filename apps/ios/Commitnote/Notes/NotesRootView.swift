import NativeCoreAPI
import SwiftUI

struct NotesRootView: View {
    let model: AppModel
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var selection: [String]?
    @State private var expanded: Set<[String]> = []
    @State private var columnVisibility = NavigationSplitViewVisibility.all

    var body: some View {
        layout
            .onChange(of: selection) { _, path in
                if let path {
                    expandAncestors(of: path)
                }
                Task { await model.open(path: path) }
            }
            .overlay(alignment: .bottom) {
                if let notice = model.notices.last {
                    NoticeBanner(model: model, notice: notice)
                        .padding()
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(.default, value: model.notices.last)
    }

    @ViewBuilder
    private var layout: some View {
        if sizeClass == .regular {
            NavigationSplitView(columnVisibility: $columnVisibility) {
                TreeView(model: model, selection: $selection, expanded: $expanded)
            } detail: {
                if let selection {
                    NavigationStack {
                        NoteView(model: model, path: selection)
                    }
                } else {
                    Text("Select a note")
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .accessibilityIdentifier("note-placeholder")
                }
            }
            .navigationSplitViewStyle(.balanced)
        } else {
            NavigationStack {
                TreeView(model: model, selection: $selection, expanded: $expanded)
                    .navigationDestination(item: $selection) { path in
                        NoteView(model: model, path: path)
                    }
            }
        }
    }

    private func expandAncestors(of path: [String]) {
        guard path.count > 1 else { return }
        for length in 1..<path.count {
            expanded.insert(Array(path.prefix(length)))
        }
    }
}
