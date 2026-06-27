import { WorkspaceContext } from '../models/context';
import { Tool } from '../models/tool';
import { IWorkflow, WorkflowResult } from './workflow';

export interface IOrchestrator {
  // Core orchestration
  handleUserRequest(
    userMessage: string,
    options?: OrchestrationOptions
  ): Promise<WorkflowResult>;

  // Context management
  setContext(context: WorkspaceContext): void;
  getContext(): WorkspaceContext;
  refreshContext(): Promise<WorkspaceContext>;

  // Tool management
  registerTool(tool: Tool): void;
  unregisterTool(name: string): void;
  listTools(): Tool[];

  // Workflow management
  setWorkflow(workflow: IWorkflow): void;
  getWorkflow(): IWorkflow;
  listWorkflows(): string[];
}


export interface OrchestrationOptions {
  workflow?: string;
  temperature?: number;
  maxTokens?: number;
  maxIterations?: number;
}

export const IOrchestrator = Symbol('IOrchestrator');
