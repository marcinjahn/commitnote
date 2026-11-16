import Foundation
import NativeCoreAPI

extension AppModel {
    func insertImages(_ inputs: consuming [ImageInput]) async -> [String] {
        await flushEdits()
        let runtime = self.runtime
        var remaining = consume inputs
        remaining.reverse()
        var ids: [String] = []
        if let runtime {
            while let input = remaining.popLast() {
                ids.append(runtime.stageInput(input.data, type: input.mimeType))
            }
        }
        defer { runtime?.discardStagedInputs(ids) }
        do {
            return try await send(ImageInsert(inputs: ids)).references
        } catch {
            showError(error)
            return []
        }
    }

    func clonePastedImages(_ pasted: String, current: String) async -> String {
        let path: [String]?
        switch editorTarget {
        case .none:
            return pasted
        case .note(let notePath):
            path = notePath
        case .draft:
            path = nil
        }
        do {
            return try await send(ImageClonePasted(path: path, current: current, pasted: pasted)).text
        } catch {
            return pasted
        }
    }

    func openHistory() async {
        guard let path = editorTarget.notePath else { return }
        await flushEdits()
        isHistoryPresented = true
        do {
            _ = try await send(HistoryOpen(path: path))
        } catch {
            isHistoryPresented = false
            showError(error)
        }
    }

    func closeHistory() {
        isHistoryPresented = false
        Task {
            do {
                _ = try await send(HistoryClose())
            } catch {
                showError(error)
            }
        }
    }

    func loadMoreHistory() {
        Task {
            do {
                _ = try await send(HistoryLoadMore())
            } catch {
                showError(error)
            }
        }
    }

    func retryHistory() {
        Task {
            do {
                _ = try await send(HistoryRetry())
            } catch {
                showError(error)
            }
        }
    }

    func previewVersion(sha: String, restoreTitle: Bool) async -> VersionPreview? {
        do {
            return try await send(HistoryPreview(sha: sha, restoreTitle: restoreTitle)).preview
        } catch {
            showError(error)
            return nil
        }
    }

    func restoreVersion(sha: String, restoreTitle: Bool) async -> String? {
        await flushEdits()
        do {
            switch try await send(HistoryRestore(sha: sha, restoreTitle: restoreTitle)).outcome {
            case .restored, .closed:
                haptics.play(.actionFinished(succeeded: true))
                return nil
            case .blocked(let message), .error(let message):
                haptics.play(.actionFinished(succeeded: false))
                return message
            }
        } catch {
            haptics.play(.actionFinished(succeeded: false))
            return Self.message(for: error)
        }
    }
}
