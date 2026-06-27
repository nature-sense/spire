import { IWorkflow, WorkflowOptions, WorkflowResult } from '../../core/interfaces/workflow';

import { ILLMProvider } from '../../core/interfaces/llm-provider';
import { IToolRegistry } from '../../core/interfaces/tool-registry';
import { WorkspaceContext } from '../../core/models/context';
import { Message } from '../../core/models/message';

export class AgenticWorkflow implements IWorkflow {
  name = 'agentic';
  description = 'Standard agentic loop: think, act, observe, repeat';

  async execute(
    userMessage: string,
    context: WorkspaceContext,
    llm: ILLMProvider,
    tools: IToolRegistry,
    options?: WorkflowOptions
  ): Promise<WorkflowResult> {
    const maxIterations = options?.maxIterations ?? 15;
    const temperature = options?.temperature ?? 0.7;

    const messages: Message[] = [
      { role: 'system', content: this.buildSystemPrompt(context) },
      { role: 'user', content: userMessage }
    ];

    const allTools = tools.list();
    let iteration = 0;
    let finalReasoning: string | undefined;

    while (iteration < maxIterations) {
      iteration++;

      const response = await llm.sendMessage(messages, {
        temperature,
        tools: allTools,
        toolChoice: 'auto'
      });

      // Capture reasoning from the final response
      if (!response.toolCalls || response.toolCalls.length === 0) {
        finalReasoning = response.reasoning;
      }

      if (response.toolCalls && response.toolCalls.length > 0) {
        // Assistant message with tool calls
        messages.push({
          role: 'assistant',
          content: response.content,
          toolCalls: response.toolCalls
        });

        // Execute each tool call
        for (const tc of response.toolCalls) {
          const args = JSON.parse(tc.function.arguments);
          const result = await tools.execute(tc.function.name, args);

          messages.push({
            role: 'tool',
            content: result.content,
            toolCallId: tc.id
          });
        }
      } else {
        // Final response - no more tool calls
        return { content: response.content, reasoning: response.reasoning };
      }
    }

    return { content: 'Reached maximum iteration limit. Please try again with a more specific request.', reasoning: finalReasoning };
  }


  private buildSystemPrompt(context: WorkspaceContext): string {
    const sections: string[] = [
      '# Role',
      'You are Spire, an autonomous coding assistant inside VS Code with full tool access.',
      '',
      '# Loop',
      'You operate in a tool-calling agentic loop:',
      '1. Analyze the request. Break it down.',
      '2. Plan one step before acting.',
      '3. Call one tool at a time.',
      '4. Verify results.',
      '5. Summarize when done.',
      '',
      '# Tool Rules',
      '- Only call a tool when you have a clear, specific purpose.',
      '- Read the minimum content needed.',
      '- On error: diagnose, then retry with a corrected call.',
      '- After repeated failures on the same sub-task: stop and report the blocker.',
      '',
      '# Output Style',
      '- Be direct. Think aloud briefly before each tool call.',
      '- Use ```language blocks for all code.',
      '- End with a short summary of what was accomplished.',
      '- If you need clarification, ask one concise question.'
    ];

    if (context.currentFile) {
      sections.push(`\n# Current Context\nCurrent file: ${context.currentFile.path}`);
      if (context.currentFile.selection) {
        sections.push(`Selection: lines ${context.currentFile.selection.start.line}-${context.currentFile.selection.end.line}`);
      }
    }

    if (context.projectInfo) {
      sections.push(`\nProject: ${context.projectInfo.name}`);
      if (context.projectInfo.techStack && context.projectInfo.techStack.length > 0) {
        sections.push(`Tech stack: ${context.projectInfo.techStack.join(', ')}`);
      }
    }

    if (context.diagnostics && context.diagnostics.length > 0) {
      sections.push(`\n# Active Diagnostics (${context.diagnostics.length})`);
      for (const d of context.diagnostics.slice(0, 5)) {
        sections.push(`  [${d.severity.toUpperCase()}] ${d.file}:${d.line} — ${d.message}`);
      }
    }

    return sections.join('\n');
  }
}
