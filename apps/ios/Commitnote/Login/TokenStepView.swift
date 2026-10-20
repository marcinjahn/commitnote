import SwiftUI

struct TokenStepView: View {
    @Bindable var state: LoginFlowState

    var body: some View {
        Form {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Wordmark()
                    Text("Encrypted markdown notes in your own git repository.")
                        .foregroundStyle(.secondary)
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
                .padding(.vertical, 8)
            }

            if state.model.forges.count > 1 {
                Section("Git host") {
                    Picker(
                        "Git host",
                        selection: Binding(
                            get: { state.forgeID }, set: { state.selectForge($0) })
                    ) {
                        ForEach(state.model.forges, id: \.id) { forge in
                            Text(forge.name).tag(forge.id)
                        }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .disabled(state.listing)
                    .accessibilityIdentifier("login-forge-picker")
                }
            }

            Section {
                SecureField("Access token", text: $state.token)
                    .textContentType(nil)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.continue)
                    .disabled(state.listing)
                    .accessibilityIdentifier("login-token-field")
                    .onChange(of: state.token) { _, _ in state.tokenEdited() }
                    .onSubmit { Task { await state.continueWithToken() } }
            } header: {
                Text("Access token")
            } footer: {
                hints
            }

            if let error = state.tokenError {
                Section {
                    switch error {
                    case .message(let message):
                        LoginErrorText(message: message)
                    case .noRepositories:
                        VStack(alignment: .leading, spacing: 8) {
                            LoginErrorText(
                                message:
                                    "This access token has no access to any repository. Edit it on \(state.forgeName) and add your notes repository."
                            )
                            newRepositoryNote
                        }
                    }
                }
            }

            Section {
                if state.listing {
                    ProgressStatus(text: state.model.loadingStep ?? "Listing repositories…")
                }
                Button("Continue") {
                    Task { await state.continueWithToken() }
                }
                .disabled(state.listing)
                .accessibilityIdentifier("login-continue-button")
            }
        }
        .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder
    private var hints: some View {
        if let forge = state.forge {
            VStack(alignment: .leading, spacing: 8) {
                Text(forge.accessTokenHint)
                if let url = URL(string: forge.accessTokenCreationUrl) {
                    Link(destination: url) {
                        Text(
                            "Create a token on \(forge.name) with these settings filled in, then choose the repository there."
                        )
                        .multilineTextAlignment(.leading)
                    }
                    .accessibilityIdentifier("login-token-link")
                }
                newRepositoryNote
            }
        }
    }

    @ViewBuilder
    private var newRepositoryNote: some View {
        if let forge = state.forge {
            Text(
                linkedText(
                    "No notes repo yet? Create an empty private repository first, then give the token access to it.",
                    link: "Create an empty private repository", url: forge.repositoryCreationUrl))
        }
    }
}
