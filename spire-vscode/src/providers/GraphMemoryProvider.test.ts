/**
 * Tests for GraphMemoryProvider.
 *
 * These are plain assertion-based tests (no test runner dependency).
 * Run with: npx tsx src/providers/GraphMemoryProvider.test.ts
 */

import {
  GraphMemoryProvider,
  _extractSessionDetails,
  _extractReference,
  _matchPatterns,
} from './GraphMemoryProvider';
import type { ProviderDecision } from './types';

// ──────────────────────────────────────────────
// Test Utilities
// ──────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${message}`);
  }
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${message}`);
    console.error(`  Expected: ${JSON.stringify(expected)}`);
    console.error(`  Actual:   ${JSON.stringify(actual)}`);
  }
}

function assertApprox(actual: number, expected: number, tolerance: number, message: string): void {
  if (Math.abs(actual - expected) <= tolerance) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${message}`);
    console.error(`  Expected approx: ${expected}`);
    console.error(`  Actual:          ${actual}`);
  }
}

function assertHasKey(obj: Record<string, any>, key: string, message: string): void {
  if (key in obj) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${message}`);
    console.error(`  Missing key: "${key}" in ${JSON.stringify(obj)}`);
  }
}

function assertToolName(decision: ProviderDecision, expected: string | undefined, message: string): void {
  assert(decision.toolName === expected, `${message} (toolName: "${decision.toolName}" vs "${expected}")`);
}

function assertConfidenceAbove(decision: ProviderDecision, min: number, message: string): void {
  assert(decision.confidence >= min, `${message} (confidence: ${decision.confidence} < ${min})`);
}

function assertAugmented(decision: ProviderDecision, expected: boolean, message: string): void {
  assert(decision.augmented === expected, `${message} (augmented: ${decision.augmented})`);
}

// ──────────────────────────────────────────────
// Tests: _extractSessionDetails
// ──────────────────────────────────────────────

console.log('\n=== _extractSessionDetails ===\n');

{
  const result = _extractSessionDetails(
    'Start a session for camera driver on i.MX8M Plus with BSP 5.7.0'
  );
  assertEquals(result.project, 'camera_driver', 'extracts project name');
  assertEquals(result.target_hardware, 'i.MX8M Plus', 'extracts hardware');
  assertEquals(result.target_bsp, '5.7.0', 'extracts BSP version');
  assertEquals(
    result.title,
    'camera driver on i.MX8M Plus BSP 5.7.0',
    'builds title from details'
  );
}

{
  const result = _extractSessionDetails('new session for wifi');
  assertEquals(result.project, 'wifi', 'extracts simple project');
  assertEquals(result.target_hardware, undefined, 'no hardware for simple project');
  assertEquals(result.title, 'wifi', 'title is just project');
}

{
  const result = _extractSessionDetails('begin a session');
  assertEquals(result.project, undefined, 'no project for generic begin');
  assertEquals(result.title, undefined, 'no title for generic begin');
}

{
  const result = _extractSessionDetails(
    'create session for audio driver on QCS6490 with BSP 6.1.0'
  );
  assertEquals(result.project, 'audio_driver', 'extracts audio driver project');
  assertEquals(result.target_hardware, 'QCS6490', 'extracts QCS hardware');
  assertEquals(result.target_bsp, '6.1.0', 'extracts BSP 6.1.0');
  assertEquals(
    result.title,
    'audio driver on QCS6490 BSP 6.1.0',
    'builds title with BSP'
  );
}

// ──────────────────────────────────────────────
// Tests: _extractReference
// ──────────────────────────────────────────────

console.log('\n=== _extractReference ===\n');

assertEquals(_extractReference('resume my camera driver session'), 'camera driver', 'extracts reference from resume');
assertEquals(_extractReference('continue the bootloader session'), 'bootloader', 'extracts reference from continue');
assertEquals(_extractReference('open "QCS6490"'), 'QCS6490', 'extracts quoted reference');
assertEquals(_extractReference('switch to wifi'), 'wifi', 'extracts reference from switch to');

// ──────────────────────────────────────────────
// Tests: _matchPatterns
// ──────────────────────────────────────────────

console.log('\n=== _matchPatterns ===\n');

{
  const patterns = [
    { regex: /^test (.+)$/i, confidence: 0.8, extract: () => ({}) },
    { regex: /^test (.+) with (.+)$/i, confidence: 0.9, extract: () => ({}) },
  ];
  const result = _matchPatterns(patterns, 'test hello with world');
  assert(result !== null, 'matches best pattern');
  assertEquals(result!.pattern.confidence, 0.9, 'selects highest confidence pattern');
}

{
  const patterns = [
    { regex: /^hello/i, confidence: 0.5, extract: () => ({}) },
  ];
  const result = _matchPatterns(patterns, 'no match');
  assertEquals(result, null, 'returns null for no match');
}

// ──────────────────────────────────────────────
// Tests: GraphMemoryProvider - Constructor
// ──────────────────────────────────────────────

console.log('\n=== GraphMemoryProvider - Constructor ===\n');

{
  const provider = new GraphMemoryProvider();
  assert(provider instanceof GraphMemoryProvider, 'creates instance with no options');
}

{
  const provider = new GraphMemoryProvider({ currentSessionId: 'session-123', userId: 'user-456' });
  assert(provider instanceof GraphMemoryProvider, 'creates instance with options');
}

// ──────────────────────────────────────────────
// Tests: GraphMemoryProvider - Selection
// ──────────────────────────────────────────────

console.log('\n=== Selection Detection ===\n');

{
  const provider = new GraphMemoryProvider({ currentSessionId: 'session-1' });
  const decision = provider.analyzePrompt('B');
  assertToolName(decision, 'graph-memory__resolve_selection', 'single letter B');
  assertEquals(decision.arguments?.label, 'B', 'label is B');
  assertEquals(decision.arguments?.session_id, 'session-1', 'includes session_id');
  assertConfidenceAbove(decision, 0.9, 'high confidence');
}

{
  const provider = new GraphMemoryProvider({ currentSessionId: 'session-1' });
  const decision = provider.analyzePrompt('option C');
  assertToolName(decision, 'graph-memory__resolve_selection', 'option C');
  assertEquals(decision.arguments?.label, 'C', 'label is C');
}

{
  const provider = new GraphMemoryProvider({ currentSessionId: 'session-1' });
  const decision = provider.analyzePrompt('second');
  assertToolName(decision, 'graph-memory__resolve_selection', 'second ordinal');
  assertEquals(decision.arguments?.label, 'B', 'second maps to B');
}

{
  const provider = new GraphMemoryProvider({ currentSessionId: 'session-1' });
  const decision = provider.analyzePrompt('3');
  assertToolName(decision, 'graph-memory__resolve_selection', 'number 3');
  assertEquals(decision.arguments?.label, 'C', '3 maps to C');
}

{
  const provider = new GraphMemoryProvider(); // no session ID set
  const decision = provider.analyzePrompt('A');
  assertToolName(decision, 'graph-memory__resolve_selection', 'A without session');
  assertEquals(decision.arguments?.session_id, undefined, 'no session_id when not set');
}

// ──────────────────────────────────────────────
// Tests: GraphMemoryProvider - Feedback
// ──────────────────────────────────────────────

console.log('\n=== Feedback Detection ===\n');

{
  const provider = new GraphMemoryProvider({ currentSessionId: 'session-1' });
  const decision = provider.analyzePrompt("That didn't work");
  assertToolName(decision, 'graph-memory__store_feedback', 'negative feedback');
  assertEquals(decision.arguments?.type, 'negative', 'type is negative');
  assertEquals(decision.arguments?.session_id, 'session-1', 'includes session_id');
  assertConfidenceAbove(decision, 0.8, 'high confidence');
}

{
  const provider = new GraphMemoryProvider({ currentSessionId: 'session-1' });
  const decision = provider.analyzePrompt('correction: The BSP version is 5.7.1 not 5.7.0');
  assertToolName(decision, 'graph-memory__store_feedback', 'correction feedback');
  assertEquals(decision.arguments?.type, 'correction', 'type is correction');
  assertEquals(
    decision.arguments?.text,
    'The BSP version is 5.7.1 not 5.7.0',
    'extracts correction text'
  );
}

{
  const provider = new GraphMemoryProvider({ currentSessionId: 'session-1' });
  const decision = provider.analyzePrompt('this is wrong');
  assertToolName(decision, 'graph-memory__store_feedback', '"this is wrong" feedback');
  assertEquals(decision.arguments?.type, 'negative', 'type is negative');
}

// ──────────────────────────────────────────────
// Tests: GraphMemoryProvider - Session Creation
// ──────────────────────────────────────────────

console.log('\n=== Session Creation Detection ===\n');

{
  const provider = new GraphMemoryProvider({ userId: 'user-1' });
  const decision = provider.analyzePrompt('Start a session for camera driver on i.MX8M Plus with BSP 5.7.0');
  assertToolName(decision, 'graph-memory__create_session', 'full session creation');
  assertEquals(decision.arguments?.project, 'camera_driver', 'extracts project');
  assertEquals(decision.arguments?.target_hardware, 'i.MX8M Plus', 'extracts hardware');
  assertEquals(decision.arguments?.target_bsp, '5.7.0', 'extracts BSP');
  assertEquals(decision.arguments?.user_id, 'user-1', 'includes user_id');
  assertConfidenceAbove(decision, 0.9, 'high confidence');
}

{
  const provider = new GraphMemoryProvider();
  const decision = provider.analyzePrompt('new session for wifi');
  assertToolName(decision, 'graph-memory__create_session', 'simple session creation');
  assertEquals(decision.arguments?.project, 'wifi', 'extracts simple project');
  assertConfidenceAbove(decision, 0.9, 'high confidence');
}

{
  const provider = new GraphMemoryProvider();
  const decision = provider.analyzePrompt('begin a session');
  assertToolName(decision, 'graph-memory__create_session', 'generic session begin');
  assertEquals(decision.arguments?.project, undefined, 'no project for generic begin');
}

// ──────────────────────────────────────────────
// Tests: GraphMemoryProvider - Session Listing
// ──────────────────────────────────────────────

console.log('\n=== Session Listing Detection ===\n');

{
  const provider = new GraphMemoryProvider();
  const decision = provider.analyzePrompt('list my sessions');
  assertToolName(decision, 'graph-memory__get_sessions', 'list sessions');
  assertConfidenceAbove(decision, 0.9, 'high confidence');
}

{
  const provider = new GraphMemoryProvider();
  const decision = provider.analyzePrompt('show active sessions');
  assertToolName(decision, 'graph-memory__get_sessions', 'show active sessions');
}

{
  const provider = new GraphMemoryProvider();
  const decision = provider.analyzePrompt('view sessions');
  assertToolName(decision, 'graph-memory__get_sessions', 'view sessions');
}

// ──────────────────────────────────────────────
// Tests: GraphMemoryProvider - Session Status
// ──────────────────────────────────────────────

console.log('\n=== Session Status Detection ===\n');

{
  const provider = new GraphMemoryProvider({ currentSessionId: 'session-1' });
  const decision = provider.analyzePrompt("what's the status");
  assertToolName(decision, 'graph-memory__get_session_context', 'status query');
  assertEquals(decision.arguments?.session_id, 'session-1', 'includes session_id');
  assertConfidenceAbove(decision, 0.8, 'high confidence');
}

{
  const provider = new GraphMemoryProvider({ currentSessionId: 'session-1' });
  const decision = provider.analyzePrompt('show progress');
  assertToolName(decision, 'graph-memory__get_session_context', 'progress query');
}

{
  const provider = new GraphMemoryProvider({ currentSessionId: 'session-1' });
  const decision = provider.analyzePrompt('where am I');
  assertToolName(decision, 'graph-memory__get_session_context', 'where am I query');
}

// ──────────────────────────────────────────────
// Tests: GraphMemoryProvider - Session Resume
// ──────────────────────────────────────────────

console.log('\n=== Session Resume Detection ===\n');

{
  const provider = new GraphMemoryProvider();
  const decision = provider.analyzePrompt('resume my camera driver session');
  assertToolName(decision, 'graph-memory__find_sessions_by_reference', 'resume by project');
  assertEquals(decision.arguments?.reference, 'camera driver', 'extracts reference');
  assertConfidenceAbove(decision, 0.8, 'high confidence');
}

{
  const provider = new GraphMemoryProvider();
  const decision = provider.analyzePrompt('continue the bootloader session');
  assertToolName(decision, 'graph-memory__find_sessions_by_reference', 'continue session');
  assertEquals(decision.arguments?.reference, 'bootloader', 'extracts bootloader reference');
}

{
  const provider = new GraphMemoryProvider();
  const decision = provider.analyzePrompt('switch to wifi');
  assertToolName(decision, 'graph-memory__find_sessions_by_reference', 'switch to session');
  assertEquals(decision.arguments?.reference, 'wifi', 'extracts wifi reference');
}

// ──────────────────────────────────────────────
// Tests: GraphMemoryProvider - Session Close
// ──────────────────────────────────────────────

console.log('\n=== Session Close Detection ===\n');

{
  const provider = new GraphMemoryProvider({ currentSessionId: 'session-1' });
  const decision = provider.analyzePrompt('close this session');
  assertToolName(decision, 'graph-memory__close_session', 'close session');
  assertEquals(decision.arguments?.session_id, 'session-1', 'includes session_id');
  assertConfidenceAbove(decision, 0.9, 'high confidence');
}

{
  const provider = new GraphMemoryProvider({ currentSessionId: 'session-1' });
  const decision = provider.analyzePrompt("I'm done with this");
  assertToolName(decision, 'graph-memory__close_session', 'done with session');
  assertConfidenceAbove(decision, 0.8, 'good confidence');
}

{
  const provider = new GraphMemoryProvider({ currentSessionId: 'session-1' });
  const decision = provider.analyzePrompt('end session');
  assertToolName(decision, 'graph-memory__close_session', 'end session');
}

// ──────────────────────────────────────────────
// Tests: GraphMemoryProvider - No Match
// ──────────────────────────────────────────────

console.log('\n=== No Match Detection ===\n');

{
  const provider = new GraphMemoryProvider();
  const decision = provider.analyzePrompt("What's the weather?");
  assertEquals(decision.toolName, undefined, 'no tool for weather query');
  assertEquals(decision.confidence, 0, 'zero confidence for no match');
  assertAugmented(decision, false, 'not augmented');
}

{
  const provider = new GraphMemoryProvider();
  const decision = provider.analyzePrompt('Tell me a joke');
  assertEquals(decision.toolName, undefined, 'no tool for joke');
  assertEquals(decision.confidence, 0, 'zero confidence');
}

{
  const provider = new GraphMemoryProvider();
  const decision = provider.analyzePrompt('');
  assertEquals(decision.toolName, undefined, 'no tool for empty prompt');
  assertEquals(decision.confidence, 0, 'zero confidence for empty');
  assertEquals(decision.reasoning, 'Empty prompt', 'reasoning for empty prompt');
}

// ──────────────────────────────────────────────
// Tests: GraphMemoryProvider - setCurrentSessionId
// ──────────────────────────────────────────────

console.log('\n=== setCurrentSessionId / setUserId ===\n');

{
  const provider = new GraphMemoryProvider();
  provider.setCurrentSessionId('session-42');
  let decision = provider.analyzePrompt('B');
  assertEquals(decision.arguments?.session_id, 'session-42', 'setCurrentSessionId takes effect');

  provider.setCurrentSessionId('session-99');
  decision = provider.analyzePrompt('B');
  assertEquals(decision.arguments?.session_id, 'session-99', 'setCurrentSessionId updates');
}

{
  const provider = new GraphMemoryProvider();
  provider.setUserId('user-abc');
  const decision = provider.analyzePrompt('start a session for test');
  assertEquals(decision.arguments?.user_id, 'user-abc', 'setUserId takes effect');
}

// ──────────────────────────────────────────────
// Tests: GraphMemoryProvider - getProviderInfo
// ──────────────────────────────────────────────

console.log('\n=== getProviderInfo ===\n');

{
  const provider = new GraphMemoryProvider();
  const info = provider.getProviderInfo();
  assertEquals(info.name, 'GraphMemoryProvider', 'provider name');
  assertEquals(info.version, '1.0.0', 'provider version');
  assert(Array.isArray(info.supportedTools), 'supportedTools is array');
  assert(info.supportedTools.length > 0, 'has supported tools');
  assertEquals(info.confidenceThreshold, 0.5, 'confidence threshold');
}

// ──────────────────────────────────────────────
// Report
// ──────────────────────────────────────────────

console.log('\n═══════════════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
