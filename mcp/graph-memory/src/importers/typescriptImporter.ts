import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';
import { EntityNode, Relationship, ImportResult } from '../types/import.js';
import { isoTimestamp, slugify, computeHash } from '../utils/helpers.js';
import { ensureTreeSitterInit } from '../utils/treeSitterInit.js';

// ---------------------------------------------------------------------------
// Cached WASM language — loaded once, shared across all TypeScriptImporter instances
// ---------------------------------------------------------------------------

let TSLanguage: any = null;
let TSXLanguage: any = null;

function getTSWasmPath(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.join(__dirname, '..', '..', 'node_modules', 'tree-sitter-typescript', 'tree-sitter-typescript.wasm');
}

function getTSXWasmPath(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.join(__dirname, '..', '..', 'node_modules', 'tree-sitter-typescript', 'tree-sitter-tsx.wasm');
}

// ---------------------------------------------------------------------------
// Module-level parser class holder (set via shared ensureTreeSitterInit)
// ---------------------------------------------------------------------------

let ParserClass: any = null;
let parserInitPromise: Promise<void> | null = null;

// ---------------------------------------------------------------------------
// TypeScriptImporter
// ---------------------------------------------------------------------------

export class TypeScriptImporter {
  private filePath: string;
  private source: string;
  private sourceVersion: string;
  private fileHash: string;
  private fileContent: string;
  private parser: any;
  private isTsx: boolean;

  constructor(
    filePath: string,
    isTsx: boolean,
    source: string = 'ts_ast',
    sourceVersion: string = '1.0.0',
  ) {
    this.filePath = path.resolve(filePath);
    this.isTsx = isTsx;
    this.source = source;
    this.sourceVersion = sourceVersion;
    this.fileContent = fs.readFileSync(this.filePath, 'utf-8');
    this.fileHash = crypto
      .createHash('sha256')
      .update(this.fileContent)
      .digest('hex')
      .substring(0, 16);
    this.parser = new ParserClass();
  }

  static async create(
    filePath: string,
    isTsx: boolean,
    source?: string,
    sourceVersion?: string,
  ): Promise<TypeScriptImporter> {
    if (!parserInitPromise) {
      parserInitPromise = (async () => {
        const { Parser, Language } = await ensureTreeSitterInit();
        ParserClass = Parser;
        if (!TSLanguage) {
          const wasmData = fs.readFileSync(getTSWasmPath());
          TSLanguage = await Language.load(wasmData);
        }
        if (!TSXLanguage) {
          const wasmData = fs.readFileSync(getTSXWasmPath());
          TSXLanguage = await Language.load(wasmData);
        }
      })();
    }
    await parserInitPromise;

    const importer = new TypeScriptImporter(filePath, isTsx, source, sourceVersion);
    importer.parser.setLanguage(isTsx ? TSXLanguage : TSLanguage);
    return importer;
  }



  // ── Public entry point ──────────────────────────────────────────────────

  importFile(): ImportResult {
    const nodes: EntityNode[] = [];
    const edges: Relationship[] = [];
    const errors: string[] = [];

    try {
      const tree = this.parser.parse(this.fileContent);
      const root = tree.rootNode;

      const fileNode = this.createFileNode();
      nodes.push(fileNode);

      this.walkProgram(root, fileNode.id, nodes, edges, errors);

      return {
        success: errors.length === 0,
        file: this.filePath,
        file_hash: this.fileHash,
        entities_found: nodes.length - 1,
        nodes_created: 0,
        nodes_updated: 0,
        relationships_created: 0,
        nodes,
        edges,
        errors,
        summary:
          'Extracted ' + (nodes.length - 1) + ' entities from ' + path.basename(this.filePath),
      };
    } catch (error) {
      return {
        success: false,
        file: this.filePath,
        entities_found: 0,
        nodes_created: 0,
        nodes_updated: 0,
        relationships_created: 0,
        nodes: [],
        edges: [],
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }  
  private walkProgram(
    node: any,
    fileId: string,
    nodes: EntityNode[],
    edges: Relationship[],
    errors: string[],
  ): void {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;
      try { this.walkTopLevel(child, fileId, fileId, nodes, edges, errors); } catch (e) {
        errors.push('L' + (child.startPosition?.row + 1 || 0) + ': ' + (e instanceof Error ? e.message : String(e)));
      }
    }
  }

  private walkTopLevel(node: any, fileId: string, parentId: string, nodes: EntityNode[], edges: Relationship[], errors: string[]): void {
    const t = node.type;
    switch (t) {
      case 'function_declaration': case 'generator_function_declaration':
        this.extractFunction(node, fileId, parentId, nodes, edges); break;
      case 'method_definition':
        this.extractMethod(node, fileId, parentId, nodes, edges); break;
      case 'class_declaration': case 'abstract_class_declaration':
        this.extractClass(node, fileId, parentId, nodes, edges, errors); break;
      case 'interface_declaration':
        this.extractInterface(node, fileId, parentId, nodes, edges, errors); break;
      case 'type_alias_declaration':
        this.extractTypeAlias(node, fileId, parentId, nodes, edges); break;
      case 'enum_declaration':
        this.extractEnum(node, fileId, parentId, nodes, edges, errors); break;
      case 'import_statement':
        this.extractImport(node, fileId, edges); break;
      case 'lexical_declaration': case 'variable_declaration':
        this.extractVariable(node, fileId, parentId, nodes, edges); break;
      case 'export_statement':
        this.walkExport(node, fileId, parentId, nodes, edges, errors); break;
      case 'namespace_declaration': case 'internal_module': case 'module':
        this.extractNamespace(node, fileId, parentId, nodes, edges, errors); break;
      default:
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child) this.walkTopLevel(child, fileId, parentId, nodes, edges, errors);
        }
        break;
    }
  }

  private extractFunction(node: any, fileId: string, parentId: string, nodes: EntityNode[], edges: Relationship[]): void {
    const nameNode = this.findChildOfType(node, 'identifier');
    const name = nameNode ? this.nodeText(nameNode) : 'anonymous';
    const params = this.extractParams(node);
    const returnType = this.extractReturnType(node);
    const sig = name + '(' + params.join(', ') + ')' + (returnType ? ': ' + returnType : '');
    const docstring = this.extractDocstring(node);
    const body = this.findChildOfType(node, 'statement_block');
    let bodyText = body ? this.nodeText(body) : '';
    const now = isoTimestamp();
    const ln = node.startPosition.row + 1;
    nodes.push({
      id: slugify('func-' + name + '-' + this.fileHash), name, details: docstring || sig,
      type: 'code' as const, category: 'function', language: 'typescript' as const,
      file_path: this.filePath, signature: sig,
      body_preview: bodyText.length > 200 ? bodyText.substring(0, 200) + '...' : bodyText,
      start_line: ln, end_line: node.endPosition.row + 1,
      hash: computeHash(sig), source: this.source, source_version: this.sourceVersion,
      valid_from: now, valid_to: null, version: 1, created_at: now, ingested_at: now, updated_at: now,
    });
    edges.push({ type: 'CONTAINS', source_id: parentId, target_id: slugify('func-' + name + '-' + this.fileHash), evidence: this.filePath + '#L' + ln, source: this.source });
  }

  private extractMethod(node: any, fileId: string, parentId: string, nodes: EntityNode[], edges: Relationship[]): void {
    const nameNode = this.findChildOfType(node, 'property_identifier') || this.findChildOfType(node, 'identifier');
    const name = nameNode ? this.nodeText(nameNode) : 'anonymous';
    const params = this.extractParams(node);
    const returnType = this.extractReturnType(node);
    const sig = name + '(' + params.join(', ') + ')' + (returnType ? ': ' + returnType : '');
    const docstring = this.extractDocstring(node);
    const now = isoTimestamp();
    const ln = node.startPosition.row + 1;
    const id = slugify('method-' + name + '-' + this.fileHash);
    nodes.push({
      id, name, details: docstring || sig,
      type: 'code' as const, category: 'method', language: 'typescript' as const,
      file_path: this.filePath, signature: sig,
      start_line: ln, end_line: node.endPosition.row + 1,
      hash: computeHash(sig), source: this.source, source_version: this.sourceVersion,
      valid_from: now, valid_to: null, version: 1, created_at: now, ingested_at: now, updated_at: now,
    });
    edges.push({ type: 'CONTAINS', source_id: parentId, target_id: id, evidence: this.filePath + '#L' + ln, source: this.source });
  }

  private extractClass(node: any, fileId: string, parentId: string, nodes: EntityNode[], edges: Relationship[], errors: string[]): void {
    const nameNode = this.findChildOfType(node, 'type_identifier') || this.findChildOfType(node, 'identifier');
    const name = nameNode ? this.nodeText(nameNode) : 'anonymous';
    const docstring = this.extractDocstring(node);
    const now = isoTimestamp();
    const ln = node.startPosition.row + 1;
    const id = slugify('class-' + name + '-' + this.fileHash);
    nodes.push({
      id, name, details: docstring || 'class ' + name,
      type: 'code' as const, category: 'class', language: 'typescript' as const,
      file_path: this.filePath, start_line: ln, end_line: node.endPosition.row + 1,
      hash: computeHash(name + this.filePath), source: this.source, source_version: this.sourceVersion,
      valid_from: now, valid_to: null, version: 1, created_at: now, ingested_at: now, updated_at: now,
    });
    edges.push({ type: 'CONTAINS', source_id: parentId, target_id: id, evidence: this.filePath + '#L' + ln, source: this.source });
    const body = this.findChildOfType(node, 'class_body') || this.findChildOfType(node, 'statement_block');
    if (body) {
      for (let i = 0; i < body.childCount; i++) {
        const child = body.child(i);
        if (!child) continue;
        try {
          if (child.type === 'public_field_definition') {
            const pn = this.findChildOfType(child, 'property_identifier') || this.findChildOfType(child, 'identifier');
            if (pn) {
              const pname = this.nodeText(pn);
              const pid = slugify('prop-' + pname + '-' + this.fileHash);
              nodes.push({
                id: pid, name: pname, details: 'property ' + pname,
                type: 'code' as const, category: 'property', language: 'typescript' as const,
                file_path: this.filePath, start_line: child.startPosition.row + 1, end_line: child.endPosition.row + 1,
                hash: computeHash(pname), source: this.source, source_version: this.sourceVersion,
                valid_from: now, valid_to: null, version: 1, created_at: now, ingested_at: now, updated_at: now,
              });
              edges.push({ type: 'CONTAINS', source_id: id, target_id: pid, evidence: this.filePath + '#L' + (child.startPosition.row + 1), source: this.source });
            }
          } else if (child.type === 'constructor_definition') {
            const cparams = this.extractParams(child);
            const csig = 'constructor(' + cparams.join(', ') + ')';
            const cdoc = this.extractDocstring(child);
            const cid = slugify('ctor-' + id);
            nodes.push({
              id: cid, name: 'constructor', details: cdoc || csig,
              type: 'code' as const, category: 'constructor', language: 'typescript' as const,
              file_path: this.filePath, signature: csig,
              start_line: child.startPosition.row + 1, end_line: child.endPosition.row + 1,
              hash: computeHash(csig), source: this.source, source_version: this.sourceVersion,
              valid_from: now, valid_to: null, version: 1, created_at: now, ingested_at: now, updated_at: now,
            });
            edges.push({ type: 'CONTAINS', source_id: id, target_id: cid, evidence: this.filePath + '#L' + (child.startPosition.row + 1), source: this.source });
          } else {
            this.walkTopLevel(child, fileId, id, nodes, edges, errors);
          }
        } catch (e) {
          errors.push('L' + (child.startPosition?.row + 1 || 0) + ': ' + (e instanceof Error ? e.message : String(e)));
        }
      }
    }
  }

  private extractInterface(node: any, fileId: string, parentId: string, nodes: EntityNode[], edges: Relationship[], errors: string[]): void {
    const nameNode = this.findChildOfType(node, 'type_identifier') || this.findChildOfType(node, 'identifier');
    const name = nameNode ? this.nodeText(nameNode) : 'anonymous';
    const docstring = this.extractDocstring(node);
    const now = isoTimestamp();
    const ln = node.startPosition.row + 1;
    const id = slugify('interface-' + name + '-' + this.fileHash);
    nodes.push({
      id, name, details: docstring || 'interface ' + name,
      type: 'code' as const, category: 'interface', language: 'typescript' as const,
      file_path: this.filePath, start_line: ln, end_line: node.endPosition.row + 1,
      hash: computeHash(name + this.filePath), source: this.source, source_version: this.sourceVersion,
      valid_from: now, valid_to: null, version: 1, created_at: now, ingested_at: now, updated_at: now,
    });
    edges.push({ type: 'CONTAINS', source_id: parentId, target_id: id, evidence: this.filePath + '#L' + ln, source: this.source });
  }

  private extractTypeAlias(node: any, fileId: string, parentId: string, nodes: EntityNode[], edges: Relationship[]): void {
    const nameNode = this.findChildOfType(node, 'type_identifier') || this.findChildOfType(node, 'identifier');
    const name = nameNode ? this.nodeText(nameNode) : 'anonymous';
    const now = isoTimestamp();
    const ln = node.startPosition.row + 1;
    const id = slugify('type-' + name + '-' + this.fileHash);
    nodes.push({
      id, name, details: 'type ' + name,
      type: 'code' as const, category: 'type', language: 'typescript' as const,
      file_path: this.filePath, start_line: ln, end_line: node.endPosition.row + 1,
      hash: computeHash(name + this.filePath), source: this.source, source_version: this.sourceVersion,
      valid_from: now, valid_to: null, version: 1, created_at: now, ingested_at: now, updated_at: now,
    });
    edges.push({ type: 'CONTAINS', source_id: parentId, target_id: id, evidence: this.filePath + '#L' + ln, source: this.source });
  }

  private extractEnum(node: any, fileId: string, parentId: string, nodes: EntityNode[], edges: Relationship[], errors: string[]): void {
    const nameNode = this.findChildOfType(node, 'type_identifier') || this.findChildOfType(node, 'identifier');
    const name = nameNode ? this.nodeText(nameNode) : 'anonymous';
    const now = isoTimestamp();
    const ln = node.startPosition.row + 1;
    const id = slugify('enum-' + name + '-' + this.fileHash);
    nodes.push({
      id, name, details: 'enum ' + name,
      type: 'code' as const, category: 'enum', language: 'typescript' as const,
      file_path: this.filePath, start_line: ln, end_line: node.endPosition.row + 1,
      hash: computeHash(name + this.filePath), source: this.source, source_version: this.sourceVersion,
      valid_from: now, valid_to: null, version: 1, created_at: now, ingested_at: now, updated_at: now,
    });
    edges.push({ type: 'CONTAINS', source_id: parentId, target_id: id, evidence: this.filePath + '#L' + ln, source: this.source });
  }

  private extractVariable(node: any, fileId: string, parentId: string, nodes: EntityNode[], edges: Relationship[]): void {
    const now = isoTimestamp();
    const ln = node.startPosition.row + 1;
    for (let i = 0; i < node.childCount; i++) {
      const decl = node.child(i);
      if (!decl || decl.type !== 'variable_declarator') continue;
      const nameNode = this.findChildOfType(decl, 'identifier') || this.findChildOfType(decl, 'property_identifier');
      const name = nameNode ? this.nodeText(nameNode) : null;
      if (!name) continue;
      const id = slugify('var-' + name + '-' + this.fileHash);
      nodes.push({
        id, name, details: 'variable ' + name,
        type: 'code' as const, category: 'variable', language: 'typescript' as const,
        file_path: this.filePath, start_line: ln, end_line: node.endPosition.row + 1,
        hash: computeHash(name + this.filePath), source: this.source, source_version: this.sourceVersion,
        valid_from: now, valid_to: null, version: 1, created_at: now, ingested_at: now, updated_at: now,
      });
      edges.push({ type: 'CONTAINS', source_id: parentId, target_id: id, evidence: this.filePath + '#L' + ln, source: this.source });
    }
  }

  private extractImport(node: any, fileId: string, edges: Relationship[]): void {
    const sourceNode = this.findChildOfType(node, 'string_fragment') || this.findChildOfType(node, 'string');
    if (!sourceNode) return;
    const mod = this.nodeText(sourceNode).replace(/^['"]|['"]$/g, '');
    edges.push({
      type: 'IMPORTS', source_id: fileId, target_id: slugify('module-' + mod),
      evidence: this.filePath + '#L' + (node.startPosition.row + 1), source: this.source,
    });
  }

  private walkExport(node: any, fileId: string, parentId: string, nodes: EntityNode[], edges: Relationship[], errors: string[]): void {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;
      const t = child.type;
      if (t === 'function_declaration' || t === 'class_declaration' || t === 'interface_declaration' ||
          t === 'enum_declaration' || t === 'type_alias_declaration' || t === 'lexical_declaration' ||
          t === 'variable_declaration' || t === 'abstract_class_declaration')
        this.walkTopLevel(child, fileId, parentId, nodes, edges, errors);
    }
  }

  private extractNamespace(node: any, fileId: string, parentId: string, nodes: EntityNode[], edges: Relationship[], errors: string[]): void {
    const nameNode = this.findChildOfType(node, 'identifier');
    const name = nameNode ? this.nodeText(nameNode) : 'anonymous';
    const now = isoTimestamp();
    const ln = node.startPosition.row + 1;
    const id = slugify('ns-' + name + '-' + this.fileHash);
    nodes.push({
      id, name, details: 'namespace ' + name,
      type: 'code' as const, category: 'namespace', language: 'typescript' as const,
      file_path: this.filePath, start_line: ln, end_line: node.endPosition.row + 1,
      hash: computeHash(name + this.filePath), source: this.source, source_version: this.sourceVersion,
      valid_from: now, valid_to: null, version: 1, created_at: now, ingested_at: now, updated_at: now,
    });
    edges.push({ type: 'CONTAINS', source_id: parentId, target_id: id, evidence: this.filePath + '#L' + ln, source: this.source });
    const body = this.findChildOfType(node, 'statement_block');
    if (body) {
      for (let i = 0; i < body.childCount; i++) {
        const child = body.child(i);
        if (!child) continue;
        try { this.walkTopLevel(child, fileId, id, nodes, edges, errors); } catch (e) {
          errors.push('L' + (child.startPosition?.row + 1 || 0) + ': ' + (e instanceof Error ? e.message : String(e)));
        }
      }
    }
  }

  private extractParams(node: any): string[] {
    const out: string[] = [];
    const pn = this.findChildOfType(node, 'formal_parameters') || this.findChildOfType(node, 'parameters');
    if (!pn) return out;
    for (let i = 0; i < pn.childCount; i++) {
      const child = pn.child(i);
      if (child && (child.type === 'required_parameter' || child.type === 'optional_parameter')) {
        const nameNode = this.findChildOfType(child, 'identifier') || this.findChildOfType(child, 'property_identifier');
        out.push(nameNode ? this.nodeText(nameNode) : '?');
      }
    }
    return out;
  }

  private extractReturnType(node: any): string {
    const rtn = this.findChildOfType(node, 'return_type') || node.childForFieldName?.('return_type');
    if (rtn) {
      let rt = this.nodeText(rtn).trim();
      if (rt.startsWith(':')) rt = rt.substring(1).trim();
      return rt;
    }
    return '';
  }

  private extractDocstring(node: any): string {
    const body = this.findChildOfType(node, 'statement_block') || this.findChildOfType(node, 'body') || this.findChildOfType(node, 'class_body');
    if (!body) return '';
    for (let i = 0; i < body.childCount; i++) {
      const child = body.child(i);
      if (!child) continue;
      if (child.type === 'expression_statement') {
        const expr = child.child(0);
        if (expr && (expr.type === 'string' || expr.type === 'template_string')) {
          let ds = this.nodeText(expr);
          ds = ds.replace(/^[\"'`]|[\"'`]$/g, '').trim();
          if (ds) return ds;
        }
      }
      if (child.type === 'comment') {
        let c = this.nodeText(child).trim();
        if (c.startsWith('/**') || c.startsWith('*')) return c.replace(/^\/\*\*\s*/, '').replace(/\*\s*\/$/, '').replace(/^\s*\*\s?/gm, '').trim();
      }
      break;
    }
    return '';
  }

  private findChildOfType(node: any, type: string): any | null {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && child.type === type) return child;
    }
    return null;
  }

  private nodeText(node: any): string {
    return this.fileContent.substring(node.startIndex, node.endIndex);
  }

  private createFileNode(): EntityNode {
    const now = isoTimestamp();
    const lang = this.isTsx ? 'tsx' : 'typescript';
    return {
      id: slugify('file-' + this.filePath),
      name: path.basename(this.filePath),
      details: 'TypeScript file: ' + this.filePath,
      type: 'code',
      language: lang as any,
      file_path: this.filePath,
      hash: this.fileHash,
      source: this.source,
      source_version: this.sourceVersion,
      valid_from: now, valid_to: null, version: 1,
      created_at: now, ingested_at: now, updated_at: now,
    };
  }
}