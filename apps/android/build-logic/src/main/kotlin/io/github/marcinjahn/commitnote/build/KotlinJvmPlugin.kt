package io.github.marcinjahn.commitnote.build

import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.api.plugins.JavaPluginExtension
import org.gradle.api.tasks.testing.Test
import org.gradle.jvm.toolchain.JavaLanguageVersion

/** Kotlin/JVM module on the shared toolchain, with JUnit Platform test tasks. */
class KotlinJvmPlugin : Plugin<Project> {
    override fun apply(project: Project) {
        project.pluginManager.apply("org.jetbrains.kotlin.jvm")
        project.extensions.getByType(JavaPluginExtension::class.java).toolchain {
            languageVersion.set(JavaLanguageVersion.of(project.libs.version("jdk").toInt()))
        }
        project.tasks.withType(Test::class.java).configureEach { useJUnitPlatform() }
    }
}
