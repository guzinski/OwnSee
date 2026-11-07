import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

// Release signing key, kept OUTSIDE the repo (default ~/.ownsee/signing.properties,
// or set OWNSEE_SIGNING to another path). Android only installs an update
// signed with the same key as the installed app, so back this key up.
val signingFile = file(System.getenv("OWNSEE_SIGNING") ?: "${System.getProperty("user.home")}/.ownsee/signing.properties")
val signingProps = Properties().apply { if (signingFile.exists()) signingFile.inputStream().use(::load) }

android {
    namespace = "org.ownsee.app"
    compileSdk = 37

    defaultConfig {
        applicationId = "org.ownsee.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 6
        versionName = "0.3.3"
    }

    signingConfigs {
        if (signingProps.isNotEmpty()) {
            create("release") {
                storeFile = file(signingProps.getProperty("storeFile"))
                storePassword = signingProps.getProperty("storePassword")
                keyAlias = signingProps.getProperty("keyAlias")
                keyPassword = signingProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
        debug {
            // A separate app ("OwnSee (dev)"), so development builds never
            // replace or collide with the release install.
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-dev"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true // for BuildConfig.VERSION_NAME/VERSION_CODE in the UI
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)

    implementation(libs.media3.exoplayer)
    implementation(libs.media3.ui)

    // QR scanning for pairing (open source ZXing, no Google Play Services)
    implementation(libs.zxing.android.embedded)
}
