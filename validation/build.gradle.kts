import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    kotlin("jvm")
    application
}

kotlin { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }
java { targetCompatibility = JavaVersion.VERSION_17 }
tasks.withType<JavaCompile> { options.release.set(17) }

dependencies {
    implementation(project(":core"))
    testImplementation(kotlin("test"))
}

application {
    mainClass.set("app.efitmi.validation.MainKt")
}

// Run from the repo root so relative paths like data/bodym resolve.
tasks.named<JavaExec>("run") { workingDir = rootProject.projectDir }

tasks.test { useJUnitPlatform() }
