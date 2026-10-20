import NativeCoreAPI
import SwiftUI

struct NoteView: View {
    @Bindable var model: AppModel
    @FocusState private var nameFocused: Bool
    @State private var nameSubmitted = false
    @State private var editorFocusRequested = false

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
        case .note:
            if let error = model.draftError {
                errorText(error, identifier: "note-name-error")
                    .padding(.horizontal)
                    .padding(.top, 8)
            }
        }
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
                PlainTextEditor(
                    model: model, target: model.editorTarget, editorSwitch: model.editorSwitch,
                    update: model.noteUpdate, focusRequested: $editorFocusRequested)
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
            case .loaded(let notePath, _, let conflict)? = model.openNote, notePath == path
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
            case .loaded(_, _, let conflict?) where !conflict.editing:
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
