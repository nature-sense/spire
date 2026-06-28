import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';
import { EntityNode, Relationship, ImportResult } from '../types/import.js';
import { isoTimestamp, slugify, computeHash } from '../utils/helpers.js';
import { ensureTreeSitterInit } from '../utils/treeSitterInit.js';

// ---------------------------------------------------------------------------
// Cached WASM language — loaded once, shared across all CppImporter instances
// ---------------------------------------------------------------------------

let CppLanguage: any = null;

function getCppWasmPath(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.join(
    __dirname, '..', '..', 'node_modules', 'tree-sitter-cpp', 'tree-sitter-cpp.wasm',
  );
}

// ---------------------------------------------------------------------------
// Module-level parser class holder (set via shared ensureTreeSitterInit)
// ---------------------------------------------------------------------------

let ParserClass: any = null;
let parserInitPromise: Promise<void> | null = null;

// ---------------------------------------------------------------------------
// CppImporter
// ---------------------------------------------------------------------------

export class CppImporter {
  private filePath: string;
  private source: string;
  private sourceVersion: string;
  private fileHash: string;
  private fileContent: string;
  private parser: any;

  constructor(
    filePath: string,
    source: string = 'cpp_ast',
    sourceVersion: string = '1.0.0',
  ) {
    this.filePath = path.resolve(filePath);
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
    source?: string,
    sourceVersion?: string,
  ): Promise<CppImporter> {
    if (!parserInitPromise) {
      parserInitPromise = (async () => {
        const { Parser, Language } = await ensureTreeSitterInit();
        ParserClass = Parser;
        if (!CppLanguage) {
          const wasmPath = getCppWasmPath();
          const wasmData = fs.readFileSync(wasmPath);
          CppLanguage = await Language.load(wasmData);
        }
      })();
    }
    await parserInitPromise;

    const importer = new CppImporter(filePath, source, sourceVersion);
    importer.parser.setLanguage(CppLanguage);
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

      this.walkTranslationUnit(root, fileNode.id, nodes, edges, errors);

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

  // ── Root walker ─────────────────────────────────────────────────────────

  private walkTranslationUnit(
    node: any,
    fileId: string,
    nodes: EntityNode[],
    edges: Relationship[],
    errors: string[],
  ): void {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;
      try {
        this.walkTopLevelDecl(child, fileId, null, nodes, edges, errors);
      } catch (e) {
        errors.push(
          `L${child.startPosition?.row + 1 || 0}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  // ── Top-level and nested declarations ───────────────────────────────────

  private walkTopLevelDecl(
    node: any,
    fileId: string,
    parentId: string | null,
    nodes: EntityNode[],
    edges: Relationship[],
    errors: string[],
  ): void {
    const type = node.type;
    const parentNodeId = parentId || fileId;

    switch (type) {
      case 'function_definition':
        this.extractFunction(node, fileId, parentNodeId, nodes, edges, errors);
        break;

      case 'declaration': {
        const declarator = this.findChildOfType(node, 'function_declarator');
        if (declarator) {
          this.extractFunctionDeclaration(node, declarator, fileId, parentNodeId, nodes, edges, errors);
        }
        break;
      }

      case 'template_declaration':
        this.extractTemplate(node, fileId, parentNodeId, nodes, edges, errors);
        break;

      case 'class_specifier':
      case 'struct_specifier':
        this.extractClassOrStruct(node, type, fileId, parentNodeId, nodes, edges, errors);
        break;

      case 'enum_specifier':
        this.extractEnum(node, fileId, parentNodeId, nodes, edges, errors);
        break;

      case 'namespace_definition':
        this.extractNamespace(node, fileId, parentNodeId, nodes, edges, errors);
        break;

      case 'preproc_include':
        this.extractInclude(node, fileId, edges);
        break;

      default:
        if (this.nodeContents(node)) {
          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child) {
              this.walkTopLevelDecl(child, fileId, parentNodeId, nodes, edges, errors);
            }
          }
        }
        break;
    }
  }



  // ── Function extraction ─────────────────────────────────────────────────

  private extractFunction(
    node: any,
    fileId: string,
    parentNodeId: string,
    nodes: EntityNode[],
    edges: Relationship[],
    errors: string[],
  ): void {
    const decl = this.findChildOfType(node, 'function_declarator') || this.findChildOfType(node, 'declarator');
    if (!decl) return;

    const name = this.extractDeclaratorName(decl);
    if (!name) return;

    const params = this.extractFunctionParams(decl);
    const returnType = this.extractReturnType(node);
    const signature = this.buildSignature(name, params, returnType);
    const docstring = this.extractDocstring(node);

    const id = slugify('func-' + name + '-' + this.fileHash);
    const now = isoTimestamp();
    const funcNode: EntityNode = {
      id: id, name: name, details: docstring || signature,
      type: 'code' as const, category: 'function', language: 'cpp' as const,
      file_path: this.filePath, signature: signature,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      hash: computeHash(signature),
      source: this.source, source_version: this.sourceVersion,
      valid_from: now, valid_to: null, version: 1,
      created_at: now, ingested_at: now, updated_at: now,
    };

    nodes.push(funcNode);
    edges.push({
      type: 'CONTAINS', source_id: parentNodeId, target_id: id,
      evidence: `${this.filePath}#L${node.startPosition.row + 1}`,
      source: this.source,
    });

    this.extractParamsAsChildren(decl, id, nodes, edges);
  }

  private extractFunctionDeclaration(
    declNode: any,
    declarator: any,
    fileId: string,
    parentNodeId: string,
    nodes: EntityNode[],
    edges: Relationship[],
    errors: string[],
  ): void {
    const name = this.extractDeclaratorName(declarator);
    if (!name) return;

    const params = this.extractFunctionParams(declarator);
    const returnType = this.extractReturnType(declNode);
    const signature = this.buildSignature(name, params, returnType);
    const id = slugify('decl-' + name + '-' + this.fileHash);
    const now = isoTimestamp();

    nodes.push({
      id: id, name: name, details: signature,
      type: 'code' as const, category: 'function_declaration', language: 'cpp' as const,
      file_path: this.filePath, signature: signature,
      start_line: declNode.startPosition.row + 1,
      end_line: declNode.endPosition.row + 1,
      hash: computeHash(signature),
      source: this.source, source_version: this.sourceVersion,
      valid_from: now, valid_to: null, version: 1,
      created_at: now, ingested_at: now, updated_at: now,
    });

    edges.push({
      type: 'CONTAINS', source_id: parentNodeId, target_id: id,
      evidence: `${this.filePath}#L${declNode.startPosition.row + 1}`,
      source: this.source,
    });
  }



  // ── Class / struct extraction ───────────────────────────────────────────

  private extractClassOrStruct(
    node: any,
    specType: string,
    fileId: string,
    parentNodeId: string,
    nodes: EntityNode[],
    edges: Relationship[],
    errors: string[],
  ): void {
    const nameNode = this.findChildOfType(node, 'type_identifier') ||
      this.findChildOfType(node, 'identifier');
    const name = nameNode ? this.nodeText(nameNode) : 'anonymous';

    const category = specType === 'class_specifier' ? 'class' : 'struct';
    const id = slugify(category + '-' + name + '-' + this.fileHash);
    const docstring = this.extractDocstring(node);
    const body = this.findChildOfType(node, 'field_declaration_list') || this.findChildOfType(node, 'body');
    const now = isoTimestamp();

    nodes.push({
      id: id, name: name, details: docstring || (category + ' ' + name),
      type: 'code' as const, category: category, language: 'cpp' as const,
      file_path: this.filePath,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
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

    if (body) {
      for (let i = 0; i < body.childCount; i++) {
        const child = body.child(i);
        if (!child) continue;
        try {
          if (child.type === 'function_definition' || child.type === 'declaration') {
            this.walkTopLevelDecl(child, fileId, id, nodes, edges, errors);
          } else if (child.type === 'template_declaration') {
            this.extractTemplate(child, fileId, id, nodes, edges, errors);
          } else if (child.type === 'class_specifier' || child.type === 'struct_specifier') {
            this.extractClassOrStruct(child, child.type, fileId, id, nodes, edges, errors);
          } else if (child.type === 'field_declaration') {
            this.extractField(child, id, nodes, edges);
          }
        } catch (e) {
          errors.push(`L${child.startPosition.row + 1 || 0}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  // ── Field extraction ────────────────────────────────────────────────────

  private extractField(node: any, parentId: string, nodes: EntityNode[], edges: Relationship[]): void {
    const identifiers = this.collectIdentifiers(node);
    const now = isoTimestamp();
    for (const name of identifiers) {
      const fieldId = slugify('field-' + name + '-' + this.fileHash);
      nodes.push({
        id: fieldId, name: name, details: 'Field in ' + parentId,
        type: 'code' as const, category: 'field', language: 'cpp' as const,
        file_path: this.filePath,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        hash: computeHash(name),
        source: this.source, source_version: this.sourceVersion,
        valid_from: now, valid_to: null, version: 1,
        created_at: now, ingested_at: now, updated_at: now,
      });
      edges.push({
        type: 'CONTAINS', source_id: parentId, target_id: fieldId,
        evidence: `${this.filePath}#L${node.startPosition.row + 1}`,
        source: this.source,
      });
    }
  }

  // ── Enum extraction ─────────────────────────────────────────────────────

  private extractEnum(
    node: any,
    fileId: string,
    parentNodeId: string,
    nodes: EntityNode[],
    edges: Relationship[],
    errors: string[],
  ): void {
    const nameNode = this.findChildOfType(node, 'type_identifier') || this.findChildOfType(node, 'identifier');
    const name = nameNode ? this.nodeText(nameNode) : 'anonymous_enum';
    const id = slugify('enum-' + name + '-' + this.fileHash);
    const now = isoTimestamp();

    nodes.push({
      id: id, name: name, details: 'enum ' + name,
      type: 'code' as const, category: 'enum', language: 'cpp' as const,
      file_path: this.filePath,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
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

    const enumeratorList = this.findChildOfType(node, 'enumerator_list');
    if (enumeratorList) {
      for (let i = 0; i < enumeratorList.childCount; i++) {
        const child = enumeratorList.child(i);
        if (!child || child.type !== 'enumerator') continue;
        const enName = this.nodeText(this.findFirstIdentifier(child) || child);
        const enId = slugify('enumerator-' + enName + '-' + this.fileHash);
        nodes.push({
          id: enId, name: enName, details: 'enumerator of ' + name,
          type: 'code' as const, category: 'enumerator', language: 'cpp' as const,
          file_path: this.filePath,
          start_line: child.startPosition.row + 1,
          end_line: child.endPosition.row + 1,
          hash: computeHash(enName),
          source: this.source, source_version: this.sourceVersion,
          valid_from: now, valid_to: null, version: 1,
          created_at: now, ingested_at: now, updated_at: now,
        });
        edges.push({
          type: 'CONTAINS', source_id: id, target_id: enId,
          evidence: `${this.filePath}#L${child.startPosition.row + 1}`,
          source: this.source,
        });
      }
    }
  }



  // ── Namespace extraction ────────────────────────────────────────────────

  private extractNamespace(
    node: any,
    fileId: string,
    parentNodeId: string,
    nodes: EntityNode[],
    edges: Relationship[],
    errors: string[],
  ): void {
    const nameNode = this.findChildOfType(node, 'namespace_identifier') || this.findChildOfType(node, 'identifier');
    const name = nameNode ? this.nodeText(nameNode) : 'anonymous';
    const id = slugify('ns-' + name + '-' + this.fileHash);
    const now = isoTimestamp();

    nodes.push({
      id: id, name: name, details: 'namespace ' + name,
      type: 'code' as const, category: 'namespace', language: 'cpp' as const,
      file_path: this.filePath,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
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

    const body = this.findChildOfType(node, 'declaration_list') || this.findChildOfType(node, 'compound_statement');
    if (body) {
      for (let i = 0; i < body.childCount; i++) {
        const child = body.child(i);
        if (!child) continue;
        try {
          this.walkTopLevelDecl(child, fileId, id, nodes, edges, errors);
        } catch (e) {
          errors.push(`L${child.startPosition.row + 1 || 0}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  // ── Include extraction ──────────────────────────────────────────────────

  private extractInclude(node: any, fileId: string, edges: Relationship[]): void {
    const pathNode = this.findChildOfType(node, 'string_literal') ||
      this.findChildOfType(node, 'system_lib_string') ||
      (node.childForFieldName ? node.childForFieldName('path') : null);
    if (!pathNode) return;

    let includePath = this.nodeText(pathNode);
    includePath = includePath.replace(/^["<>]|["<>]$/g, '').trim();
    if (!includePath) return;

    edges.push({
      type: 'IMPORTS', source_id: fileId,
      target_id: slugify('module-' + includePath),
      evidence: `${this.filePath}#L${node.startPosition.row + 1}`,
      source: this.source,
    });
  }



  // ── Template extraction ─────────────────────────────────────────────────

  private extractTemplate(
    node: any,
    fileId: string,
    parentNodeId: string,
    nodes: EntityNode[],
    edges: Relationship[],
    errors: string[],
  ): void {
    const paramsNode = node.childForFieldName ? node.childForFieldName('parameters') : null;
    const templateParams = paramsNode ? this.nodeText(paramsNode) : '';

    const childDecl = this.findAnyChildOfTypes(node, [
      'function_definition', 'declaration', 'class_specifier', 'struct_specifier',
    ]);
    if (!childDecl) return;

    if (childDecl.type === 'function_definition') {
      this.extractTemplateFunc(childDecl, parentNodeId, templateParams, nodes, edges);
    } else if (childDecl.type === 'class_specifier' || childDecl.type === 'struct_specifier') {
      this.extractTemplateClass(childDecl, parentNodeId, templateParams, fileId, nodes, edges, errors);
    } else if (childDecl.type === 'declaration') {
      this.extractTemplateDecl(childDecl, parentNodeId, templateParams, nodes, edges);
    }
  }

  private extractTemplateFunc(
    childDecl: any,
    parentNodeId: string,
    templateParams: string,
    nodes: EntityNode[],
    edges: Relationship[],
  ): void {
    const decl = this.findChildOfType(childDecl, 'function_declarator') || this.findChildOfType(childDecl, 'declarator');
    if (!decl) return;
    const name = this.extractDeclaratorName(decl);
    if (!name) return;

    const params = this.extractFunctionParams(decl);
    const returnType = this.extractReturnType(childDecl);
    const sig = 'template<' + templateParams + '> ' + this.buildSignature(name, params, returnType);
    const id = slugify('template-func-' + name + '-' + this.fileHash);
    const now = isoTimestamp();

    nodes.push({
      id: id, name: name, details: sig,
      type: 'code' as const, category: 'template_function', language: 'cpp' as const,
      file_path: this.filePath, signature: sig,
      start_line: childDecl.startPosition.row + 1,
      end_line: childDecl.endPosition.row + 1,
      hash: computeHash(sig), source: this.source, source_version: this.sourceVersion,
      valid_from: now, valid_to: null, version: 1,
      created_at: now, ingested_at: now, updated_at: now,
    });

    edges.push({
      type: 'CONTAINS', source_id: parentNodeId, target_id: id,
      evidence: `${this.filePath}#L${childDecl.startPosition.row + 1}`,
      source: this.source,
    });
  }

  private extractTemplateClass(
    childDecl: any,
    parentNodeId: string,
    templateParams: string,
    fileId: string,
    nodes: EntityNode[],
    edges: Relationship[],
    errors: string[],
  ): void {
    const nameNode = this.findChildOfType(childDecl, 'type_identifier') || this.findChildOfType(childDecl, 'identifier');
    const name = nameNode ? this.nodeText(nameNode) : 'anonymous';
    const kind = childDecl.type === 'class_specifier' ? 'class' : 'struct';
    const sig = 'template<' + templateParams + '> ' + kind + ' ' + name;
    const id = slugify('template-class-' + name + '-' + this.fileHash);
    const now = isoTimestamp();

    nodes.push({
      id: id, name: name, details: sig,
      type: 'code' as const, category: 'template_class', language: 'cpp' as const,
      file_path: this.filePath, signature: sig,
      start_line: childDecl.startPosition.row + 1,
      end_line: childDecl.endPosition.row + 1,
      hash: computeHash(sig), source: this.source, source_version: this.sourceVersion,
      valid_from: now, valid_to: null, version: 1,
      created_at: now, ingested_at: now, updated_at: now,
    });

    edges.push({
      type: 'CONTAINS', source_id: parentNodeId, target_id: id,
      evidence: `${this.filePath}#L${childDecl.startPosition.row + 1}`,
      source: this.source,
    });

    const classBody = this.findChildOfType(childDecl, 'field_declaration_list') || this.findChildOfType(childDecl, 'body');
    if (classBody) {
      for (let i = 0; i < classBody.childCount; i++) {
        const child = classBody.child(i);
        if (!child) continue;
        try {
          this.walkTopLevelDecl(child, fileId, id, nodes, edges, errors);
        } catch (e) {
          errors.push(`L${child.startPosition.row + 1 || 0}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  private extractTemplateDecl(
    childDecl: any,
    parentNodeId: string,
    templateParams: string,
    nodes: EntityNode[],
    edges: Relationship[],
  ): void {
    const declarator = this.findChildOfType(childDecl, 'function_declarator');
    if (!declarator) return;
    const name = this.extractDeclaratorName(declarator);
    if (!name) return;

    const params = this.extractFunctionParams(declarator);
    const returnType = this.extractReturnType(childDecl);
    const sig = 'template<' + templateParams + '> ' + this.buildSignature(name, params, returnType);
    const id = slugify('template-decl-' + name + '-' + this.fileHash);
    const now = isoTimestamp();

    nodes.push({
      id: id, name: name, details: sig,
      type: 'code' as const, category: 'template_declaration', language: 'cpp' as const,
      file_path: this.filePath, signature: sig,
      start_line: childDecl.startPosition.row + 1,
      end_line: childDecl.endPosition.row + 1,
      hash: computeHash(sig), source: this.source, source_version: this.sourceVersion,
      valid_from: now, valid_to: null, version: 1,
      created_at: now, ingested_at: now, updated_at: now,
    });

    edges.push({
      type: 'CONTAINS', source_id: parentNodeId, target_id: id,
      evidence: `${this.filePath}#L${childDecl.startPosition.row + 1}`,
      source: this.source,
    });
  }



  // ── Parameter extraction ────────────────────────────────────────────────

  private extractParamsAsChildren(decl: any, parentId: string, nodes: EntityNode[], edges: Relationship[]): void {
    const paramList = this.findChildOfType(decl, 'parameter_list') || this.findChildOfType(decl, 'parameters');
    if (!paramList) return;

    for (let i = 0; i < paramList.childCount; i++) {
      const param = paramList.child(i);
      if (!param) continue;

      const name = this.extractParamName(param);
      if (!name) continue;

      const paramId = slugify('param-' + name + '-' + parentId);
      const now = isoTimestamp();

      nodes.push({
        id: paramId, name: name, details: 'Parameter of ' + parentId,
        type: 'code' as const, category: 'parameter', language: 'cpp' as const,
        file_path: this.filePath,
        start_line: param.startPosition.row + 1,
        end_line: param.endPosition.row + 1,
        hash: computeHash(name), source: this.source, source_version: this.sourceVersion,
        valid_from: now, valid_to: null, version: 1,
        created_at: now, ingested_at: now, updated_at: now,
      });

      edges.push({
        type: 'CONTAINS', source_id: parentId, target_id: paramId,
        evidence: `${this.filePath}#L${param.startPosition.row + 1}`,
        source: this.source,
      });
    }
  }

  // ── Helpers (param name / declarator name / func params / return type) ──

  private extractParamName(paramNode: any): string | null {
    const ident = this.findChildOfType(paramNode, 'identifier') || this.findChildOfType(paramNode, 'field_identifier');
    if (ident) return this.nodeText(ident);
    const decl = this.findChildOfType(paramNode, 'declarator');
    if (decl) {
      const nested = this.findChildOfType(decl, 'identifier');
      if (nested) return this.nodeText(nested);
    }
    return null;
  }

  private extractDeclaratorName(decl: any): string | null {
    let current = decl;
    for (let depth = 0; depth < 10; depth++) {
      const ident = this.findChildOfType(current, 'identifier') || this.findChildOfType(current, 'field_identifier');
      if (ident) return this.nodeText(ident);
      const next = this.findChildOfType(current, 'declarator') || this.findChildOfType(current, 'function_declarator');
      if (!next) break;
      current = next;
    }
    return null;
  }

  private extractFunctionParams(decl: any): string[] {
    const out: string[] = [];
    const pl = this.findChildOfType(decl, 'parameter_list') || this.findChildOfType(decl, 'parameters');
    if (!pl) return out;
    for (let i = 0; i < pl.childCount; i++) {
      const c = pl.child(i);
      if (c && c.type === 'parameter_declaration') out.push(this.nodeText(c).trim());
    }
    return out;
  }

  private extractReturnType(node: any): string {
    const s = this.findChildOfType(node, 'declaration_specifiers') || this.findChildOfType(node, 'type_specifier');
    if (s) return this.nodeText(s).trim();
    const parts: string[] = [];
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i); if (!c) continue;
      const t = c.type;
      if (t === 'function_declarator' || t === 'declarator' || t === 'compound_statement') break;
      if (t.startsWith('preproc_') || t === 'comment') continue;
      parts.push(this.nodeText(c).trim());
    }
    return parts.filter(Boolean).join(' ').trim();
  }

  private buildSignature(name: string, params: string[], returnType: string): string {
    return (returnType ? returnType + ' ' : '') + name + '(' + params.join(', ') + ')';
  }

  // ── Helpers (docstring / node text / tree traversal / file node) ────────

  private extractDocstring(node: any): string {
    const comments: string[] = [];
    let prev = node.previousSibling;
    while (prev) {
      if (prev.type === 'comment') { comments.unshift(this.extractCommentText(prev)); }
      else if (comments.length > 0) break;
      prev = prev.previousSibling;
    }
    if (comments.length === 0 && node.childCount > 0) {
      const first = node.child(0);
      if (first && first.type === 'comment') comments.push(this.extractCommentText(first));
    }
    return comments.join('\n');
  }

  private extractCommentText(node: any): string {
    return this.nodeText(node).replace(/^\/\*+/, '').replace(/\*+\/$/, '').replace(/^\/\//gm, '')
      .split('\n').map((l) => l.replace(/^\s*\*?\s*/, '').trim()).join('\n').trim();
  }

  private nodeText(node: any): string { return this.fileContent.substring(node.startIndex, node.endIndex); }
  private nodeContents(node: any): boolean { return node.startIndex !== node.endIndex; }

  private findChildOfType(node: any, type: string): any {
    for (let i = 0; i < node.childCount; i++) { const c = node.child(i); if (c && c.type === type) return c; }
    return null;
  }

  private findAnyChildOfTypes(node: any, types: string[]): any {
    for (let i = 0; i < node.childCount; i++) { const c = node.child(i); if (c && types.includes(c.type)) return c; }
    return null;
  }

  private findFirstIdentifier(node: any): any {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i); if (!c) continue;
      if (c.type === 'identifier' || c.type === 'field_identifier') return c;
      const n = this.findFirstIdentifier(c); if (n) return n;
    }
    return null;
  }

  private collectIdentifiers(node: any): string[] {
    const names: string[] = [];
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i); if (!c) continue;
      if (c.type === 'identifier' || c.type === 'field_identifier') { names.push(this.nodeText(c)); }
      else if (c.type === 'declarator' || c.type === 'init_declarator') {
        const id = this.findFirstIdentifier(c); if (id) names.push(this.nodeText(id));
      }
    }
    return names;
  }

  private createFileNode(): EntityNode {
    const now = isoTimestamp();
    const ext = path.extname(this.filePath).toLowerCase();
    const isC = ['.c', '.h'].includes(ext);
    return {
      id: slugify('file-' + this.filePath),
      name: path.basename(this.filePath),
      details: (isC ? 'C' : 'C++') + ' file: ' + this.filePath,
      type: 'code' as const,
      language: (isC ? 'c' : 'cpp') as 'cpp',
      file_path: this.filePath, hash: this.fileHash,
      source: this.source, source_version: this.sourceVersion,
      valid_from: now, valid_to: null, version: 1,
      created_at: now, ingested_at: now, updated_at: now,
    };
  }
}
