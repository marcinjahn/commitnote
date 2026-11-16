plugins {
    id("commitnote.kotlin-jvm")
    alias(libs.plugins.kotlin.serialization)
}

dependencies {
    api(libs.kotlinx.serialization.json)

    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}

val coreApiSource = rootDir.resolve("../../src/native-core/api.ts")

tasks.test {
    inputs.file(coreApiSource)
    systemProperty("commitnote.coreApiSource", coreApiSource.absolutePath)
}
