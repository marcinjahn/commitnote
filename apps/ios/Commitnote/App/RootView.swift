import SwiftUI

struct RootView: View {
    let model: AppModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        content
            .onChange(of: scenePhase, initial: true) { _, phase in
                model.scenePhaseChanged(phase)
                if phase == .active {
                    AppearanceApplier.apply(model.appearance)
                }
            }
            .onAppear { AppearanceApplier.apply(model.appearance) }
            .onChange(of: model.appearance) { _, appearance in
                AppearanceApplier.apply(appearance)
            }
            #if FAKE_CORE
            .preferredColorScheme(TestingAppearance.shared.scheme)
            .onAppear { TestingAppearance.shared.startListening() }
            #endif
    }

    @ViewBuilder
    private var content: some View {
        switch model.screen {
        case .starting, .loading(.inProgress):
            LoadingView(model: model, failure: nil)
        case .loading(.failed(let message, let canRetry)):
            LoadingView(model: model, failure: LoadingFailure(message: message, canRetry: canRetry))
        case .login(let entry):
            LoginFlowView(model: model, entry: entry)
        case .keyChanged(let info):
            KeyChangedView(model: model, info: info)
        case .notes:
            NotesRootView(model: model)
        case .fatal(let message):
            FatalView(message: message)
        }
    }
}

private struct KeyChangedView: View {
    let model: AppModel
    let info: KeyChangedInfo
    @State private var exportButtonFrame: CGRect?

    var body: some View {
        VStack(spacing: 16) {
            Text("Passphrase changed")
                .font(.title2.weight(.semibold))
            Text(info.message)
                .multilineTextAlignment(.center)
            Text(info.detail)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            Button(model.exportState == .exporting ? "Exporting…" : info.exportLabel) {
                Task {
                    if let url = await model.exportNotes() {
                        ShareSheet.present(url: url, sourceRect: exportButtonFrame)
                    }
                }
            }
            .disabled(model.exportState == .exporting)
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { exportButtonFrame = $0 }
            .accessibilityIdentifier("key-changed-export-button")
            if model.exportState == .failed {
                Text("Export failed. Try again.")
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("key-changed-export-error")
            }
            Button("Log in again") {
                Task { await model.logInAgain() }
            }
            .buttonStyle(.borderedProminent)
            .accessibilityIdentifier("key-changed-log-in-again-button")
        }
        .padding()
        .frame(maxWidth: 480)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("key-changed-screen")
    }
}

private struct FatalView: View {
    let message: String

    var body: some View {
        VStack(spacing: 24) {
            Wordmark()
            Text(message)
                .multilineTextAlignment(.center)
                .accessibilityIdentifier("fatal-error")
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
