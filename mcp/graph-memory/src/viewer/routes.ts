// @ts-nocheck
import { ViewerNode, ViewerEdge, ViewerGraphData } from "./types.js";
let db = null;
export function setDb(d) { db = d; }
export async function getGraphData(limit) {
  if (!db) return { nodes:[], edges:[], metadata:{node_count:0,edge_count:0,types:{},generated_at:new Date().toISOString()} };
  const tm = {}; const nodes = [];
  const q = "MATCH (n:Entity) RETURN n.id as id, n.name as name, n.type as type, n.category as category, n.language as language, n.file_path as file_path, n.signature as signatur, n.details as details, n.status as status, n.goal as goal, n.source as source, n.version as version, n.hash as hash, n.start_line as start_line, n.end_line as end_line, n.created_at as created_at LIMIT " + (limit||500);
  const nr = db.execute(q);
  for (const n of nr.rows||[]) {
    const t = String(n.type || "concept");
    tm[t] = (tm[t]||0) + 1;
    nodes.push({ id:String(n.id||""), name:String(n.name||""), type:t, category:n.category?String(n.category):undefined, language:n.language?String(n.language):undefined, file_path:n.file_path?String(n.file_path):undefined, signature:n.signature?String(n.signature):undefined, details:n.details?String(n.details):"", created_at:n.created_at?String(n.created_at):"", status:n.status?String(n.status):undefined, goal:n.goal?String(n.goal):undefined, source:n.source?String(n.source):undefined, version:n.version?Number(n.version):undefined, hash:n.hash?String(n.hash):undefined, start_line:n.start_line?Number(n.start_line):undefined, end_line:n.end_line?Number(n.end_line):undefined });
  }
  const edges = []; const rts = ["RELATED_TO","DEPENDS_ON","LEADS","INSPIRED_BY","BLOCKS","MENTIONS","CREATED_BY","SUPERSEDED_BY","DEFINED_IN","CONTAINS","IMPORTS"];
  for (const rt of rts) { try { const er = db.execute("MATCH (a)-[:" + rt + "]->(b) RETURN a.id AS s, b.id AS t LIMIT " + (limit||500)); for (const r of er.rows||[]) { edges.push({ id: String(r.s||"") + "_" + String(r.t||"") + "_" + rt, source: String(r.s||""), target: String(r.t||""), type: rt }); } } catch {} }
  return { nodes, edges, metadata: { node_count: nodes.length, edge_count: edges.length, types: tm, generated_at: new Date().toISOString() } };
}
export async function searchGraph(q, tf) { const d = await getGraphData(1000); let n = d.nodes; if (tf && tf !== "all") n = n.filter(function(x){return x.type===tf}); const s = q.toLowerCase().trim(); if (s) n = n.filter(function(x){return (x.name||"").toLowerCase().includes(s) || (x.details||"").toLowerCase().includes(s) || (x.file_path||"").toLowerCase().includes(s)}); const ids = new Set(n.map(function(x){return x.id})); const e = d.edges.filter(function(x){return ids.has(x.source) && ids.has(x.target)}); const tm = {}; n.forEach(function(x){tm[x.type] = (tm[x.type]||0) + 1}); return { nodes: n, edges: e, metadata: { node_count: n.length, edge_count: e.length, types: tm, generated_at: new Date().toISOString() } }; }
export async function getNodeById(id) { if (!db) return null; const safeId = id.replace(/[^a-zA-Z0-9_\-]/g, "");const q = "MATCH (n:Entity {id: '" + safeId + "'}) RETURN n.id as id, n.name as name, n.type as type, n.category as category, n.language as language, n.file_path as file_path, n.signature as signature, n.details as details, n.status as status, n.goal as goal, n.source as source, n.version as version, n.hash as hash, n.start_line as start_line, n.end_line as end_line, n.created_at as created_at LIMIT 1"; const r = db.execute(q); if (!r.rows || !r.rows.length) return null; const n = r.rows[0]; return { id: String(n.id||""), name: String(n.name||""), type: String(n.type||"concept"), details: String(n.details||""), category: n.category ? String(n.category) : undefined, language: n.language ? String(n.language) : undefined, file_path: n.file_path ? String(n.file_path) : undefined, signature: n.signature ? String(n.signature) : undefined, created_at: n.created_at ? String(n.created_at) : "", status: n.status ? String(n.status) : undefined, goal: n.goal ? String(n.goal) : undefined, source: n.source ? String(n.source) : undefined, version: n.version ? Number(n.version) : undefined, hash: n.hash ? String(n.hash) : undefined, start_line: n.start_line ? Number(n.start_line) : undefined, end_line: n.end_line ? Number(n.end_line) : undefined }; }

export async function getNodeRelationships(id) {
  if (!db) return [];
  const safeId = id.replace(/[^a-zA-Z0-9_\-]/g, "");
  const r = db.execute(
    "MATCH (a:Entity {id: '" + safeId + "'})-[r]->(b:Entity) " +
    "RETURN b.id as target, b.name as target_name, type(r) as rel_type, 'outgoing' as direction " +
    "UNION " +
    "MATCH (a:Entity)-[r]->(b:Entity {id: '" + safeId + "'}) " +
    "RETURN a.id as target, a.name as target_name, type(r) as rel_type, 'incoming' as direction"
  );
  const rels = [];
  if (r.rows) {
    for (const row of r.rows) {
      rels.push({
        target: String(row.target||""),
        target_name: String(row.target_name||""),
        type: String(row.rel_type||""),
        direction: String(row.direction||"outgoing"),
      });
    }
  }
  return rels;
}

