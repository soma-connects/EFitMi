rootProject.name = "efitmi"

dependencyResolutionManagement {
    repositories {
        // Maven Central's canonical host, same artifacts as mavenCentral().
        // The shortcut resolves to repo.maven.apache.org, which rate-limits
        // (HTTP 429) on some shared networks and CI runners.
        maven("https://repo1.maven.org/maven2")
    }
}

// core:       pure Kotlin. No Android classes, so the code validated on a
//             laptop is the same code that ships in the app.
// validation: JVM tool that runs core against the BodyM dataset.
include(":core", ":validation")
