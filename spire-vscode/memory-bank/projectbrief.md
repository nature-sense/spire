# Project Brief

## Core Requirements
- Provide an AI-powered coding assistant inside VS Code
- Integrate with DeepSeek LLM API for natural language responses
- Support the Model Context Protocol (MCP) for external tool connectivity
- Maintain a Memory Bank for cross-session context
- Extensible via MCP servers (trap ops, file operations, etc.)

## Goals
- Modular architecture with clear separation of concerns
- MCP-first design for tool integration
- Multiple workflow strategies (agentic, direct, ReAct)
- Clean TypeScript compilation with zero errors
- Packaged and installable as a VS Code extension

## Constraints
- Must run inside VS Code extension host (Node.js)
- Webview-based sidebar UI
- Communication with MCP servers via JSON-RPC over stdio
- DeepSeek API as primary LLM backend

## Timeline
- v0.1.0: Architecture refactoring complete, TypeScript compiles, extension installed
