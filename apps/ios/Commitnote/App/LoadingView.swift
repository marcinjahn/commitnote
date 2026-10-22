import SwiftUI

struct LoadingFailure {
    let message: String
    let canRetry: Bool
}

struct LoadingView: View {
    @Bindable var model: AppModel
    let failure: LoadingFailure?
    @FocusState private var focus: Field?

    private enum Field {
        case name
        case body
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                Wordmark()
                status
                draftFields
                if let failure {
                    actions(canRetry: failure.canRetry)
                }
                #if FAKE_CORE
                TestingLoadingBar(model: model)
                #endif
            }
            .padding()
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .defaultScrollAnchor(.center)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("loading-screen")
    }

    @ViewBuilder
    private var status: some View {
        if let failure {
            Text(failure.message)
                .multilineTextAlignment(.center)
                .accessibilityIdentifier("loading-error")
        } else {
            HStack(spacing: 12) {
                ProgressView()
                Text(model.loadingStep ?? "Loading…")
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("loading-step")
            }
        }
    }

    private var draftFields: some View {
        VStack(alignment: .leading, spacing: 12) {
            TextField("Name", text: $model.earlyDraft.name)
                .font(.title3)
                .textFieldStyle(.roundedBorder)
                .submitLabel(.next)
                .autocorrectionDisabled()
                .focused($focus, equals: .name)
                .onSubmit {
                    model.earlyDraft.nameConfirmed = true
                    focus = .body
                }
                .accessibilityIdentifier("early-draft-name")
            TextEditor(text: $model.earlyDraft.body)
                .focused($focus, equals: .body)
                .scrollContentBackground(.hidden)
                .padding(4)
                .frame(minHeight: 200)
                .background(Color(.secondarySystemBackground))
                .accessibilityIdentifier("early-draft-body")
        }
    }

    private func actions(canRetry: Bool) -> some View {
        VStack(spacing: 12) {
            if canRetry {
                Button("Try again") {
                    Task { await model.resume() }
                }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("loading-try-again-button")
            }
            Button("Log in") {
                model.showLogin()
            }
            .accessibilityIdentifier("loading-log-in-button")
        }
    }
}
