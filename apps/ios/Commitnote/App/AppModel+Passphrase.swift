import Foundation
import NativeCoreAPI

struct PassphraseChangeState: Equatable {
    enum Stage: Equatable {
        case form
        case working(message: String, done: Int?, total: Int?)
        case review(summary: String, carriedOver: [String], historyWarning: String?)
        case setup(canConfigure: Bool, message: String, actionLabel: String)
        case unsettled(message: String)
        case done
    }

    var copy: PassphraseChangeCopy
    var canRemoveHistory: Bool
    var repositoryLabel: String
    var stage: Stage = .form
    var error: String?
    var clearCurrentRequested = false
    var checking = false

    var isWorking: Bool {
        if case .working = stage { return true }
        return false
    }
}

extension AppModel {
    func openChangePassphrase() async {
        await leaveDraft()
        do {
            let form = try await send(PassphraseChangeForm())
            passphraseChange = PassphraseChangeState(
                copy: form.copy, canRemoveHistory: form.canRemoveHistory,
                repositoryLabel: form.repositoryLabel)
            isChangePassphrasePresented = true
        } catch {
            showError(error)
        }
    }

    func passphraseStrength(_ text: String) async -> PassphraseStrength? {
        guard let label = passphraseChange?.repositoryLabel, !text.isEmpty else { return nil }
        return try? await strength(passphrase: text, repositoryLabel: label)
    }

    func preparePassphraseChange(
        current: String, next: String, repeated: String, removeHistory: Bool
    ) async {
        guard let state = passphraseChange else { return }
        switch state.stage {
        case .form, .setup:
            break
        case .working, .review, .unsettled, .done:
            return
        }
        if current.isEmpty {
            passphraseChange?.stage = .form
            passphraseChange?.error = state.copy.enterCurrentPassphrase
            return
        }
        if next != repeated {
            passphraseChange?.stage = .form
            passphraseChange?.error = state.copy.passphrasesDiffer
            return
        }
        passphraseChange?.clearCurrentRequested = false
        startPassphraseWork()
        await runPassphraseOutcome(from: .form) {
            try await self.send(
                PassphrasePrepareChange(current: current, next: next, removeHistory: removeHistory)
            ).outcome
        }
    }

    func commitPassphraseChange() async {
        guard let state = passphraseChange, case .review = state.stage else { return }
        startPassphraseWork()
        await runPassphraseOutcome(from: state.stage) {
            try await self.send(PassphraseCommitChange()).outcome
        }
    }

    func settlePassphraseChange() async {
        guard let state = passphraseChange, case .unsettled = state.stage, !state.checking
        else { return }
        passphraseChange?.checking = true
        await runPassphraseOutcome(from: state.stage) {
            try await self.send(PassphraseSettle()).outcome
        }
        passphraseChange?.checking = false
    }

    func enablePassphraseAtomic() async -> Bool {
        guard let state = passphraseChange, case .setup = state.stage else { return false }
        startPassphraseWork()
        let failure: String?
        do {
            failure = try await send(PassphraseEnableAtomic()).error
        } catch {
            failure = Self.message(for: error)
        }
        guard passphraseChange != nil else { return false }
        if let failure {
            passphraseChange?.stage = .form
            passphraseChange?.error = failure
            return false
        }
        passphraseChange?.stage = .form
        return true
    }

    func cancelPassphraseChange() async {
        guard let state = passphraseChange, case .review = state.stage else { return }
        passphraseChange?.stage = .form
        passphraseChange?.error = nil
        _ = try? await send(PassphraseCancelChange())
    }

    func dismissChangePassphrase() async {
        if let state = passphraseChange {
            switch state.stage {
            case .working, .unsettled:
                return
            case .review:
                passphraseChange?.stage = .form
                _ = try? await send(PassphraseCancelChange())
            case .form, .setup, .done:
                break
            }
        }
        isChangePassphrasePresented = false
        passphraseChange = nil
    }

    func acknowledgeClearCurrentPassphrase() {
        passphraseChange?.clearCurrentRequested = false
    }

    func resetPassphraseState() {
        passphraseChange = nil
        isChangePassphrasePresented = false
    }

    func handlePassphraseProgress(_ progress: PassphraseChangeProgress) {
        guard let state = passphraseChange, state.isWorking else { return }
        passphraseChange?.stage = .working(
            message: progress.message, done: progress.done, total: progress.total)
    }

    private func startPassphraseWork() {
        guard let state = passphraseChange else { return }
        passphraseChange?.error = nil
        passphraseChange?.stage = .working(message: state.copy.startingLabel, done: nil, total: nil)
    }

    private func runPassphraseOutcome(
        from previous: PassphraseChangeState.Stage,
        _ operation: () async throws -> PassphraseChangeOutcome
    ) async {
        let outcome: PassphraseChangeOutcome
        do {
            outcome = try await operation()
        } catch {
            guard passphraseChange != nil else { return }
            passphraseChange?.stage = previous
            passphraseChange?.error = Self.message(for: error)
            return
        }
        guard passphraseChange != nil else { return }
        await applyPassphraseOutcome(outcome)
    }

    private func applyPassphraseOutcome(_ outcome: PassphraseChangeOutcome) async {
        switch outcome {
        case .review(let summary, let carriedOver, let historyWarning):
            passphraseChange?.error = nil
            passphraseChange?.stage = .review(
                summary: summary, carriedOver: carriedOver, historyWarning: historyWarning)
        case .changed:
            passphraseChange?.error = nil
            passphraseChange?.stage = .done
            isChangePassphrasePresented = false
            if let path = editorTarget.notePath {
                await open(path: path)
            }
        case .failed(let message, let clearCurrent):
            passphraseChange?.stage = .form
            passphraseChange?.error = message
            passphraseChange?.clearCurrentRequested = clearCurrent
        case .needsSetup(let canConfigure, let message, let actionLabel):
            passphraseChange?.error = nil
            passphraseChange?.stage = .setup(
                canConfigure: canConfigure, message: message, actionLabel: actionLabel)
        case .unsettled(let message):
            passphraseChange?.error = nil
            passphraseChange?.stage = .unsettled(message: message)
        }
    }
}
