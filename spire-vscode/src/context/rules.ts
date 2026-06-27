import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Get the workspace root path
 */
export function getWorkspaceRoot(overrideRoot?: string): string | null {
  if (overrideRoot) {
    return overrideRoot;
  }
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return null;
  }
  return folders[0].uri.fsPath;
}

/**
 * Load Cline rules from the workspace
 * Reads .clinerules and .clinerules-arch files
 */
export async function loadClineRules(overrideRoot?: string): Promise<string> {
  const workspaceRoot = getWorkspaceRoot(overrideRoot);
  if (!workspaceRoot) {
    return '';
  }

  const rules: string[] = [];

  // Read .clinerules
  const rulesPath = path.join(workspaceRoot, '.clinerules');
  try {
    const content = await fs.readFile(rulesPath, 'utf-8');
    if (content.trim()) {
      rules.push(`# Cline Rules\n${content}`);
    }
  } catch {
    // File doesn't exist, skip
  }

  // Read .clinerules-arch
  const archPath = path.join(workspaceRoot, '.clinerules-arch');
  try {
    const content = await fs.readFile(archPath, 'utf-8');
    if (content.trim()) {
      rules.push(`# Cline Architecture Rules\n${content}`);
    }
  } catch {
    // File doesn't exist, skip
  }

  // Read .clinerules-* files (additional rule files)
  try {
    const files = await fs.readdir(workspaceRoot);
    const ruleFiles = files.filter(f => f.startsWith('.clinerules-') && f !== '.clinerules-arch');
    
    for (const file of ruleFiles) {
      const filePath = path.join(workspaceRoot, file);
      const content = await fs.readFile(filePath, 'utf-8');
      if (content.trim()) {
        const label = file.replace('.clinerules-', '').replace(/-/g, ' ').toUpperCase();
        rules.push(`# ${label} Rules\n${content}`);
      }
    }
  } catch {
    // Skip if can't read directory
  }

  return rules.join('\n\n');
}

/**
 * Check if Cline rules exist
 */
export async function clineRulesExist(overrideRoot?: string): Promise<boolean> {
  const workspaceRoot = getWorkspaceRoot(overrideRoot);
  if (!workspaceRoot) {
    return false;
  }

  const rulesPath = path.join(workspaceRoot, '.clinerules');
  try {
    await fs.access(rulesPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get all Cline rule file paths
 */
export async function getClineRuleFiles(overrideRoot?: string): Promise<string[]> {
  const workspaceRoot = getWorkspaceRoot(overrideRoot);
  if (!workspaceRoot) {
    return [];
  }

  const result: string[] = [];
  
  try {
    const files = await fs.readdir(workspaceRoot);
    const ruleFiles = files.filter(f => f.startsWith('.clinerules'));
    for (const file of ruleFiles) {
      result.push(path.join(workspaceRoot, file));
    }
  } catch {
    // Skip
  }

  return result;
}