package io.github.marcinjahn.commitnote.core.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

object NativeCoreApi {
    const val VERSION = 8
    const val MARKER = "commitnote-native-core"
}

@Serializable
enum class NativePlatform {
    @SerialName("ios")
    IOS,

    @SerialName("linux")
    LINUX,

    @SerialName("android")
    ANDROID,
}

object CoreNames {
    val commands: List<String> =
        listOf(
            "forges.list",
            "login.lastRepository",
            "login.listRepositories",
            "login.inspectRepository",
            "login.unlock",
            "login.initialize",
            "passphrase.strength",
            "session.resume",
            "session.logout",
            "tree.get",
            "note.open",
            "sync.refresh",
            "note.edit",
            "sync.flush",
            "sync.retry",
            "conflict.resolve",
            "export.notes",
            "draft.start",
            "draft.commitName",
            "draft.content",
            "draft.leave",
            "folder.create",
            "lifecycle.setVisible",
            "lifecycle.setOnline",
            "device.name",
            "notices.dismiss",
            "notices.perform",
            "node.rename",
            "node.move",
            "node.place",
            "node.moveSibling",
            "node.moveTargets",
            "node.trashPreview",
            "node.trash",
            "node.setColorTag",
            "trash.restoreTargets",
            "trash.restore",
            "trash.delete",
            "trash.empty",
            "tags.setFilter",
            "search.open",
            "search.close",
            "search.query",
            "note.rename",
            "note.stats",
            "note.dates",
            "image.read",
            "image.insert",
            "image.clonePasted",
            "history.open",
            "history.close",
            "history.loadMore",
            "history.retry",
            "history.preview",
            "history.restore",
            "share.form",
            "share.create",
            "share.update",
            "share.rename",
            "share.revoke",
            "share.sharedVersion",
            "lastView.load",
            "lastView.save",
            "earlyDraft.handOff",
            "launch.deliver",
            "launch.attach",
            "launch.detach",
            "settings.open",
            "settings.change",
            "settings.setScope",
            "settings.retry",
            "settings.flush",
            "device.setName",
            "lastView.setEnabled",
            "print.render",
            "import.readArchive",
            "import.preview",
            "import.commit",
            "import.cancel",
            "import.dropFiles",
            "import.enableAtomic",
            "import.saveWithoutAtomic",
            "passphrase.changeForm",
            "passphrase.prepareChange",
            "passphrase.commitChange",
            "passphrase.settle",
            "passphrase.cancelChange",
            "passphrase.enableAtomic",
        )

    val events: List<String> =
        listOf(
            "loadingProgress",
            "treeChanged",
            "trashChanged",
            "searchStatusChanged",
            "noteChanged",
            "noteContentChangedRemotely",
            "syncStateChanged",
            "notice",
            "noticeCleared",
            "keyChanged",
            "sessionEnded",
            "historyChanged",
            "sharesChanged",
            "settingsChanged",
            "settingsSaveChanged",
            "importStatusChanged",
            "passphraseChangeProgress",
            "launchAction",
        )

    val fakeCommands: List<String> =
        listOf(
            "fake.saveNote",
            "fake.exportRepo",
            "fake.expectedSampleNotes",
            "fake.checkVectors",
            "fake.httpRequest",
            "fake.timerProbe",
            "fake.remoteEdit",
            "fake.changeRepoKey",
            "fake.failNext",
            "fake.clearFailures",
            "fake.shareNote",
            "fake.holdLoading",
            "fake.releaseLoading",
            "fake.processImage",
            "fake.importArchive",
        )
}
