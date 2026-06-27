# System Patterns

## Architecture

```
VS Code Extension (extension.ts)
  ├── ProviderFactory → ILLMProvider (DeepSeek)
  ├── Orchestrator → IOrchestrator
  │   ├── ToolRegistry → IToolRegistry
  │   │   ├── Local tools (file ops, etc.)
  │   │   └── MCP tools (via McpToolAdapter)
  │   └── Workflow → IWorkflow (Agentic | Direct | ReAct)
  └── SpireSidebarProvider (WebviewView)
      └── SpireChatPanel
          └── ChatHtmlProvider (HTML template)
```

## Key Patterns

### 1. Interface-based Architecture
All major components are defined by interfaces in `src/core/interfaces/`. Implementations can be swapped without affecting consumers.

### 2. Provider Factory (Strategy Pattern)
`ProviderFactory.create()` returns an `ILLMProvider` implementation based on the `type` parameter, enabling easy addition of new LLM backends.

### 3. Tool Registry (Registry Pattern)
A central `ToolRegistry` holds all available tools (both local and MCP-synced). The orchestrator uses it during workflow execution.

### 4. MCP Tool Adapter (Adapter Pattern)
`McpToolAdapter` connects to MCP servers, discovers their tools, and wraps them as `Tool` objects registered in the local `ToolRegistry`. The adapter also supports auto-syncing on a timer.

### 5. Workflow Strategy (Strategy Pattern)
The orchestrator delegates execution to a pluggable `IWorkflow` implementation. Three strategies exist: Agentic (default), Direct (single LLM call), and ReAct (tool-use loop).

### 6. Orchestration Layer
The `Orchestrator` is the central coordinator, owning the LLM provider, tool registry, workflow, and context. It exposes `handleUserRequest()` as the main entry point.

## Data Flow
1. User sends message via sidebar
2. `SpireChatPanel` receives message, sends to `Orchestrator.handleUserRequest()`
3. Orchestrator passes to current `Workflow.execute()`
4. Workflow uses `ILLMProvider` for completions, `IToolRegistry` for tool access
5. Result is returned back up to the sidebar for display
