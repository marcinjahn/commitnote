import NativeCoreAPI
import SwiftUI

struct UnlockView: View {
    let state: LoginFlowState
    let repository: RepositoryView
    @State private var passphrase = ""
    @State private var submitting = false
    @State private var formError: String?
    @FocusState private var passphraseFocused: Bool

    var body: some View {
        Form {
            if let warning = repository.publicWarning {
                Section { PublicWarningView(message: warning) }
            }

            Section("Repository") {
                RepositoryUsernameField(label: repository.label)
            }

            Section {
                SecureField("Passphrase", text: $passphrase)
                    .textContentType(.password)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.go)
                    .focused($passphraseFocused)
                    .disabled(submitting)
                    .accessibilityIdentifier("login-passphrase-field")
                    .onSubmit { Task { await submit() } }
            } header: {
                Text("Passphrase")
            } footer: {
                Text("You stay logged in on this device until you log out.")
            }

            if submitting {
                Section { ProgressStatus(text: state.model.loadingStep ?? "") }
            }

            if let formError {
                Section { LoginErrorText(message: formError) }
            }

            Section {
                Button("Log in") { Task { await submit() } }
                    .disabled(submitting)
                    .accessibilityIdentifier("login-unlock-button")
            }
        }
        .onAppear { passphraseFocused = true }
    }

    private func submit() async {
        guard !submitting else { return }
        guard !passphrase.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            formError = "Enter the passphrase."
            return
        }
        formError = nil
        submitting = true
        defer { submitting = false }
        do {
            try await state.model.unlock(passphrase: passphrase)
        } catch let error as CoreError {
            if error.kind == CoreError.Kind.wrongPassphrase {
                formError = error.message
                passphrase = ""
                passphraseFocused = true
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
