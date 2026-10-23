import Foundation
import NativeCoreAPI
import UniformTypeIdentifiers

struct ImportSetupState: Equatable {
    var canConfigure: Bool
    var message: String
    var actionLabel: String
    var destination: ImportDestinationView
    var policy: ImportPolicy
}

struct DropSetupState: Equatable {
    var canConfigure: Bool
    var message: String
    var actionLabel: String
}

private struct PickedImportFile: Sendable {
    var data: Data
    var name: String
}

extension AppModel {
    func exportNotes() async -> URL? {
        await export(includeImages: false)
    }

    func exportArchive() async -> URL? {
        await export(includeImages: true)
    }

    func importFiles(_ urls: [URL]) async {
        guard !urls.isEmpty, let runtime else { return }
        await flushEdits()
        let read = await Task.detached(priority: .userInitiated) {
            Self.readPickedFiles(urls)
        }.value
        guard let read else {
            showErrorNotice(Self.genericErrorMessage)
            return
        }
        let files = read.map { file in
            ImportDroppedFile(
                input: runtime.stageInput(file.data, type: Self.importMimeType(for: file.name)),
                name: file.name)
        }
        defer { runtime.discardStagedInputs(files.map(\.input)) }
        if files.count == 1, Self.isArchive(files[0].name) {
            await readArchive(files[0])
        } else {
            await sendDroppedFiles(files, parent: nil, source: .picker)
        }
    }

    func previewImport(_ destination: ImportDestinationView) async {
        importPreviewRequest += 1
        let request = importPreviewRequest
        do {
            try await Task.sleep(for: .milliseconds(150))
        } catch {
            return
        }
        guard request == importPreviewRequest, importForm != nil else { return }
        queuedImportPreview = destination
        guard !importPreviewRunning else { return }
        importPreviewRunning = true
        defer { importPreviewRunning = false }
        while let next = queuedImportPreview {
            queuedImportPreview = nil
            let text = try? await send(ImportPreview(destination: next)).text
            guard importForm != nil else { return }
            if queuedImportPreview == nil {
                importPreview = text
            }
        }
    }

    func commitImport(_ destination: ImportDestinationView, policy: ImportPolicy) async {
        guard importForm != nil, !importBusy else { return }
        importBusy = true
        defer { importBusy = false }
        await performImportCommit(destination, policy: policy)
    }

    func enableAtomicAndRetry() async {
        guard !importBusy else { return }
        let setup = importSetup
        let dropping = dropSetup != nil || importForm == nil
        dropSetup = nil
        importBusy = true
        defer { importBusy = false }
        let result: ImportEnableAtomic.Result
        do {
            result = try await send(ImportEnableAtomic())
        } catch {
            reportImportFailure(Self.message(for: error), dropping: dropping)
            return
        }
        if let error = result.error {
            reportImportFailure(error, dropping: dropping)
        } else if let outcome = result.outcome {
            applyDropOutcome(outcome)
        } else if let setup, importForm != nil {
            importSetup = nil
            await performImportCommit(setup.destination, policy: setup.policy)
        }
    }

    func cancelImport() {
        clearImportForm()
        Task { _ = try? await send(ImportCancel()) }
    }

    func dropFiles(_ providers: [NSItemProvider], parent: [String]?) async {
        guard !providers.isEmpty, let runtime else { return }
        await flushEdits()
        var loaded: [PickedImportFile] = []
        for provider in providers {
            if let file = await Self.loadDroppedFile(provider) {
                loaded.append(file)
            }
        }
        let files = loaded.map { file in
            ImportDroppedFile(
                input: runtime.stageInput(file.data, type: Self.importMimeType(for: file.name)),
                name: file.name)
        }
        defer { runtime.discardStagedInputs(files.map(\.input)) }
        await sendDroppedFiles(files, parent: parent, source: .tree)
    }

    func resolveAtomicBlocked(enable: Bool) async {
        do {
            if enable {
                let result = try await send(ImportEnableAtomic())
                if let error = result.error {
                    showErrorNotice(error)
                } else if let outcome = result.outcome {
                    applyDropOutcome(outcome)
                }
            } else {
                _ = try await send(ImportSaveWithoutAtomic())
            }
        } catch {
            showError(error)
        }
    }

    func resetImportState() {
        clearImportForm()
        importBusy = false
        isImporting = false
        atomicBlocked = nil
        isImportPickerPresented = false
        dropSetup = nil
    }

    private func export(includeImages: Bool) async -> URL? {
        guard exportState != .exporting else { return nil }
        exportState = .exporting
        let archive: ExportedArchive
        do {
            archive = try await send(ExportNotes(includeImages: includeImages))
        } catch {
            exportState = .failed
            return nil
        }
        let url = await Task.detached(priority: .userInitiated) {
            Self.writeArchive(archive)
        }.value
        exportState = url == nil ? .failed : .idle
        return url
    }

    private func readArchive(_ file: ImportDroppedFile) async {
        do {
            switch try await send(ImportReadArchive(input: file.input, fileName: file.name)) {
            case .ready(let form):
                clearImportForm()
                importForm = form
            case .error(let message):
                showErrorNotice(message)
            }
        } catch {
            showError(error)
        }
    }

    private func performImportCommit(_ destination: ImportDestinationView, policy: ImportPolicy)
        async
    {
        importOutcomeMessage = nil
        importOffersRename = false
        importSetup = nil
        let outcome: ImportOutcomeView
        do {
            outcome = try await send(ImportCommit(destination: destination, policy: policy)).outcome
        } catch {
            if importForm != nil {
                importOutcomeMessage = Self.message(for: error)
            }
            return
        }
        guard importForm != nil else { return }
        switch outcome {
        case .queued(let expand):
            clearImportForm()
            if let expand {
                expandImportedFolder(expand)
            }
        case .conflicts(_, let message):
            importOutcomeMessage = message
            importOffersRename = true
        case .needsSetup(let canConfigure, let message, let actionLabel):
            importSetup = ImportSetupState(
                canConfigure: canConfigure, message: message, actionLabel: actionLabel,
                destination: destination, policy: policy)
        case .error(let message):
            importOutcomeMessage = message
        }
    }

    private func sendDroppedFiles(
        _ files: [ImportDroppedFile], parent: [String]?, source: ImportDropSource
    ) async {
        do {
            let outcome = try await send(
                ImportDropFiles(files: files, parent: parent, source: source)
            ).outcome
            applyDropOutcome(outcome)
        } catch {
            showError(error)
        }
    }

    private func applyDropOutcome(_ outcome: ImportOutcomeView) {
        switch outcome {
        case .queued(let expand):
            if let expand {
                expandImportedFolder(expand)
            }
        case .needsSetup(let canConfigure, let message, let actionLabel):
            dropSetup = DropSetupState(
                canConfigure: canConfigure, message: message, actionLabel: actionLabel)
        case .conflicts(_, let message), .error(let message):
            showErrorNotice(message)
        }
    }

    private func reportImportFailure(_ message: String, dropping: Bool) {
        if dropping {
            showErrorNotice(message)
        } else {
            importOutcomeMessage = message
        }
    }

    private func expandImportedFolder(_ path: [String]) {
        guard !path.isEmpty else { return }
        var folders = expandedFolders
        for length in 1...path.count {
            folders.insert(Array(path.prefix(length)))
        }
        setExpandedFolders(folders)
    }

    private func clearImportForm() {
        importForm = nil
        importPreview = nil
        importOutcomeMessage = nil
        importOffersRename = false
        importSetup = nil
        importPreviewRequest += 1
        queuedImportPreview = nil
    }

    private nonisolated static func writeArchive(_ archive: ExportedArchive) -> URL? {
        guard let data = Data(base64Encoded: archive.base64) else { return nil }
        do {
            let directory = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(
                at: directory, withIntermediateDirectories: true)
            let url = directory.appendingPathComponent(
                (archive.fileName as NSString).lastPathComponent)
            try data.write(to: url, options: .atomic)
            return url
        } catch {
            return nil
        }
    }

    private nonisolated static func readPickedFiles(_ urls: [URL]) -> [PickedImportFile]? {
        var files: [PickedImportFile] = []
        for url in urls {
            let scoped = url.startAccessingSecurityScopedResource()
            defer {
                if scoped { url.stopAccessingSecurityScopedResource() }
            }
            guard let data = try? Data(contentsOf: url) else { return nil }
            files.append(PickedImportFile(data: data, name: url.lastPathComponent))
        }
        return files
    }

    private nonisolated static let droppedFileTypes: [UTType] = [
        UTType.zip, UTType("net.daringfireball.markdown"), UTType.plainText, UTType.data,
    ].compactMap { $0 }

    /// The provider's file URL is deleted once the completion handler returns, so the bytes are
    /// read inside it.
    private nonisolated static func loadDroppedFile(_ provider: NSItemProvider) async
        -> PickedImportFile?
    {
        guard
            let type = droppedFileTypes.first(where: {
                provider.hasItemConformingToTypeIdentifier($0.identifier)
            })
        else { return nil }
        return await withCheckedContinuation { continuation in
            _ = provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, _ in
                guard let url, let data = try? Data(contentsOf: url) else {
                    continuation.resume(returning: nil)
                    return
                }
                continuation.resume(
                    returning: PickedImportFile(data: data, name: url.lastPathComponent))
            }
        }
    }

    private nonisolated static func isArchive(_ name: String) -> Bool {
        (name as NSString).pathExtension.lowercased() == "zip"
    }

    private nonisolated static func importMimeType(for name: String) -> String {
        isArchive(name) ? "application/zip" : "text/markdown"
    }
}
