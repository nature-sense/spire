import { describe, it, expect } from 'vitest';
import { GraphQueryProvider } from '../../../src/providers/GraphQueryProvider';

describe('GraphQueryProvider', () => {
  const provider = new GraphQueryProvider();

  // ───── Tool Matching ─────

  it('matches query_knowledge_graph for "what is" prompts', () => {
    const decision = provider.analyzePrompt('what is authentication');
    expect(decision.toolName).toBe('graph-memory__query_knowledge_graph');
    expect(decision.arguments?.query).toBeTruthy();
    expect(decision.confidence).toBeGreaterThan(0);
  });

  it('matches query_knowledge_graph for "tell me about" prompts', () => {
    const decision = provider.analyzePrompt('tell me about the camera driver');
    expect(decision.toolName).toBe('graph-memory__query_knowledge_graph');
  });

  it('matches find_shortest_path for "path between" prompts', () => {
    const decision = provider.analyzePrompt('path between authentication and database');
    expect(decision.toolName).toBe('graph-memory__find_shortest_path');
    expect(decision.arguments?.source).toBeTruthy();
    expect(decision.arguments?.target).toBeTruthy();
  });

  it('matches find_shortest_path for "connection between" prompts', () => {
    const decision = provider.analyzePrompt('connection between login and auth');
    expect(decision.toolName).toBe('graph-memory__find_shortest_path');
  });

  it('matches get_node_neighbors for "connections of" prompts', () => {
    const decision = provider.analyzePrompt('connections of AuthModule');
    expect(decision.toolName).toBe('graph-memory__get_node_neighbors');
    expect(decision.arguments?.node_id).toBeTruthy();
  });

  it('matches get_node_neighbors for "neighbors of" prompts', () => {
    const decision = provider.analyzePrompt('neighbors of AuthModule');
    expect(decision.toolName).toBe('graph-memory__get_node_neighbors');
  });

  it('matches get_node_properties for "properties of" prompts', () => {
    const decision = provider.analyzePrompt('properties of AuthModule');
    expect(decision.toolName).toBe('graph-memory__get_node_properties');
    expect(decision.arguments?.node_id).toBeTruthy();
  });

  it('matches get_all_nodes for "list all" prompts', () => {
    const decision = provider.analyzePrompt('list all nodes');
    expect(decision.toolName).toBe('graph-memory__get_all_nodes');
    expect(decision.arguments?.limit).toBe(50);
  });

  it('matches project_status for "project status" prompts (without higher-priority prefix)', () => {
    const decision = provider.analyzePrompt('project status');
    expect(decision.toolName).toBe('graph-memory__project_status');
  });

  it('matches whats_blocking for "blocking" prompts (without higher-priority prefix)', () => {
    const decision = provider.analyzePrompt('blocking the audio driver');
    expect(decision.toolName).toBe('graph-memory__whats_blocking');
    expect(decision.arguments?.concept).toBeTruthy();
  });

  it('matches summarize for "summarize" prompts', () => {
    const decision = provider.analyzePrompt('summarize the project');
    expect(decision.toolName).toBe('graph-memory__summarize');
  });

  it('matches remember for "remember" prompts', () => {
    const decision = provider.analyzePrompt('remember that the BSP version is 5.7.0');
    expect(decision.toolName).toBe('graph-memory__remember');
    expect(decision.arguments?.concept).toBeTruthy();
    expect(decision.arguments?.details).toBeTruthy();
  });

  // ───── Priority Ordering ─────

  it('prefers higher-priority tool when multiple keywords match', () => {
    // "what is" (priority 1) should win over "properties of" (priority 4)
    const decision = provider.analyzePrompt('what is the properties of AuthModule');
    expect(decision.toolName).toBe('graph-memory__query_knowledge_graph');
  });

  // ───── Entity Extraction ─────

  it('extracts quoted entities', () => {
    const decision = provider.analyzePrompt('tell me about "Paris"');
    expect(decision.arguments?.query).toBe('Paris');
  });

  it('extracts entities between "X and Y" for path finding', () => {
    const decision = provider.analyzePrompt('path between Auth and Database');
    expect(decision.arguments?.source).toBe('Auth');
    expect(decision.arguments?.target).toBe('Database');
  });

  it('extracts entities after prepositions', () => {
    const decision = provider.analyzePrompt('tell me about the camera driver');
    expect(decision.arguments?.query).toContain('camera driver');
  });

  // ───── Graph Fallback ─────

  it('falls back to query_knowledge_graph for graph-related terms', () => {
    const decision = provider.analyzePrompt('graph concepts');
    expect(decision.toolName).toBe('graph-memory__query_knowledge_graph');
  });

  it('falls back to query_knowledge_graph for "knowledge" term', () => {
    const decision = provider.analyzePrompt('knowledge about something');
    expect(decision.toolName).toBe('graph-memory__query_knowledge_graph');
  });

  it('falls back to query_knowledge_graph for "memory" term', () => {
    const decision = provider.analyzePrompt('what is in memory');
    expect(decision.toolName).toBe('graph-memory__query_knowledge_graph');
  });

  // ───── No Match ─────

  it('returns empty toolName for non-graph prompts', () => {
    const decision = provider.analyzePrompt('hello world');
    expect(decision.toolName).toBe('');
    expect(decision.confidence).toBe(0);
  });

  it('returns empty toolName for empty prompt', () => {
    const decision = provider.analyzePrompt('');
    expect(decision.toolName).toBe('');
    expect(decision.confidence).toBe(0);
  });

  // ───── Confidence Scoring ─────

  it('returns confidence > 0 for clear matches', () => {
    const decision = provider.analyzePrompt('what is authentication');
    expect(decision.confidence).toBeGreaterThan(0);
  });

  it('caps confidence at 0.95', () => {
    const decision = provider.analyzePrompt('what is the status of the project and what is blocking it');
    expect(decision.confidence).toBeLessThanOrEqual(0.95);
  });

  // ───── Argument Building ─────

  it('builds remember args with concept and details', () => {
    const decision = provider.analyzePrompt('remember that BSP version is 5.7.0');
    // The "remember that" prefix is stripped, then "BSP version is 5.7.0" is captured
    // The "is" split gives concept="BSP version" and details="5.7.0"
    expect(decision.arguments?.concept).toBeTruthy();
    expect(decision.arguments?.details).toBeTruthy();
  });

  it('builds summarize args with category for project', () => {
    const decision = provider.analyzePrompt('summarize the project');
    expect(decision.arguments?.category).toBe('project');
  });

  it('builds get_all_nodes args with node_type filter', () => {
    const decision = provider.analyzePrompt('list all Person');
    expect(decision.toolName).toBe('graph-memory__get_all_nodes');
    // The regex (?:all|list)\s+([a-zA-Z_]+) captures "Person" from "all Person"
    expect(decision.arguments?.node_type).toBe('Person');
  });

  // ───── getProviderInfo ─────

  it('getProviderInfo returns correct metadata', () => {
    const info = provider.getProviderInfo();
    expect(info.name).toBe('GraphQueryProvider');
    expect(info.version).toBe('1.0.0');
    expect(info.supportedTools.length).toBeGreaterThan(0);
    expect(info.confidenceThreshold).toBe(0.5);
  });
});
