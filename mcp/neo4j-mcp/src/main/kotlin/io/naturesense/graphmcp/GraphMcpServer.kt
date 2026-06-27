package io.naturesense.graphmcp

import io.modelcontextprotocol.kotlin.sdk.Implementation
import io.modelcontextprotocol.kotlin.sdk.ServerCapabilities
import io.modelcontextprotocol.kotlin.sdk.server.Server
import io.modelcontextprotocol.kotlin.sdk.server.ServerOptions
import io.modelcontextprotocol.kotlin.sdk.server.StdioServerTransport
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.isActive
import kotlinx.coroutines.runBlocking
import kotlinx.io.asSink
import kotlinx.io.asSource
import kotlinx.io.buffered
import org.slf4j.LoggerFactory
import java.io.PrintStream

/**
 * Entry point for the Neo4j Graph Memory MCP server.
 *
 * All MCP communication happens over stdin/stdout using StdioServerTransport.
 * All application logs go to stderr via Logback.
 * Neo4j's Log4j2 internal status messages are redirected to stderr via
 * log4j2.component.properties (disableStatusListener) and System.setOut.
 *
 * Environment variables:
 *   MEMORY_BANK_PATH - optional path for persistent Neo4j database storage.
 *                      If not set, uses pure in-memory storage (ephemeral).
 */
fun main() = runBlocking(Dispatchers.IO + Job()) {
    // ── Save original stdout BEFORE any redirection ──────────────────────
    // The MCP StdioServerTransport writes responses to System.out.
    // Neo4j's Log4j2 has a StatusConsoleListener that writes to System.out.
    // We redirect System.out to stderr so Log4j2 garbage goes to stderr,
    // but the MCP transport MUST use the original stdout (print stream).
    val originalStdout = System.out
    System.setOut(System.err)

    val log = LoggerFactory.getLogger("GraphMcpServer")
    log.info("GraphMCP server starting...")

    // ── Database ──────────────────────────────────
    val memoryService = MemoryService()

    try {
        // ── MCP Server ────────────────────────────────
        val capabilities = ServerCapabilities(
            tools = ServerCapabilities.Tools(listChanged = false)
        )
        val server = Server(
            serverInfo = Implementation(
                name = "graph-mcp",
                version = "0.1.0"
            ),
            options = ServerOptions(capabilities = capabilities)
        )

        // Register all 7 tools
        McpTools(server, memoryService)

        log.info("Connecting via StdioServerTransport...")

        // Use original stdout for MCP responses, redirected System.out (stderr) for logs
        val stdin = System.`in`.asSource().buffered()
        val stdout = originalStdout.asSink().buffered()

        val transport = StdioServerTransport(stdin, stdout)

        // connect is a suspend function
        server.connect(transport)

        log.info("GraphMCP server running on stdio. Waiting for messages...")

        // Keep running while the coroutine context is active
        while (isActive) {
            kotlinx.coroutines.delay(Long.MAX_VALUE)
        }
    } finally {
        log.info("Shutting down...")
        memoryService.close()
    }
}
