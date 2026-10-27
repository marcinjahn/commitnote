import NativeCoreAPI
import SwiftUI
import UIKit

struct NoteFontListScreen: View {
    let model: AppModel
    let copy: SettingsCopy
    let selected: String

    var body: some View {
        List {
            Section {
                FontPreview(copy: copy.noteFont, fontID: selected)
            }
            Section {
                ForEach(copy.noteFont.options, id: \.id) { option in
                    row(option)
                }
            }
        }
        .navigationTitle(copy.noteFont.label)
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("settings-font-list")
    }

    private func row(_ option: SettingOptionView) -> some View {
        let current = option.id == selected
        return Button {
            model.changeSetting(.noteFont, to: option.id)
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(option.label)
                        .font(Font(NoteFontCatalog.bodyFont(id: option.id) as CTFont))
                        .foregroundStyle(.primary)
                    if let description = option.description {
                        Text(description)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                if current {
                    Image(systemName: "checkmark")
                        .foregroundStyle(.tint)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityAddTraits(current ? .isSelected : [])
        .accessibilityIdentifier("settings-font-\(option.id)")
    }
}

private struct FontPreview: View {
    let copy: NoteFontCopy
    let fontID: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(copy.previewHeading)
                .font(Font(NoteFontCatalog.bodyFont(id: fontID, semibold: true, scale: 1.4) as CTFont))
            Text(styled(copy.previewBody))
            Text(copy.previewCode)
                .font(.system(.body, design: .monospaced))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("settings-font-preview")
    }

    private func styled(_ markdown: String) -> AttributedString {
        guard var text = try? AttributedString(markdown: markdown) else {
            return AttributedString(markdown)
        }
        for run in text.runs {
            let intent = run.inlinePresentationIntent ?? []
            if intent.contains(.code) {
                text[run.range].font = .system(.body, design: .monospaced)
                continue
            }
            let font = NoteFontCatalog.bodyFont(
                id: fontID, semibold: intent.contains(.stronglyEmphasized),
                italic: intent.contains(.emphasized))
            text[run.range].font = Font(font as CTFont)
        }
        return text
    }
}
