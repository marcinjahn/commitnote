import NativeCoreAPI
import SwiftUI

struct SharedLinksScreen: View {
    let model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var viewing: [SharedVersionItem] = []

    var body: some View {
        NavigationStack(path: $viewing) {
            content
                .navigationTitle(model.shareCopy?.sharedLinksTitle ?? "")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }
                            .accessibilityIdentifier("shared-links-done")
                    }
                }
                .navigationDestination(for: SharedVersionItem.self) { item in
                    if let copy = model.shareCopy {
                        SharedVersionScreen(model: model, item: item, copy: copy)
                    }
                }
        }
        .imageViewer(model: model)
    }

    @ViewBuilder
    private var content: some View {
        if let copy = model.shareCopy {
            List {
                if let unreadable = model.sharesUnreadable {
                    Section {
                        Text(unreadable)
                            .foregroundStyle(.red)
                            .accessibilityIdentifier("shared-links-unreadable")
                    }
                }
                if model.shares.isEmpty {
                    if model.sharesUnreadable == nil {
                        Text(copy.sharedLinksEmpty)
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("shared-links-empty")
                    }
                } else {
                    ForEach(model.shares) { row in
                        ShareRow(model: model, row: row, copy: copy) { viewing.append(SharedVersionItem($0)) }
                    }
                }
            }
            .accessibilityIdentifier("shared-links-screen")
        } else {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}
