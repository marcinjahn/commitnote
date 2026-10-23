import Foundation
import NativeCoreAPI
import UIKit

extension AppModel {
    func presentShare() async {
        guard let path = editorTarget.notePath else { return }
        await flushEdits()
        sharePath = path
    }

    func shares(for path: [String]) -> [ShareRowView] {
        shares.filter { $0.notePath == path }
    }

    func shareTitle(for path: [String]) async -> String? {
        do {
            return try await send(ShareForm(path: path)).title
        } catch {
            return nil
        }
    }

    func createShare(path: [String], password: String, label: String) async -> ShareCreateOutcome? {
        await flushEdits()
        do {
            return try await send(ShareCreate(path: path, password: password, label: label)).outcome
        } catch {
            showError(error)
            return nil
        }
    }

    func updateShare(id: String) {
        Task {
            do {
                _ = try await send(ShareUpdate(id: id))
            } catch {
                showError(error)
            }
        }
    }

    func revokeShare(id: String) {
        Task {
            do {
                _ = try await send(ShareRevoke(id: id))
            } catch {
                showError(error)
            }
        }
    }

    func renameShare(id: String, label: String) async -> String? {
        do {
            switch try await send(ShareRename(id: id, label: label)).outcome {
            case .ok:
                return nil
            case .error(let message):
                return message
            }
        } catch {
            return Self.message(for: error)
        }
    }

    func sharedVersion(id: String) async -> SharedVersionOutcome? {
        do {
            return try await send(ShareSharedVersion(id: id)).outcome
        } catch {
            showError(error)
            return nil
        }
    }

    func copyShareLink(_ row: ShareRowView) {
        guard let copy = shareCopy else { return }
        UIPasteboard.general.string = row.link
        appendLocalNotice(tone: .success, message: copy.linkCopied)
    }

    func copySharePassword(_ row: ShareRowView) {
        guard let copy = shareCopy, let password = row.password else { return }
        UIPasteboard.general.string = password
        appendLocalNotice(tone: .success, message: copy.passwordCopied)
    }

    func openSharedNote(_ row: ShareRowView) {
        guard let path = row.notePath else { return }
        isSharedLinksPresented = false
        sharePath = nil
        Task { await open(path: path) }
    }
}
