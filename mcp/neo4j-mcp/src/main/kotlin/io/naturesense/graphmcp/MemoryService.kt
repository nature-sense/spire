package io.naturesense.graphmcp

import org.neo4j.dbms.api.DatabaseManagementServiceBuilder
import org.neo4j.graphdb.GraphDatabaseService
import org.neo4j.graphdb.Label
import org.neo4j.graphdb.RelationshipType
import org.neo4j.graphdb.Result
import org.slf4j.LoggerFactory
import java.io.File
import java.nio.file.Path
import java.util.UUID

/**
 * Manages an embedded Neo4j database for graph memory storage.
 *
 * If the env var MEMORY_BANK_PATH is set, data persists at that location.
 * Otherwise the database is purely ephemeral (in-memory).
 */
class MemoryService {
    private val log = LoggerFactory.getLogger(MemoryService::class.java)

    private val db: GraphDatabaseService
    private val managementService: org.neo4j.dbms.api.DatabaseManagementService

    init {
        val dbPath: Path = System.getenv("MEMORY_BANK_PATH")?.let { Path.of(it) }
            ?: run {
                val projectDir = System.getProperty("user.dir")
                val path = Path.of(projectDir, ".graph-memory")
                // If user.dir is unwritable (e.g. "/"), fall back to temp
                val parent = path.parent
                if (parent != null && parent.toFile().canWrite()) {
                    path.toFile().mkdirs()
                    path
                } else {
                    File.createTempFile("graphmcp-", "").toPath().also { it.toFile().delete() }
                }
            }

        log.info("Opening Neo4j database at: ${dbPath.toAbsolutePath()}")

        managementService = DatabaseManagementServiceBuilder(dbPath).build()
        db = managementService.database("neo4j")

        // Ensure uniqueness constraint on Memory.id
        createIndexes()

        log.info("Neo4j database ready")
    }

    private fun createIndexes() {
        db.executeTransactionally(
            "CREATE CONSTRAINT IF NOT EXISTS FOR (m:Memory) REQUIRE m.id IS UNIQUE"
        )
    }

    /**
     * Escape a Kotlin string to produce a literal Cypher parameter reference.
     *
     * In Kotlin string templates, `$` is special.  When we want a literal
     * `$paramName` inside a regular (non-raw) string, we cannot use `$$` because
     * that would be interpreted as `$` followed by string-interpolation of the
     * Kotlin variable.  Instead we use `"\$"` (escaped dollar) or append strings.
     *
     * This helper returns the Cypher parameter reference for [name].
     * Usage: `"... WHERE m.importance >= ${cypherParam("minImportance")} ..."`
     */
    private fun cypherParam(name: String): String = "\$$name"

    // ─────────────────────────────────────────────
    // CRUD Operations
    // ─────────────────────────────────────────────

    /** Store a new memory node. Returns the generated ID. */
    fun storeMemory(content: String, type: String, tags: List<String>, importance: Double): String {
        val id = UUID.randomUUID().toString()
        db.executeTransactionally(
            "CREATE (m:Memory {id: \$id, content: \$content, type: \$type, tags: \$tags, importance: \$importance, createdAt: datetime(), updatedAt: datetime()})",
            mapOf(
                "id" to id,
                "content" to content,
                "type" to type,
                "tags" to tags.joinToString(","),
                "importance" to importance
            )
        )
        return id
    }

    /** Update a memory. Returns the memory if found, or null. */
    fun updateMemory(id: String, content: String?, importance: Double?, tags: List<String>?): MemoryNode? {
        val sets = mutableListOf("m.updatedAt = datetime()")
        val params = mutableMapOf<String, Any>("id" to id)
        content?.let {
            sets.add("m.content = \$content")
            params["content"] = it
        }
        importance?.let {
            sets.add("m.importance = \$importance")
            params["importance"] = it
        }
        tags?.let {
            sets.add("m.tags = \$tags")
            params["tags"] = it.joinToString(",")
        }

        val setClause = sets.joinToString(", ")
        val cypher = "MATCH (m:Memory {id: \$id}) SET $setClause RETURN m.id, m.content, m.type, m.tags, m.importance, m.createdAt, m.updatedAt"

        return db.executeTransactionally(
            cypher,
            params
        ) { result: Result ->
            if (result.hasNext()) {
                val row = result.next()
                MemoryNode(
                    id = row["m.id"] as String,
                    content = row["m.content"] as? String ?: "",
                    type = row["m.type"] as? String ?: "",
                    tags = (row["m.tags"] as? String)?.split(",")?.filter { it.isNotBlank() } ?: emptyList(),
                    importance = (row["m.importance"] as? Number)?.toDouble() ?: 0.0
                )
            } else null
        }
    }

    /** Delete a memory. If cascade is true, also delete directly linked nodes. */
    fun deleteMemory(id: String, cascade: Boolean) {
        if (cascade) {
            // Find connected nodes and delete them too
            val connectedIds = mutableListOf<String>()
            db.executeTransactionally(
                "MATCH (m:Memory {id: \$id})-[r:RELATES_TO]-(other:Memory) RETURN DISTINCT other.id AS otherId",
                mapOf("id" to id)
            ) { result: Result ->
                result.forEach { row ->
                    (row["otherId"] as? String)?.let { connectedIds.add(it) }
                }
            }
            // Delete relationships first, then the main node and connected nodes
            db.executeTransactionally(
                "MATCH (m:Memory {id: \$id}) DETACH DELETE m",
                mapOf("id" to id)
            )
            connectedIds.forEach { connectedId ->
                db.executeTransactionally(
                    "MATCH (m:Memory {id: \$id}) DETACH DELETE m",
                    mapOf("id" to connectedId)
                )
            }
        } else {
            db.executeTransactionally(
                "MATCH (m:Memory {id: \$id}) DETACH DELETE m",
                mapOf("id" to id)
            )
        }
    }

    /** Execute a read-only Cypher query. Validates no mutating clauses. Returns JSON result as string. */
    fun searchMemory(query: String, params: Map<String, Any>): String {
        val upper = query.uppercase()
        val disallowed = listOf("CREATE ", "DELETE ", "SET ", "MERGE ", "REMOVE ", "DETACH ", "CALL ", "LOAD ")

        // Allow only SELECT-style queries: MATCH ... RETURN ...
        // Simple read-only check
        val hasMatch = upper.contains("MATCH")
        val hasReturn = upper.contains("RETURN")

        if (!hasMatch || !hasReturn) {
            throw IllegalArgumentException("Only read-only Cypher queries (MATCH/RETURN) are allowed")
        }

        val violation = disallowed.any { upper.contains(it) }
        if (violation) {
            throw IllegalArgumentException("Mutating Cypher clauses (CREATE/DELETE/SET/MERGE etc.) are not allowed")
        }

        val resultJson = db.executeTransactionally(
            query,
            params
        ) { result: Result ->
            val rows = mutableListOf<String>()
            result.use { rs ->
                val columns = rs.columns()
                while (rs.hasNext()) {
                    val row = rs.next()
                    val fields = columns.joinToString(",") { col ->
                        val value = row[col]
                        "\"$col\":${valueToJson(value)}"
                    }
                    rows.add("{$fields}")
                }
            }
            rows
        }
        return "[${resultJson.joinToString(",")}]"
    }

    /** Get context: top N memories ordered by importance, optional type filter. */
    fun getContext(limit: Int, minImportance: Double, types: List<String>?): String {
        val conditions = mutableListOf<String>()
        val params = mutableMapOf<String, Any>("limit" to limit)

        // Build conditions — use string concatenation to avoid Kotlin \$Gotchas
        conditions.add("m.importance >= \$minImportance")
        params["minImportance"] = minImportance

        types?.let {
            if (it.isNotEmpty()) {
                conditions.add("m.type IN \$types")
                params["types"] = it
            }
        }

        val whereClause = conditions.joinToString(" AND ")
        val cypher = "MATCH (m:Memory) WHERE $whereClause RETURN m ORDER BY m.importance DESC LIMIT \$limit"

        val sb = StringBuilder("[")
        db.executeTransactionally(cypher, params) { result: Result ->
            var first = true
            while (result.hasNext()) {
                if (!first) sb.append(",")
                first = false
                val row = result.next()
                val node = row["m"] as org.neo4j.graphdb.Node
                sb.append(nodeToJson(node))
            }
        }
        sb.append("]")
        return sb.toString()
    }

    /** Create a RELATES_TO relationship between two memories. */
    fun linkMemories(fromId: String, toId: String, relationship: String) {
        db.executeTransactionally(
            "MATCH (a:Memory {id: \$fromId}), (b:Memory {id: \$toId}) CREATE (a)-[r:RELATES_TO {relationship: \$relationship}]->(b)",
            mapOf("fromId" to fromId, "toId" to toId, "relationship" to relationship)
        )
    }

    /** Get relationships for a memory, optionally filtered by direction. */
    fun getRelationships(id: String, direction: String): String {
        val cypher = when (direction.uppercase()) {
            "OUTGOING" ->
                "MATCH (m:Memory {id: \$id})-[r:RELATES_TO]->(other:Memory) RETURN other, r.relationship AS relationship"
            "INCOMING" ->
                "MATCH (m:Memory {id: \$id})<-[r:RELATES_TO]-(other:Memory) RETURN other, r.relationship AS relationship"
            else -> // BOTH
                "MATCH (m:Memory {id: \$id})-[r:RELATES_TO]-(other:Memory) RETURN other, r.relationship AS relationship"
        }

        val sb = StringBuilder("[")
        db.executeTransactionally(cypher, mapOf("id" to id)) { result: Result ->
            var first = true
            while (result.hasNext()) {
                if (!first) sb.append(",")
                first = false
                val row = result.next()
                val other = row["other"] as org.neo4j.graphdb.Node
                val rel = row["relationship"] as? String ?: ""
                sb.append("""{"relationship":"$rel","memory":""")
                sb.append(nodeToJson(other))
                sb.append("}")
            }
        }
        sb.append("]")
        return sb.toString()
    }

    /** Shut down the database gracefully. */
    fun close() {
        log.info("Shutting down Neo4j database")
        managementService.shutdown()
    }

    // ─────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────

    private fun nodeToJson(node: org.neo4j.graphdb.Node): String {
        return """{
            |"id":"${node.getProperty("id", "")}",
            |"content":"${escapeJson(node.getProperty("content", "") as String)}",
            |"type":"${node.getProperty("type", "")}",
            |"tags":"${node.getProperty("tags", "")}",
            |"importance":${node.getProperty("importance", 0.0)}
        |}""".trimMargin()
    }

    private fun valueToJson(value: Any?): String {
        return when (value) {
            null -> "null"
            is org.neo4j.graphdb.Node -> nodeToJson(value)
            is String -> "\"${escapeJson(value)}\""
            is Number -> value.toString()
            is Boolean -> value.toString()
            is org.neo4j.graphdb.Relationship -> "\"${escapeJson(value.getProperty("relationship", "") as String)}\""
            else -> "\"${escapeJson(value.toString())}\""
        }
    }

    private fun escapeJson(s: String): String {
        return s.replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t")
    }
}

data class MemoryNode(
    val id: String,
    val content: String,
    val type: String,
    val tags: List<String>,
    val importance: Double
)
