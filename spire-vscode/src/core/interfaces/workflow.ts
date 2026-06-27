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


export interface WorkflowOptions {
  maxIterations?: number;
  temperature?: number;
}

export const IWorkflow = Symbol('IWorkflow');
