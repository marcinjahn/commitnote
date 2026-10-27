import NativeCoreAPI
import SwiftUI
import UIKit

struct SettingsScreen: View {
    @Bindable var model: AppModel
    @Environment(\.dismiss) private var dismiss

    /// A text bar button keeps its size at large text sizes; the iOS 26 confirm button is a glyph.
    @ViewBuilder
    private var doneButton: some View {
        if #available(iOS 26, *) {
            Button(role: .confirm) { dismiss() }
        } else {
            Button("Done") { dismiss() }
        }
    }

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(model.settingsCopy?.title ?? "")
                .navigationBarTitleDisplayMode(.inline)
                .navigationDestination(isPresented: $model.isChangePassphrasePresented) {
                    ChangePassphraseScreen(model: model)
                }
                .onChange(of: model.passphraseChange?.stage == .done) { _, finished in
                    if finished { dismiss() }
                }
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        doneButton
                            .accessibilityLabel("Done")
                            .accessibilityIdentifier("settings-done")
                    }
                }
        }
        .presentationDetents([.large])
        .modifier(ImportPresenter(model: model))
        #if FAKE_CORE
        .task {
            if let form = model.pendingTestingImportForm {
                model.pendingTestingImportForm = nil
                model.importForm = form
            }
        }
        #endif
    }

    @ViewBuilder
    private var content: some View {
        if let copy = model.settingsCopy, let view = model.settingsView {
            SettingsForm(model: model, copy: copy, view: view, save: model.settingsSave)
        } else {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

private struct SettingsForm: View {
    let model: AppModel
    let copy: SettingsCopy
    let view: SettingsView
    let save: SettingsSaveView?

    var body: some View {
        Form {
            // In a row of their own the status texts lag behind a text size change on iPad, long
            // enough for the accessibility audit to find them not following Dynamic Type. In the
            // header of a section without rows they crashed the list on a text size change, so
            // they lead the first section's header.
            AppearanceSection(model: model, copy: copy, view: view) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(copy.intro)
                    if let save {
                        saveStatus(save)
                    }
                }
                .textCase(nil)
            }
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    SettingHeader(
                        model: model, copy: copy, title: copy.typeToStart.label, key: .typeToStart,
                        scope: view.scopes.typeToStart)
                    Toggle(
                        copy.typeToStart.label,
                        isOn: Binding(
                            get: { view.values.typeToStart },
                            set: { model.changeSetting(.typeToStart, to: $0 ? "true" : "false") })
                    )
                    .labelsHidden()
                    .accessibilityValue(view.values.typeToStart ? "on" : "off")
                    .accessibilityIdentifier("settings-type-to-start")
                    Text(copy.typeToStart.hint)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            } header: {
                Text(copy.sections.editor)
            } footer: {
                Text(copy.editorUnavailable)
                    .accessibilityIdentifier("settings-editor-note")
            }
            NotesSection(model: model, copy: copy, view: view)
            DeviceSection(model: model, copy: copy, view: view)
            DataSection(model: model, copy: copy, view: view)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("settings-screen")
    }

    private func saveStatus(_ save: SettingsSaveView) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(save.label)
                .font(.body)
                .foregroundStyle(.primary)
                .accessibilityValue(save.state.rawValue)
                .accessibilityIdentifier("settings-save-status")
            if !save.detail.isEmpty {
                Text(save.detail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if save.canRetry {
                Button(copy.retryLabel) { model.retrySettings() }
                    .buttonStyle(.borderless)
                    .accessibilityIdentifier("settings-retry-button")
            }
        }
    }
}

private struct ScopeToggle: View {
    let model: AppModel
    let copy: SettingsCopy
    let key: ScopedSettingKey
    let scope: SettingScope

    var body: some View {
        Button {
            model.setScope(key, to: scope == .synced ? .device : .synced)
        } label: {
            Label(
                scope == .synced ? copy.scopeLabels.synced : copy.scopeLabels.device,
                systemImage: scope == .synced ? "icloud" : "iphone")
        }
        .font(.footnote)
        .buttonStyle(.borderless)
        .hoverEffect()
        .accessibilityValue(scope.rawValue)
        .accessibilityIdentifier("settings-scope-\(key.rawValue)")
    }
}

private struct SettingHeader: View {
    let model: AppModel
    let copy: SettingsCopy
    let title: String
    let key: ScopedSettingKey
    let scope: SettingScope
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let layout =
            dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
            : AnyLayout(HStackLayout())
        layout {
            Text(title)
            if !dynamicTypeSize.isAccessibilitySize { Spacer() }
            ScopeToggle(model: model, copy: copy, key: key, scope: scope)
        }
    }
}

private struct AppearanceSection<Lead: View>: View {
    let model: AppModel
    let copy: SettingsCopy
    let view: SettingsView
    @ViewBuilder let lead: Lead

    @ScaledMetric private var swatchSize: CGFloat = 32
    /// `UIFontMetrics` would scale by whichever traits are current when the body runs, which can
    /// trail this view's own text size while it changes.
    @ScaledMetric(relativeTo: .body) private var fontLabelSize: CGFloat = 17
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 8) {
                SettingHeader(
                    model: model, copy: copy, title: copy.colorMode.label, key: .colorMode,
                    scope: view.scopes.colorMode)
                Picker(copy.colorMode.label, selection: binding(.colorMode, view.values.colorMode)) {
                    ForEach(copy.colorMode.options, id: \.id) { option in
                        Text(option.label).tag(option.id)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .accessibilityValue(view.values.colorMode)
                .accessibilityIdentifier("settings-color-mode")
            }
            VStack(alignment: .leading, spacing: 8) {
                SettingHeader(
                    model: model, copy: copy, title: copy.accentColor.label, key: .accentColor,
                    scope: view.scopes.accentColor)
                WrappingLayout(spacing: 12) {
                    ForEach(copy.accentColor.options, id: \.id) { option in
                        swatch(option)
                    }
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                SettingHeader(
                    model: model, copy: copy, title: copy.noteFont.label, key: .noteFont,
                    scope: view.scopes.noteFont)
                NavigationLink {
                    NoteFontListScreen(model: model, copy: copy, selected: view.values.noteFont)
                } label: {
                    Text(currentFontLabel)
                        .font(
                            Font(
                                NoteFontCatalog.font(
                                    id: view.values.noteFont, size: fontLabelSize, semibold: false,
                                    italic: false) as CTFont))
                }
                .accessibilityValue(view.values.noteFont)
                .accessibilityIdentifier("settings-note-font")
            }
        } header: {
            VStack(alignment: .leading, spacing: 24) {
                lead
                Text(copy.sections.appearance)
            }
        }
    }

    private var currentFontLabel: String {
        copy.noteFont.options.first { $0.id == view.values.noteFont }?.label ?? view.values.noteFont
    }

    private func binding(_ key: SettingKeyView, _ current: String) -> Binding<String> {
        Binding(get: { current }, set: { model.changeSetting(key, to: $0) })
    }

    private func swatch(_ option: AccentOptionView) -> some View {
        let selected = option.id == view.values.accentColor
        return Button {
            model.changeSetting(.accentColor, to: option.id)
        } label: {
            Circle()
                .fill(swatchColor(option))
                .frame(width: swatchSize, height: swatchSize)
                .overlay {
                    Circle().strokeBorder(
                        .primary.opacity(selected || contrast == .increased ? 1 : 0.15),
                        lineWidth: selected ? 3 : 1)
                }
                .padding(6)
                .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .hoverEffect(.lift)
        .accessibilityLabel(option.label)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("settings-accent-\(option.id)")
    }

    private func swatchColor(_ option: AccentOptionView) -> Color {
        guard let light = option.light ?? option.dark, let dark = option.dark ?? option.light,
            let lightColor = AppAppearance.color(hex: light),
            let darkColor = AppAppearance.color(hex: dark)
        else { return .accentColor }
        return Color(
            uiColor: UIColor { $0.userInterfaceStyle == .dark ? darkColor : lightColor })
    }
}

private struct NotesSection: View {
    let model: AppModel
    let copy: SettingsCopy
    let view: SettingsView

    var body: some View {
        Section(copy.sections.notes) {
            placementPicker(
                copy.newNotePlacement, key: .newNotePlacement, current: view.values.newNotePlacement,
                id: "settings-new-note-placement")
            placementPicker(
                copy.newFolderPlacement, key: .newFolderPlacement,
                current: view.values.newFolderPlacement, id: "settings-new-folder-placement")
        }
    }

    private func placementPicker(
        _ choice: SettingChoiceCopy, key: SettingKeyView, current: String, id: String
    ) -> some View {
        Picker(
            choice.label,
            selection: Binding(get: { current }, set: { model.changeSetting(key, to: $0) })
        ) {
            ForEach(choice.options, id: \.id) { option in
                Text(option.label).tag(option.id)
            }
        }
        .pickerStyle(.menu)
        .accessibilityValue(current)
        .accessibilityIdentifier(id)
    }
}

private struct DeviceSection: View {
    let model: AppModel
    let copy: SettingsCopy
    let view: SettingsView
    @State private var name = ""
    @FocusState private var nameFocused: Bool

    var body: some View {
        Section {
            LabeledContent(copy.deviceName.label) {
                TextField(copy.deviceName.label, text: $name, prompt: Text(view.automaticDeviceName))
                    .multilineTextAlignment(.trailing)
                    .focused($nameFocused)
                    .submitLabel(.done)
                    .onSubmit(commitName)
                    .onChange(of: name) { _, value in
                        if value.count > copy.deviceName.maxLength {
                            name = String(value.prefix(copy.deviceName.maxLength))
                        }
                    }
                    .onChange(of: nameFocused) { _, focused in
                        if !focused { commitName() }
                    }
                    .onAppear { name = view.deviceName }
                    .accessibilityIdentifier("settings-device-name")
            }
            Toggle(
                copy.reopenLastView.label,
                isOn: Binding(
                    get: { view.reopenLastView },
                    set: { value in Task { await model.setReopenLastView(value) } })
            )
            .accessibilityValue(view.reopenLastView ? "on" : "off")
            .accessibilityIdentifier("settings-reopen-last-view")
            Toggle(
                copy.analytics.label,
                isOn: Binding(
                    get: { view.analyticsCounted },
                    set: { value in Task { await model.setAnalyticsCounted(value) } })
            )
            .accessibilityValue(view.analyticsCounted ? "on" : "off")
            .accessibilityIdentifier("settings-analytics")
        } header: {
            Text(copy.sections.thisDevice)
        } footer: {
            VStack(alignment: .leading, spacing: 8) {
                Text(copy.deviceName.hint)
                Text(copy.analytics.hint)
            }
        }
    }

    private func commitName() {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed != view.deviceName else { return }
        Task { await model.setDeviceName(trimmed) }
    }
}

/// Self-sizing list cells must measure the same on every pass, or a text size change can loop the
/// list's layout until UIKit stops the app; a lazy grid in a cell does not.
private struct WrappingLayout: Layout {
    let spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(subviews, width: proposal.width ?? .infinity).size
    }

    func placeSubviews(
        in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
    ) {
        let frames = arrange(subviews, width: bounds.width).frames
        for (subview, frame) in zip(subviews, frames) {
            subview.place(
                at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                proposal: ProposedViewSize(frame.size))
        }
    }

    private func arrange(_ subviews: Subviews, width: CGFloat) -> (frames: [CGRect], size: CGSize) {
        var frames: [CGRect] = []
        var origin = CGPoint.zero
        var rowHeight: CGFloat = 0
        var usedWidth: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if origin.x > 0, origin.x + size.width > width {
                origin.x = 0
                origin.y += rowHeight + spacing
                rowHeight = 0
            }
            frames.append(CGRect(origin: origin, size: size))
            usedWidth = max(usedWidth, origin.x + size.width)
            origin.x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return (frames, CGSize(width: usedWidth, height: origin.y + rowHeight))
    }
}
