import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';
import { EntityNode, Relationship, ImportResult } from '../types/import.js';
import { isoTimestamp, slugify, computeHash } from '../utils/helpers.js';
import { ensureTreeSitterInit } from '../utils/treeSitterInit.js';

// ---------------------------------------------------------------------------
// Cached WASM language
// ---------------------------------------------------------------------------

let DartLanguage: any = null;

function getDartWasmPath(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.join(__dirname, '..', '..', 'node_modules', '@plurnk', 'plurnk-mimetypes-grammar-dart', 'dart.wasm');
}

// ---------------------------------------------------------------------------
// Module-level parser class holder
// ---------------------------------------------------------------------------

let ParserClass: any = null;
let parserInitPromise: Promise<void> | null = null;

// ---------------------------------------------------------------------------
// DartImporter
// ---------------------------------------------------------------------------

export class DartImporter {
  private filePath: string;
  private source: string;
  private sourceVersion: string;
  private fileHash: string;
  private fileContent: string;
  private parser: any;

  constructor(
    filePath: string,
    source: string = 'dart_ast',
    sourceVersion: string = '1.0.0',
  ) {
    this.filePath = path.resolve(filePath);
    this.source = source;
    this.sourceVersion = sourceVersion;
    this.fileContent = fs.readFileSync(this.filePath, 'utf-8');
    this.fileHash = crypto.createHash('sha256').update(this.fileContent).digest('hex').substring(0, 16);
    this.parser = new ParserClass();
  }

  static async create(
    filePath: string,
    source?: string,
    sourceVersion?: string,
  ): Promise<DartImporter> {
    if (!parserInitPromise) {
      parserInitPromise = (async () => {
        const { Parser, Language } = await ensureTreeSitterInit();
        ParserClass = Parser;
        if (!DartLanguage) {
          const wasmPath = getDartWasmPath();
          const wasmData = fs.readFileSync(wasmPath);
          DartLanguage = await Language.load(wasmData);
        }
      })();
    }
    await parserInitPromise;

    const importer = new DartImporter(filePath, source, sourceVersion);
    importer.parser.setLanguage(DartLanguage);
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
        nodes_created: 0, nodes_updated: 0, relationships_created: 0,
        nodes, edges, errors,
        summary: 'Extracted ' + (nodes.length - 1) + ' entities from ' + path.basename(this.filePath),
      };
    } catch (error) {
      return {
        success: false,
        file: this.filePath, entities_found: 0,
        nodes_created: 0, nodes_updated: 0, relationships_created: 0,
        nodes: [], edges: [],
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  // ── Root walker ─────────────────────────────────────────────────────────

  private walkProgram(root: any, fileId: string, nodes: EntityNode[], edges: Relationship[], errors: string[]): void {
    for (let i = 0; i < root.childCount; i++) {
      const child = root.child(i);
      if (!child) continue;
      try {
        this.processTopLevel(child, fileId, fileId, nodes, edges, errors);
      } catch (e) {
        errors.push(`L${child.startPosition.row + 1 || 0}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // ── Top-level processing ────────────────────────────────────────────────

  private processTopLevel(
    node: any,
    fileId: string,
    parentNodeId: string,
    nodes: EntityNode[],
    edges: Relationship[],
    errors: string[],
  ): void {
    switch (node.type) {
      case 'import_or_export':
        this.extractImport(node, fileId, edges);
        break;

      case 'class_definition':
        this.extractClass(node, fileId, parentNodeId, nodes, edges, errors);
        break;

      case 'mixin_declaration':
        this.extractMixin(node, fileId, parentNodeId, nodes, edges, errors);
        break;

      case 'extension_declaration':
        this.extractExtension(node, fileId, parentNodeId, nodes, edges, errors);
        break;

      case 'enum_declaration':
        this.extractEnum(node, fileId, parentNodeId, nodes, edges, errors);
        break;

      case 'function_signature':
        this.extractTopLevelFunction(node, fileId, parentNodeId, nodes, edges, errors);
        break;

      case 'declaration':
      case 'const_builtin':
      case 'final_builtin':
        this.extractTopLevelDeclaration(node, fileId, parentNodeId, nodes, edges, errors);
        break;

      default:
        // Recurse for any other container
        if (this.nodeContents(node)) {
          for (let i = 0; i < node.childCount; i++) {
            const c = node.child(i);
            if (c) this.processTopLevel(c, fileId, parentNodeId, nodes, edges, errors);
          }
        }
        break;
    }
  }

  // ── Import extraction ───────────────────────────────────────────────────

  private extractImport(node: any, fileId: string, edges: Relationship[]): void {
    const sl = this.findDeepStringLiteral(node);
    const content = sl ? this.nodeText(sl) : "";
    const cleaned = content.replace(/^['"]|['"]$/g, "").trim();
    if (!cleaned) return;

    edges.push({
      type: 'IMPORTS', source_id: fileId,
      target_id: slugify('module-' + cleaned),
      evidence: `${this.filePath}#L${node.startPosition.row + 1}`,
      source: this.source,
    });
  }

  // ── Class extraction ────────────────────────────────────────────────────

  private extractClass(
    node: any, fileId: string, parentNodeId: string,
    nodes: EntityNode[], edges: Relationship[], errors: string[],
  ): void {
    const nameNode = this.findChildOfType(node, 'identifier');
    const name = nameNode ? this.nodeText(nameNode) : 'anonymous';
    const id = slugify('class-' + name + '-' + this.fileHash);
    const docstring = this.extractDocstring(node);
    const now = isoTimestamp();

    nodes.push({
      id: id, name: name, details: docstring || 'class ' + name,
      type: 'code' as const, category: 'class', language: 'dart' as const,
      file_path: this.filePath,
      start_line: node.startPosition.row + 1, end_line: node.endPosition.row + 1,
      hash: computeHash(name + this.filePath),
      source: this.source, source_version: this.sourceVersion,
      valid_from: now, valid_to: null, version: 1,
      created_at: now, ingested_at: now, updated_at: now,
    });

    edges.push({
      type: 'CONTAINS', source_id: parentNodeId, target_id: id,
      evidence: `${this.filePath}#L${node.startPosition.row + 1}`,
      source: this.source,
    });

    // Walk class body
    const body = this.findChildOfType(node, 'class_body');
    if (body) {
      for (let i = 0; i < body.childCount; i++) {
        const c = body.child(i); if (!c) continue;
        try {
          if (c.type === 'method_signature') {
            this.extractMethod(c, fileId, id, nodes, edges, errors);
          } else if (c.type === 'constructor_signature') {
            this.extractConstructor(c, fileId, id, nodes, edges, errors);
          } else if (c.type === 'declaration') {
            this.extractField(c, id, nodes, edges);
          }
        } catch (e) {
          errors.push(`L${c.startPosition.row + 1 || 0}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  // ── Mixin extraction ────────────────────────────────────────────────────

  private extractMixin(
    node: any, fileId: string, parentNodeId: string,
    nodes: EntityNode[], edges: Relationship[], errors: string[],
  ): void {
    const nameNode = this.findChildOfType(node, 'identifier');
    const name = nameNode ? this.nodeText(nameNode) : 'anonymous';
    const id = slugify('mixin-' + name + '-' + this.fileHash);
    const docstring = this.extractDocstring(node);
    const now = isoTimestamp();

    nodes.push({
      id: id, name: name, details: docstring || 'mixin ' + name,
      type: 'code' as const, category: 'mixin', language: 'dart' as const,
      file_path: this.filePath,
      start_line: node.startPosition.row + 1, end_line: node.endPosition.row + 1,
      hash: computeHash(name + this.filePath),
      source: this.source, source_version: this.sourceVersion,
      valid_from: now, valid_to: null, version: 1,
      created_at: now, ingested_at: now, updated_at: now,
    });

    edges.push({
      type: 'CONTAINS', source_id: parentNodeId, target_id: id,
      evidence: `${this.filePath}#L${node.startPosition.row + 1}`,
      source: this.source,
    });

    const body = this.findChildOfType(node, 'class_body') || this.findChildOfType(node, 'mixin_body');
    if (body) {
      for (let i = 0; i < body.childCount; i++) {
        const c = body.child(i); if (!c) continue;
        try {
          if (c.type === 'method_signature') {
            this.extractMethod(c, fileId, id, nodes, edges, errors);
          } else if (c.type === 'declaration') {
            this.extractField(c, id, nodes, edges);
          }
        } catch (e) {
          errors.push(`L${c.startPosition.row + 1 || 0}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  // ── Extension extraction ────────────────────────────────────────────────

  private extractExtension(
    node: any, fileId: string, parentNodeId: string,
    nodes: EntityNode[], edges: Relationship[], errors: string[],
  ): void {
    const nameNode = this.findChildOfType(node, 'identifier');
    const name = nameNode ? this.nodeText(nameNode) : 'anonymous';
    const id = slugify('extension-' + name + '-' + this.fileHash);
    const docstring = this.extractDocstring(node);
    const now = isoTimestamp();

    nodes.push({
      id: id, name: name, details: docstring || 'extension ' + name,
      type: 'code' as const, category: 'extension', language: 'dart' as const,
      file_path: this.filePath,
      start_line: node.startPosition.row + 1, end_line: node.endPosition.row + 1,
      hash: computeHash(name + this.filePath),
      source: this.source, source_version: this.sourceVersion,
      valid_from: now, valid_to: null, version: 1,
      created_at: now, ingested_at: now, updated_at: now,
    });

    edges.push({
      type: 'CONTAINS', source_id: parentNodeId, target_id: id,
      evidence: `${this.filePath}#L${node.startPosition.row + 1}`,
      source: this.source,
    });

    const body = this.findChildOfType(node, 'class_body');
    if (body) {
      for (let i = 0; i < body.childCount; i++) {
        const c = body.child(i); if (!c) continue;
        try {
          if (c.type === 'method_signature') {
            this.extractMethod(c, fileId, id, nodes, edges, errors);
          } else if (c.type === 'declaration') {
            this.extractField(c, id, nodes, edges);
          }
        } catch (e) {
          errors.push(`L${c.startPosition.row + 1 || 0}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  // ── Enum extraction ─────────────────────────────────────────────────────

  private extractEnum(
    node: any, fileId: string, parentNodeId: string,
    nodes: EntityNode[], edges: Relationship[], errors: string[],
  ): void {
    const nameNode = this.findChildOfType(node, 'identifier');
    const name = nameNode ? this.nodeText(nameNode) : 'anonymous_enum';
    const id = slugify('enum-' + name + '-' + this.fileHash);
    const docstring = this.extractDocstring(node);
    const now = isoTimestamp();

    nodes.push({
      id: id, name: name, details: docstring || 'enum ' + name,
      type: 'code' as const, category: 'enum', language: 'dart' as const,
      file_path: this.filePath,
      start_line: node.startPosition.row + 1, end_line: node.endPosition.row + 1,
      hash: computeHash(name + this.filePath),
      source: this.source, source_version: this.sourceVersion,
      valid_from: now, valid_to: null, version: 1,
      created_at: now, ingested_at: now, updated_at: now,
    });

    edges.push({
      type: 'CONTAINS', source_id: parentNodeId, target_id: id,
      evidence: `${this.filePath}#L${node.startPosition.row + 1}`,
      source: this.source,
    });

    const body = this.findChildOfType(node, 'enum_body');
    if (body) {
      for (let i = 0; i < body.childCount; i++) {
        const c = body.child(i);
        if (!c || c.type !== 'enum_constant') continue;
        const enNameNode = this.findChildOfType(c, 'identifier');
        const enName = enNameNode ? this.nodeText(enNameNode) : '?';
        const enId = slugify('enumerator-' + enName + '-' + this.fileHash);
        nodes.push({
          id: enId, name: enName, details: 'enumerator of ' + name,
          type: 'code' as const, category: 'enumerator', language: 'dart' as const,
          file_path: this.filePath,
          start_line: c.startPosition.row + 1, end_line: c.endPosition.row + 1,
          hash: computeHash(enName),
          source: this.source, source_version: this.sourceVersion,
          valid_from: now, valid_to: null, version: 1,
          created_at: now, ingested_at: now, updated_at: now,
        });
        edges.push({
          type: 'CONTAINS', source_id: id, target_id: enId,
          evidence: `${this.filePath}#L${c.startPosition.row + 1}`,
          source: this.source,
        });
      }
    }
  }

  // ── Method extraction ───────────────────────────────────────────────────

  private extractMethod(
    node: any, fileId: string, parentNodeId: string,
    nodes: EntityNode[], edges: Relationship[], errors: string[],
  ): void {
    const funcSig = this.findChildOfType(node, 'function_signature') || node;
    const nameNode = this.findChildOfType(funcSig, 'identifier');
    const name = nameNode ? this.nodeText(nameNode) : 'anonymous';
    const isStatic = this.findChildOfType(node, 'static') !== null;

    const params = this.extractFormalParams(funcSig);
    const returnType = this.extractReturnType(funcSig);
    const sig = (isStatic ? 'static ' : '') + this.buildSig(name, params, returnType);
    const docstring = this.extractDocstring(node);
    const id = slugify('method-' + name + '-' + this.fileHash);
    const now = isoTimestamp();

    nodes.push({
      id: id, name: name, details: docstring || sig,
      type: 'code' as const, category: 'method', language: 'dart' as const,
      file_path: this.filePath, signature: sig,
      start_line: node.startPosition.row + 1, end_line: this.getEndLine(node),
      hash: computeHash(sig),
      source: this.source, source_version: this.sourceVersion,
      valid_from: now, valid_to: null, version: 1,
      created_at: now, ingested_at: now, updated_at: now,
    });

    edges.push({
      type: 'CONTAINS', source_id: parentNodeId, target_id: id,
      evidence: `${this.filePath}#L${node.startPosition.row + 1}`,
      source: this.source,
    });

    this.extractParamsFromFunc(funcSig, id, nodes, edges);
  }

  // ── Constructor extraction ──────────────────────────────────────────────

  private extractConstructor(
    node: any, fileId: string, parentNodeId: string,
    nodes: EntityNode[], edges: Relationship[], errors: string[],
  ): void {
    const nameNode = this.findChildOfType(node, 'identifier');
    const name = nameNode ? this.nodeText(nameNode) : '';
    const docstring = this.extractDocstring(node);
    const params = this.extractConstructorParams(node);
    const sig = name + '(' + params.join(', ') + ')';
    const id = slugify('constructor-' + name + '-' + this.fileHash);
    const now = isoTimestamp();

    nodes.push({
      id: id, name: name, details: docstring || 'Constructor',
      type: 'code' as const, category: 'constructor', language: 'dart' as const,
      file_path: this.filePath, signature: sig,
      start_line: node.startPosition.row + 1, end_line: node.endPosition.row + 1,
      hash: computeHash(sig),
      source: this.source, source_version: this.sourceVersion,
      valid_from: now, valid_to: null, version: 1,
      created_at: now, ingested_at: now, updated_at: now,
    });

    edges.push({
      type: 'CONTAINS', source_id: parentNodeId, target_id: id,
      evidence: `${this.filePath}#L${node.startPosition.row + 1}`,
      source: this.source,
    });

    const paramList = this.findChildOfType(node, 'formal_parameter_list');
    if (paramList) this.extractParamsAsChildren(paramList, id, nodes, edges);
  }

  // ── Top-level function ──────────────────────────────────────────────────

  private extractTopLevelFunction(
    node: any, fileId: string, parentNodeId: string,
    nodes: EntityNode[], edges: Relationship[], errors: string[],
  ): void {
    const nameNode = this.findChildOfType(node, 'identifier');
    const name = nameNode ? this.nodeText(nameNode) : 'anonymous';
    if (!nameNode) return;

    const params = this.extractFormalParams(node);
    const returnType = this.extractReturnType(node);
    const sig = this.buildSig(name, params, returnType);
    const docstring = this.extractDocstring(node);
    const id = slugify('func-' + name + '-' + this.fileHash);
    const now = isoTimestamp();

    nodes.push({
      id: id, name: name, details: docstring || sig,
      type: 'code' as const, category: 'function', language: 'dart' as const,
      file_path: this.filePath, signature: sig,
      start_line: node.startPosition.row + 1,
      end_line: this.getEndLine(node),
      hash: computeHash(sig),
      source: this.source, source_version: this.sourceVersion,
      valid_from: now, valid_to: null, version: 1,
      created_at: now, ingested_at: now, updated_at: now,
    });

    edges.push({
      type: 'CONTAINS', source_id: parentNodeId, target_id: id,
      evidence: `${this.filePath}#L${node.startPosition.row + 1}`,
      source: this.source,
    });

    this.extractParamsFromFunc(node, id, nodes, edges);
  }

  // ── Top-level declaration (variables, typedefs) ─────────────────────────

  private extractTopLevelDeclaration(
    node: any, fileId: string, parentNodeId: string,
    nodes: EntityNode[], edges: Relationship[], errors: string[],
  ): void {
    const docstring = this.extractDocstring(node);
    const identifiers = this.collectIdentifiers(node);
    const now = isoTimestamp();

    for (const name of identifiers) {
      const id = slugify('var-' + name + '-' + this.fileHash);
      nodes.push({
        id: id, name: name, details: docstring || 'top-level variable',
        type: 'code' as const, category: 'variable', language: 'dart' as const,
        file_path: this.filePath,
        start_line: node.startPosition.row + 1, end_line: node.endPosition.row + 1,
        hash: computeHash(name),
        source: this.source, source_version: this.sourceVersion,
        valid_from: now, valid_to: null, version: 1,
        created_at: now, ingested_at: now, updated_at: now,
      });
      edges.push({
        type: 'CONTAINS', source_id: parentNodeId, target_id: id,
        evidence: `${this.filePath}#L${node.startPosition.row + 1}`,
        source: this.source,
      });
    }
  }

  // ── Field extraction ────────────────────────────────────────────────────

  private extractField(node: any, parentId: string, nodes: EntityNode[], edges: Relationship[]): void {
    const identifiers = this.collectIdentifiers(node);
    const now = isoTimestamp();
    for (const name of identifiers) {
      const id = slugify('field-' + name + '-' + this.fileHash);
      nodes.push({
        id: id, name: name, details: 'Field',
        type: 'code' as const, category: 'field', language: 'dart' as const,
        file_path: this.filePath,
        start_line: node.startPosition.row + 1, end_line: node.endPosition.row + 1,
        hash: computeHash(name),
        source: this.source, source_version: this.sourceVersion,
        valid_from: now, valid_to: null, version: 1,
        created_at: now, ingested_at: now, updated_at: now,
      });
      edges.push({
        type: 'CONTAINS', source_id: parentId, target_id: id,
        evidence: `${this.filePath}#L${node.startPosition.row + 1}`,
        source: this.source,
      });
    }
  }

  // ── Parameter extraction ────────────────────────────────────────────────

  private extractParamsFromFunc(funcSig: any, parentId: string, nodes: EntityNode[], edges: Relationship[]): void {
    const paramList = this.findChildOfType(funcSig, 'formal_parameter_list');
    if (paramList) this.extractParamsAsChildren(paramList, parentId, nodes, edges);
  }

  private extractParamsAsChildren(paramList: any, parentId: string, nodes: EntityNode[], edges: Relationship[]): void {
    for (let i = 0; i < paramList.childCount; i++) {
      const param = paramList.child(i);
      if (!param || param.type !== 'formal_parameter') continue;
      const nameNode = this.findChildOfType(param, 'identifier');
      const name = nameNode ? this.nodeText(nameNode) : null;
      if (!name) continue;

      const id = slugify('param-' + name + '-' + parentId);
      const now = isoTimestamp();

      nodes.push({
        id: id, name: name, details: 'Parameter',
        type: 'code' as const, category: 'parameter', language: 'dart' as const,
        file_path: this.filePath,
        start_line: param.startPosition.row + 1, end_line: param.endPosition.row + 1,
        hash: computeHash(name),
        source: this.source, source_version: this.sourceVersion,
        valid_from: now, valid_to: null, version: 1,
        created_at: now, ingested_at: now, updated_at: now,
      });
      edges.push({
        type: 'CONTAINS', source_id: parentId, target_id: id,
        evidence: `${this.filePath}#L${param.startPosition.row + 1}`,
        source: this.source,
      });
    }
  }

  private extractConstructorParams(node: any): string[] {
    const out: string[] = [];
    const pl = this.findChildOfType(node, 'formal_parameter_list');
    if (!pl) return out;
    for (let i = 0; i < pl.childCount; i++) {
      const c = pl.child(i);
      if (c && c.type === 'formal_parameter') out.push(this.nodeText(c).trim());
    }
    return out;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private extractFormalParams(funcSig: any): string[] {
    const out: string[] = [];
    const pl = this.findChildOfType(funcSig, 'formal_parameter_list');
    if (!pl) return out;
    for (let i = 0; i < pl.childCount; i++) {
      const c = pl.child(i);
      if (c && c.type === 'formal_parameter') out.push(this.nodeText(c).trim());
    }
    return out;
  }

  private extractReturnType(funcSig: any): string {
    const ti = this.findChildOfType(funcSig, 'type_identifier');
    return ti ? this.nodeText(ti).trim() : '';
  }

  private buildSig(name: string, params: string[], returnType: string): string {
    return (returnType ? returnType + ' ' : '') + name + '(' + params.join(', ') + ')';
  }

  private getEndLine(node: any): number {
    if (node.endPosition) return node.endPosition.row + 1;
    let n = node.parent?.nextSibling;
    while (n) {
      if (n.type === 'function_body') return n.endPosition.row + 1;
      n = n.nextSibling;
    }
    return node.endPosition?.row + 1 || node.startPosition.row + 1;
  }

  private extractDocstring(node: any): string {
    const comments: string[] = [];
    let prev = node.previousSibling;
    while (prev) {
      if (prev.type === 'documentation_comment') {
        comments.unshift(this.extractCommentText(prev));
      } else if (prev.type === 'comment') {
        comments.unshift(this.extractCommentText(prev));
      } else if (comments.length > 0) {
        break;
      }
      prev = prev.previousSibling;
    }
    return comments.join('\n');
  }

  private extractCommentText(node: any): string {
    return this.nodeText(node).replace(/^\/\*+/, '').replace(/\*+\/$/, '').replace(/^\/\/\//gm, '').replace(/^\/\//gm, '')
      .split('\n').map((l: string) => l.replace(/^\s*\*?\s*\/?\/?\/?\s*/, '').trim()).join('\n').trim();
  }

  private nodeText(node: any): string { return this.fileContent.substring(node.startIndex, node.endIndex); }
  private nodeContents(node: any): boolean { return node.startIndex !== node.endIndex; }

  private findChildOfType(node: any, type: string): any {
    for (let i = 0; i < node.childCount; i++) { const c = node.child(i); if (c && c.type === type) return c; }
    return null;
  }

  private collectIdentifiers(node: any): string[] {
    const names: string[] = [];
    // Handle initialized_identifier_list
    const iil = this.findChildOfType(node, 'initialized_identifier_list');
    if (iil) {
      for (let i = 0; i < iil.childCount; i++) {
        const c = iil.child(i);
        if (!c) continue;
        const id = this.findChildOfType(c, 'identifier');
        if (id) names.push(this.nodeText(id));
      }
    }
    // Handle static_final_declaration_list
    const sfdl = this.findChildOfType(node, 'static_final_declaration_list');
    if (sfdl) {
      for (let i = 0; i < sfdl.childCount; i++) {
        const c = sfdl.child(i);
        if (!c) continue;
        const id = this.findChildOfType(c, 'identifier');
        if (id) names.push(this.nodeText(id));
      }
    }
    // Direct identifiers
    if (names.length === 0) {
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i); if (!c) continue;
        if (c.type === 'identifier') names.push(this.nodeText(c));
      }
    }
    return names;
  }

  private createFileNode(): EntityNode {
    const now = isoTimestamp();
    return {
      id: slugify('file-' + this.filePath),
      name: path.basename(this.filePath),
      details: 'Dart file: ' + this.filePath,
      type: 'code' as const,
      language: 'dart' as const,
      file_path: this.filePath, hash: this.fileHash,
      source: this.source, source_version: this.sourceVersion,
      valid_from: now, valid_to: null, version: 1,
      created_at: now, ingested_at: now, updated_at: now,
    };
  }

  private findDeepStringLiteral(node: any): any {
    return this.findDeep(node, "string_literal");
  }

  private findDeep(node: any, type: string): any {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (!c) continue;
      if (c.type === type) return c;
      const found = this.findDeep(c, type);
      if (found) return found;
    }
    return null;
  }
}
