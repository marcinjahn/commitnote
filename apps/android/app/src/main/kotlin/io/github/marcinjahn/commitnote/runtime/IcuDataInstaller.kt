package io.github.marcinjahn.commitnote.runtime

import android.content.Context
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/**
 * V8 reads its ICU data from a file path, so the asset is copied out once per app version. An
 * existing copy with the asset's length is reused; a new copy appears atomically.
 */
class IcuDataInstaller(
    private val context: Context,
    private val versionCode: Int,
) {
    /** Returns the copy for this app version, removing the copies of other versions. */
    fun install(): File {
        val root = File(context.noBackupFilesDir, ROOT)
        val target = File(root, "$versionCode/$FILE_NAME")
        val assetLength = context.assets.openFd(FILE_NAME).use { it.length }
        if (!(target.isFile && target.length() == assetLength)) {
            copy(target)
        }
        root
            .listFiles { file -> file.isDirectory && file.name != versionCode.toString() }
            .orEmpty()
            .forEach { it.deleteRecursively() }
        return target
    }

    private fun copy(target: File) {
        val directory = checkNotNull(target.parentFile)
        directory.mkdirs()
        val partial = File(directory, "$FILE_NAME.partial")
        context.assets.open(FILE_NAME).use { input ->
            partial.outputStream().use { output ->
                input.copyTo(output)
                output.fd.sync()
            }
        }
        Files.move(partial.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE)
    }

    private companion object {
        const val ROOT = "icu"
        const val FILE_NAME = "icudtl.dat"
    }
}
