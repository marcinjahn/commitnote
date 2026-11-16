plugins {
    id("commitnote.kotlin-jvm")
    alias(libs.plugins.kotlin.serialization)
}

dependencies {
    api(libs.kotlinx.serialization.json)
    implementation(libs.commonmark)
    implementation(libs.commonmark.ext.gfm.strikethrough)
    implementation(libs.commonmark.ext.gfm.tables)
    implementation(libs.commonmark.ext.task.list.items)

    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}

val repositoryRoot = rootDir.resolve("../..")
val markdownVectors = repositoryRoot.resolve("apps/linux/markdown-vectors/vectors.json")
val testVectors = repositoryRoot.resolve("apps/test-vectors")

tasks.test {
    inputs.file(markdownVectors)
    inputs.dir(testVectors)
    systemProperty("commitnote.markdownVectors", markdownVectors.absolutePath)
    systemProperty("commitnote.testVectors", testVectors.absolutePath)
}
