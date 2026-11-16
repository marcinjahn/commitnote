import NativeCoreAPI
import SwiftUI

struct InitializeView: View {
    let state: LoginFlowState
    let repository: RepositoryView
    let description: String
    @State private var passphrase = ""
    @State private var repeated = ""
    @State private var strength: PassphraseStrength?
    @State private var submitting = false
    @State private var formError: String?
    @FocusState private var focus: Field?

    private enum Field {
        case passphrase, repeated
    }

    var body: some View {
        Form {
            if let warning = repository.publicWarning {
                Section { PublicWarningView(message: warning) }
            }

            Section {
                Text(description)
                    .accessibilityIdentifier("init-description")
            }

            Section("Repository") {
                RepositoryUsernameField(label: repository.label)
            }

            Section {
                SecureField("Create passphrase", text: $passphrase)
                    .textContentType(.newPassword)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.next)
                    .focused($focus, equals: .passphrase)
                    .disabled(submitting)
                    .accessibilityIdentifier("init-passphrase-field")
                    .onSubmit { focus = .repeated }
                if let strength, !passphrase.isEmpty {
                    PassphraseStrengthView(strength: strength)
                }
            } header: {
                Text("Create passphrase")
            } footer: {
                Text(
                    "Use a long passphrase, for example several random words. It encrypts your notes and cannot be recovered if you forget it."
                )
            }

            Section {
                SecureField("Repeat passphrase", text: $repeated)
                    .textContentType(.newPassword)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.go)
                    .focused($focus, equals: .repeated)
                    .disabled(submitting)
                    .accessibilityIdentifier("init-repeat-field")
                    .onSubmit { Task { await submit() } }
            } header: {
                Text("Repeat passphrase")
            }

            if submitting {
                Section { ProgressStatus(text: state.model.loadingStep ?? "") }
            }

            if let formError {
                Section { LoginErrorText(message: formError) }
            }

            Section {
                Button("Set up notes repo") { Task { await submit() } }
                    .disabled(submitting)
                    .accessibilityIdentifier("init-submit-button")
            }
        }
        .task(id: passphrase) { await updateStrength() }
        .onAppear { focus = .passphrase }
    }

    private func updateStrength() async {
        guard !passphrase.isEmpty else {
            strength = nil
            return
        }
        try? await Task.sleep(for: .milliseconds(150))
        guard !Task.isCancelled else { return }
        let result = try? await state.model.strength(
            passphrase: passphrase, repositoryLabel: repository.label)
        guard !Task.isCancelled, let result else { return }
        strength = result
    }

    private func submit() async {
        guard !submitting else { return }
        guard !passphrase.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            formError = "Create a passphrase."
            return
        }
        guard repeated == passphrase else {
            formError = "Passphrases do not match."
            return
        }
        formError = nil
        submitting = true
        defer { submitting = false }
        do {
            try await state.model.initialize(passphrase: passphrase)
        } catch let error as CoreError {
            if error.kind == CoreError.Kind.wrongPassphrase {
                formError = error.message
                passphrase = ""
                repeated = ""
                focus = .passphrase
            } else if error.transient {
                formError = error.message
            } else {
                state.markUnusable(error, repository: repository)
            }
        } catch {
            formError = AppModel.genericErrorMessage
        }
    }
}
