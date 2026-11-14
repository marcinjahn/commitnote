package io.github.marcinjahn.commitnote.build

import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.file.ConfigurableFileCollection
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.tasks.CacheableTask
import org.gradle.api.tasks.InputFiles
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction

@CacheableTask
abstract class CopyCoreBundle : DefaultTask() {
    // A file collection, not an input file, so that a missing bundle reaches the action below
    // instead of failing Gradle's input validation with a less helpful message.
    @get:InputFiles
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val bundle: ConfigurableFileCollection

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun copy() {
        val source = bundle.singleFile
        if (!source.isFile) {
            throw GradleException(
                "Core bundle not found at ${source.absolutePath}: " +
                    "run `just build-native-core` first",
            )
        }
        source.copyTo(outputDir.get().file(FILE_NAME).asFile, overwrite = true)
    }

    companion object {
        const val FILE_NAME = "commitnote-core.js"
    }
}
