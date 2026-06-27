import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface MemoryBankContent {
  projectbrief: string;
  productContext: string;
  activeContext: string;
  systemPatterns: string;
  techContext: string;
  progress: string;
}

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
 * Load all Memory Bank files from the workspace
 */
export async function loadMemoryBank(overrideRoot?: string): Promise<Record<string, string>> {
  const workspaceRoot = getWorkspaceRoot(overrideRoot);
  if (!workspaceRoot) {
    return {};
  }

  const memoryBankPath = path.join(workspaceRoot, 'memory-bank');
  const files = [
    'projectbrief.md',
    'productContext.md',
    'activeContext.md',
    'systemPatterns.md',
    'techContext.md',
    'progress.md'
  ];

  const result: Record<string, string> = {};

  for (const file of files) {
    const filePath = path.join(memoryBankPath, file);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const key = file.replace('.md', '');
      result[key] = content;
    } catch {
      // File doesn't exist, skip
      result[file.replace('.md', '')] = '';
    }
  }

  return result;
}

/**
 * Initialize Memory Bank with template files
 */
export async function initMemoryBank(overrideRoot?: string): Promise<void> {
  const workspaceRoot = getWorkspaceRoot(overrideRoot);
  if (!workspaceRoot) {
    vscode.window.showErrorMessage('No workspace folder open. Please open a folder first.');
    return;
  }

  const memoryBankPath = path.join(workspaceRoot, 'memory-bank');
  await fs.mkdir(memoryBankPath, { recursive: true });

  const templates: Record<string, string> = {
    'projectbrief.md': `# Project Brief

## Core Requirements

## Goals

## Constraints

## Timeline
`,
    'productContext.md': `# Product Context

## Why This Project Exists

## User Experience Goals

## Key Features

## Success Metrics
`,
    'activeContext.md': `# Active Context

## Current Focus

## Recent Changes

## Next Steps

## Blockers
`,
    'systemPatterns.md': `# System Patterns

## Architecture Overview

## Key Components

## Design Patterns

## Data Flow
`,
    'techContext.md': `# Tech Context

## Technology Stack

## Development Setup

## Dependencies

## Deployment
`,
    'progress.md': `# Progress

## What Works

## What's Left

## Known Issues

## Milestones
`
  };

  for (const [filename, content] of Object.entries(templates)) {
    const filePath = path.join(memoryBankPath, filename);
    try {
      await fs.access(filePath);
      // File exists, skip
    } catch {
      // File doesn't exist, create it
      await fs.writeFile(filePath, content, 'utf-8');
    }
  }

  vscode.window.showInformationMessage('Memory Bank initialized in memory-bank/ folder.');
}

/**
 * Update a specific Memory Bank file
 */
export async function updateMemoryBank(filename: string, content: string, overrideRoot?: string): Promise<void> {
  const workspaceRoot = getWorkspaceRoot(overrideRoot);
  if (!workspaceRoot) {
    throw new Error('No workspace folder open');
  }

  const memoryBankPath = path.join(workspaceRoot, 'memory-bank');
  const filePath = path.join(memoryBankPath, filename);

  // Ensure the memory-bank folder exists
  await fs.mkdir(memoryBankPath, { recursive: true });

  // Write the file
  await fs.writeFile(filePath, content, 'utf-8');

  // Also update the in-memory cache if we're tracking it
  // (caller should reload memory bank after update)
}

/**
 * Check if Memory Bank exists
 */
export async function memoryBankExists(overrideRoot?: string): Promise<boolean> {
  const workspaceRoot = getWorkspaceRoot(overrideRoot);
  if (!workspaceRoot) {
    return false;
  }

  const memoryBankPath = path.join(workspaceRoot, 'memory-bank');
  try {
    await fs.access(memoryBankPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Format Memory Bank for inclusion in a system prompt
 */
export function formatMemoryBankForPrompt(memoryBank: Record<string, string>): string {
  const sections: string[] = [];

  if (memoryBank.projectbrief) {
    sections.push(`## Project Brief\n${memoryBank.projectbrief}`);
  }
  if (memoryBank.productContext) {
    sections.push(`## Product Context\n${memoryBank.productContext}`);
  }
  if (memoryBank.activeContext) {
    sections.push(`## Active Context\n${memoryBank.activeContext}`);
  }
  if (memoryBank.systemPatterns) {
    sections.push(`## System Patterns\n${memoryBank.systemPatterns}`);
  }
  if (memoryBank.techContext) {
    sections.push(`## Tech Context\n${memoryBank.techContext}`);
  }
  if (memoryBank.progress) {
    sections.push(`## Progress\n${memoryBank.progress}`);
  }

  return sections.join('\n\n');
}