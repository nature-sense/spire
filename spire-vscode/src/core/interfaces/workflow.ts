import { ILLMProvider } from './llm-provider';
import { IToolRegistry } from './tool-registry';
import { WorkspaceContext } from '../models/context';

export interface WorkflowResult {
  content: string;
  reasoning?: string;
}

export interface IWorkflow {
  name: string;
  description: string;
  execute(
    userMessage: string,
    context: WorkspaceContext,
    llm: ILLMProvider,
    tools: IToolRegistry,
    options?: WorkflowOptions
  ): Promise<WorkflowResult>;
}


export type StatusUpdate =
  | { type: 'thinking' }
  | { type: 'tool_call'; toolName: string; args: Record<string, any> };

export interface WorkflowOptions {
  maxIterations?: number;
  temperature?: number;
  onStatusUpdate?: (status: StatusUpdate) => void;
}

export const IWorkflow = Symbol('IWorkflow');
