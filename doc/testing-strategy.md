# Spire Testing Strategy

## Overview

The Spire VS Code extension utilizes **Vitest** as its primary test runner. The testing approach is designed to verify the logic of the extension entirely within a Node.js environment, providing fast and reliable feedback. 

To achieve this without relying on external services or requiring a full VS Code extension host environment for every test, the project relies heavily on mocking:
- **`nock`**: Used to intercept and mock outbound HTTP requests, specifically those communicating with external APIs like the DeepSeek LLM.
- **`vi.mock()`**: Used to mock the VS Code API and file system operations, isolating the business logic from the editor environment.

## Test Organization

Tests are organized into three main categories under the `spire-vscode/test/` directory, reflecting their scope and purpose:

1. **Unit Tests (`test/unit/`)**: Tests individual classes and components in isolation to ensure their internal logic is correct.
2. **Integration Tests (`test/integration/`)**: Tests the interaction between multiple components (e.g., the orchestrator and workflows) to ensure they integrate properly.
3. **End-to-End (E2E) Tests (`test/e2e/`)**: Tests full execution flows using mocks. These simulate complete user interactions from request to final response without hitting live services.

## Test Inventory and Descriptions

Below is a comprehensive list of the test suites and what they verify.

### 1. Unit Tests

**LLM Provider (`test/unit/llm/deepseek-provider.test.ts`)**
- Verifies the `sendMessage()` method formats the request payload correctly and parses the response properly.
- Ensures that tools are correctly formatted into the request schema when provided to the LLM.
- Validates that HTTP errors from the API throw the appropriate `ProviderError`.
- Verifies the `validateApiKey()` function correctly handles `200 OK` (valid) and `401 Unauthorized` (invalid) responses.

**Prompt Augmenter (`test/unit/augmenter/GraphPromptAugmenter.test.ts`)**
- Verifies that `processPrompt()` returns the original prompt unchanged if the provider decides to skip augmentation.
- Ensures that prompts are correctly augmented with context if the provider decides to execute a tool call (e.g., `graph-memory__semantic_search`).
- Validates that the original prompt is returned gracefully if a tool call fails during augmentation.
- Tests the `truncateContext()` logic to ensure massive context blocks are shortened appropriately to fit within token limits.

**ReAct Workflow (`test/unit/orchestration/react.test.ts`)**
- Verifies that `execute()` handles direct responses correctly when the LLM does not request any tool calls.
- Ensures that the workflow can parse tool calls, execute them, feed the results back to the LLM, and loop until a final answer is reached.
- Validates that the execution loop handles the maximum iterations limit gracefully to prevent infinite loops.

**Agentic Workflow (`test/unit/orchestration/agentic-workflow.test.ts`)**
- Tests that `execute()` correctly handles a direct response from the LLM without requiring tool calls.
- Verifies that the workflow accurately parses and executes tool calls, then loops to allow the agent to reason about the tool results.

**Context Builder (`test/unit/orchestration/context-builder.test.ts`)**
- Verifies that `build()` successfully assembles the `WorkspaceContext`, properly mocking file system operations.
- Ensures `buildSystemPrompt()` correctly includes the tech stack, memory bank data, and custom rules.
- Validates that the system prompt builder skips missing features gracefully without throwing errors.

### 2. Integration Tests

**Orchestrator Integration (`test/integration/orchestrator.test.ts`)**
- Verifies that `handleUserRequest()` correctly triggers the execution of a tool call, and that the result of the tool call is successfully fed back to the LLM to generate the final response.

### 3. End-to-End (E2E) Tests

**E2E Prompt Flow (`test/e2e/prompt-flow.test.ts`)**
- Ensures that a complete prompt flow (from user input to augmentation to final LLM response) executes successfully under simulated conditions.

**DeepSeek Orchestrator E2E (`test/e2e/deepseek-orchestrator-test.test.ts`)**
- Verifies that the orchestrator paired with the mocked DeepSeek provider can handle a direct request end-to-end.

**DeepSeek Debug Flow (`test/e2e/deepseek-debug.test.ts`)**
- Validates a full, complex E2E flow using deep debugging mocks to ensure all active mocks resolve as expected.

**Mocking Infrastructure (`test/e2e/nock-test.test.ts`, `test/e2e/nock-mock-test.test.ts`)**
- Validates that `nock` correctly intercepts `https.request` calls within the Vitest environment.
- Ensures that `nock` continues to intercept HTTP requests correctly even when standard modules (like `vscode`) are aggressively mocked.