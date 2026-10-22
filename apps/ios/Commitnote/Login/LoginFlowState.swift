import NativeCoreAPI
import Observation
import SwiftUI

enum LoginRoute: Hashable {
    case repositories
    case repository
}

enum TokenError: Equatable {
    case message(String)
    case noRepositories
}

enum Inspection: Equatable {
    case checking
    case result(InspectionResult)
}

@MainActor @Observable
final class LoginFlowState {
    let model: AppModel
    var forgeID: ForgeID
    var token = ""
    var repositories: [RepositoryListing] = []
    var highlightedUrl: String?
    var tokenError: TokenError?
    var listing = false
    var path: [LoginRoute] = []
    var selected: RepositoryListing?
    var inspection: Inspection = .checking
    private var inspectionRun = 0

    init(model: AppModel, entry: LoginEntry) {
        self.model = model
        forgeID = model.lastRepository?.forge ?? model.forges.first?.id ?? .github
        if let message = entry.errorMessage {
            tokenError = .message(message)
        }
    }

    var forge: ForgeView? {
        model.forges.first { $0.id == forgeID }
    }

    var forgeName: String {
        forge?.name ?? ""
    }

    func selectForge(_ id: ForgeID) {
        guard id != forgeID else { return }
        forgeID = id
        token = ""
        tokenError = nil
        forgetRepositories()
    }

    func tokenEdited() {
        if !repositories.isEmpty || path != [] {
            forgetRepositories()
        }
    }

    func forgetRepositories() {
        repositories = []
        highlightedUrl = nil
        path = []
        resetInspection()
    }

    func resetInspection() {
        inspectionRun += 1
        selected = nil
        inspection = .checking
    }

    func continueWithToken() async {
        guard !listing else { return }
        guard !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            tokenError = .message("Enter the access token.")
            return
        }
        forgetRepositories()
        tokenError = nil
        listing = true
        defer { listing = false }
        let requested = token
        do {
            let listed = try await model.listRepositories(forge: forgeID, token: requested)
            guard token == requested else { return }
            guard !listed.isEmpty else {
                tokenError = .noRepositories
                return
            }
            let preselected = preselectedUrl(in: listed)
            highlightedUrl = preselected
            repositories = listed.sorted { lhs, rhs in
                (lhs.url == preselected) && (rhs.url != preselected)
            }
            path = [.repositories]
        } catch {
            guard token == requested else { return }
            tokenError = .message(Self.message(for: error))
        }
    }

    func inspect(_ repository: RepositoryListing) async {
        resetInspection()
        let run = inspectionRun
        selected = repository
        path = [.repositories, .repository]
        await runInspection(repository, run: run)
    }

    func checkAgain() async {
        guard let repository = selected else { return }
        inspectionRun += 1
        let run = inspectionRun
        inspection = .checking
        await runInspection(repository, run: run)
    }

    func markUnusable(_ error: CoreError, repository: RepositoryView) {
        inspection = .result(
            .unusable(
                repository: repository, error: error,
                canCheckAgain: error.kind != CoreError.Kind.unauthorized, foreignHint: nil))
    }

    private func runInspection(_ repository: RepositoryListing, run: Int) async {
        let result: InspectionResult
        do {
            result = try await model.inspect(
                forge: forgeID, token: token, repositoryUrl: repository.url)
        } catch {
            let core = error as? CoreError
            result = .unusable(
                repository: RepositoryView(
                    label: repository.label, url: repository.url, private: repository.private,
                    publicWarning: nil),
                error: core
                    ?? CoreError(
                        kind: CoreError.Kind.notReady, message: AppModel.genericErrorMessage,
                        transient: false),
                canCheckAgain: core?.kind != CoreError.Kind.unauthorized, foreignHint: nil)
        }
        guard run == inspectionRun else { return }
        inspection = .result(result)
    }

    private func preselectedUrl(in listed: [RepositoryListing]) -> String? {
        if let remembered = model.lastRepository?.repoUrl?.trimmingCharacters(
            in: .whitespacesAndNewlines).lowercased(),
            let match = listed.first(where: { $0.url.lowercased() == remembered })
        {
            return match.url
        }
        return listed.count == 1 ? listed[0].url : nil
    }

    static func message(for error: Error) -> String {
        (error as? CoreError)?.message ?? AppModel.genericErrorMessage
    }
}
