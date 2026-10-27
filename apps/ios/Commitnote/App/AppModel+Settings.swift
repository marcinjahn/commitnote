import CoreRuntime
import Foundation
import NativeCoreAPI

extension AppModel {
    func openSettings() async {
        guard await loadSettings() else { return }
        isSettingsPresented = true
    }

    func changeSetting(_ key: SettingKeyView, to value: String) {
        Task {
            do {
                _ = try await send(SettingsChange(key: key, value: value))
            } catch {
                showError(error)
            }
        }
    }

    func setScope(_ key: ScopedSettingKey, to scope: SettingScope) {
        Task {
            do {
                _ = try await send(SettingsSetScope(key: key, scope: scope))
            } catch {
                showError(error)
            }
        }
    }

    func retrySettings() {
        Task { _ = try? await send(SettingsRetry()) }
    }

    func flushSettings() async {
        _ = try? await send(SettingsFlush())
    }

    func setDeviceName(_ name: String) async {
        do {
            let result = try await send(DeviceSetName(name: name.isEmpty ? nil : name))
            deviceName = result.name
        } catch {
            showError(error)
        }
    }

    func setReopenLastView(_ on: Bool) async {
        do {
            _ = try await send(LastViewSetEnabled(enabled: on, view: currentLastView()))
        } catch {
            showError(error)
        }
    }

    func setAnalyticsCounted(_ on: Bool) async {
        do {
            _ = try await send(AnalyticsSetCounted(counted: on))
        } catch {
            showError(error)
        }
    }

    func handleSettingsChanged(_ view: SettingsView) {
        settingsView = view
        typeToStartEnabled = view.values.typeToStart
        refreshAppearance()
        if settingsCopy == nil, !settingsCopyRequested {
            settingsCopyRequested = true
            Task { _ = await loadSettings() }
        }
    }

    func refreshAppearance() {
        guard let settingsView else { return }
        let next = AppAppearance(
            values: settingsView.values, accents: settingsCopy?.accentColor.options ?? [],
            fallback: appearance)
        applyAppearance(next)
    }

    func applyAppearance(_ next: AppAppearance) {
        guard next != appearance else { return }
        appearance = next
        next.saveCache()
        AppearanceApplier.apply(next)
    }

    private func loadSettings() async -> Bool {
        do {
            let result = try await send(SettingsOpen())
            settingsCopy = result.copy
            settingsView = result.view
            settingsSave = result.save
            refreshAppearance()
            return true
        } catch {
            showError(error)
            return false
        }
    }
}
