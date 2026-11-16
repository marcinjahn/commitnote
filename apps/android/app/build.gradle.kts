import io.github.marcinjahn.commitnote.build.FetchIcuData
import io.github.marcinjahn.commitnote.build.SyncFonts

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    id("commitnote.android-core-assets")
}

val appId = "io.github.marcinjahn.commitnote"
val develIdSuffix = ".devel"
val appVersionName = providers.gradleProperty("commitnote.versionName").get()
val appVersionCode =
    appVersionName.split(".").map(String::toInt).let { (major, minor, patch) ->
        major * 10_000 + minor * 100 + patch
    }

val releaseSigningVariables =
    listOf(
        "COMMITNOTE_ANDROID_KEYSTORE",
        "COMMITNOTE_ANDROID_KEYSTORE_PASSWORD",
        "COMMITNOTE_ANDROID_KEY_ALIAS",
        "COMMITNOTE_ANDROID_KEY_PASSWORD",
    )
val releaseSigning =
    releaseSigningVariables.associateWith { name ->
        providers.environmentVariable(name).orNull?.takeIf(String::isNotBlank)
    }
val missingReleaseSigningVariables = releaseSigning.filterValues { it == null }.keys
val hasReleaseSigning = missingReleaseSigningVariables.isEmpty()
if (!hasReleaseSigning && missingReleaseSigningVariables.size < releaseSigningVariables.size) {
    throw GradleException(
        "Release signing needs all of ${releaseSigningVariables.joinToString()} or none of them; " +
            "missing: ${missingReleaseSigningVariables.joinToString()}",
    )
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
        applicationId = appId
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

        resValue("string", "app_name", "Commitnote")
        // Static shortcuts name the package their intent targets, which differs per build type.
        resValue("string", "application_id", appId)

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        testInstrumentationRunnerArguments["clearPackageData"] = "false"
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(checkNotNull(releaseSigning["COMMITNOTE_ANDROID_KEYSTORE"]))
                storePassword = releaseSigning["COMMITNOTE_ANDROID_KEYSTORE_PASSWORD"]
                keyAlias = releaseSigning["COMMITNOTE_ANDROID_KEY_ALIAS"]
                keyPassword = releaseSigning["COMMITNOTE_ANDROID_KEY_PASSWORD"]
            }
        }
    }

    // Per-ABI APKs for sideloading. The Android Gradle plugin rejects `ndk.abiFilters` next to ABI
    // splits, so the ABIs the V8 engine ships beyond the two supported ones are excluded instead.
    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a", "x86_64")
            isUniversalApk = false
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = false
            isDebuggable = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            signingConfig =
                signingConfigs.getByName(if (hasReleaseSigning) "release" else "debug")
        }
        debug {
            applicationIdSuffix = develIdSuffix
            resValue("string", "app_name", "Commitnote Devel")
            resValue("string", "application_id", appId + develIdSuffix)
        }
        create("fake") {
            initWith(getByName("debug"))
            matchingFallbacks += "debug"
        }
    }
    testBuildType = "fake"

    packaging {
        jniLibs {
            excludes += listOf("lib/armeabi-v7a/**", "lib/x86/**")
        }
    }

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
        unitTests.isIncludeAndroidResources = true
    }
}

val repositoryRoot = rootDir.resolve("../..")

val syncFonts =
    tasks.register<SyncFonts>("syncFonts") {
        fonts.from(
            fileTree(repositoryRoot.resolve("apps/fonts")) { include("*.ttf") },
        )
        licenses.from(
            fileTree(repositoryRoot.resolve("apps/fonts/Licenses")) { include("*") },
        )
        outputDir.set(layout.buildDirectory.dir("generated/fonts"))
    }

androidComponents {
    onVariants { variant ->
        checkNotNull(
            variant.sources.assets,
        ).addGeneratedSourceDirectory(syncFonts, SyncFonts::outputDir)
    }
}

// The JVM UI tests run the fake core bundle on the desktop V8 engine instead of the Android one.
val fakeCoreBundle = repositoryRoot.resolve("dist-native-core-fake/commitnote-core.js")
val fetchIcuData = rootProject.tasks.named<FetchIcuData>("fetchIcuData")
val icuData = fetchIcuData.flatMap { it.outputDir.file(FetchIcuData.FILE_NAME) }

configurations
    .matching {
        it.name.startsWith("test") && it.name.endsWith("RuntimeClasspath")
    }.configureEach {
        exclude(group = "com.caoccao.javet", module = "javet-v8-android-i18n")
    }

// Robolectric's own SDK download has no read timeout and its cache lives outside the Gradle cache, so
// Gradle resolves the SDK jar and Robolectric runs offline against it.
val robolectricSdk =
    configurations.create("robolectricSdk") {
        isCanBeConsumed = false
        isTransitive = false
    }
val syncRobolectricSdk =
    tasks.register<Sync>("syncRobolectricSdk") {
        from(robolectricSdk)
        into(layout.buildDirectory.dir("robolectric-sdk"))
    }

tasks.withType<Test>().configureEach {
    dependsOn(fetchIcuData)
    inputs.files(syncRobolectricSdk).withPropertyName("robolectricSdk")
    systemProperty("robolectric.offline", "true")
    systemProperty(
        "robolectric.dependency.dir",
        syncRobolectricSdk.get().destinationDir.absolutePath,
    )
    inputs.file(fakeCoreBundle)
    systemProperty("commitnote.fakeCoreBundle", fakeCoreBundle.absolutePath)
    systemProperty("commitnote.icuData", icuData.get().asFile.absolutePath)
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
    implementation(project(":markdown"))
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.javet.android)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.material3)
    implementation(libs.androidx.core)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.lifecycle.viewmodel.navigation3)
    implementation(libs.androidx.navigation3.runtime)
    implementation(libs.androidx.navigation3.ui)
    implementation(libs.compose.material3.adaptive)
    implementation(libs.compose.material3.adaptive.layout)
    implementation(libs.compose.material3.adaptive.navigation3)
    implementation(libs.compose.material.icons.extended)

    testImplementation(platform(libs.compose.bom))
    testImplementation(testFixtures(project(":core-runtime")))
    testImplementation(libs.junit4)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.androidx.test.espresso.core)
    testImplementation(libs.compose.ui.test.junit4)
    testImplementation(libs.javet)
    testImplementation(libs.javet.linux.engine)
    robolectricSdk(libs.robolectric.android.all.instrumented)

    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(testFixtures(project(":core-runtime")))
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.espresso.core)
    androidTestImplementation(libs.androidx.exifinterface)
    androidTestImplementation(libs.compose.ui.test.junit4)
    androidTestUtil(libs.androidx.test.orchestrator)
    debugImplementation(libs.compose.ui.test.manifest)
    "fakeImplementation"(libs.compose.ui.test.manifest)
}
