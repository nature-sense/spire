package io.naturesense.graphmcp

import io.modelcontextprotocol.kotlin.sdk.CallToolRequest
import io.modelcontextprotocol.kotlin.sdk.CallToolResult
import io.modelcontextprotocol.kotlin.sdk.TextContent
import io.modelcontextprotocol.kotlin.sdk.Tool
import io.modelcontextprotocol.kotlin.sdk.server.Server
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import org.slf4j.LoggerFactory

/**
 * Registers the 7 MCP tools on the given [server], backed by [memoryService].
 */
class McpTools(server: Server, private val memoryService: MemoryService) {
    private val log = LoggerFactory.getLogger(McpTools::class.java)

    init {
        registerTools(server)
        log.info("Registered 7 MCP tools")
    }

    private fun registerTools(server: Server) {
        // Tool.1 — store_memory
        server.addTool(
            name = "store_memory",
            description = "Store a new memory in the graph",
            inputSchema = Tool.Input(
                properties = JsonObject(mapOf(
                    "content" to JsonObject(mapOf("type" to JsonPrimitive("string"), "description" to JsonPrimitive("Memory content"))),
                    "type" to JsonObject(mapOf("type" to JsonPrimitive("string"), "description" to JsonPrimitive("Memory type (e.g. note, fact, insight)"))),
                    "tags" to JsonObject(mapOf("type" to JsonPrimitive("array"), "items" to JsonObject(mapOf("type" to JsonPrimitive("string"))), "description" to JsonPrimitive("Tags"))),
                    "importance" to JsonObject(mapOf("type" to JsonPrimitive("number"), "description" to JsonPrimitive("Importance score (0.0 - 1.0)")))
                )),
                required = listOf("content")
            ),
            handler = { request -> handleStoreMemory(request) }
        )

        // Tool.2 — update_memory
        server.addTool(
            name = "update_memory",
            description = "Update an existing memory's content, importance, or tags",
            inputSchema = Tool.Input(
                properties = JsonObject(mapOf(
                    "id" to JsonObject(mapOf("type" to JsonPrimitive("string"), "description" to JsonPrimitive("Memory ID to update"))),
                    "content" to JsonObject(mapOf("type" to JsonPrimitive("string"), "description" to JsonPrimitive("New content (optional)"))),
                    "importance" to JsonObject(mapOf("type" to JsonPrimitive("number"), "description" to JsonPrimitive("New importance score (optional)"))),
                    "tags" to JsonObject(mapOf("type" to JsonPrimitive("array"), "items" to JsonObject(mapOf("type" to JsonPrimitive("string"))), "description" to JsonPrimitive("New tags (optional)")))
                )),
                required = listOf("id")
            ),
            handler = { request -> handleUpdateMemory(request) }
        )

        // Tool.3 — delete_memory
        server.addTool(
            name = "delete_memory",
            description = "Delete a memory by ID. If cascade=true, also deletes directly related memories.",
            inputSchema = Tool.Input(
                properties = JsonObject(mapOf(
                    "id" to JsonObject(mapOf("type" to JsonPrimitive("string"), "description" to JsonPrimitive("Memory ID to delete"))),
                    "cascade" to JsonObject(mapOf("type" to JsonPrimitive("boolean"), "description" to JsonPrimitive("Also delete linked memories")))
                )),
                required = listOf("id")
            ),
            handler = { request -> handleDeleteMemory(request) }
        )

        // Tool.4 — search_memory
        server.addTool(
            name = "search_memory",
            description = "Execute a read-only Cypher query to search memories. Only MATCH/RETURN/WHERE/ORDER/LIMIT allowed.",
            inputSchema = Tool.Input(
                properties = JsonObject(mapOf(
                    "query" to JsonObject(mapOf("type" to JsonPrimitive("string"), "description" to JsonPrimitive("Cypher query (read-only)"))),
                    "params" to JsonObject(mapOf("type" to JsonPrimitive("object"), "description" to JsonPrimitive("Query parameters")))
                )),
                required = listOf("query")
            ),
            handler = { request -> handleSearchMemory(request) }
        )

        // Tool.5 — get_context
        server.addTool(
            name = "get_context",
            description = "Retrieve top memories by importance, optionally filtered by type",
            inputSchema = Tool.Input(
                properties = JsonObject(mapOf(
                    "limit" to JsonObject(mapOf("type" to JsonPrimitive("integer"), "description" to JsonPrimitive("Max memories to return"))),
                    "minImportance" to JsonObject(mapOf("type" to JsonPrimitive("number"), "description" to JsonPrimitive("Minimum importance threshold"))),
                    "types" to JsonObject(mapOf("type" to JsonPrimitive("array"), "items" to JsonObject(mapOf("type" to JsonPrimitive("string"))), "description" to JsonPrimitive("Filter by memory types")))
                )),
                required = emptyList()
            ),
            handler = { request -> handleGetContext(request) }
        )

        // Tool.6 — link_memories
        server.addTool(
            name = "link_memories",
            description = "Create a relationship between two memories",
            inputSchema = Tool.Input(
                properties = JsonObject(mapOf(
                    "fromId" to JsonObject(mapOf("type" to JsonPrimitive("string"), "description" to JsonPrimitive("Source memory ID"))),
                    "toId" to JsonObject(mapOf("type" to JsonPrimitive("string"), "description" to JsonPrimitive("Target memory ID"))),
                    "relationship" to JsonObject(mapOf("type" to JsonPrimitive("string"), "description" to JsonPrimitive("Relationship label (e.g. references, supports, contradicts)")))
                )),
                required = listOf("fromId", "toId", "relationship")
            ),
            handler = { request -> handleLinkMemories(request) }
        )

        // Tool.7 — get_relationships
        server.addTool(
            name = "get_relationships",
            description = "Get all relationships for a memory, optionally filtered by direction",
            inputSchema = Tool.Input(
                properties = JsonObject(mapOf(
                    "id" to JsonObject(mapOf("type" to JsonPrimitive("string"), "description" to JsonPrimitive("Memory ID"))),
                    "direction" to JsonObject(mapOf("type" to JsonPrimitive("string"), "description" to JsonPrimitive("OUTGOING, INCOMING, or BOTH")))
                )),
                required = listOf("id")
            ),
            handler = { request -> handleGetRelationships(request) }
        )
    }

    // ─────────────────────────────────────────────
    // Handlers — suspend functions returning CallToolResult
    // ─────────────────────────────────────────────

    private suspend fun handleStoreMemory(request: CallToolRequest): CallToolResult {
        return try {
            val args = request.arguments
            val content = args["content"]?.jsonPrimitive?.content
                ?: return CallToolResult(listOf(TextContent("Error: 'content' is required")), isError = true)
            val type = args["type"]?.jsonPrimitive?.content ?: "note"
            val tags = parseTags(args["tags"])
            val importance = args["importance"]?.jsonPrimitive?.content?.toDoubleOrNull() ?: 0.0

            val id = memoryService.storeMemory(content, type, tags, importance)
            CallToolResult(listOf(TextContent("""{"id":"$id"}""")))
        } catch (e: Exception) {
            log.error("store_memory failed", e)
            CallToolResult(listOf(TextContent("Error: ${e.message}")), isError = true)
        }
    }

    private suspend fun handleUpdateMemory(request: CallToolRequest): CallToolResult {
        return try {
            val args = request.arguments
            val id = args["id"]?.jsonPrimitive?.content
                ?: return CallToolResult(listOf(TextContent("Error: 'id' is required")), isError = true)
            val content = args["content"]?.jsonPrimitive?.content
            val importance = args["importance"]?.jsonPrimitive?.content?.toDoubleOrNull()
            val tags = parseTagsOrNull(args["tags"])

            val record = memoryService.updateMemory(id, content, importance, tags)
            if (record != null) {
                CallToolResult(listOf(TextContent("""{"result":"updated","id":"${record.id}"}""")))
            } else {
                CallToolResult(listOf(TextContent("""{"result":"not_found","id":"$id"}""")))
            }
        } catch (e: Exception) {
            log.error("update_memory failed", e)
            CallToolResult(listOf(TextContent("Error: ${e.message}")), isError = true)
        }
    }

    private suspend fun handleDeleteMemory(request: CallToolRequest): CallToolResult {
        return try {
            val args = request.arguments
            val id = args["id"]?.jsonPrimitive?.content
                ?: return CallToolResult(listOf(TextContent("Error: 'id' is required")), isError = true)
            val cascade = args["cascade"]?.jsonPrimitive?.booleanOrNull ?: false

            memoryService.deleteMemory(id, cascade)
            CallToolResult(listOf(TextContent("""{"result":"deleted","id":"$id"}""")))
        } catch (e: Exception) {
            log.error("delete_memory failed", e)
            CallToolResult(listOf(TextContent("Error: ${e.message}")), isError = true)
        }
    }

    private suspend fun handleSearchMemory(request: CallToolRequest): CallToolResult {
        return try {
            val args = request.arguments
            val query = args["query"]?.jsonPrimitive?.content
                ?: return CallToolResult(listOf(TextContent("Error: 'query' is required")), isError = true)
            val paramsObj = args["params"]?.jsonObject
            val params: Map<String, Any> = paramsObj?.entries?.associate { (k, v) ->
                val prim = v.jsonPrimitive
                k to when {
                    prim.booleanOrNull != null -> prim.booleanOrNull!!
                    prim.longOrNull != null -> prim.longOrNull!!
                    prim.content.toDoubleOrNull() != null -> prim.content.toDouble()
                    else -> prim.content
                }
            } ?: emptyMap()

            val result = memoryService.searchMemory(query, params)
            CallToolResult(listOf(TextContent(result)))
        } catch (e: Exception) {
            log.error("search_memory failed", e)
            CallToolResult(listOf(TextContent("Error: ${e.message}")), isError = true)
        }
    }

    private suspend fun handleGetContext(request: CallToolRequest): CallToolResult {
        return try {
            val args = request.arguments
            val limit = args["limit"]?.jsonPrimitive?.longOrNull?.toInt() ?: 20
            val minImportance = args["minImportance"]?.jsonPrimitive?.content?.toDoubleOrNull() ?: 0.0
            val types = parseTagsOrNull(args["types"])

            val result = memoryService.getContext(limit, minImportance, types)
            CallToolResult(listOf(TextContent(result)))
        } catch (e: Exception) {
            log.error("get_context failed", e)
            CallToolResult(listOf(TextContent("Error: ${e.message}")), isError = true)
        }
    }

    private suspend fun handleLinkMemories(request: CallToolRequest): CallToolResult {
        return try {
            val args = request.arguments
            val fromId = args["fromId"]?.jsonPrimitive?.content
                ?: return CallToolResult(listOf(TextContent("Error: 'fromId' is required")), isError = true)
            val toId = args["toId"]?.jsonPrimitive?.content
                ?: return CallToolResult(listOf(TextContent("Error: 'toId' is required")), isError = true)
            val relationship = args["relationship"]?.jsonPrimitive?.content
                ?: return CallToolResult(listOf(TextContent("Error: 'relationship' is required")), isError = true)

            memoryService.linkMemories(fromId, toId, relationship)
            CallToolResult(listOf(TextContent("""{"result":"linked","from":"$fromId","to":"$toId"}""")))
        } catch (e: Exception) {
            log.error("link_memories failed", e)
            CallToolResult(listOf(TextContent("Error: ${e.message}")), isError = true)
        }
    }

    private suspend fun handleGetRelationships(request: CallToolRequest): CallToolResult {
        return try {
            val args = request.arguments
            val id = args["id"]?.jsonPrimitive?.content
                ?: return CallToolResult(listOf(TextContent("Error: 'id' is required")), isError = true)
            val direction = args["direction"]?.jsonPrimitive?.content ?: "OUTGOING"

            val result = memoryService.getRelationships(id, direction)
            CallToolResult(listOf(TextContent(result)))
        } catch (e: Exception) {
            log.error("get_relationships failed", e)
            CallToolResult(listOf(TextContent("Error: ${e.message}")), isError = true)
        }
    }

    // ─────────────────────────────────────────────
    // Tag/type parsing helpers — accept JSON array OR comma-separated string
    // ─────────────────────────────────────────────

    /**
     * Parse [element] as a list of strings. Accepts:
     * - JSON array of strings: `["a","b"]`
     * - JSON string: `"a,b"` (comma-separated)
     * - `null` → returns empty list
     */
    private fun parseTags(element: JsonElement?): List<String> {
        return parseTagsOrNull(element) ?: emptyList()
    }

    /**
     * Parse [element] as a list of strings or null. Accepts:
     * - JSON array of strings: `["a","b"]`
     * - JSON string: `"a,b"` (comma-separated)
     * - `null` → returns `null`
     */
    private fun parseTagsOrNull(element: JsonElement?): List<String>? {
        if (element == null) return null

        // JSON array of strings: ["a","b"]
        if (element is JsonArray) {
            return element.map { it.jsonPrimitive.content }
        }

        // Fallback: treat as comma-separated string
        if (element is JsonPrimitive) {
            val str = element.content
            if (str.isNotBlank()) {
                return str.split(",").map { it.trim() }.filter { it.isNotBlank() }
            }
        }

        return emptyList()
    }
}
