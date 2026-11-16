import NativeCoreAPI
import SwiftUI

struct UnusableRepositoryView: View {
    let state: LoginFlowState
    let repository: RepositoryView
    let error: CoreError
    let canCheckAgain: Bool
    let foreignHint: String?

    var body: some View {
        Form {
            Section("Repository") {
                Text(repository.label)
            }
            Section {
                LoginErrorText(message: error.message)
                if let foreignHint {
                    foreignText(foreignHint)
                }
                if canCheckAgain {
                    Button("Check again") {
                        Task { await state.checkAgain() }
                    }
                    .accessibilityIdentifier("login-check-again-button")
                }
            }
        }
    }

    @ViewBuilder
    private func foreignText(_ hint: String) -> some View {
        if let forge = state.forge {
            Text(
                linkedText(
                    hint, link: "create an empty private repository",
                    url: forge.repositoryCreationUrl)
            )
            .foregroundStyle(.secondary)
        } else {
            Text(hint).foregroundStyle(.secondary)
        }
    }
}
