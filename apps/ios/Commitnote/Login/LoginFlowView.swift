import SwiftUI

struct LoginFlowView: View {
    let model: AppModel
    let entry: LoginEntry
    @State private var state: LoginFlowState

    init(model: AppModel, entry: LoginEntry) {
        self.model = model
        self.entry = entry
        _state = State(initialValue: LoginFlowState(model: model, entry: entry))
    }

    var body: some View {
        NavigationStack(path: $state.path) {
            TokenStepView(state: state)
                .navigationDestination(for: LoginRoute.self) { route in
                    switch route {
                    case .repositories:
                        RepositoryListView(state: state)
                    case .repository:
                        RepositoryDestinationView(state: state)
                    }
                }
        }
        .frame(maxWidth: 560)
        .frame(maxWidth: .infinity)
        .onChange(of: state.path) { _, path in
            if !path.contains(.repository) {
                state.resetInspection()
            }
        }
    }
}

private struct RepositoryDestinationView: View {
    let state: LoginFlowState

    var body: some View {
        Group {
            switch state.inspection {
            case .checking:
                Form {
                    ProgressStatus(text: state.model.loadingStep ?? "Checking the repository…")
                }
            case .result(.notesRepo(let repository)):
                UnlockView(state: state, repository: repository)
            case .result(.uninitialized(let repository, let description)):
                InitializeView(state: state, repository: repository, description: description)
            case .result(.unusable(let repository, let error, let canCheckAgain, let foreignHint)):
                UnusableRepositoryView(
                    state: state, repository: repository, error: error,
                    canCheckAgain: canCheckAgain, foreignHint: foreignHint)
            }
        }
        .navigationTitle(state.selected?.label ?? "")
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct ProgressStatus: View {
    let text: String

    var body: some View {
        HStack(spacing: 12) {
            ProgressView()
            Text(text)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("login-progress")
    }
}

struct PublicWarningView: View {
    let message: String?

    var body: some View {
        if let message {
            Label(message, systemImage: "exclamationmark.triangle")
                .foregroundStyle(.orange)
                .accessibilityIdentifier("login-public-warning")
        }
    }
}

struct LoginErrorText: View {
    let message: String

    var body: some View {
        Text(message)
            .foregroundStyle(.red)
            .accessibilityIdentifier("login-error")
    }
}

struct RepositoryUsernameField: View {
    let label: String

    var body: some View {
        TextField("Repository", text: .constant(label))
            .textContentType(.username)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .allowsHitTesting(false)
            .foregroundStyle(.secondary)
    }
}
