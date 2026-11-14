plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    id("commitnote.android-core-assets")
}

val appVersionName = "0.1.0"
val appVersionCode =
    appVersionName.split(".").map(String::toInt).let { (major, minor, patch) ->
        major * 10_000 + minor * 100 + patch
    }

android {
    namespace = "io.github.marcinjahn.commitnote"
    compileSdk =
        libs.versions.compile.sdk
            .get()
            .toInt()
    buildToolsVersion =
        libs.versions.build.tools
            .get()
    ndkVersion = libs.versions.ndk.get()

    defaultConfig {
        applicationId = "io.github.marcinjahn.commitnote"
        minSdk =
            libs.versions.min.sdk
                .get()
                .toInt()
        targetSdk =
            libs.versions.target.sdk
                .get()
                .toInt()
        versionCode = appVersionCode
        versionName = appVersionName

        // The V8 engine is the only native code in the app. Declaring the ABIs lets the Android
        // Gradle plugin strip it with the NDK.
        ndk {
            abiFilters += listOf("arm64-v8a", "x86_64")
        }

        resValue("string", "app_name", "Commitnote")

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        testInstrumentationRunnerArguments["clearPackageData"] = "false"
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".devel"
            resValue("string", "app_name", "Commitnote Devel")
        }
        create("fake") {
            initWith(getByName("debug"))
            matchingFallbacks += "debug"
        }
    }
    testBuildType = "fake"

    buildFeatures {
        buildConfig = true
        resValues = true
    }

    // The ICU data asset is read through a file descriptor to get its length without unpacking it.
    androidResources {
        noCompress += "dat"
    }

    sourceSets {
        getByName("androidTest") {
            assets.directories += "../../test-vectors"
        }
    }

    compileOptions {
        val javaVersion = JavaVersion.toVersion(libs.versions.jdk.get())
        sourceCompatibility = javaVersion
        targetCompatibility = javaVersion
    }

    testOptions {
        execution = "ANDROIDX_TEST_ORCHESTRATOR"
    }
}

kotlin {
    jvmToolchain(
        libs.versions.jdk
            .get()
            .toInt(),
    )
}

dependencies {
    implementation(project(":core-runtime"))
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.javet.android)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.material3)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)

    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(testFixtures(project(":core-runtime")))
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.exifinterface)
    androidTestImplementation(libs.compose.ui.test.junit4)
    androidTestUtil(libs.androidx.test.orchestrator)
    debugImplementation(libs.compose.ui.test.manifest)
    "fakeImplementation"(libs.compose.ui.test.manifest)
}
