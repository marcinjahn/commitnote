import NativeCoreAPI
import SwiftUI

struct NoticeBanner: View {
    let model: AppModel
    let notice: AppNotice

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .foregroundStyle(color)
            VStack(alignment: .leading, spacing: 8) {
                Text(notice.message)
                if let action = notice.action {
                    Button(action.label) {
                        Task { await model.performNoticeAction(id: notice.id) }
                    }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("notice-action-button")
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                Task { await model.dismissNotice(id: notice.id) }
            } label: {
                Image(systemName: "xmark")
                    .accessibilityLabel("Dismiss")
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
        }
        .padding()
        .frame(maxWidth: 520)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12).strokeBorder(color.opacity(0.6), lineWidth: 1)
        )
        .shadow(radius: 4, y: 2)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("notice-banner")
        .task(id: notice) {
            guard !notice.persistent, notice.action == nil else { return }
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled else { return }
            await model.dismissNotice(id: notice.id)
        }
    }

    private var color: Color {
        switch notice.tone {
        case .info: .accentColor
        case .success: .green
        case .warning: .orange
        case .error: .red
        }
    }

    private var symbol: String {
        switch notice.tone {
        case .info: "info.circle"
        case .success: "checkmark.circle"
        case .warning: "exclamationmark.triangle"
        case .error: "xmark.octagon"
        }
    }
}
