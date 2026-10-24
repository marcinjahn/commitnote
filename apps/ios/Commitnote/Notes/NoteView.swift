import NativeCoreAPI
import SwiftUI

struct NoteView: View {
    @Bindable var model: AppModel
    @FocusState private var nameFocused: Bool
    @State private var nameSubmitted = false
    @State private var editorFocusRequested = false
    @FocusState private var titleFocused: Bool
    @State private var titleText = ""
    @State private var titleSubmitted = false

    private enum Mode: Equatable {
        case editor
        case conflict
        case message(String)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            content
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("note-view")
        .onChange(of: model.editorTarget) { old, new in
            if old.isDraft, new.notePath != nil, nameFocused || nameSubmitted {
                editorFocusRequested = true
            }
            nameSubmitted = false
        }
        .task(id: model.editorSwitch) {
            if model.editorTarget.isDraft {
                nameFocused = true
            }
        }
    }

    private var title: String {
        switch model.editorTarget {
        case .none: ""
        case .note(let path): path.last ?? ""
        case .draft: "New note"
        }
    }

    @ViewBuilder
    private var header: some View {
        switch model.editorTarget {
        case .none:
            EmptyView()
        case .draft:
            VStack(alignment: .leading, spacing: 4) {
                TextField("Name", text: $model.draftName)
                    .font(.title3.weight(.semibold))
                    .autocorrectionDisabled()
                    .focused($nameFocused)
                    .submitLabel(.next)
                    .onSubmit(submitName)
                    .accessibilityIdentifier("draft-name-field")
                if let error = model.draftError {
                    errorText(error, identifier: "draft-name-error")
                }
            }
            .padding(.horizontal)
            .padding(.top, 12)
            detailsRow
                .padding(.horizontal)
                .padding(.top, 4)
        case .note(let path):
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    titleView(path: path)
                    colorTagMenu(path: path)
                }
                if let error = model.noteNameError ?? model.draftError {
                    errorText(error, identifier: "note-name-error")
                }
                detailsRow
            }
            .padding(.horizontal)
            .padding(.top, 12)
        }
    }

    @ViewBuilder
    private func titleView(path: [String]) -> some View {
        let name = path.last ?? ""
        if openConflict != nil {
            Text(name)
                .font(.title3.weight(.semibold))
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier("note-title-field")
        } else {
            TextField("Name", text: $titleText)
                .font(.title3.weight(.semibold))
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .focused($titleFocused)
                .submitLabel(.done)
                .onSubmit {
                    titleSubmitted = true
                    commitTitle(name: name)
                }
                .onChange(of: titleFocused) { _, focused in
                    if focused {
                        titleSubmitted = false
                    } else if !titleSubmitted {
                        commitTitle(name: name)
                    }
                }
                .onChange(of: name, initial: true) { _, new in
                    if !titleFocused { titleText = new }
                }
                .onChange(of: model.noteNameError) { _, error in
                    if let error { AccessibilityNotification.Announcement(error).post() }
                }
                .accessibilityLabel("Note name")
                .accessibilityIdentifier("note-title-field")
        }
    }

    private func commitTitle(name: String) {
        guard titleText != name || model.noteNameError != nil else { return }
        let text = titleText
        Task {
            switch await model.renameOpenNote(to: text) {
            case .restore, .none:
                titleText = name
            case .error, .renamed:
                break
            }
        }
    }

    @ViewBuilder
    private func colorTagMenu(path: [String]) -> some View {
        if model.tagsWritable {
            let current = model.openNoteColorTag(for: path)
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
                if let current {
                    Circle().fill(current.color).frame(width: 14, height: 14)
                } else {
                    Image(systemName: "circle.dashed")
                }
            }
            .accessibilityLabel("Color tag")
            .accessibilityIdentifier("note-color-tag-menu")
        }
    }

    @ViewBuilder
    private var detailsRow: some View {
        if let details = model.noteDetails {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) {
                    dateItems(details)
                    countItems(details)
                }
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 10) { dateItems(details) }
                    HStack(spacing: 10) { countItems(details) }
                }
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("note-details")
        }
    }

    @ViewBuilder
    private func dateItems(_ details: NoteDetails) -> some View {
        if details.notSaved {
            Text("Not saved yet").fixedSize()
        } else {
            if let created = details.created { dateItem(created) }
            if let updated = details.updated { dateItem(updated) }
        }
    }

    @ViewBuilder
    private func countItems(_ details: NoteDetails) -> some View {
        if let words = details.words { countItem(words) }
        if let tasks = details.tasks { countItem(tasks) }
        if details.shared {
            Label("Shared", systemImage: "link")
                .fixedSize()
                .accessibilityIdentifier("note-details-shared")
        }
    }

    private func dateItem(_ item: DetailItemText) -> some View {
        Text("\(item.label) \(item.value)").fixedSize()
    }

    private func countItem(_ item: DetailItemText) -> some View {
        Text("\(item.value) \(item.label)").fixedSize()
    }

    @ViewBuilder
    private var content: some View {
        switch mode {
        case .editor:
            VStack(alignment: .leading, spacing: 0) {
                if let conflict = openConflict, conflict.editing {
                    Text(conflict.editHint)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal)
                        .padding(.vertical, 8)
                        .accessibilityIdentifier("conflict-edit-hint")
                }
                MarkdownEditor(
                    model: model, target: model.editorTarget, editorSwitch: model.editorSwitch,
                    editorLineage: model.editorLineage,
                    update: model.noteUpdate, focusRequested: $editorFocusRequested,
                    appearance: model.appearance)
            }
        case .conflict:
            if let conflict = openConflict {
                ConflictView(model: model, conflict: conflict)
            }
        case .message(let text):
            ScrollView {
                Text(text)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: 720, alignment: .leading)
                    .frame(maxWidth: .infinity)
                    .padding()
            }
        }
    }

    private var openConflict: OpenNoteConflict? {
        guard case .note(let path) = model.editorTarget,
            case .loaded(let notePath, _, let conflict, _, _)? = model.openNote, notePath == path
        else { return nil }
        return conflict
    }

    private var mode: Mode {
        switch model.editorTarget {
        case .none:
            return .message("")
        case .draft:
            return .editor
        case .note(let path):
            // Until the core reports the new target the editor stays, refusing input, so a note
            // created from a draft keeps its editor and keyboard.
            guard let note = model.openNote, note.path == path else { return .editor }
            switch note {
            case .loading:
                return .message("Loading…")
            case .loaded(_, _, let conflict?, _, _) where !conflict.editing:
                return .conflict
            case .loaded:
                return .editor
            case .missing(_, let message), .trashed(_, let message), .failed(_, let message, _):
                return .message(message)
            }
        }
    }

    private func errorText(_ text: String, identifier: String) -> some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(.red)
            .accessibilityIdentifier(identifier)
    }

    private func submitName() {
        nameSubmitted = true
        Task {
            await model.commitDraftName()
            if model.editorTarget.isDraft {
                nameFocused = true
            }
        }
    }
}
