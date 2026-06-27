plugins {
    kotlin("jvm") version "2.1.20"
    kotlin("plugin.serialization") version "2.1.20"
    id("com.gradleup.shadow") version "8.3.3"
}

group = "io.naturesense"
version = "0.1.0"

repositories {
    mavenCentral()
    maven("https://jitpack.io")
}

dependencies {
    // MCP Kotlin SDK
    implementation("io.modelcontextprotocol:kotlin-sdk:0.4.0")

    // Embedded Neo4j (exclude its bundled SLF4J provider in favour of Logback)
    implementation("org.neo4j:neo4j:5.23.0") {
        exclude("org.neo4j", "neo4j-slf4j-provider")
    }

    // Kotlin serialization
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")

    // Logging via Logback → stderr
    implementation("ch.qos.logback:logback-classic:1.5.13")

    // kotlinx.io for StdioServerTransport
    implementation("org.jetbrains.kotlinx:kotlinx-io-core:0.7.0")

    // Coroutines for runBlocking / job.join
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
}

kotlin {
    jvmToolchain(21)
}

tasks.jar {
    manifest {
        attributes["Main-Class"] = "io.naturesense.graphmcp.GraphMcpServerKt"
    }
}

tasks.shadowJar {
    archiveBaseName.set("graph-mcp")
    archiveClassifier.set("all")
    mergeServiceFiles()
    mergeServiceFiles {
        include("META-INF/services/*")
    }
    // Neo4j deps push us over 65535 entries
    isZip64 = true
}
