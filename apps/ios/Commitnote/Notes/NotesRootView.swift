import NativeCoreAPI
import SwiftUI

struct NotesRootView: View {
    let model: AppModel
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var columnVisibility = NavigationSplitViewVisibility.all
    @State private var dismissing = false

    var body: some View {
        layout
            .onChange(of: model.editorTarget, initial: true) { _, target in
                dismissing = false
                if let path = target.notePath {
                    model.expandAncestors(of: path)
                }
            }
            .overlay(alignment: .bottom) {
                if let notice = model.notices.last {
                    NoticeBanner(model: model, notice: notice)
                        .padding()
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(.default, value: model.notices.last)
            .overlay {
                if model.logoutState == .saving {
                    LogoutSavingOverlay()
                }
            }
            .sheet(isPresented: trashPresented) {
                TrashView(model: model)
            }
            .alert("Some changes are not saved", isPresented: unsavedAlertPresented) {
                Button("Keep trying") {
                    Task { await model.keepTryingLogOut() }
                }
                Button("Log out anyway", role: .destructive) {
                    Task { await model.logOutAnyway() }
                }
                Button("Cancel", role: .cancel) {
                    model.cancelLogOut()
                }
            } message: {
                Text(unsavedMessage)
            }
    }

    @ViewBuilder
    private var layout: some View {
        if sizeClass == .regular {
            NavigationSplitView(columnVisibility: $columnVisibility) {
                treeColumn(placement: .navigationBarDrawer(displayMode: .always))
            } detail: {
                if model.editorTarget != .none {
                    NavigationStack {
                        NoteView(model: model)
                            #if FAKE_CORE
                            .toolbar {
                                ToolbarItem(placement: .topBarTrailing) {
                                    TestingMenu(model: model)
                                }
                            }
                            #endif
                    }
                } else {
                    NavigationStack {
                        Text("Select a note")
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .accessibilityIdentifier("note-placeholder")
                            #if FAKE_CORE
                            .toolbar {
                                ToolbarItem(placement: .topBarTrailing) {
                                    TestingMenu(model: model)
                                }
                            }
                            #endif
                    }
                }
            }
            .navigationSplitViewStyle(.balanced)
        } else {
            NavigationStack {
                treeColumn(placement: .navigationBarDrawer(displayMode: .always))
                    #if FAKE_CORE
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) { TestingMenu(model: model) }
                    }
                    #endif
                    .navigationDestination(isPresented: editorPresented) {
                        NoteView(model: model)
                            .toolbar {
                                ToolbarItem(placement: .topBarTrailing) {
                                    SyncStatusButton(model: model)
                                }
                                #if FAKE_CORE
                                ToolbarItem(placement: .topBarTrailing) {
                                    TestingMenu(model: model)
                                }
                                #endif
                            }
                    }
            }
        }
    }

    @ViewBuilder
    private func treeColumn(placement: SearchFieldPlacement) -> some View {
        Group {
            if model.isSearchActive {
                SearchResultsView(model: model)
            } else {
                TreeView(model: model, selection: selection, expanded: expanded)
            }
        }
        .searchable(
            text: searchText, isPresented: searchPresented, placement: placement,
            prompt: SearchCopy.prompt)
    }

    private var searchText: Binding<String> {
        Binding(
            get: { model.searchQuery },
            set: { model.setSearchQuery($0) })
    }

    private var searchPresented: Binding<Bool> {
        Binding(
            get: { model.isSearchActive },
            set: { presented in
                Task {
                    if presented {
                        await model.activateSearch()
                    } else {
                        await model.deactivateSearch()
                    }
                }
            })
    }

    private var unsavedAlertPresented: Binding<Bool> {
        Binding(
            get: {
                if case .unsaved = model.logoutState { return true }
                return false
            },
            set: { _ in })
    }

    private var trashPresented: Binding<Bool> {
        Binding(
            get: { model.isTrashPresented },
            set: { model.isTrashPresented = $0 })
    }

    private var unsavedMessage: String {
        if case .unsaved(_, let message) = model.logoutState { return message }
        return ""
    }

    private var expanded: Binding<Set<[String]>> {
        Binding(
            get: { model.expandedFolders },
            set: { model.setExpandedFolders($0) })
    }

    private var selection: Binding<[String]?> {
        Binding(
            get: { model.editorTarget.notePath },
            set: { path in
                guard let path, path != model.editorTarget.notePath else { return }
                Task { await model.open(path: path) }
            })
    }

    private var editorPresented: Binding<Bool> {
        Binding(
            get: { model.editorTarget != .none && !dismissing },
            set: { presented in
                guard !presented, !dismissing else { return }
                dismissing = true
                Task { await closeEditor() }
            })
    }

    private func closeEditor() async {
        if model.editorTarget.isDraft {
            await model.leaveDraft()
        }
        if model.editorTarget != .none {
            await model.open(path: nil)
        }
        dismissing = false
    }
}

private struct LogoutSavingOverlay: View {
    var body: some View {
        ZStack {
            Color.black.opacity(0.35).ignoresSafeArea()
            VStack(spacing: 12) {
                Text("Logging out")
                    .font(.headline)
                ProgressView()
                Text("Saving…")
                    .foregroundStyle(.secondary)
            }
            .padding(24)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("logout-saving")
        }
        .transition(.opacity)
    }
}
