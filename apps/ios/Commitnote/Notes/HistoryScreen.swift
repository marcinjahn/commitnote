import NativeCoreAPI
import SwiftUI

struct HistoryScreen: View {
    let model: AppModel

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Version history")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { model.closeHistory() }
                            .accessibilityIdentifier("history-done")
                    }
                }
        }
    }

    @ViewBuilder
    private var content: some View {
        if let history = model.history {
            switch history.phase {
            case .saving:
                VStack(spacing: 12) {
                    ProgressView()
                    if let message = history.message {
                        Text(message).foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .unsaved:
                Text(history.message ?? "")
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .accessibilityIdentifier("history-message")
            case .ready:
                HistoryList(model: model, history: history)
            }
        } else {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

private struct HistoryList: View {
    let model: AppModel
    let history: HistoryView

    var body: some View {
        List {
            ForEach(Array(history.sections.enumerated()), id: \.offset) { sectionIndex, section in
                Section {
                    ForEach(Array(section.rows.enumerated()), id: \.offset) { rowIndex, row in
                        rowView(row)
                            .onAppear {
                                if isLast(sectionIndex, rowIndex) { loadMoreIfPossible() }
                            }
                    }
                } header: {
                    Text(section.title)
                        .accessibilityIdentifier("history-section-header")
                }
            }
            Section { footer }
        }
        .accessibilityIdentifier("history-screen")
    }

    private func isLast(_ sectionIndex: Int, _ rowIndex: Int) -> Bool {
        sectionIndex == history.sections.count - 1
            && rowIndex == history.sections[sectionIndex].rows.count - 1
    }

    private func loadMoreIfPossible() {
        if history.canLoadMore && !history.loading && history.error == nil {
            model.loadMoreHistory()
        }
    }

    @ViewBuilder
    private func rowView(_ row: HistoryRow) -> some View {
        switch row {
        case .single(let version):
            versionLink(version)
        case .session(let title, let shared, let versions):
            DisclosureGroup {
                ForEach(versions, id: \.sha) { version in
                    versionLink(version)
                }
            } label: {
                HStack(spacing: 8) {
                    Text(title)
                    if shared { HistoryBadge(text: "Shared", identifier: "history-badge-shared") }
                }
            }
            .accessibilityIdentifier("history-session")
        }
    }

    private func versionLink(_ version: HistoryVersionView) -> some View {
        NavigationLink {
            VersionPreviewScreen(model: model, version: version)
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(version.time)
                    if version.current {
                        HistoryBadge(text: "Current", identifier: "history-badge-current")
                    }
                    if version.shared {
                        HistoryBadge(text: "Shared", identifier: "history-badge-shared")
                    }
                }
                if !version.events.isEmpty {
                    Text(version.events.joined(separator: ", "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if let name = version.name {
                    Text(name)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityValue(version.dateTime)
        .accessibilityIdentifier("history-version")
    }

    @ViewBuilder
    private var footer: some View {
        if let error = history.error {
            VStack(alignment: .leading, spacing: 8) {
                Text(error).foregroundStyle(.secondary)
                Button("Retry") { model.retryHistory() }
                    .accessibilityIdentifier("history-retry")
            }
        } else if let end = history.end {
            Text(end)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("history-end")
        } else if history.canLoadMore {
            HStack(spacing: 8) {
                Button("Load older versions") { model.loadMoreHistory() }
                    .disabled(history.loading)
                    .accessibilityIdentifier("history-load-more")
                if history.loading { ProgressView() }
            }
        } else if history.loading {
            ProgressView().frame(maxWidth: .infinity)
        }
    }
}

private struct HistoryBadge: View {
    let text: String
    let identifier: String

    var body: some View {
        Text(text)
            .font(.caption2)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .overlay(Capsule().stroke(Color.secondary, lineWidth: 1))
            .foregroundStyle(.secondary)
            .accessibilityIdentifier(identifier)
    }
}
