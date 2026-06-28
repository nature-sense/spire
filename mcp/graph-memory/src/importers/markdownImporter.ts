import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { EntityNode, Relationship, ImportResult } from '../types/import.js';
import { isoTimestamp, slugify, computeHash } from '../utils/helpers.js';

// ---------------------------------------------------------------------------
// MarkdownImporter — parses Cline memory bank / rules markdown files
//
// Uses regex-based parsing (not tree-sitter) to extract:
//   - Headings (# → section, ## → section/subsection, ### → subsection)
//   - List items (- / * ) as typed children of parent headings
//   - **Bold text** as key_term entities
//   - Code blocks (```) as code_snippet entities
//   - Smart category inference from heading text
// ---------------------------------------------------------------------------

interface HeadingNode {
  level: number;        // 1 for #, 2 for ##, etc.
  title: string;        // Clean heading text (no markdown syntax)
  entityId: string;     // Corresponding EntityNode.id
  lineNumber: number;   // 1-based line number
}

const CATEGORY_PATTERNS: [RegExp, string][] = [
  [/requirements?|core\s*requirements/i, 'requirement'],
  [/decisions?|active\s*decisions?/i, 'decision'],
  [/issues?|known\s*issues?/i, 'issue'],
  [/blockers?/i, 'blocker'],
  [/next\s*steps?|tasks?|todo/i, 'task'],
  [/patterns?|design\s*patterns?/i, 'pattern'],
  [/technology\s*stack|tech\s*stack/i, 'technology'],
  [/dependenc(y|ies)/i, 'dependency'],
  [/architectur(e|al)/i, 'architecture'],
  [/scope/i, 'scope'],
  [/status|progress/i, 'status'],
  [/context/i, 'context'],
  [/focus/i, 'focus'],
];

function inferCategory(headingText: string): string {
  for (const [pattern, category] of CATEGORY_PATTERNS) {
    if (pattern.test(headingText)) return category;
  }
  return 'section';
}

// ---------------------------------------------------------------------------
// MarkdownImporter
// ---------------------------------------------------------------------------

export class MarkdownImporter {
  private filePath: string;
  private source: string;
  private sourceVersion: string;
  private fileHash: string;
  private fileContent: string;
  private lines: string[];

  constructor(
    filePath: string,
    source: string = 'markdown',
    sourceVersion: string = '1.0.0',
  ) {
    this.filePath = path.resolve(filePath);
    this.source = source;
    this.sourceVersion = sourceVersion;
    this.fileContent = fs.readFileSync(this.filePath, 'utf-8');
    this.fileHash = crypto.createHash('sha256').update(this.fileContent).digest('hex').substring(0, 16);
    this.lines = this.fileContent.split('\n');
  }

  static async create(
    filePath: string,
    source?: string,
    sourceVersion?: string,
  ): Promise<MarkdownImporter> {
    // No async init needed for markdown (no tree-sitter WASM)
    return new MarkdownImporter(filePath, source, sourceVersion);
  }

  // ── Public entry point ──────────────────────────────────────────────────

  importFile(): ImportResult {
    const nodes: EntityNode[] = [];
    const edges: Relationship[] = [];
    const errors: string[] = [];

    try {
      const fileNode = this.createFileNode();
      nodes.push(fileNode);

      const headingStack: HeadingNode[] = [];
      let collectingBody: string[] = [];
      let currentHeading: HeadingNode | null = null;

      for (let i = 0; i < this.lines.length; i++) {
        const line = this.lines[i];
        const lineNum = i + 1;

        // ── Code block ──
        if (/^```/.test(line)) {
          const codeNode = this.extractCodeBlock(i, fileNode.id, nodes, edges);
          if (codeNode) {
            // Skip code block lines
            const closing = this.findClosingCodeBlock(i + 1);
            i = closing > i ? closing : i;
          }
          continue;
        }

        // ── Heading ──
        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
          // Flush collected body for the previous heading
          this.flushBody(collectingBody, currentHeading, nodes, edges);
          collectingBody = [];

          const level = headingMatch[1].length;
          const rawTitle = headingMatch[2].trim();
          const cleanTitle = this.stripMarkdownSyntax(rawTitle);
          const category = level === 1 ? 'section' : inferCategory(cleanTitle);
          const id = slugify('h' + level + '-' + cleanTitle + '-' + this.fileHash);
          const now = isoTimestamp();

          // Pop stack to find parent
          while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
            headingStack.pop();
          }
          const parentId = headingStack.length > 0
            ? headingStack[headingStack.length - 1].entityId
            : fileNode.id;

          nodes.push({
            id, name: cleanTitle, details: rawTitle,
            type: 'documentation' as const, category, language: 'markdown' as const,
            file_path: this.filePath,
            start_line: lineNum, end_line: lineNum,
            hash: this.fileHash,
            source: this.source, source_version: this.sourceVersion,
            valid_from: now, valid_to: null, version: 1,
            created_at: now, ingested_at: now, updated_at: now,
          });

          edges.push({
            type: 'CONTAINS', source_id: parentId, target_id: id,
            evidence: `${this.filePath}#L${lineNum}`,
            source: this.source,
          });

          const heading: HeadingNode = {
            level, title: cleanTitle, entityId: id, lineNumber: lineNum,
          };
          headingStack.push(heading);
          currentHeading = heading;
          continue;
        }

        // ── Collect body content for current heading ──
        if (currentHeading) {
          collectingBody.push(line);
        }
      }

      // Flush last heading's body
      this.flushBody(collectingBody, currentHeading, nodes, edges);

      // ── Extract key terms from bold text ──
      this.extractKeyTerms(nodes, edges);

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

  // ── Extract list items, paragraphs from body lines ────────────────────

  private flushBody(
    bodyLines: string[],
    heading: HeadingNode | null,
    nodes: EntityNode[],
    edges: Relationship[],
  ): void {
    if (!heading || bodyLines.length === 0) return;

    const effectiveLines = bodyLines.filter((l) => l.trim() !== '');
    if (effectiveLines.length === 0) return;

    const parentId = heading.entityId;
    const now = isoTimestamp();

    for (const line of effectiveLines) {
      // Checkboxes or bullet items
      const listMatch = line.match(/^\s*[-*]\s+\[([ x])\]\s+(.+)$/);
      const bulletMatch = line.match(/^\s*[-*]\s+(.+)$/);

      if (listMatch) {
        // Checkbox item - could be task
        const label = listMatch[2].trim();
        const isChecked = listMatch[1] === 'x';
        const cleanLabel = this.stripMarkdownSyntax(label);
        const id = slugify('todo-' + cleanLabel.substring(0, 40) + '-' + this.fileHash);
        nodes.push({
          id, name: cleanLabel,
          details: (isChecked ? '[x] ' : '[ ] ') + label,
          type: 'documentation' as const,
          category: 'task', language: 'markdown' as const,
          file_path: this.filePath,
          hash: computeHash(cleanLabel),
          source: this.source, source_version: this.sourceVersion,
          valid_from: now, valid_to: null, version: 1,
          created_at: now, ingested_at: now, updated_at: now,
        });
        edges.push({
          type: 'CONTAINS', source_id: parentId, target_id: id,
          evidence: `${this.filePath}#L${heading.lineNumber}`,
          source: this.source,
        });
      } else if (bulletMatch) {
        // Regular bullet item
        const label = bulletMatch[1].trim();
        const cleanLabel = this.stripMarkdownSyntax(label);
        const category = this.inferListItemCategory(heading.title);
        const id = slugify(category + '-' + cleanLabel.substring(0, 40) + '-' + this.fileHash);
        nodes.push({
          id, name: cleanLabel.length > 80 ? cleanLabel.substring(0, 80) + '...' : cleanLabel,
          details: label,
          type: 'documentation' as const,
          category, language: 'markdown' as const,
          file_path: this.filePath,
          hash: computeHash(cleanLabel),
          source: this.source, source_version: this.sourceVersion,
          valid_from: now, valid_to: null, version: 1,
          created_at: now, ingested_at: now, updated_at: now,
        });
        edges.push({
          type: 'CONTAINS', source_id: parentId, target_id: id,
          evidence: `${this.filePath}#L${heading.lineNumber}`,
          source: this.source,
        });
      }
      // Plain paragraphs are captured in the heading's body_preview later
    }

    // Join remaining non-list text as body_preview on the heading
    const nonListLines = effectiveLines.filter((l) => !/^\s*[-*]/.test(l));
    if (nonListLines.length > 0) {
      const preview = nonListLines.join(' ').trim();
      // Find heading node and update body_preview
      for (const node of nodes) {
        if (node.id === parentId && !node.body_preview) {
          node.body_preview = preview.substring(0, 300);
          break;
        }
      }
    }
  }

  // ── Code block extraction ─────────────────────────────────────────────

  private extractCodeBlock(
    startLine: number,
    fileId: string,
    nodes: EntityNode[],
    edges: Relationship[],
  ): EntityNode | null {
    const closing = this.findClosingCodeBlock(startLine + 1);
    if (closing <= startLine) return null;

    const firstLine = this.lines[startLine];
    const lang = firstLine.slice(3).trim();
    const codeLines = this.lines.slice(startLine + 1, closing);
    const code = codeLines.join('\n').trim();
    if (!code) return null;

    const name = lang ? 'code block (' + lang + ')' : 'code block';
    const id = slugify('codeblock-' + startLine + '-' + this.fileHash);
    const now = isoTimestamp();

    const node: EntityNode = {
      id, name, details: code.substring(0, 200),
      type: 'documentation' as const, category: 'code_snippet',
      language: 'markdown' as const,
      file_path: this.filePath, body_preview: code.substring(0, 1000),
      start_line: startLine + 1, end_line: closing + 1,
      hash: computeHash(code),
      source: this.source, source_version: this.sourceVersion,
      valid_from: now, valid_to: null, version: 1,
      created_at: now, ingested_at: now, updated_at: now,
    };
    if (lang) node.signature = lang;

    nodes.push(node);
    edges.push({
      type: 'CONTAINS', source_id: fileId, target_id: id,
      evidence: `${this.filePath}#L${startLine + 1}`,
      source: this.source,
    });
    return node;
  }

  private findClosingCodeBlock(afterLine: number): number {
    for (let i = afterLine; i < this.lines.length; i++) {
      if (/^```/.test(this.lines[i])) return i;
    }
    return -1;
  }

  // ── Key term extraction (bold text) ───────────────────────────────────

  private extractKeyTerms(nodes: EntityNode[], edges: Relationship[]): void {
    const now = isoTimestamp();

    for (let i = 0; i < this.lines.length; i++) {
      // Find **bold** patterns
      const boldRegex = /\*\*(.+?)\*\*/g;
      let match;

      while ((match = boldRegex.exec(this.lines[i])) !== null) {
        const term = match[1].trim();
        if (!term || term.length < 2) continue;

        const existing = nodes.find((n) => n.name === term && n.category === 'key_term');
        if (existing) {
          // Reference existing term (multiple occurrences)
          continue;
        }

        const id = slugify('term-' + term + '-' + this.fileHash);
        nodes.push({
          id, name: term, details: 'Key term: ' + term,
          type: 'documentation' as const, category: 'key_term',
          language: 'markdown' as const,
          file_path: this.filePath,
          start_line: i + 1, end_line: i + 1,
          hash: computeHash(term),
          source: this.source, source_version: this.sourceVersion,
          valid_from: now, valid_to: null, version: 1,
          created_at: now, ingested_at: now, updated_at: now,
        });
      }
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private inferListItemCategory(headingTitle: string): string {
    const lower = headingTitle.toLowerCase();
    if (/requirements?/i.test(lower)) return 'requirement';
    if (/decisions?/i.test(lower)) return 'decision';
    if (/issues?/i.test(lower)) return 'issue';
    if (/blockers?/i.test(lower)) return 'blocker';
    if (/patterns?/i.test(lower)) return 'pattern';
    if (/dependenc/i.test(lower)) return 'dependency';
    return 'note';
  }

  private stripMarkdownSyntax(text: string): string {
    return text
      .replace(/\*\*(.+?)\*\*/g, '$1')   // **bold**
      .replace(/\*(.+?)\*/g, '$1')        // *italic*
      .replace(/`(.+?)`/g, '$1')           // `code`
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [text](url)
      .trim();
  }

  private createFileNode(): EntityNode {
    const now = isoTimestamp();
    return {
      id: slugify('file-' + this.filePath),
      name: path.basename(this.filePath),
      details: 'Markdown file: ' + this.filePath,
      type: 'documentation' as const,
      language: 'markdown' as const,
      file_path: this.filePath, hash: this.fileHash,
      source: this.source, source_version: this.sourceVersion,
      valid_from: now, valid_to: null, version: 1,
      created_at: now, ingested_at: now, updated_at: now,
    };
  }
}
