import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    kotlin("jvm")
}

// Android runs Java 17 bytecode, so target that even though this machine
// builds with a newer JDK.
kotlin { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }
java { targetCompatibility = JavaVersion.VERSION_17 }
tasks.withType<JavaCompile> { options.release.set(17) }

dependencies {
    testImplementation(kotlin("test"))
}

tasks.test { useJUnitPlatform() }
