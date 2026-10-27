import NativeCoreAPI
import SwiftUI
import UniformTypeIdentifiers

struct TreeView: View {
    let model: AppModel
    @Binding var selection: [String]?
    @Binding var expanded: Set<[String]>
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var folderSheet: FolderSheetTarget?
    @State private var renameTarget: TreeActionTarget?
    @State private var moveTarget: TreeActionTarget?
    @State private var deleteRequest: DeleteRequest?
    @State private var drop = TreeDropHandler()

    var body: some View {
        content
            .navigationTitle("Notes")
            .reportsPresentation(
                .treeAction,
                presented: folderSheet != nil || renameTarget != nil || moveTarget != nil
                    || deleteRequest != nil,
                model: model)
            .sheet(item: $folderSheet) { target in
                NewFolderSheet(model: model, parent: target.parent) {
                    if !target.parent.isEmpty {
                        for length in 1...target.parent.count {
                            expanded.insert(Array(target.parent.prefix(length)))
                        }
                    }
                }
            }
            .sheet(item: $renameTarget) { target in
                RenameSheet(name: target.name) { name in
                    await model.rename(path: target.path, name: name)
                }
            }
            .sheet(item: $moveTarget) { target in
                FolderPickerSheet(
                    title: "Move to",
                    loadTargets: { await model.moveTargets(for: target.path) },
                    onPick: { parent in await model.move(path: target.path, to: parent) })
            }
            .confirmationDialog(
                deleteRequest?.preview.title ?? "", isPresented: deletePresented(alert: false),
                titleVisibility: .visible, presenting: deleteRequest
            ) { request in
                deleteButtons(request)
            } message: { request in
                Text(request.preview.message)
            }
            .alert(
                deleteRequest?.preview.title ?? "", isPresented: deletePresented(alert: true),
                presenting: deleteRequest
            ) { request in
                deleteButtons(request)
            } message: { request in
                Text(request.preview.message)
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    SyncStatusButton(model: model)
                }
                if !filterTags.isEmpty {
                    ToolbarItem(placement: .topBarTrailing) {
                        tagFilterMenu
                    }
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
                        Button("Trash", systemImage: "trash") {
                            model.isTrashPresented = true
                        }
                        .accessibilityIdentifier("trash-button")
                        Button(model.shareCopy?.sharedLinksTitle ?? "Shared links", systemImage: "link") {
                            model.isSharedLinksPresented = true
                        }
                        .accessibilityIdentifier("shared-links-button")
                        Button("Refresh", systemImage: "arrow.clockwise") {
                            Task { try? await model.refresh() }
                        }
                        .accessibilityIdentifier("refresh-button")
                        Button("Settings", systemImage: "gearshape") {
                            Task { await model.openSettings() }
                        }
                        .accessibilityIdentifier("settings-button")
                        Button("Log out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
                            Task { await model.logOut() }
                        }
                        .accessibilityIdentifier("log-out-button")
                    } label: {
                        Label("Menu", systemImage: "ellipsis.circle")
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
                    TreeRows(
                        model: model, parent: [], nodes: tree, expanded: $expanded, folderSheet: $folderSheet,
                        drop: drop, perform: perform)
                }
                .listStyle(.sidebar)
                .refreshable { try? await model.refresh() }
                .accessibilityIdentifier("notes-tree")
                .onAppear { drop.model = model }
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

    private var filterTags: [ColorTag] {
        guard let active = model.tagFilter, !model.usedTags.contains(active) else {
            return model.usedTags
        }
        return model.usedTags + [active]
    }

    private var tagFilterMenu: some View {
        Menu {
            Picker(
                "Color tag filter",
                selection: Binding(
                    get: { model.tagFilter },
                    set: { tag in Task { await model.setTagFilter(tag) } })
            ) {
                Text("All notes").tag(ColorTag?.none)
                ForEach(filterTags, id: \.self) { tag in
                    Label {
                        Text(model.tagLabel(tag))
                    } icon: {
                        TagDot.menuImage(tag)
                    }
                    .tag(Optional(tag))
                }
            }
            .pickerStyle(.inline)
        } label: {
            Label(
                "Color tag filter",
                systemImage: model.tagFilter == nil
                    ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
        }
        .accessibilityIdentifier("tag-filter-menu")
    }

    @ViewBuilder
    private func deleteButtons(_ request: DeleteRequest) -> some View {
        Button(request.preview.confirmLabel, role: .destructive) {
            confirmDelete(request)
        }
        .accessibilityIdentifier("delete-confirm-button")
        Button("Cancel", role: .cancel) {}
    }

    private func deletePresented(alert: Bool) -> Binding<Bool> {
        Binding(
            get: { deleteRequest != nil && (sizeClass == .regular) == alert },
            set: { presented in
                if !presented { deleteRequest = nil }
            })
    }

    private func perform(_ action: TreeAction) {
        switch action {
        case .rename(let target):
            renameTarget = target
        case .move(let target):
            moveTarget = target
        case .delete(let path):
            Task {
                guard let preview = await model.trashPreview(for: path) else {
                    model.showErrorNotice(AppModel.genericErrorMessage)
                    return
                }
                deleteRequest = DeleteRequest(path: path, preview: preview)
            }
        }
    }

    private func confirmDelete(_ request: DeleteRequest) {
        Task {
            switch await model.trash(path: request.path, shareCount: request.preview.shareCount) {
            case .trashed, .deleted:
                break
            case .confirm(let preview):
                deleteRequest = DeleteRequest(path: request.path, preview: preview)
            case .error(let message):
                model.showErrorNotice(message)
            }
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

private struct TreeActionTarget: Identifiable {
    let path: [String]
    let name: String
    var id: [String] { path }
}

private struct DeleteRequest {
    let path: [String]
    let preview: TrashPreview
}

private enum TreeAction {
    case rename(TreeActionTarget)
    case move(TreeActionTarget)
    case delete([String])
}

private struct TreeRows: View {
    let model: AppModel
    let parent: [String]
    let nodes: [TreeNode]
    @Binding var expanded: Set<[String]>
    @Binding var folderSheet: FolderSheetTarget?
    let drop: TreeDropHandler
    let perform: (TreeAction) -> Void
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var rowLayout: AnyLayout {
        dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
            : AnyLayout(HStackLayout(spacing: 8))
    }

    /// The List lets its rows be dragged only while it accepts drops itself.
    var body: some View {
        ForEach(Array(nodes.enumerated()), id: \.element.path) { index, node in
            row(node, first: index == 0, last: index == nodes.count - 1)
        }
        .onInsert(of: [.commitnoteTreeNode]) { index, providers in
            guard let provider = providers.first else { return }
            let target = TreeDropTarget(parent: parent, before: index < nodes.count ? nodes[index].name : nil)
            TreeDrop.load(provider) { path in
                TreeDrop.place(path, at: target, model: model)
            }
        }
    }

    @ViewBuilder
    private func row(_ node: TreeNode, first: Bool, last: Bool) -> some View {
        switch node {
        case .folder(let name, let path, let noteCount, let children):
            DisclosureGroup(isExpanded: isExpanded(path)) {
                TreeRows(
                    model: model, parent: path, nodes: children, expanded: $expanded,
                    folderSheet: $folderSheet, drop: drop, perform: perform)
            } label: {
                rowLayout {
                    Label {
                        Text(name)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("tree-folder")
                            .accessibilityLabel(name)
                            .accessibilityValue(expanded.contains(path) ? "Expanded" : "Collapsed")
                    } icon: {
                        Image(systemName: "folder")
                    }
                    if !expanded.contains(path) {
                        if !dynamicTypeSize.isAccessibilitySize { Spacer() }
                        Text("\(noteCount)")
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("tree-folder-count")
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
                .onTapGesture {
                    withAnimation(reduceMotion ? nil : .default) { toggle(path) }
                }
                .hoverEffect(.highlight)
                .contextMenu {
                    Button("New note", systemImage: "square.and.pencil") {
                        Task { await model.startDraft(parent: path) }
                    }
                    .accessibilityIdentifier("folder-new-note")
                    Button("New folder", systemImage: "folder.badge.plus") {
                        folderSheet = FolderSheetTarget(parent: path)
                    }
                    .accessibilityIdentifier("folder-new-folder")
                    organiseActions(path: path, name: name, first: first, last: last, colorTag: nil)
                }
                .modifier(
                    TreeRowActions(
                        target: TreeActionTarget(path: path, name: name), isFolder: true, drop: drop,
                        perform: perform))
            }
        case .note(let name, let path, let colorTag, let shared):
            rowLayout {
                Label {
                    Text(name)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("tree-note")
                        .accessibilityLabel(name)
                        .accessibilityValue(noteValue(colorTag: colorTag, shared: shared))
                } icon: {
                    Image(systemName: "doc.text")
                }
                if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 0) }
                if shared || colorTag != nil {
                    HStack(spacing: 8) {
                        if shared {
                            Image(systemName: "link")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .accessibilityLabel("Shared")
                                .accessibilityIdentifier("tree-note-shared")
                        }
                        if let colorTag {
                            TagDot(tag: colorTag)
                                .accessibilityElement(children: .ignore)
                                .accessibilityLabel("\(model.tagLabel(colorTag)) tag")
                                .accessibilityIdentifier("tree-note-tag")
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .tag(Optional(path))
            .contextMenu {
                organiseActions(path: path, name: name, first: first, last: last, colorTag: .some(colorTag))
            }
            .modifier(
                TreeRowActions(
                    target: TreeActionTarget(path: path, name: name), isFolder: false, drop: drop,
                    perform: perform))
        }
    }

    private func noteValue(colorTag: ColorTag?, shared: Bool) -> String {
        var parts: [String] = []
        if let colorTag { parts.append("\(model.tagLabel(colorTag)) tag") }
        if shared { parts.append("Shared") }
        return parts.joined(separator: ", ")
    }

    @ViewBuilder
    private func organiseActions(
        path: [String], name: String, first: Bool, last: Bool, colorTag: ColorTag??
    ) -> some View {
        let target = TreeActionTarget(path: path, name: name)
        Button("Rename…", systemImage: "pencil") { perform(.rename(target)) }
            .accessibilityIdentifier("tree-action-rename")
        Button("Move to…", systemImage: "folder") { perform(.move(target)) }
            .accessibilityIdentifier("tree-action-move")
        Button("Move up", systemImage: "arrow.up") {
            Task { await model.moveSibling(path: path, direction: .up) }
        }
        .disabled(first)
        .accessibilityIdentifier("tree-action-move-up")
        Button("Move down", systemImage: "arrow.down") {
            Task { await model.moveSibling(path: path, direction: .down) }
        }
        .disabled(last)
        .accessibilityIdentifier("tree-action-move-down")
        if case .some(let current) = colorTag, model.tagsWritable {
            Menu {
                Picker(
                    "Color tag",
                    selection: Binding(
                        get: { current },
                        set: { tag in Task { await model.setColorTag(tag, for: path) } })
                ) {
                    Text("None").tag(ColorTag?.none)
                    ForEach(model.tagOptions, id: \.tag) { option in
                        Label {
                            Text(option.label)
                        } icon: {
                            TagDot.menuImage(option.tag)
                        }
                        .tag(Optional(option.tag))
                    }
                }
                .pickerStyle(.inline)
            } label: {
                Label("Color tag", systemImage: "circle")
            }
            .accessibilityIdentifier("tree-action-color-tag")
        }
        Button("Delete", systemImage: "trash", role: .destructive) { perform(.delete(path)) }
            .accessibilityIdentifier("tree-action-delete")
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

private struct TreeRowActions: ViewModifier {
    let target: TreeActionTarget
    let isFolder: Bool
    let drop: TreeDropHandler
    let perform: (TreeAction) -> Void

    func body(content: Content) -> some View {
        content
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                Button("Delete", systemImage: "trash", role: .destructive) {
                    perform(.delete(target.path))
                }
                .tint(.red)
                .accessibilityIdentifier("swipe-delete")
                Button("Move", systemImage: "folder") { perform(.move(target)) }
                    .tint(.gray)
                    .accessibilityIdentifier("swipe-move")
            }
            .swipeActions(edge: .leading, allowsFullSwipe: false) {
                Button("Rename", systemImage: "pencil") { perform(.rename(target)) }
                    .tint(.accentColor)
                    .accessibilityIdentifier("swipe-rename")
            }
            .itemProvider {
                drop.model?.haptics.play(.dragStarted)
                return TreeDrop.provider(for: target.path)
            }
            .background(TreeDropInstaller(handler: drop, path: target.path, isFolder: isFolder))
    }
}

struct TagDot: View {
    let tag: ColorTag
    @ScaledMetric private var diameter: CGFloat

    init(tag: ColorTag, diameter: CGFloat = 10) {
        self.tag = tag
        _diameter = ScaledMetric(wrappedValue: diameter)
    }

    var body: some View {
        Circle()
            .fill(tag.color)
            .frame(width: diameter, height: diameter)
    }

    static func menuImage(_ tag: ColorTag) -> Image {
        let symbol = UIImage(systemName: "circle.fill") ?? UIImage()
        return Image(uiImage: symbol.withTintColor(UIColor(tag.color), renderingMode: .alwaysOriginal))
    }
}

extension UTType {
    fileprivate static let commitnoteTreeNode = UTType(exportedAs: "io.github.marcinjahn.commitnote.tree-node")
}

/// Drag items use a private type that stays inside the app, so a dragged path never lands in
/// another app or in the editor as text.
@MainActor
private enum TreeDrop {
    nonisolated static func provider(for path: [String]) -> NSItemProvider {
        let data = (try? JSONEncoder().encode(path)) ?? Data()
        let provider = NSItemProvider()
        provider.registerDataRepresentation(
            forTypeIdentifier: UTType.commitnoteTreeNode.identifier, visibility: .ownProcess
        ) { completion in
            completion(data, nil)
            return nil
        }
        return provider
    }

    static func load(_ provider: NSItemProvider, then handle: @escaping @MainActor ([String]) -> Void) {
        _ = provider.loadDataRepresentation(forTypeIdentifier: UTType.commitnoteTreeNode.identifier) {
            @Sendable data, _ in
            guard let data, let path = try? JSONDecoder().decode([String].self, from: data) else { return }
            Task { @MainActor in handle(path) }
        }
    }

    static func place(_ path: [String], at target: TreeDropTarget, model: AppModel) {
        guard !path.isEmpty, !target.parent.starts(with: path) else { return }
        if target.parent == Array(path.dropLast()), target.before == path.last { return }
        Task { _ = await model.place(path: path, parent: target.parent, before: target.before) }
    }
}

/// A folder takes the dropped node as its last child and a note gets it placed before itself.
private struct TreeDropTarget: Equatable {
    let parent: [String]
    let before: String?

    init(parent: [String], before: String?) {
        self.parent = parent
        self.before = before
    }

    init(row path: [String], isFolder: Bool) {
        if isFolder {
            self.init(parent: path, before: nil)
        } else {
            self.init(parent: Array(path.dropLast()), before: path.last)
        }
    }
}

/// The List refuses drops of its own rows, and SwiftUI drop modifiers inside it never see them,
/// so each cell of the tree gets a drop interaction that takes the drop before the collection
/// view does, aimed at the row the cell currently shows.
@MainActor
private final class TreeDropHandler: NSObject, UIDropInteractionDelegate {
    weak var model: AppModel?
    private var hoveredTarget: TreeDropTarget?

    func install(on cell: UICollectionViewCell) {
        let installed = cell.interactions.contains { ($0 as? UIDropInteraction)?.delegate === self }
        if !installed {
            cell.addInteraction(UIDropInteraction(delegate: self))
        }
    }

    func dropInteraction(_ interaction: UIDropInteraction, canHandle session: UIDropSession) -> Bool {
        if session.localDragSession != nil {
            return session.hasItemsConforming(toTypeIdentifiers: [UTType.commitnoteTreeNode.identifier])
        }
        return session.hasItemsConforming(toTypeIdentifiers: UTType.importableNotes.map(\.identifier))
    }

    func dropInteraction(
        _ interaction: UIDropInteraction, sessionDidUpdate session: UIDropSession
    ) -> UIDropProposal {
        let target = target(of: interaction)
        let external = session.localDragSession == nil
        let allowed = target != nil && !(external && model?.isImporting == true)
        setHighlighted(allowed, interaction)
        guard allowed else { return UIDropProposal(operation: .forbidden) }
        if target != hoveredTarget {
            hoveredTarget = target
            model?.haptics.play(.dropTargetChanged)
        }
        return UIDropProposal(operation: external ? .copy : .move)
    }

    func dropInteraction(_ interaction: UIDropInteraction, sessionDidExit session: UIDropSession) {
        hoveredTarget = nil
        setHighlighted(false, interaction)
    }

    func dropInteraction(_ interaction: UIDropInteraction, sessionDidEnd session: UIDropSession) {
        hoveredTarget = nil
        setHighlighted(false, interaction)
    }

    func dropInteraction(_ interaction: UIDropInteraction, performDrop session: UIDropSession) {
        hoveredTarget = nil
        setHighlighted(false, interaction)
        guard let target = target(of: interaction), let model else { return }
        if session.localDragSession == nil {
            let providers = session.items.map(\.itemProvider)
            let parent = target.parent.isEmpty ? nil : target.parent
            Task { await model.dropFiles(providers, parent: parent) }
            return
        }
        guard let provider = session.items.first?.itemProvider else { return }
        TreeDrop.load(provider) { path in
            TreeDrop.place(path, at: target, model: model)
        }
    }

    private func target(of interaction: UIDropInteraction) -> TreeDropTarget? {
        guard let cell = interaction.view, let installer = TreeDropInstallerView.find(in: cell),
            let path = installer.path
        else { return nil }
        return TreeDropTarget(row: path, isFolder: installer.isFolder)
    }

    private func setHighlighted(_ highlighted: Bool, _ interaction: UIDropInteraction) {
        guard let cell = interaction.view as? UICollectionViewCell, cell.isHighlighted != highlighted else {
            return
        }
        cell.isHighlighted = highlighted
    }
}

/// Sits in a row to reach the collection view cell that shows it.
private struct TreeDropInstaller: UIViewRepresentable {
    let handler: TreeDropHandler
    let path: [String]
    let isFolder: Bool

    func makeUIView(context: Context) -> TreeDropInstallerView {
        TreeDropInstallerView(handler: handler)
    }

    func updateUIView(_ view: TreeDropInstallerView, context: Context) {
        view.path = path
        view.isFolder = isFolder
        view.install()
    }
}

private final class TreeDropInstallerView: UIView {
    private let handler: TreeDropHandler
    var path: [String]?
    var isFolder = false

    init(handler: TreeDropHandler) {
        self.handler = handler
        super.init(frame: .zero)
        isUserInteractionEnabled = false
    }

    required init?(coder: NSCoder) {
        nil
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        install()
    }

    func install() {
        var view = superview
        while let current = view, !(current is UICollectionViewCell) {
            view = current.superview
        }
        if let cell = view as? UICollectionViewCell {
            handler.install(on: cell)
        }
    }

    static func find(in view: UIView) -> TreeDropInstallerView? {
        for subview in view.subviews {
            if let installer = subview as? TreeDropInstallerView ?? find(in: subview) {
                return installer
            }
        }
        return nil
    }
}

extension AppModel {
    func tagLabel(_ tag: ColorTag) -> String {
        tagOptions.first { $0.tag == tag }?.label ?? tag.rawValue.capitalized
    }
}

private extension TreeNode {
    var path: [String] {
        switch self {
        case .folder(_, let path, _, _), .note(_, let path, _, _):
            return path
        }
    }

    var name: String {
        switch self {
        case .folder(let name, _, _, _), .note(let name, _, _, _):
            return name
        }
    }
}
