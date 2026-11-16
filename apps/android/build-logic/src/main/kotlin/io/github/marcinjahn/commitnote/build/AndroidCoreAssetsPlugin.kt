package io.github.marcinjahn.commitnote.build

import com.android.build.api.variant.ApplicationAndroidComponentsExtension
import org.gradle.api.Plugin
import org.gradle.api.Project
import java.util.Locale

/** Adds the core bundle and the ICU data to the assets of every variant of an application. */
class AndroidCoreAssetsPlugin : Plugin<Project> {
    override fun apply(project: Project) {
        val repositoryRoot = project.rootDir.resolve("../..").canonicalFile
        val fetchIcuData = project.rootProject.tasks.named(IcuDataPlugin.TASK_NAME, FetchIcuData::class.java)

        project.extensions.getByType(ApplicationAndroidComponentsExtension::class.java)
            .onVariants { variant ->
                val bundleDir = if (variant.buildType == FAKE_BUILD_TYPE) {
                    "dist-native-core-fake"
                } else {
                    "dist-native-core"
                }
                val taskName = "copy${variant.name.replaceFirstChar { it.titlecase(Locale.ROOT) }}CoreBundle"
                val copyCoreBundle = project.tasks.register(taskName, CopyCoreBundle::class.java) {
                    bundle.from(repositoryRoot.resolve("$bundleDir/${CopyCoreBundle.FILE_NAME}"))
                    outputDir.set(project.layout.buildDirectory.dir("generated/coreBundle/${variant.name}"))
                }
                val assets = checkNotNull(variant.sources.assets)
                assets.addGeneratedSourceDirectory(copyCoreBundle, CopyCoreBundle::outputDir)
                assets.addGeneratedSourceDirectory(fetchIcuData, FetchIcuData::outputDir)
            }
    }

    private companion object {
        const val FAKE_BUILD_TYPE = "fake"
    }
}
