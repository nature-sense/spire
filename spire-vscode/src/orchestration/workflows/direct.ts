import { IWorkflow, WorkflowOptions, WorkflowResult } from '../../core/interfaces/workflow';

import { ILLMProvider } from '../../core/interfaces/llm-provider';
import { IToolRegistry } from '../../core/interfaces/tool-registry';
import { WorkspaceContext } from '../../core/models/context';
import { Message } from '../../core/models/message';

/**
 * Direct workflow: single LLM call, no tool loops.
 * Best for simple Q&A where no tool use is needed.
 */
export class DirectWorkflow implements IWorkflow {
  name = 'direct';
  description = 'Single LLM call without tool execution. Best for simple Q&A.';

  async execute(
    userMessage: string,
    context: WorkspaceContext,
    llm: ILLMProvider,
    tools: IToolRegistry,
    options?: WorkflowOptions
  ): Promise<WorkflowResult> {
    const messages: Message[] = [
      { role: 'system', content: this.buildSystemPrompt(context) },
      { role: 'user', content: userMessage }
    ];

    const response = await llm.sendMessage(messages, {
      temperature: options?.temperature ?? 0.0,
      tools: [],
      toolChoice: 'none'
    });

    return { content: response.content, reasoning: response.reasoning };
  }


  private buildSystemPrompt(context: WorkspaceContext): string {
    const sections: string[] = [
      '# Role',
      'You are Spire, an AI coding assistant in VS Code.',
      '',
      '# Mode',
      'Direct answer mode — respond with no tools. Be concise and factual.',
      '',
      '# Style',
      '- Direct. Factual. Use ```language blocks for code.',
      '- If uncertain, say so. Do not guess.',
      '- Keep responses focused on what was asked.'
    ];

    if (context.currentFile) {
      sections.push(`\n# Context\nCurrent file: ${context.currentFile.path}`);
    }
    if (context.projectInfo) {
      sections.push(`\nProject: ${context.projectInfo.name}`);
    }

    return sections.join('\n');
  }
}
