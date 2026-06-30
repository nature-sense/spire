/**
 * Pipeline Orchestrator Interface
 *
 * The main orchestrator interface used by extension.ts, chat-panel.ts,
 * and sidebar-provider.ts to coordinate tool execution and LLM workflows.
 */

import { Node, NodeType } from './memory';
import type { IToolRegistry } from './tool-registry';
import type { IWorkflow, WorkflowResult } from './workflow';
import type { Tool } from '../models/tool';
import type { WorkspaceContext } from '../models/context';

// ============================================================================
// SHARED TYPES
// ============================================================================

export interface Entity {
  name: string;
  type: NodeType;
  confidence: number;
  aliases?: string[];
  id?: string;                  // Node ID if matched
}

// ============================================================================
// ERROR CLASSES
// ============================================================================

export class OrchestrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrchestrationError';
  }
}

// ============================================================================
// PIPELINE ORCHESTRATOR INTERFACES
// ============================================================================

/**
 * Options for the pipeline orchestrator
 */
export interface OrchestrationOptions {
  maxIterations?: number;
  temperature?: number;
  onStatusUpdate?: (status: import('./workflow').StatusUpdate) => void;
}

/**
 * Main pipeline orchestrator interface
 * Used by extension.ts, chat-panel.ts, sidebar-provider.ts
 */
export interface IOrchestrator {
  getToolRegistry(): IToolRegistry;
  setContext(context: WorkspaceContext): void;
  getContext(): WorkspaceContext;
  refreshContext(): Promise<WorkspaceContext>;
  registerTool(tool: Tool): void;
  unregisterTool(name: string): void;
  listTools(): Tool[];
  setWorkflow(workflow: IWorkflow): void;
  getWorkflow(): IWorkflow;
  listWorkflows(): string[];
  handleUserRequest(
    userMessage: string,
    options?: OrchestrationOptions
  ): Promise<WorkflowResult>;
}
