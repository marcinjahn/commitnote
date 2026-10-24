import NativeCoreAPI
import SwiftUI

struct ChangePassphraseScreen: View {
    let model: AppModel
    @State private var current = ""
    @State private var next = ""
    @State private var repeated = ""
    @State private var removeHistory = false
    @State private var strength: PassphraseStrength?
    @FocusState private var focus: Field?

    private enum Field {
        case current, next, repeated
    }

    var body: some View {
        Group {
            if let state = model.passphraseChange {
                content(state)
                    .navigationTitle(state.copy.title)
                    .navigationBarTitleDisplayMode(.inline)
                    .navigationBarBackButtonHidden(locked(state))
                    .interactiveDismissDisabled(locked(state))
            } else {
                Color.clear
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("change-passphrase-screen")
        .task(id: next) { await updateStrength() }
        .onChange(of: model.passphraseChange?.clearCurrentRequested ?? false) { _, requested in
            if requested { clearCurrent() }
        }
        .onDisappear {
            current = ""
            next = ""
            repeated = ""
            Task { await model.dismissChangePassphrase() }
        }
    }

    private func locked(_ state: PassphraseChangeState) -> Bool {
        switch state.stage {
        case .working, .unsettled: true
        case .form, .review, .setup, .done: false
        }
    }

    @ViewBuilder
    private func content(_ state: PassphraseChangeState) -> some View {
        switch state.stage {
        case .form:
            formView(state)
        case .working(let message, let done, let total):
            workingView(message: message, done: done, total: total)
        case .review(let summary, let carriedOver, let historyWarning):
            reviewView(
                state, summary: summary, carriedOver: carriedOver, historyWarning: historyWarning)
        case .setup(let canConfigure, let message, let actionLabel):
            setupView(state, canConfigure: canConfigure, message: message, actionLabel: actionLabel)
        case .unsettled(let message):
            unsettledView(state, message: message)
        case .done:
            Color.clear
        }
    }

    private func formView(_ state: PassphraseChangeState) -> some View {
        let copy = state.copy
        return Form {
            Section {
                Text(copy.intro)
            }
            Section {
                SecureField(copy.currentLabel, text: $current)
                    .textContentType(.password)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.next)
                    .focused($focus, equals: .current)
                    .onSubmit { focus = .next }
                    .accessibilityIdentifier("change-passphrase-current")
            } header: {
                Text(copy.currentLabel)
            }
            Section {
                SecureField(copy.newLabel, text: $next)
                    .textContentType(.newPassword)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.next)
                    .focused($focus, equals: .next)
                    .onSubmit { focus = .repeated }
                    .accessibilityIdentifier("change-passphrase-new")
                if let strength, !next.isEmpty {
                    strengthMeter(strength)
                }
            } header: {
                Text(copy.newLabel)
            } footer: {
                Text(copy.newHint)
            }
            Section {
                SecureField(copy.repeatLabel, text: $repeated)
                    .textContentType(.newPassword)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.go)
                    .focused($focus, equals: .repeated)
                    .onSubmit { Task { await submit(state) } }
                    .accessibilityIdentifier("change-passphrase-repeat")
            } header: {
                Text(copy.repeatLabel)
            }
            if state.canRemoveHistory {
                Section {
                    Toggle(copy.removeHistoryLabel, isOn: $removeHistory)
                        .accessibilityValue(removeHistory ? "on" : "off")
                        .accessibilityIdentifier("change-passphrase-remove-history")
                } footer: {
                    Text(copy.removeHistoryDescription)
                }
            }
            Section {
                Text(copy.otherDevicesWarning)
                Text(copy.versionHistoryNotice)
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
            if let error = state.error {
                Section {
                    Text(error)
                        .foregroundStyle(.red)
                        .accessibilityIdentifier("change-passphrase-error")
                }
            }
            Section {
                Button(copy.continueLabel) { Task { await submit(state) } }
                    .accessibilityIdentifier("change-passphrase-continue")
            }
        }
    }

    private func strengthMeter(_ strength: PassphraseStrength) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 4) {
                ForEach(0..<4, id: \.self) { index in
                    Capsule()
                        .fill(
                            index < strength.filledSegments
                                ? (strength.weak ? Color.red : Color.accentColor)
                                : Color(.systemFill)
                        )
                        .frame(height: 6)
                }
            }
            .accessibilityHidden(true)
            Text(strength.label)
                .font(.footnote)
                .foregroundStyle(.secondary)
            if strength.score <= 2, !strength.warning.isEmpty {
                Text(strength.warning)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(strength.label)
        .accessibilityValue(strength.label)
        .accessibilityIdentifier("change-passphrase-strength")
    }

    private func workingView(message: String, done: Int?, total: Int?) -> some View {
        VStack(spacing: 16) {
            if let done, let total, total > 0 {
                ProgressView(value: Double(done), total: Double(total))
            } else {
                ProgressView()
            }
            Text(message)
                .multilineTextAlignment(.center)
                .accessibilityIdentifier("change-passphrase-progress")
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func reviewView(
        _ state: PassphraseChangeState, summary: String, carriedOver: [String],
        historyWarning: String?
    ) -> some View {
        Form {
            Section {
                Text(summary)
                    .accessibilityIdentifier("change-passphrase-summary")
                ForEach(Array(carriedOver.enumerated()), id: \.offset) { _, line in
                    Text(line)
                }
            }
            Section {
                if let historyWarning {
                    Text(historyWarning)
                        .foregroundStyle(.red)
                }
                Text(state.copy.versionHistoryNotice)
                Text(state.copy.otherDevicesWarning)
            }
            .font(.footnote)
            if let error = state.error {
                Section {
                    Text(error)
                        .foregroundStyle(.red)
                        .accessibilityIdentifier("change-passphrase-error")
                }
            }
            Section {
                Button(state.copy.confirmLabel) {
                    Task { await model.commitPassphraseChange() }
                }
                .accessibilityIdentifier("change-passphrase-confirm")
                Button(state.copy.cancelLabel, role: .cancel) {
                    Task { await model.cancelPassphraseChange() }
                }
                .accessibilityIdentifier("change-passphrase-cancel")
            }
        }
    }

    private func setupView(
        _ state: PassphraseChangeState, canConfigure: Bool, message: String, actionLabel: String
    ) -> some View {
        Form {
            Section {
                Text(message)
                    .accessibilityIdentifier("change-passphrase-setup-message")
            }
            if let error = state.error {
                Section {
                    Text(error)
                        .foregroundStyle(.red)
                        .accessibilityIdentifier("change-passphrase-error")
                }
            }
            if canConfigure {
                Section {
                    Button(state.copy.enableAtomicLabel) {
                        Task { await enableAtomic() }
                    }
                    .accessibilityIdentifier("change-passphrase-enable-atomic")
                }
            }
        }
    }

    private func unsettledView(_ state: PassphraseChangeState, message: String) -> some View {
        Form {
            Section {
                Text(message)
                    .accessibilityIdentifier("change-passphrase-unsettled-message")
            }
            if let error = state.error {
                Section {
                    Text(error)
                        .foregroundStyle(.red)
                        .accessibilityIdentifier("change-passphrase-error")
                }
            }
            Section {
                Button(state.checking ? state.copy.checkingLabel : state.copy.checkAgainLabel) {
                    Task { await model.settlePassphraseChange() }
                }
                .disabled(state.checking)
                .accessibilityIdentifier("change-passphrase-check-again")
                Button(state.copy.logOutLabel) {
                    model.resetPassphraseState()
                    model.isSettingsPresented = false
                    Task { await model.logOut() }
                }
                .disabled(state.checking)
                .accessibilityIdentifier("change-passphrase-log-out")
            }
        }
    }

    private func submit(_ state: PassphraseChangeState) async {
        await model.preparePassphraseChange(
            current: current, next: next, repeated: repeated,
            removeHistory: state.canRemoveHistory && removeHistory)
    }

    private func enableAtomic() async {
        guard await model.enablePassphraseAtomic(), let state = model.passphraseChange else {
            return
        }
        await submit(state)
    }

    private func clearCurrent() {
        current = ""
        model.acknowledgeClearCurrentPassphrase()
        focus = .current
    }

    private func updateStrength() async {
        guard !next.isEmpty else {
            strength = nil
            return
        }
        try? await Task.sleep(for: .milliseconds(150))
        guard !Task.isCancelled else { return }
        let result = await model.passphraseStrength(next)
        guard !Task.isCancelled else { return }
        strength = result
    }
}
