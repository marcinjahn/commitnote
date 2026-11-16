package io.github.marcinjahn.commitnote.build

import org.gradle.api.Plugin
import org.gradle.api.Project

/** Registers `fetchIcuData`; apply it to the root project only. */
class IcuDataPlugin : Plugin<Project> {
    override fun apply(project: Project) {
        val catalog = project.libs
        val sha256 = catalog.version("icu-data-sha256")
        project.tasks.register(TASK_NAME, FetchIcuData::class.java) {
            url.set(catalog.version("icu-data-url"))
            this.sha256.set(sha256)
            outputDir.set(project.gradle.gradleUserHomeDir.resolve("commitnote/icu/$sha256"))
        }
    }

    companion object {
        const val TASK_NAME = "fetchIcuData"
    }
}
