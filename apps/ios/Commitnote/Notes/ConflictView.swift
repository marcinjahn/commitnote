import NativeCoreAPI
import SwiftUI

struct ConflictView: View {
    let model: AppModel
    let conflict: OpenNoteConflict
    @State private var resolving = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(conflict.heading)
                        .font(.headline)
                    Text(conflict.text)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                VStack(spacing: 8) {
                    choice(conflict.keepThisLabel, .keepMine, "conflict-keep-this")
                    choice(conflict.keepOtherLabel, .keepTheirs, "conflict-keep-other")
                    choice(conflict.editMergedLabel, .editMerged, "conflict-edit-merged")
                }
                Text(mergedText)
                    .font(.system(.footnote, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("conflict-merged-text")
            }
            .frame(maxWidth: 720, alignment: .leading)
            .frame(maxWidth: .infinity)
            .padding()
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("conflict-view")
        }
    }

    private func choice(_ label: String, _ resolution: ConflictResolution, _ identifier: String)
        -> some View
    {
        Button {
            resolving = true
            Task {
                await model.resolveConflict(resolution)
                resolving = false
            }
        } label: {
            Text(label)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .controlSize(.large)
        .disabled(resolving)
        .accessibilityIdentifier(identifier)
    }

    private var mergedText: AttributedString {
        var result = AttributedString()
        let lines = conflict.merged.split(separator: "\n", omittingEmptySubsequences: false)
        for (index, line) in lines.enumerated() {
            var attributed = AttributedString(index < lines.count - 1 ? "\(line)\n" : String(line))
            if Self.isMarker(line) {
                attributed.foregroundColor = .secondary
            }
            result += attributed
        }
        return result
    }

    private static func isMarker(_ line: Substring) -> Bool {
        line.hasPrefix("<<<<<<<") || line.hasPrefix("=======") || line.hasPrefix(">>>>>>>")
    }
}
