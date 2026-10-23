import NativeCoreAPI
import SwiftUI

struct VersionPreviewScreen: View {
    let model: AppModel
    let version: HistoryVersionView
    @State private var preview: VersionPreview?
    @State private var loading = true
    @State private var restoreTitle = false
    @State private var reloadCount = 0
    @State private var restoring = false
    @State private var restoreMessage: String?

    private struct LoadKey: Hashable {
        let restoreTitle: Bool
        let reloadCount: Int
    }

    var body: some View {
        ScrollView {
            content
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
        }
        .navigationTitle(version.time)
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("history-preview")
        .safeAreaInset(edge: .bottom) { restoreBar }
        .task(id: LoadKey(restoreTitle: restoreTitle, reloadCount: reloadCount)) {
            loading = true
            let result = await model.previewVersion(sha: version.sha, restoreTitle: restoreTitle)
            if Task.isCancelled { return }
            preview = result
            loading = false
        }
    }

    @ViewBuilder
    private var content: some View {
        switch preview {
        case nil:
            if loading {
                ProgressView().frame(maxWidth: .infinity)
            } else {
                retryButton
            }
        case .failed(let message):
            VStack(alignment: .leading, spacing: 12) {
                Text(message)
                retryButton
            }
        case .undecryptable(let message), .closed(let message):
            Text(message).foregroundStyle(.secondary)
        case .version(let titleChange, let body, _, _):
            VStack(alignment: .leading, spacing: 12) {
                if let titleChange {
                    Text(titleChange)
                        .font(.headline)
                        .accessibilityIdentifier("history-title-change")
                }
                bodyView(body)
            }
        }
    }

    private var retryButton: some View {
        Button("Retry") { reloadCount += 1 }
            .accessibilityIdentifier("history-preview-retry")
    }

    @ViewBuilder
    private func bodyView(_ body: PreviewBody) -> some View {
        switch body {
        case .tooLarge(let message), .unchanged(let message):
            Text(message).foregroundStyle(.secondary)
        case .diff(let items, let finalNewline):
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    switch item {
                    case .line(let line):
                        DiffLine(line: line)
                    case .fold(let label, let lines):
                        DisclosureGroup(label) {
                            VStack(alignment: .leading, spacing: 0) {
                                ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                                    DiffLine(line: line)
                                }
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
                if let finalNewline {
                    Text(finalNewline)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.top, 8)
                }
            }
        }
    }

    @ViewBuilder
    private var restoreBar: some View {
        if case .version(_, _, let titleLabel, let availability) = preview {
            VStack(alignment: .leading, spacing: 8) {
                if let titleLabel {
                    Toggle(titleLabel, isOn: $restoreTitle)
                        .accessibilityIdentifier("history-restore-title-toggle")
                }
                if let reason = restoreMessage ?? availability.reason {
                    Text(reason)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("history-restore-reason")
                }
                Button {
                    restore()
                } label: {
                    HStack(spacing: 8) {
                        if restoring { ProgressView() }
                        Text(availability.label)
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(!availability.enabled || restoring)
                .accessibilityIdentifier("history-restore-button")
            }
            .padding()
            .background(.bar)
        }
    }

    private func restore() {
        restoring = true
        restoreMessage = nil
        Task {
            let message = await model.restoreVersion(sha: version.sha, restoreTitle: restoreTitle)
            restoring = false
            restoreMessage = message
        }
    }
}

private struct DiffLine: View {
    let line: DiffLineView

    var body: some View {
        Text(attributedText)
            .font(.system(.footnote, design: .monospaced))
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 4)
            .background(lineTint)
            .accessibilityValue(kind)
            .accessibilityIdentifier("history-diff-line")
    }

    private var kind: String {
        switch line {
        case .same: "same"
        case .added: "added"
        case .removed: "removed"
        }
    }

    private var lineTint: Color {
        switch line {
        case .same: .clear
        case .added: Color.green.opacity(0.15)
        case .removed: Color.red.opacity(0.15)
        }
    }

    private var emphasis: Color {
        switch line {
        case .same: .clear
        case .added: Color.green.opacity(0.4)
        case .removed: Color.red.opacity(0.4)
        }
    }

    private var attributedText: AttributedString {
        switch line {
        case .same(let text):
            return AttributedString(text.isEmpty ? " " : text)
        case .added(let segments), .removed(let segments):
            var result = AttributedString()
            for segment in segments {
                var part = AttributedString(segment.text)
                if segment.changed { part.backgroundColor = emphasis }
                result += part
            }
            if result.characters.isEmpty { result = AttributedString(" ") }
            return result
        }
    }
}
