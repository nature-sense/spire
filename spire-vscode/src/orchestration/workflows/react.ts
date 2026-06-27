import { IWorkflow, WorkflowOptions, WorkflowResult } from '../../core/interfaces/workflow';

import { ILLMProvider } from '../../core/interfaces/llm-provider';
import { IToolRegistry } from '../../core/interfaces/tool-registry';
import { WorkspaceContext } from '../../core/models/context';
import { Message, ToolCall } from '../../core/models/message';

/**
 * ReAct workflow: Reasoning + Acting loop.
 * - Think (reasoning step)
 * - Act (tool call)
 * - Observe (tool result)
 * - Repeat until complete
 *
 * Designed for DeepSeek V4's native thinking capabilities.
 * The model uses its internal reasoning_content for deliberation;
 * exposed output is kept concise.
 */
export class ReActWorkflow implements IWorkflow {
  name = 'react';
  description = 'Reasoning + Acting loop: Think, Act, Observe, Repeat.';

  async execute(
    userMessage: string,
    context: WorkspaceContext,
    llm: ILLMProvider,
    tools: IToolRegistry,
    options?: WorkflowOptions
  ): Promise<WorkflowResult> {
    const maxIterations = options?.maxIterations ?? 15;
    const temperature = options?.temperature ?? 0.7;

    const systemPrompt = this.buildSystemPrompt(context);
    const allTools = tools.list();

    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ];

    let iteration = 0;
    let fullResponse = '';
    let fullReasoning: string | undefined;

    while (iteration < maxIterations) {
      iteration++;

      const response = await llm.sendMessage(messages, {
        temperature,
        tools: allTools,
        toolChoice: 'auto'
      });

      // Capture reasoning from the final response (last non-tool-call iteration)
      if (!response.toolCalls || response.toolCalls.length === 0) {
        fullReasoning = response.reasoning;
      }

      if (response.toolCalls && response.toolCalls.length > 0) {
        // Add the assistant's thought + tool calls to history
        messages.push({
          role: 'assistant',
          content: response.content,
          toolCalls: response.toolCalls
        });

        // Execute each tool call in sequence
        for (const tc of response.toolCalls) {
          const args = this.parseToolCall(tc);

          const result = await tools.execute(tc.function.name, args);

          // Add observation (tool result) to messages
          messages.push({
            role: 'tool',
            content: result.success
              ? `[Result] ${result.content}`
              : `[Error] ${result.error || 'Tool execution failed'}`,
            toolCallId: tc.id
          });
        }
      } else {
        // No more tool calls - this is the final answer
        fullResponse = response.content;
        break;
      }
    }

    if (!fullResponse) {
      fullResponse = 'Reached maximum iteration limit. Here\'s what I\'ve done so far:\n\n';
      // Find the last assistant message
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'assistant' && messages[i].content) {
          fullResponse += messages[i].content;
          break;
        }
      }
    }

    return { content: fullResponse, reasoning: fullReasoning };
  }


  private parseToolCall(tc: ToolCall): any {
    try {
      return JSON.parse(tc.function.arguments);
    } catch {
      return {};
    }
  }

  private buildSystemPrompt(context: WorkspaceContext): string {
    const sections: string[] = [
      '# Role',
      'You are Spire, an autonomous coding assistant inside VS Code with full tool access.',
      '',
      '# Loop',
      'You operate in a ReAct loop. For each step:',
      '',
      '1️. Reason — Analyze the current state. What do you know? What do you need? What is the next logical step?',
      '2️. Act — Call one tool with precise arguments.',
      '3️. Observe — Read the result. Did it work? What did you learn? Decide the next step.',
      '',
      'Repeat until the task is complete. Use DeepSeek V4\'s native reasoning (thinking) internally for deliberation.',
      '',
      '# Tool Rules',
      '- Call tools one at a time with a clear purpose.',
      '- Read the minimum needed to understand context.',
      '- On error: diagnose, then retry with a corrected call.',
      '- After repeated failures on the same sub-task: stop and report the blocker.',
      '',
      '# Output Style',
      '- Direct and concise. Keeps explanations brief.',
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
