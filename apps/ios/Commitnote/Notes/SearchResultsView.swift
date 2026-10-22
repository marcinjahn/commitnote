import NativeCoreAPI
import SwiftUI

enum SearchCopy {
    static let prompt = "Search notes"
}

enum SearchHighlight {
    static func name(_ text: String, ranges: [SearchRange]) -> AttributedString {
        var result = AttributedString(text)
        let utf16 = text.utf16
        for range in ranges {
            guard range.start >= 0, range.start < range.end, range.end <= utf16.count else { continue }
            let lower = utf16.index(utf16.startIndex, offsetBy: range.start)
            let upper = utf16.index(utf16.startIndex, offsetBy: range.end)
            guard let target = Range(lower..<upper, in: result) else { continue }
            result[target].font = .body.bold()
        }
        return result
    }

    static func snippet(_ parts: [SnippetPart]) -> AttributedString {
        var result = AttributedString()
        for part in parts {
            var piece = AttributedString(part.text)
            if part.match {
                piece.font = .subheadline.bold()
                piece.foregroundColor = .primary
            }
            result += piece
        }
        return result
    }
}

struct SearchResultsView: View {
    let model: AppModel

    var body: some View {
        List {
            if let status = model.searchStatus, let text = status.status {
                statusRow(text: text, progress: status.progress)
            }
            if isBlankQuery {
                recentSection
            } else {
                namesSection
                contentsSection
                noResults
            }
        }
        .listStyle(.plain)
        .navigationTitle("Notes")
        .accessibilityIdentifier("search-results")
    }

    private var isBlankQuery: Bool {
        model.searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var partial: Bool {
        model.searchStatus?.partial ?? false
    }

    private func statusRow(text: String, progress: Double?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(text)
                .font(.footnote)
                .foregroundStyle(.secondary)
            if let progress {
                ProgressView(value: min(max(progress, 0), 1))
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("search-status")
    }

    @ViewBuilder
    private var recentSection: some View {
        let rows = model.searchResults?.recent ?? []
        if rows.isEmpty {
            if let results = model.searchResults {
                Text(results.copy.hint)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("search-hint")
            }
        } else {
            Section(model.searchResults?.copy.recentHeading ?? "") {
                ForEach(rows, id: \.path) { row in
                    resultRow(row, identifier: "search-recent-row", showsSnippet: false)
                }
            }
        }
    }

    @ViewBuilder
    private var namesSection: some View {
        if let results = model.searchResults, !results.names.isEmpty {
            Section(results.copy.namesHeading) {
                ForEach(results.names, id: \.path) { row in
                    resultRow(row, identifier: "search-name-row", showsSnippet: false)
                }
                moreRow(results.namesMore)
            }
        }
    }

    @ViewBuilder
    private var contentsSection: some View {
        if let results = model.searchResults, !results.contents.isEmpty {
            Section(results.copy.contentsHeading) {
                ForEach(results.contents, id: \.path) { row in
                    resultRow(row, identifier: "search-content-row", showsSnippet: true)
                }
                moreRow(results.contentsMore)
            }
        }
    }

    @ViewBuilder
    private var noResults: some View {
        if let results = model.searchResults, results.names.isEmpty, results.contents.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text(results.copy.noMatches)
                if partial {
                    Text(results.copy.stillReading)
                }
                if let count = results.countText {
                    Text(count)
                        .font(.footnote)
                }
            }
            .foregroundStyle(.secondary)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("search-no-results")
        }
    }

    @ViewBuilder
    private func moreRow(_ text: String?) -> some View {
        if let text {
            Text(text)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private func resultRow(_ row: SearchRow, identifier: String, showsSnippet: Bool) -> some View {
        Button {
            Task { await model.openSearchResult(path: row.path) }
        } label: {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(SearchHighlight.name(row.name, ranges: row.nameRanges))
                    if let folder = row.folder, !folder.isEmpty {
                        Text(folder)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if showsSnippet, let snippet = row.snippet {
                        Text(SearchHighlight.snippet(snippet))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                }
                Spacer(minLength: 0)
                if let tag = row.colorTag {
                    TagDot(tag: tag)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("\(model.tagLabel(tag)) tag")
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(identifier)
    }
}
