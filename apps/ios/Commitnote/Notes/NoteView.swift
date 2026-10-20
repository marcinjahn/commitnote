import NativeCoreAPI
import SwiftUI

struct NoteView: View {
    let model: AppModel
    let path: [String]

    var body: some View {
        ScrollView {
            body(for: state)
                .frame(maxWidth: 720, alignment: .leading)
                .frame(maxWidth: .infinity)
                .padding()
        }
        .navigationTitle(path.last ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("note-view")
    }

    private var state: OpenNote {
        if let note = model.openNote, note.path == path {
            return note
        }
        return .loading(path: path)
    }

    @ViewBuilder
    private func body(for note: OpenNote) -> some View {
        switch note {
        case .loading:
            Text("Loading…")
                .foregroundStyle(.secondary)
        case .loaded(_, let content):
            Text(content)
                .font(.body)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier("note-content")
        case .missing(_, let message), .trashed(_, let message), .failed(_, let message, _):
            Text(message)
                .foregroundStyle(.secondary)
        }
    }
}
