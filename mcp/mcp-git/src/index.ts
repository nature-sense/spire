#!/usr/bin/env node

/**
 * mcp-git — MCP server for git operations.
 *
 * Tool: git_operation
 *   - status: Show working tree status
 *   - diff: Show changes
 *   - log: Show commit history
 *   - add: Stage files
 *   - commit: Create commit
 *   - branch: List/create/delete branches
 *   - checkout: Switch branches or restore files
 *   - pull: Fetch and merge
 *   - push: Push to remote
 */

import { simpleGit, SimpleGit, StatusResult, DiffResult } from 'simple-git';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GitOperationArgs {
  files?: string[];
  message?: string;
  branch?: string;
  remote?: string;
  limit?: number;
  file?: string;
}

interface GitResult {
  success: boolean;
  data: any;
  message: string;
}

// ---------------------------------------------------------------------------
// Git Operations
// ---------------------------------------------------------------------------

class GitOperations {
  private git: SimpleGit;

  constructor(repoPath: string = process.cwd()) {
    this.git = simpleGit(repoPath);
  }

  async execute(operation: string, args: GitOperationArgs = {}): Promise<GitResult> {
    try {
      switch (operation) {
        case 'status':
          return await this.status();
        case 'diff':
          return await this.diff(args);
        case 'log':
          return await this.log(args);
        case 'add':
          return await this.add(args);
        case 'commit':
          return await this.commit(args);
        case 'branch':
          return await this.branch(args);
        case 'checkout':
          return await this.checkout(args);
        case 'pull':
          return await this.pull(args);
        case 'push':
          return await this.push(args);
        default:
          throw new Error(`Unknown git operation: ${operation}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        data: null,
        message: `Git operation failed: ${message}`,
      };
    }
  }

  // ── status ────────────────────────────────────────────────────────────────

  private async status(): Promise<GitResult> {
    const status: StatusResult = await this.git.status();
    return {
      success: true,
      data: {
        modified: status.modified,
        created: status.created,
        deleted: status.deleted,
        not_added: status.not_added,
        staged: status.staged,
        ahead: status.ahead,
        behind: status.behind,
        current: status.current,
        tracking: status.tracking,
        files: status.files,
      },
      message: `On branch ${status.current}`,
    };
  }

  // ── diff ──────────────────────────────────────────────────────────────────

  private async diff(args: GitOperationArgs): Promise<GitResult> {
    // simple-git v3 diff() returns a plain string (raw diff output)
    const raw = await this.git.diff(args.files);
    // diffSummary() returns structured DiffResult
    const summary: DiffResult = await this.git.diffSummary();

    return {
      success: true,
      data: {
        changed: summary.changed,
        insertions: summary.insertions,
        deletions: summary.deletions,
        files: summary.files,
        raw,
      },
      message: `Diff for ${args.files?.join(', ') || 'all files'} — ${summary.changed} file(s) changed`,
    };
  }

  // ── log ───────────────────────────────────────────────────────────────────

  private async log(args: GitOperationArgs): Promise<GitResult> {
    const limit = args.limit || 10;
    const log = await this.git.log({
      maxCount: limit,
      file: args.file,
    });

    return {
      success: true,
      data: {
        commits: log.all.map((commit) => ({
          hash: commit.hash,
          date: commit.date,
          message: commit.message,
          author: commit.author_name,
          email: commit.author_email,
          refs: commit.refs,
        })),
        total: log.total,
        latest: log.latest,
      },
      message: `Showing ${log.all.length} of ${log.total} commits`,
    };
  }

  // ── add ───────────────────────────────────────────────────────────────────

  private async add(args: GitOperationArgs): Promise<GitResult> {
    const files = args.files || ['.'];
    await this.git.add(files);

    return {
      success: true,
      data: { files },
      message: `Added ${files.join(', ')}`,
    };
  }

  // ── commit ────────────────────────────────────────────────────────────────

  private async commit(args: GitOperationArgs): Promise<GitResult> {
    if (!args.message) {
      throw new Error('Commit message is required');
    }

    const files = args.files || [];
    const result = await this.git.commit(args.message, files);

    return {
      success: true,
      data: {
        commit: result.commit,
        summary: result.summary,
      },
      message: `Committed: ${args.message}`,
    };
  }

  // ── branch ────────────────────────────────────────────────────────────────

  private async branch(args: GitOperationArgs): Promise<GitResult> {
    const branches = await this.git.branch();

    if (args.branch) {
      // Create new branch
      await this.git.checkoutLocalBranch(args.branch);
      return {
        success: true,
        data: { branch: args.branch },
        message: `Created and switched to branch ${args.branch}`,
      };
    }

    return {
      success: true,
      data: {
        current: branches.current,
        all: branches.all,
        branches: branches.branches,
      },
      message: `Current branch: ${branches.current}`,
    };
  }

  // ── checkout ──────────────────────────────────────────────────────────────

  private async checkout(args: GitOperationArgs): Promise<GitResult> {
    if (args.branch) {
      await this.git.checkout(args.branch);
      return {
        success: true,
        data: { branch: args.branch },
        message: `Switched to branch ${args.branch}`,
      };
    } else if (args.files && args.files.length > 0) {
      await this.git.checkout(args.files);
      return {
        success: true,
        data: { files: args.files },
        message: `Restored ${args.files.join(', ')}`,
      };
    }

    throw new Error('Either branch or files are required for checkout');
  }

  // ── pull ──────────────────────────────────────────────────────────────────

  private async pull(args: GitOperationArgs): Promise<GitResult> {
    const remote = args.remote || 'origin';
    const branch = args.branch || 'main';
    await this.git.pull(remote, branch);

    return {
      success: true,
      data: { remote, branch },
      message: `Pulled from ${remote}/${branch}`,
    };
  }

  // ── push ──────────────────────────────────────────────────────────────────

  private async push(args: GitOperationArgs): Promise<GitResult> {
    const remote = args.remote || 'origin';
    const branch = args.branch || 'main';
    await this.git.push(remote, branch);

    return {
      success: true,
      data: { remote, branch },
      message: `Pushed to ${remote}/${branch}`,
    };
  }
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new Server(
  {
    name: 'mcp-git',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// ── ListTools ──────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'git_operation',
      description:
        'Perform git operations (status, diff, log, add, commit, branch, checkout, pull, push)',
      inputSchema: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: [
              'status',
              'diff',
              'log',
              'add',
              'commit',
              'branch',
              'checkout',
              'pull',
              'push',
            ],
            description: 'Git operation to perform',
          },
          args: {
            type: 'object',
            properties: {
              files: {
                type: 'array',
                items: { type: 'string' },
                description: 'Files for operation (add, checkout, commit, diff)',
              },
              message: {
                type: 'string',
                description: 'Commit message (required for commit)',
              },
              branch: {
                type: 'string',
                description: 'Branch name (branch, checkout, pull, push)',
              },
              remote: {
                type: 'string',
                description: 'Remote name (pull, push — defaults to origin)',
              },
              limit: {
                type: 'integer',
                description: 'Number of log entries (log — defaults to 10)',
              },
              file: {
                type: 'string',
                description: 'Specific file to filter log (log)',
              },
            },
          },
          repoPath: {
            type: 'string',
            description: 'Repository path (defaults to current working directory)',
          },
        },
        required: ['operation'],
      },
    },
  ],
}));

// ── CallTool ───────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name !== 'git_operation') {
    throw new Error(`Unknown tool: ${name}`);
  }

  // Validate required operation
  if (!args || typeof args.operation !== 'string') {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { error: 'Missing required parameter: operation (string)' },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }

  try {
    const { operation, args: operationArgs = {}, repoPath } = args as {
      operation: string;
      args?: GitOperationArgs;
      repoPath?: string;
    };

    // Initialize git operations with repo path
    const gitOps = new GitOperations(repoPath || process.cwd());
    const result = await gitOps.execute(operation, operationArgs);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: message }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.error('[mcp-git] Starting server...');

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[mcp-git] Server running on stdio');
}

process.on('SIGINT', async () => {
  console.error('[mcp-git] Shutting down...');
  await server.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error('[mcp-git] Shutting down...');
  await server.close();
  process.exit(0);
});

main().catch((err) => {
  console.error('[mcp-git] Fatal error:', err);
  process.exit(1);
});
