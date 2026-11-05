// AGP 9 compiles Kotlin itself (built-in Kotlin); only the Compose compiler
// plugin is applied separately. Its version pins the Kotlin version in use.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.compose) apply false
}
