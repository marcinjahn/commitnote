import NativeCoreAPI
import SwiftUI

struct SyncStatusButton: View {
    let model: AppModel

    var body: some View {
        if let status = model.syncStatus, status.treeLoaded {
            Menu {
                Text(status.status ?? status.label)
                ForEach(status.unsavedMenu, id: \.id) { item in
                    menuItem(item)
                }
            } label: {
                icon(for: status)
                    .accessibilityLabel(status.status ?? status.label)
            }
            .accessibilityValue(Self.stateName(for: status))
            .accessibilityIdentifier("sync-status-button")
        }
    }

    @ViewBuilder
    private func menuItem(_ item: SyncStatusMenuItem) -> some View {
        if item.id == "retry" {
            Button(item.label, systemImage: "arrow.clockwise") {
                Task { await model.retrySync() }
            }
            .accessibilityIdentifier("sync-status-retry")
        } else if item.id.hasPrefix("note-"), let path = item.path {
            Button(item.label, systemImage: "doc.text") {
                Task { await model.open(path: path) }
            }
            .accessibilityIdentifier("sync-status-\(item.id)")
        } else {
            Button(item.label) {}
                .disabled(true)
                .accessibilityIdentifier("sync-status-\(item.id)")
        }
    }

    @ViewBuilder
    private func icon(for status: SyncStateChanged) -> some View {
        if !status.online {
            Image(systemName: "wifi.slash")
        } else {
            switch status.state {
            case .synced: Image(systemName: "checkmark.circle")
            case .syncing: Image(systemName: "arrow.triangle.2.circlepath")
            case .outOfSync(.pending): Image(systemName: "clock")
            case .outOfSync(.failed): Image(systemName: "exclamationmark.triangle")
            case .outOfSync(.conflict): Image(systemName: "exclamationmark.2")
            }
        }
    }

    static func stateName(for status: SyncStateChanged) -> String {
        if !status.online { return "offline" }
        switch status.state {
        case .synced: return "synced"
        case .syncing: return "syncing"
        case .outOfSync(.pending): return "pending"
        case .outOfSync(.failed): return "failed"
        case .outOfSync(.conflict): return "conflict"
        }
    }
}
