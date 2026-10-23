import NativeCoreAPI
import SwiftUI

struct SharedVersionItem: Hashable {
    let shareId: String
    let title: String

    init(_ row: ShareRowView) {
        shareId = row.id
        title = row.title
    }
}

struct SharedVersionScreen: View {
    let model: AppModel
    let item: SharedVersionItem
    let copy: ShareCopy
    @State private var outcome: SharedVersionOutcome?
    @State private var loading = true
    @State private var reloadCount = 0

    var body: some View {
        content
            .navigationTitle(copy.sharedVersionTitle)
            .navigationBarTitleDisplayMode(.inline)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("shared-version-screen")
            .task(id: reloadCount) {
                loading = true
                let result = await model.sharedVersion(id: item.shareId)
                if Task.isCancelled { return }
                outcome = result
                loading = false
            }
    }

    @ViewBuilder
    private var content: some View {
        if loading {
            VStack(spacing: 12) {
                ProgressView()
                Text(copy.loadingSharedVersion)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            switch outcome {
            case .readable(let name, let content, let date):
                VStack(alignment: .leading, spacing: 0) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(date)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(name ?? item.title)
                            .font(.headline)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal)
                    .padding(.vertical, 8)
                    MarkdownEditor(model: model, readOnlyText: content, appearance: model.appearance)
                }
            case .message(let message):
                messageView(message)
            case .failed(let message):
                messageView(message, retry: true)
            case nil:
                messageView(nil, retry: true)
            }
        }
    }

    private func messageView(_ message: String?, retry: Bool = false) -> some View {
        VStack(spacing: 12) {
            if let message {
                Text(message)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("shared-version-message")
            }
            if retry {
                Button("Try again") { reloadCount += 1 }
                    .accessibilityIdentifier("shared-version-retry")
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
