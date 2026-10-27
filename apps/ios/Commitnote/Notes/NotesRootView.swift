import NativeCoreAPI
import SwiftUI

struct NotesRootView: View {
    let model: AppModel
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var columnVisibility = NavigationSplitViewVisibility.all
    @State private var dismissing = false
    @State private var showsRegularLayout: Bool?
    @State private var layoutChange: Task<Void, Never>?
    @State private var layoutSettling = false
    @FocusState private var searchFieldFocused: Bool

    var body: some View {
        layout
            .onChange(of: sizeClass, initial: true) { _, newSizeClass in
                model.usesCompactLayout = newSizeClass != .regular
                applyLayout(regular: newSizeClass == .regular)
            }
            .onChange(of: model.searchFocusRequest, initial: true) { _, requested in
                guard requested else { return }
                focusSearchField()
                model.searchFocusRequest = false
            }
            .onChange(of: model.editorTarget, initial: true) { _, target in
                dismissing = false
                if let path = target.notePath {
                    model.expandAncestors(of: path)
                }
            }
            #if FAKE_CORE
            .overlay(alignment: .bottomLeading) { TestingWidthState() }
            #endif
            .overlay(alignment: .bottom) {
                if let notice = model.notices.last {
                    NoticeBanner(model: model, notice: notice)
                        .padding()
                        .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
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
            .sheet(isPresented: historyPresented) {
                HistoryScreen(model: model)
                    .presentationDetents([.large])
            }
            .sheet(item: sharePresented) { item in
                ShareScreen(model: model, path: item.path)
            }
            .sheet(isPresented: sharedLinksPresented) {
                SharedLinksScreen(model: model)
            }
            .sheet(isPresented: settingsPresented) {
                SettingsScreen(model: model)
            }
            .modifier(ImageSourcePresenter(model: model))
            .alert(
                model.dropSetup?.message ?? "",
                isPresented: Binding(
                    get: { model.dropSetup != nil },
                    set: { if !$0 { model.dropSetup = nil } }),
                presenting: model.dropSetup
            ) { setup in
                if setup.canConfigure {
                    Button(setup.actionLabel) {
                        Task { await model.enableAtomicAndRetry() }
                    }
                }
                Button("Cancel", role: .cancel) {}
            }
            .alert(
                model.atomicBlocked?.title ?? "",
                isPresented: Binding(
                    get: { model.atomicBlocked != nil },
                    set: { if !$0 { model.atomicBlocked = nil } }),
                presenting: model.atomicBlocked
            ) { blocked in
                if blocked.canConfigure {
                    Button(blocked.enableLabel) {
                        Task { await model.resolveAtomicBlocked(enable: true) }
                    }
                }
                Button(blocked.saveWithoutLabel) {
                    Task { await model.resolveAtomicBlocked(enable: false) }
                }
            } message: { blocked in
                Text(blocked.message)
            }
            .imageViewer(model: model)
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
        if showsRegularLayout ?? (sizeClass == .regular) {
            NavigationSplitView(columnVisibility: $columnVisibility) {
                treeColumn(placement: .navigationBarDrawer(displayMode: .always))
            } detail: {
                if model.editorTarget != .none {
                    NavigationStack {
                        NoteView(model: model)
                            .toolbar {
                                ToolbarItem(placement: .topBarTrailing) {
                                    NoteActionsMenu(model: model)
                                }
                                #if FAKE_CORE
                                ToolbarItem(placement: .topBarTrailing) {
                                    TestingMenu(model: model)
                                }
                                #endif
                            }
                    }
                } else {
                    NavigationStack {
                        Text("Select a note")
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .accessibilityIdentifier("note-placeholder")
                            #if FAKE_CORE
                            .overlay(alignment: .topLeading) {
                                TestingTypeToStartState(model: model)
                            }
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
            .background {
                // Outside the detail column: starting a note swaps that column while keys still arrive.
                TypeToStartCatcher(
                    model: model, placeholderVisible: model.editorTarget == .none,
                    capturing: model.typeToStartPending
                        || model.typeToStartArmed(placeholderVisible: model.editorTarget == .none)
                )
                .frame(width: 0, height: 0)
                .accessibilityHidden(true)
            }
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
                                    NoteActionsMenu(model: model)
                                }
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
        .searchFocused($searchFieldFocused)
    }

    private func applyLayout(regular: Bool) {
        guard let current = showsRegularLayout else {
            showsRegularLayout = regular
            return
        }
        layoutChange?.cancel()
        guard current != regular else { return }
        layoutChange = Task {
            await model.prepareForLayoutChange()
            guard !Task.isCancelled else { return }
            layoutSettling = true
            dismissing = false
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) { showsRegularLayout = regular }
            try? await Task.sleep(for: .milliseconds(500))
            layoutSettling = false
        }
    }

    private func focusSearchField() {
        guard sizeClass == .regular, columnVisibility != .all else {
            searchFieldFocused = true
            return
        }
        columnVisibility = .all
        Task { searchFieldFocused = true }
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
                guard !layoutSettling else { return }
                if presented {
                    Task { await model.activateSearch() }
                } else {
                    model.endSearch()
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

    private var sharedLinksPresented: Binding<Bool> {
        Binding(
            get: { model.isSharedLinksPresented },
            set: { model.isSharedLinksPresented = $0 })
    }

    private var settingsPresented: Binding<Bool> {
        Binding(
            get: { model.isSettingsPresented },
            set: { model.isSettingsPresented = $0 })
    }

    private var historyPresented: Binding<Bool> {
        Binding(
            get: { model.isHistoryPresented },
            set: { if !$0 { model.closeHistory() } })
    }

    private var sharePresented: Binding<SharePathItem?> {
        Binding(
            get: { model.sharePath.map(SharePathItem.init) },
            set: { if $0 == nil { model.sharePath = nil } })
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
        await model.leaveEditor()
        dismissing = false
    }
}

private struct LogoutSavingOverlay: View {
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        ZStack {
            Color.black.opacity(contrast == .increased ? 0.6 : 0.35).ignoresSafeArea()
            VStack(spacing: 12) {
                Text("Logging out")
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)
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
