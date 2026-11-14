plugins {
    `kotlin-dsl`
}

dependencies {
    compileOnly(libs.android.gradle.api)
}

gradlePlugin {
    plugins {
        register("icuData") {
            id = "commitnote.icu-data"
            implementationClass = "io.github.marcinjahn.commitnote.build.IcuDataPlugin"
        }
        register("androidCoreAssets") {
            id = "commitnote.android-core-assets"
            implementationClass = "io.github.marcinjahn.commitnote.build.AndroidCoreAssetsPlugin"
        }
        register("kotlinJvm") {
            id = "commitnote.kotlin-jvm"
            implementationClass = "io.github.marcinjahn.commitnote.build.KotlinJvmPlugin"
        }
    }
}
