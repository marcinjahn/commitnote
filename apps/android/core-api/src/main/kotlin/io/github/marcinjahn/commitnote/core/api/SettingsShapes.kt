package io.github.marcinjahn.commitnote.core.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class SettingScope {
    @SerialName("synced")
    SYNCED,

    @SerialName("device")
    DEVICE,
}

@Serializable
enum class SettingKeyView {
    @SerialName("colorMode")
    COLOR_MODE,

    @SerialName("accentColor")
    ACCENT_COLOR,

    @SerialName("noteFont")
    NOTE_FONT,

    @SerialName("newNotePlacement")
    NEW_NOTE_PLACEMENT,

    @SerialName("newFolderPlacement")
    NEW_FOLDER_PLACEMENT,

    @SerialName("typeToStart")
    TYPE_TO_START,

    @SerialName("vimMode")
    VIM_MODE,
}

/** The settings that can be switched between synced and this device. */
@Serializable
enum class ScopedSettingKey {
    @SerialName("colorMode")
    COLOR_MODE,

    @SerialName("accentColor")
    ACCENT_COLOR,

    @SerialName("noteFont")
    NOTE_FONT,

    @SerialName("typeToStart")
    TYPE_TO_START,
}

@Serializable
data class SettingOptionView(
    val id: String,
    val label: String,
    val description: String?,
)

@Serializable
data class AccentOptionView(
    val id: String,
    val label: String,
    val light: String?,
    val dark: String?,
)

@Serializable
data class SettingChoiceCopy(
    val label: String,
    val options: List<SettingOptionView>,
)

@Serializable
data class SettingsCopy(
    val title: String,
    val intro: String,
    val sections: Sections,
    val scopeLabels: ScopeLabels,
    val colorMode: SettingChoiceCopy,
    val accentColor: AccentColorCopy,
    val noteFont: NoteFontCopy,
    val editorUnavailable: String,
    val typeToStart: HintedCopy,
    val vimMode: HintedCopy? = null,
    val newNotePlacement: SettingChoiceCopy,
    val newFolderPlacement: SettingChoiceCopy,
    val deviceName: DeviceNameCopy,
    val reopenLastView: ReopenLastViewCopy,
    val data: DataCopy,
    val retryLabel: String,
) {
    @Serializable
    data class Sections(
        val appearance: String,
        val editor: String,
        val notes: String,
        val thisDevice: String,
        val dataSecurity: String,
    )

    @Serializable
    data class ScopeLabels(
        val synced: String,
        val device: String,
    )

    @Serializable
    data class AccentColorCopy(
        val label: String,
        val options: List<AccentOptionView>,
    )

    @Serializable
    data class NoteFontCopy(
        val label: String,
        val options: List<SettingOptionView>,
        val previewHeading: String,
        val previewBody: String,
        val previewCode: String,
    )

    @Serializable
    data class HintedCopy(
        val label: String,
        val hint: String,
    )

    @Serializable
    data class DeviceNameCopy(
        val label: String,
        val hint: String,
        val maxLength: Int,
    )

    @Serializable
    data class ReopenLastViewCopy(
        val label: String,
    )

    @Serializable
    data class DataCopy(
        val exportLabel: String,
        val exportingLabel: String,
        val exportShareLabel: String,
        val exportFilesLabel: String,
        val exportFailed: String,
        val importLabel: String,
        val importingLabel: String,
        val changePassphraseLabel: String,
    )
}

@Serializable
data class SettingsView(
    val values: Values,
    val scopes: Scopes,
    val deviceName: String,
    val automaticDeviceName: String,
    val reopenLastView: Boolean,
    val canExport: Boolean,
    val canImport: Boolean,
    val canChangePassphrase: Boolean,
) {
    @Serializable
    data class Values(
        val colorMode: String,
        val accentColor: String,
        val noteFont: String,
        val newNotePlacement: String,
        val newFolderPlacement: String,
        val typeToStart: Boolean,
        val vimMode: Boolean? = null,
    )

    @Serializable
    data class Scopes(
        val colorMode: SettingScope,
        val accentColor: SettingScope,
        val noteFont: SettingScope,
        val typeToStart: SettingScope,
    )
}

@Serializable
enum class SettingsSaveState {
    @SerialName("synced")
    SYNCED,

    @SerialName("syncing")
    SYNCING,

    @SerialName("pending")
    PENDING,

    @SerialName("failed")
    FAILED,
}

@Serializable
data class SettingsSaveView(
    val state: SettingsSaveState,
    val label: String,
    val detail: String,
    val canRetry: Boolean,
)

@Serializable
data class SettingsOpenResult(
    val copy: SettingsCopy,
    val view: SettingsView,
    val save: SettingsSaveView,
)

@Serializable
data class SettingsChangeParams(
    val key: SettingKeyView,
    val value: String,
)

@Serializable
data class SettingsSetScopeParams(
    val key: ScopedSettingKey,
    val scope: SettingScope,
)
