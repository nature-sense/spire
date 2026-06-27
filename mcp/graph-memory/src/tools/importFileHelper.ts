import * as path from "path";
import * as fs_mod from "fs";

// Helper: database import for the graph MCP import_file tool
import { PythonImporter } from "../importers/pythonImporter.js";

export async function handleImportFile(
  db: any,
  log: Function,
  cypherStr: (v: string) => string,
  propsToCypher: (p: Record<string, unknown>) => string,
  args: Record<string, unknown>,
): Promise<{ content: { type: string; text: string }[]; isError?: boolean }> {
  const fp = args.file_path as string;
  if (!fp || !fp.endsWith(".py")) {
    return { content: [{ type: "text", text: JSON.stringify({ error: "Only .py files are supported" }) }] };
  }
  try { fs_mod.accessSync(fp); } catch {
    return { content: [{ type: "text", text: JSON.stringify({ error: "File not found: " + fp }) }] };
  }
  try {
    const importer = await PythonImporter.create(fp);
    const result = importer.importFile();
    if (!result.success) {
      return { content: [{ type: "text", text: JSON.stringify({ error: result.errors.join("; ") }) }] };
    }
    let nc = 0, rc = 0;
    for (const node of result.nodes) {
      try {
        const hexId = cypherStr(node.id);
        db.execute("MATCH (n:Entity {id: '" + hexId + "'})-[r]-() DELETE r");
        try { db.execute("MATCH (n:Entity {id: '" + hexId + "'}) DELETE n"); } catch (_) {}
        db.execute("CREATE (n:Entity {" + propsToCypher(node as unknown as Record<string, unknown>) + "})");
        db.checkpoint(); nc++;
      } catch (_) {}
    }
    for (const edge of result.edges) {
      try {
        const sid = cypherStr(edge.source_id);
        const tid = cypherStr(edge.target_id);
        const a = db.execute("MATCH (n:Entity {id: '" + sid + "'}) RETURN n.id");
        const b = db.execute("MATCH (n:Entity {id: '" + tid + "'}) RETURN n.id");
        if (a.rows.length && b.rows.length) {
          db.execute("MATCH (a:Entity {id: '" + sid + "'})-[r:" + edge.type + "]->(b:Entity {id: '" + tid + "'}) DELETE r");
          const es = cypherStr(edge.source || "python_ast");
          let relProps = "source: '" + es + "'";
          if (edge.evidence) relProps += ", evidence: '" + cypherStr(edge.evidence) + "'";
          db.execute("MATCH (a:Entity {id: '" + sid + "'}), (b:Entity {id: '" + tid + "'}) CREATE (a)-[:" + edge.type + " {" + relProps + "}]->(b)");
          db.checkpoint(); rc++;
        }
      } catch (_) {}
    }
    const bn = path.basename(fp);
    return { content: [{ type: "text", text: JSON.stringify({
      success: true, file: fp, language: "python",
      entities_found: result.entities_found,
      nodes_created: nc, relationships_created: rc,
      summary: "Imported " + result.entities_found + " entities from " + bn,
      errors: result.errors,
    }, null, 2) }] };
  } catch (e) {
    return { content: [{ type: "text", text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }, null, 2) }] };
  }
}
