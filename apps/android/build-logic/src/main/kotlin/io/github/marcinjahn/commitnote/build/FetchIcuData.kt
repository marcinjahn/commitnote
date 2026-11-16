package io.github.marcinjahn.commitnote.build

import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.TaskAction
import org.gradle.work.DisableCachingByDefault
import java.io.File
import java.net.URI
import java.security.MessageDigest
import java.util.Base64

@DisableCachingByDefault(because = "Downloads a file into the Gradle user home")
abstract class FetchIcuData : DefaultTask() {
    @get:Input
    abstract val url: Property<String>

    @get:Input
    abstract val sha256: Property<String>

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun fetch() {
        val target = outputDir.get().file(FILE_NAME).asFile
        val expected = sha256.get()
        if (target.isFile && target.sha256() == expected) return

        val encoded = URI(url.get()).toURL().openConnection().run {
            connectTimeout = TIMEOUT_MILLIS
            readTimeout = TIMEOUT_MILLIS
            getInputStream().use { it.readBytes() }
        }
        // Gitiles serves raw files as base64 text wrapped in lines.
        val data = Base64.getMimeDecoder().decode(encoded)
        val actual = data.sha256()
        if (actual != expected) {
            throw GradleException("ICU data from ${url.get()} has SHA-256 $actual, expected $expected")
        }

        target.parentFile.mkdirs()
        val partial = File(target.parentFile, "$FILE_NAME.partial")
        partial.writeBytes(data)
        partial.renameTo(target)
    }

    companion object {
        const val FILE_NAME = "icudtl.dat"
        private const val TIMEOUT_MILLIS = 60_000

        private fun File.sha256() = readBytes().sha256()

        private fun ByteArray.sha256() =
            MessageDigest.getInstance("SHA-256").digest(this).joinToString("") { "%02x".format(it) }
    }
}
