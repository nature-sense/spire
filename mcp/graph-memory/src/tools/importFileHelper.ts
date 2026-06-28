import * as path from "path";
import * as fs_mod from "fs";

// Helper: database import for the graph MCP import_file tool
import { PythonImporter } from "../importers/pythonImporter.js";
import { CppImporter } from "../importers/cppImporter.js";
import { DartImporter } from "../importers/dartImporter.js";
import { TypeScriptImporter } from "../importers/typescriptImporter.js";
import { MarkdownImporter } from "../importers/markdownImporter.js";
import { indexNode } from "../services/orama-service.js";

// Supported file extensions
const MARKDOWN_EXTENSIONS = [".md", ".mdx"];
const DART_EXTENSIONS = [".dart"];
const CPP_EXTENSIONS = [".cpp", ".cc", ".cxx", ".hpp", ".h"];
const PYTHON_EXTENSIONS = [".py"];
const TYPESCRIPT_EXTENSIONS = [".ts", ".tsx"];

export async function handleImportFile(
  db: any,
  log: Function,
  cypherStr: (v: string) => string,
  propsToCypher: (p: Record<string, unknown>) => string,
  args: Record<string, unknown>,
): Promise<{ content: { type: string; text: string }[]; isError?: boolean }> {
  const fp = args.file_path as string;
  if (!fp) {
    return { content: [{ type: "text", text: JSON.stringify({ error: "file_path is required" }) }] };
  }

  const ext = path.extname(fp).toLowerCase();
  const isMd = MARKDOWN_EXTENSIONS.includes(ext);
  const isDart = DART_EXTENSIONS.includes(ext);
  const isCpp = CPP_EXTENSIONS.includes(ext);
  const isPy = PYTHON_EXTENSIONS.includes(ext);
  const isTs = TYPESCRIPT_EXTENSIONS.includes(ext);

  if (!isMd && !isDart && !isCpp && !isPy && !isTs) {
    return {
      content: [{ type: "text", text: JSON.stringify({
        error: "Unsupported file type. Supported extensions: .py, .cpp, .cc, .cxx, .hpp, .h, .dart, .md, .ts, .tsx",
      }) }],
    };
  }

  try { fs_mod.accessSync(fp); } catch {
    return { content: [{ type: "text", text: JSON.stringify({ error: "File not found: " + fp }) }] };
  }

  try {
    let importer;
    if (isMd) {
      importer = await MarkdownImporter.create(fp);
    } else if (isDart) {
      importer = await DartImporter.create(fp);
    } else if (isPy) {
      importer = await PythonImporter.create(fp);
    } else if (isTs) {
      importer = await TypeScriptImporter.create(fp, ext === ".tsx");
    } else {
      importer = await CppImporter.create(fp);
    }
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
          // Also index for semantic search (fire-and-forget)
          indexNode(node as unknown as { id: string; name: string; details?: string; category?: string }).catch(() => {});
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
          const es = cypherStr(edge.source || "ast");
          let relProps = "source: '" + es + "'";
          if (edge.evidence) relProps += ", evidence: '" + cypherStr(edge.evidence) + "'";
          db.execute("MATCH (a:Entity {id: '" + sid + "'}), (b:Entity {id: '" + tid + "'}) CREATE (a)-[:" + edge.type + " {" + relProps + "}]->(b)");
          db.checkpoint(); rc++;
        }
      } catch (_) {}
    }
    const bn = path.basename(fp);
    const lang = isMd ? "markdown" : isDart ? "dart" : isPy ? "python" : isTs ? "typescript" : "cpp";
    return { content: [{ type: "text", text: JSON.stringify({
      success: true, file: fp, language: lang,
      entities_found: result.entities_found,
      nodes_created: nc, relationships_created: rc,
      summary: "Imported " + result.entities_found + " entities from " + bn,
      errors: result.errors,
    }, null, 2) }] };
  } catch (e) {
    return { content: [{ type: "text", text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }, null, 2) }] };
  }
}
