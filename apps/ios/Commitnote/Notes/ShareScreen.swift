import NativeCoreAPI
import SwiftUI

struct SharePathItem: Identifiable, Equatable {
    let path: [String]
    var id: String { path.joined(separator: "/") }
}

struct ShareScreen: View {
    let model: AppModel
    let path: [String]
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var title: String?
    @State private var label = ""
    @State private var password = ""
    @State private var creating = false
    @State private var result: Result?
    @State private var linkButtonFrame: CGRect?
    @State private var passwordButtonFrame: CGRect?
    @State private var viewing: [SharedVersionItem] = []

    private enum Result {
        case created(link: String, password: String?)
        case error([MessagePart])
    }

    var body: some View {
        NavigationStack(path: $viewing) {
            content
                .navigationTitle(title ?? "")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }
                            .accessibilityIdentifier("share-done")
                    }
                }
                .navigationDestination(for: SharedVersionItem.self) { item in
                    if let copy = model.shareCopy {
                        SharedVersionScreen(model: model, item: item, copy: copy)
                    }
                }
        }
        .imageViewer(model: model)
        .task { title = await model.shareTitle(for: path) }
    }

    @ViewBuilder
    private var content: some View {
        if let copy = model.shareCopy {
            List {
                if let unreadable = model.sharesUnreadable {
                    Section {
                        Text(unreadable)
                            .foregroundStyle(.red)
                            .accessibilityIdentifier("share-unreadable")
                    }
                }
                Section {
                    formContent(copy)
                }
                sharesSection(copy)
            }
            .accessibilityIdentifier("share-screen")
        } else {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @ViewBuilder
    private func formContent(_ copy: ShareCopy) -> some View {
        if case .created(let link, let sharePassword) = result {
            createdContent(copy, link: link, password: sharePassword)
        } else {
            Text(copy.explanation)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("share-explanation")
            TextField(copy.labelField, text: $label)
                .accessibilityIdentifier("share-label-field")
            VStack(alignment: .leading, spacing: 4) {
                TextField(copy.passwordField, text: $password)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("share-password-field")
                Text(copy.passwordHint)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if case .error(let parts) = result {
                Text(attributed(parts))
                    .foregroundStyle(.red)
                    .environment(\.openURL, OpenURLAction { url in
                        openURL(url)
                        return .handled
                    })
                    .accessibilityIdentifier("share-error")
            }
            Button(creating ? copy.creating : copy.create) { create() }
                .disabled(creating || model.sharesUnreadable != nil)
                .accessibilityIdentifier("share-create-button")
        }
    }

    @ViewBuilder
    private func createdContent(_ copy: ShareCopy, link: String, password: String?) -> some View {
        Text(link)
            .font(.system(.body, design: .monospaced))
            .textSelection(.enabled)
            .accessibilityIdentifier("share-created-link")
        Button(copy.shareLink) {
            ShareSheet.present(items: [link], sourceRect: linkButtonFrame)
        }
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { linkButtonFrame = $0 }
        .accessibilityIdentifier("share-link-button")
        if let password {
            Button(copy.sharePassword) {
                ShareSheet.present(items: [password], sourceRect: passwordButtonFrame)
            }
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: {
                passwordButtonFrame = $0
            }
            .accessibilityIdentifier("share-password-button")
        }
        Button(copy.createAnother) {
            result = nil
            label = ""
            self.password = ""
        }
        .accessibilityIdentifier("share-create-another")
    }

    @ViewBuilder
    private func sharesSection(_ copy: ShareCopy) -> some View {
        let rows = model.shares(for: path)
        if !rows.isEmpty {
            Section(copy.sharedLinksTitle) {
                ForEach(rows) { row in
                    ShareRow(
                        model: model, row: row, copy: copy, hiddenActions: [.open],
                        onViewSharedVersion: { viewing.append(SharedVersionItem($0)) })
                }
            }
        }
    }

    private func create() {
        guard !creating else { return }
        creating = true
        Task {
            let outcome = await model.createShare(path: path, password: password, label: label)
            creating = false
            switch outcome {
            case .created(let link, let sharePassword):
                result = .created(link: link, password: sharePassword)
            case .error(let parts):
                result = .error(parts)
            case nil:
                break
            }
        }
    }

    private func attributed(_ parts: [MessagePart]) -> AttributedString {
        var text = AttributedString()
        for part in parts {
            switch part {
            case .text(let value):
                text.append(AttributedString(value))
            case .link(let value, let href):
                var link = AttributedString(value)
                link.link = URL(string: href)
                text.append(link)
            }
        }
        return text
    }
}
