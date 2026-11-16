import SwiftUI

struct RepositoryListView: View {
    let state: LoginFlowState
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        List {
            Section {
                ForEach(state.repositories, id: \.url) { repository in
                    Button {
                        Task { await state.inspect(repository) }
                    } label: {
                        HStack {
                            Text(repository.label)
                                .foregroundStyle(.primary)
                            Spacer()
                            if repository.private {
                                Image(systemName: "lock.fill")
                                    .foregroundStyle(.secondary)
                                    .accessibilityHidden(true)
                            }
                        }
                    }
                    .listRowBackground(
                        repository.url == state.highlightedUrl
                            ? Color.accentColor.opacity(contrast == .increased ? 0.35 : 0.15) : nil
                    )
                    .accessibilityLabel(repository.label)
                    .accessibilityIdentifier("login-repository-row")
                }
            } header: {
                Text("Repository")
            } footer: {
                Text(
                    "Repositories this access token can open. Pick your notes repo, or an empty one to start a new notes repo."
                )
            }
        }
        .accessibilityIdentifier("login-repository-list")
        .navigationTitle("Repository")
        .navigationBarTitleDisplayMode(.inline)
    }
}
