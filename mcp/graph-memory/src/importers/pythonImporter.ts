import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
// Python file importer using web-tree-sitter
import { EntityNode, Relationship, ImportResult } from '../types/import.js';
import { isoTimestamp, slugify, computeHash } from '../utils/helpers.js';

let ParserClass: any = null;
let LanguageClass: any = null;
let PythonLanguage: any = null;
let initPromise: Promise<void> | null = null;

async function ensureInit(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const wts = await import('web-tree-sitter');
    ParserClass = wts.Parser;
    LanguageClass = wts.Language;
    await ParserClass.init();
  })();
  return initPromise;
}

import { fileURLToPath } from 'url';

function getPythonWasmPath(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.join(__dirname, '..', '..', 'node_modules', 'tree-sitter-python', 'tree-sitter-python.wasm');
}

export class PythonImporter {
  private filePath: string;
  private source: string;
  private sourceVersion: string;
  private fileHash: string;
  private fileContent: string;
  private parser: any;

  constructor(
    filePath: string,
    source: string = 'python_ast',
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
  ): Promise<PythonImporter> {
    await ensureInit();
    if (!PythonLanguage) {
      const wasmPath = getPythonWasmPath();
      const wasmData = fs.readFileSync(wasmPath);
      PythonLanguage = await LanguageClass.load(wasmData);
    }
    const importer = new PythonImporter(filePath, source, sourceVersion);
    importer.parser.setLanguage(PythonLanguage);
    return importer;
  }

  importFile(): ImportResult {
    const nodes: EntityNode[] = [];
    const edges: Relationship[] = [];
    const errors: string[] = [];

    try {
      const tree = this.parser.parse(this.fileContent);
      const root = tree.rootNode;

      const fileNode = this.createFileNode();
      nodes.push(fileNode);

      this.walkNode(root, fileNode.id, nodes, edges, errors);

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
        summary: 'Extracted ' + (nodes.length - 1) + ' entities from ' + path.basename(this.filePath),
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

  private walkNode(
    node: any,
    fileId: string,
    nodes: EntityNode[],
    edges: Relationship[],
    errors: string[],
  ): void {
    try {
      if (node.type === 'function_definition') {
        const [funcNode] = this.extractFunction(node, fileId);
        nodes.push(funcNode);
        edges.push({
          type: 'DEFINED_IN',
          source_id: funcNode.id,
          target_id: fileId,
          evidence: this.filePath + '#L' + (node.startPosition.row + 1),
          source: this.source,
        });
        return;
      }

      if (node.type === 'class_definition') {
        const [classNode, classEdges] = this.extractClass(node, fileId, nodes);
        nodes.push(classNode);
        edges.push({
          type: 'DEFINED_IN',
          source_id: classNode.id,
          target_id: fileId,
          evidence: this.filePath + '#L' + (node.startPosition.row + 1),
          source: this.source,
        });
        edges.push(...classEdges);
        return;
      }

      if (node.type === 'import_statement' || node.type === 'import_from_statement') {
        const importEdges = this.extractImport(node, fileId);
        edges.push(...importEdges);
        return;
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          this.walkNode(child, fileId, nodes, edges, errors);
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push('Error at line ' + (node.startPosition.row + 1) + ': ' + msg);
    }
  }

  private extractFunction(node: any, fileId: string): [EntityNode, Relationship[]] {
    const now = isoTimestamp();
    const name = this.nodeText(node, 'name') || 'anonymous';
    const paramsNode = node.childForFieldName('parameters');
    const params = paramsNode ? this.extractParameterNames(paramsNode) : [];
    const bodyNode = node.childForFieldName('body');
    let bodyText = '';
    if (bodyNode) bodyText = this.nodeText(bodyNode);
    const bodyPreview = bodyText.length > 200 ? bodyText.substring(0, 200) + '...' : bodyText;
    const docstring = this.extractDocstring(bodyNode);
    const nodeId = slugify(this.filePath + '::' + name);
    const signature = name + '(' + params.join(', ') + ')';
    const contentHash = computeHash(nodeId + ':' + signature + ':' + bodyText);
    const entityNode: EntityNode = {
      id: nodeId, name: name, details: docstring, type: 'code', language: 'python',
      file_path: this.filePath, signature: signature, body_preview: bodyPreview,
      start_line: node.startPosition.row + 1, end_line: node.endPosition.row + 1,
      hash: contentHash, source: this.source, source_version: this.sourceVersion,
      valid_from: now, valid_to: null, version: 1,
      created_at: now, ingested_at: now, updated_at: now,
    };
    return [entityNode, []];
  }

  private extractClass(node: any, fileId: string, nodes: EntityNode[]): [EntityNode, Relationship[]] {
    const now = isoTimestamp();
    const name = this.nodeText(node, 'name') || 'anonymous';
    const bodyNode = node.childForFieldName('body');
    const docstring = this.extractDocstring(bodyNode);
    const nodeId = slugify(this.filePath + '::' + name);
    const contentHash = computeHash(nodeId + ':' + name);
    const classNode: EntityNode = {
      id: nodeId, name: name, details: docstring, type: 'code', language: 'python',
      file_path: this.filePath, start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1, hash: contentHash,
      source: this.source, source_version: this.sourceVersion,
      valid_from: now, valid_to: null, version: 1,
      created_at: now, ingested_at: now, updated_at: now,
    };
    const classEdges: Relationship[] = [];
    if (bodyNode) {
      for (let i = 0; i < bodyNode.childCount; i++) {
        const child = bodyNode.child(i);
        if (child && child.type === 'function_definition') {
          const [methodNode] = this.extractMethod(child, name, fileId);
          nodes.push(methodNode);
          classEdges.push({ type: 'CONTAINS', source_id: nodeId, target_id: methodNode.id,
            evidence: this.filePath + '#L' + (child.startPosition.row + 1), source: this.source });
        }
      }
    }
    return [classNode, classEdges];
  }

  private extractMethod(node: any, className: string, fileId: string): [EntityNode, Relationship[]] {
    const now = isoTimestamp();
    const name = this.nodeText(node, 'name') || 'anonymous';
    const fullName = className + '.' + name;
    const paramsNode = node.childForFieldName('parameters');
    const params = paramsNode ? this.extractParameterNames(paramsNode) : [];
    const bodyNode = node.childForFieldName('body');
    let bodyText = '';
    if (bodyNode) bodyText = this.nodeText(bodyNode);
    const bodyPreview = bodyText.length > 200 ? bodyText.substring(0, 200) + '...' : bodyText;
    const docstring = this.extractDocstring(bodyNode);
    const nodeId = slugify(this.filePath + '::' + fullName);
    const signature = fullName + '(' + params.join(', ') + ')';
    const contentHash = computeHash(nodeId + ':' + signature + ':' + bodyText);
    const entityNode: EntityNode = {
      id: nodeId, name: fullName, details: docstring, type: 'code', language: 'python',
      file_path: this.filePath, signature: signature, body_preview: bodyPreview,
      start_line: node.startPosition.row + 1, end_line: node.endPosition.row + 1,
      hash: contentHash, source: this.source, source_version: this.sourceVersion,
      valid_from: now, valid_to: null, version: 1,
      created_at: now, ingested_at: now, updated_at: now,
    };
    return [entityNode, []];
  }

  private extractImport(node: any, fileId: string): Relationship[] {
    const edges: Relationship[] = [];
    if (node.type === 'import_statement') {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child && child.type === 'dotted_name') {
          const moduleName = this.nodeText(child);
          edges.push({
            type: 'IMPORTS', source_id: fileId, target_id: slugify('module-' + moduleName),
            evidence: this.filePath + '#L' + (node.startPosition.row + 1), source: this.source,
          });
        }
      }
    }
    if (node.type === 'import_from_statement') {
      const moduleNode = node.childForFieldName('module');
      const moduleName = moduleNode ? this.nodeText(moduleNode) : '';
      const namesNode = node.childForFieldName('names');
      if (namesNode) {
        this.collectDottedNames(namesNode).forEach((alias: string) => {
          const fullName = moduleName ? moduleName + '.' + alias : alias;
          edges.push({
            type: 'IMPORTS', source_id: fileId, target_id: slugify('module-' + fullName),
            evidence: this.filePath + '#L' + (node.startPosition.row + 1), source: this.source,
          });
        });
      }
    }
    return edges;
  }

  private collectDottedNames(node: any): string[] {
    const names: string[] = [];
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        if (child.type === 'dotted_name') { names.push(this.nodeText(child)); }
        else if (child.type === 'aliased_import') {
          const n = child.childForFieldName('name');
          if (n) names.push(this.nodeText(n));
        } else if (child.childCount > 0) { names.push(...this.collectDottedNames(child)); }
      }
    }
    return names;
  }

  private extractParameterNames(paramsNode: any): string[] {
    const names: string[] = [];
    for (let i = 0; i < paramsNode.childCount; i++) {
      const child = paramsNode.child(i);
      if (child) {
        if (child.type === 'identifier') names.push(this.nodeText(child));
        else if (child.type === 'typed_parameter' || child.type === 'default_parameter') {
          const n = child.childForFieldName('name');
          if (n) names.push(this.nodeText(n));
        } else if (child.type === 'list_splat_pattern' || child.type === 'dictionary_splat_pattern') {
          const inner = child.child(0);
          if (inner && inner.type === 'identifier') names.push(this.nodeText(inner));
        }
      }
    }
    return names;
  }

  private extractDocstring(bodyNode: any): string {
    if (!bodyNode) return '';
    for (let i = 0; i < bodyNode.childCount; i++) {
      const child = bodyNode.child(i);
      if (child && child.type === 'expression_statement') {
        const expr = child.child(0);
        if (expr && (expr.type === 'string' || expr.type === 'fstring')) {
          let ds = this.nodeText(expr);
          ds = ds.replace(/^"""|^'''|^"|^'/, '').replace(/"""$|'''$|"$|'$/, '');
          return ds.trim();
        }
      }
      if (child && child.type === 'string') {
        let ds = this.nodeText(child);
        ds = ds.replace(/^"""|^'''|^"|^'/, '').replace(/"""$|'''$|"$|'$/, '');
        return ds.trim();
      }
    }
    return '';
  }

  private nodeText(node: any, fieldName?: string): string {
    if (fieldName) {
      const child = node.childForFieldName(fieldName);
      return child ? this.fileContent.substring(child.startIndex, child.endIndex) : '';
    }
    return this.fileContent.substring(node.startIndex, node.endIndex);
  }

  private createFileNode(): EntityNode {
    const now = isoTimestamp();
    return {
      id: slugify('file-' + this.filePath),
      name: path.basename(this.filePath),
      details: 'Python file: ' + this.filePath,
      type: 'code', language: 'python', file_path: this.filePath,
      hash: this.fileHash, source: this.source, source_version: this.sourceVersion,
      valid_from: now, valid_to: null, version: 1,
      created_at: now, ingested_at: now, updated_at: now,
    };
  }
}
