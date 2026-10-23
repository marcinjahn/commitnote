import CoreGraphics
import NativeCoreAPI

enum PrintState: Equatable {
    case idle
    case rendering
    case failed
}

extension AppModel {
    func printNote(sourceRect: CGRect?) async {
        guard printState != .rendering else { return }
        await flushEdits()
        let name: String
        let text: String
        switch editorTarget {
        case .none:
            return
        case .draft:
            name = draftName
            text = draftText
        case .note(let path):
            guard case .loaded(let loadedPath, let content, _, _, _)? = openNote,
                loadedPath == path
            else { return }
            name = path.last ?? ""
            text = content
        }
        printState = .rendering
        do {
            let html = try await send(PrintRender(name: name, text: text)).html
            let url = try await PrintRenderer.render(
                html: html, noteFont: appearance.noteFont, name: name)
            printState = .idle
            ShareSheet.present(url: url, sourceRect: sourceRect)
        } catch {
            printState = .failed
            showError(error)
        }
    }
}
