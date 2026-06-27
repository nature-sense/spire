import { IOrchestrator, OrchestrationOptions } from '../core/interfaces/orchestrator';
import { ILLMProvider } from '../core/interfaces/llm-provider';
import { IToolRegistry } from '../core/interfaces/tool-registry';
import { IWorkflow, WorkflowResult } from '../core/interfaces/workflow';
import { WorkspaceContext } from '../core/models/context';
import { Tool } from '../core/models/tool';
import { ToolRegistry } from '../tools/tool-registry';
import { AgenticWorkflow } from './workflows/agentic-workflow';
import { SpireError } from '../core/errors/errors';


export type WorkflowConstructor = new () => IWorkflow;

export class Orchestrator implements IOrchestrator {
  private llm: ILLMProvider;
  private toolRegistry: IToolRegistry;
  private workflows: Map<string, IWorkflow> = new Map();
  private defaultWorkflow: IWorkflow;
  private context: WorkspaceContext = {};

  getToolRegistry(): IToolRegistry {
    return this.toolRegistry;
  }

  constructor(llm: ILLMProvider) {
    this.llm = llm;
    this.toolRegistry = new ToolRegistry();
    this.defaultWorkflow = new AgenticWorkflow();
    this.registerDefaultWorkflow(this.defaultWorkflow);
  }

  private registerDefaultWorkflow(workflow: IWorkflow): void {
    this.workflows.set(workflow.name, workflow);
  }

  setContext(context: WorkspaceContext): void {
    this.context = context;
  }

  getContext(): WorkspaceContext {
    return this.context;
  }

  async refreshContext(): Promise<WorkspaceContext> {
    // Context is refreshed externally (from VS Code extension)
    // This method is for future automatic context gathering
    return this.context;
  }

  registerTool(tool: Tool): void {
    this.toolRegistry.register(tool);
  }

  unregisterTool(name: string): void {
    this.toolRegistry.unregister(name);
  }

  listTools(): Tool[] {
    return this.toolRegistry.list();
  }

  setWorkflow(workflow: IWorkflow): void {
    if (!this.workflows.has(workflow.name)) {
      this.workflows.set(workflow.name, workflow);
    }
    this.defaultWorkflow = workflow;
  }

  getWorkflow(): IWorkflow {
    return this.defaultWorkflow;
  }

  listWorkflows(): string[] {
    return Array.from(this.workflows.keys());
  }

  async handleUserRequest(
    userMessage: string,
    options?: OrchestrationOptions
  ): Promise<WorkflowResult> {
    const workflow = this.defaultWorkflow;

    try {
      const result = await workflow.execute(
        userMessage,
        this.context,
        this.llm,
        this.toolRegistry,
        {
          maxIterations: options?.maxIterations,
          temperature: options?.temperature
        }
      );
      return result;
    } catch (error) {
      if (error instanceof SpireError) {
        return { content: `Error: ${error.message}` };
      }
      return { content: `Unexpected error: ${(error as Error).message}` };
    }
  }

}
