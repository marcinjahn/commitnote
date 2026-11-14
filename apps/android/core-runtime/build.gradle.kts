import io.github.marcinjahn.commitnote.build.FetchIcuData

plugins {
    id("commitnote.kotlin-jvm")
    alias(libs.plugins.kotlin.serialization)
    `java-test-fixtures`
}

val repositoryRoot = rootDir.resolve("../..")
val coreBundle = repositoryRoot.resolve("dist-native-core/commitnote-core.js")
val fakeCoreBundle = repositoryRoot.resolve("dist-native-core-fake/commitnote-core.js")
val testVectors = repositoryRoot.resolve("apps/test-vectors")
val fetchIcuData = rootProject.tasks.named<FetchIcuData>("fetchIcuData")

dependencies {
    api(project(":core-api"))
    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.bouncycastle)
    implementation(libs.okhttp)
    compileOnly(libs.javet)

    testFixturesImplementation(libs.okhttp)

    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
    testImplementation(libs.javet)
    testImplementation(libs.javet.linux.engine)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.okhttp.tls)
}

val icuData = fetchIcuData.flatMap { it.outputDir.file(FetchIcuData.FILE_NAME) }

tasks.test {
    dependsOn(fetchIcuData)
    inputs.files(coreBundle, fakeCoreBundle)
    inputs.dir(testVectors)
    systemProperty("commitnote.coreBundle", coreBundle.absolutePath)
    systemProperty("commitnote.fakeCoreBundle", fakeCoreBundle.absolutePath)
    systemProperty("commitnote.testVectors", testVectors.absolutePath)
    systemProperty("commitnote.icuData", icuData.get().asFile.absolutePath)
    systemProperty("commitnote.readBackDir", rootDir.resolve("out/read-back").absolutePath)
}
