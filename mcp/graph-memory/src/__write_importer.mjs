
const fs = require('fs');
const remainder = `

  private extractImport(node: any, fileId: string): Relationship[] {
    const edges: Relationship[] = [];
    const path = require('path');

    if (node.type === 'import_statement') {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child && child.type === 'dotted_name') {
          const moduleName = this.nodeText(child);
          edges.push({
            type: 'IMPORTS',
            source_id: fileId,
            target_id: slugify('module-' + moduleName),
            evidence: this.filePath + '#L' + (node.startPosition.row + 1),
            source: this.source,
          });
        }
      }
    }

    if (node.type === 'import_from_statement') {
      const moduleNode = node.childForFieldName('module');
      const moduleName = moduleNode ? this.nodeText(moduleNode) : '';
      const namesNode = node.childForFieldName('names');
      if (namesNode) {
        this.collectDottedNames(namesNode).forEach(function(alias: string) {
          const fullName = moduleName ? moduleName + '.' + alias : alias;
          edges.push({
            type: 'IMPORTS',
            source_id: fileId,
            target_id: slugify('module-' + fullName),
            evidence: this.filePath + '#L' + (node.startPosition.row + 1),
            source: this.source,
          });
        }, this);
      }
    }

    return edges;
  }

  private collectDottedNames(node: any): string[] {
    const names: string[] = [];
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        if (child.type === 'dotted_name') {
          names.push(this.nodeText(child));
        } else if (child.type === 'aliased_import') {
          const nameNode = child.childForFieldName('name');
          if (nameNode) names.push(this.nodeText(nameNode));
        } else if (child.childCount > 0) {
          const subNames = this.collectDottedNames(child);
          names.push(...subNames);
        }
      }
    }
    return names;
  }

  private extractParameterNames(paramsNode: any): string[] {
    const names: string[] = [];
    for (let i = 0; i < paramsNode.childCount; i++) {
      const child = paramsNode.child(i);
      if (child) {
        if (child.type === 'identifier') {
          names.push(this.nodeText(child));
        } else if (child.type === 'typed_parameter' || child.type === 'default_parameter') {
          const nameNode = child.childForFieldName('name');
          if (nameNode) names.push(this.nodeText(nameNode));
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
      if (child) {
        if (child.type === 'expression_statement') {
          const expr = child.child(0);
          if (expr && (expr.type === 'string' || expr.type === 'fstring')) {
            let ds = this.nodeText(expr);
            ds = ds.replace(/^"""|^"'|^"|^'/, '').replace(/"""$|'''$|"$|'$/, '');
            return ds.trim();
          }
        }
        if (child.type === 'string') {
          let ds = this.nodeText(child);
          ds = ds.replace(/^"""|^'''|^"|^'/, '').replace(/"""$|'''$|"$|'$/, '');
          return ds.trim();
        }
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

  private nodeTextForField(node: any, fieldName: string): string {
    return this.nodeText(node, fieldName);
  }

  private createFileNode(): EntityNode {
    const now = isoTimestamp();
    const path = require('path');
    return {
      id: slugify('file-' + this.filePath),
      name: path.basename(this.filePath),
      details: 'Python file: ' + this.filePath,
      type: 'code',
      language: 'python',
      file_path: this.filePath,
      hash: this.fileHash,
      source: this.source,
      source_version: this.sourceVersion,
      valid_from: now,
      valid_to: null,
      version: 1,
      created_at: now,
      ingested_at: now,
      updated_at: now,
    };
  }
}
`;
fs.appendFileSync('/Users/steve/naturesense/tools/spire/mcp/graph-memory/src/importers/pythonImporter.ts', remainder);
console.log('done');
