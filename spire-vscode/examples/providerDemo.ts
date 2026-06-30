/**
 * Usage demonstration for GraphMemoryProvider.
 *
 * Run with: npx tsx examples/providerDemo.ts
 * (from the spire-vscode directory)
 */

import { GraphMemoryProvider } from '../src/providers/GraphMemoryProvider';
import type { ProviderDecision } from '../src/providers/types';

// ── Helpers ───────────────────────────────────

function printDecision(label: string, decision: ProviderDecision): void {
  console.log(`\n── ${label} ──`);
  console.log(`  Tool:       ${decision.toolName || '(none)'}`);
  console.log(`  Confidence: ${(decision.confidence * 100).toFixed(0)}%`);
  console.log(`  Augmented:  ${decision.augmented}`);
  console.log(`  Reasoning:  ${decision.reasoning || '(none)'}`);
  if (decision.arguments && Object.keys(decision.arguments).length > 0) {
    console.log(`  Arguments:  ${JSON.stringify(decision.arguments, null, 4)}`);
  }
}

// ── Demo ───────────────────────────────────────

console.log('╔═══════════════════════════════════════════════╗');
console.log('║     GraphMemoryProvider — Usage Demo          ║');
console.log('╚═══════════════════════════════════════════════╝');

// 1. Create provider with initial session context
const provider = new GraphMemoryProvider({
  currentSessionId: 'session-abc-123',
  userId: 'user-demo-001',
});

// 2. Session Creation
printDecision(
  'Session Creation (full)',
  provider.analyzePrompt('Start a session for camera driver on i.MX8M Plus with BSP 5.7.0')
);

// 3. Session Creation (simple)
printDecision(
  'Session Creation (simple)',
  provider.analyzePrompt('new session for wifi')
);

// 4. Session Listing
printDecision(
  'Session Listing',
  provider.analyzePrompt('list my sessions')
);

// 5. Session Status
printDecision(
  'Session Status',
  provider.analyzePrompt("what's the status")
);

// 6. Session Resume
printDecision(
  'Session Resume',
  provider.analyzePrompt('resume my camera driver session')
);

// 7. Selection Resolution (letter)
printDecision(
  'Selection (letter)',
  provider.analyzePrompt('B')
);

// 8. Selection Resolution (number)
printDecision(
  'Selection (number)',
  provider.analyzePrompt('2')
);

// 9. Selection Resolution (ordinal)
printDecision(
  'Selection (ordinal)',
  provider.analyzePrompt('second')
);

// 10. Feedback (negative)
printDecision(
  'Feedback (negative)',
  provider.analyzePrompt("That didn't work")
);

// 11. Feedback (correction)
printDecision(
  'Feedback (correction)',
  provider.analyzePrompt('correction: The pin mapping is wrong')
);

// 12. Session Closure
printDecision(
  'Session Closure',
  provider.analyzePrompt('close this session')
);

// 13. No Match (irrelevant query)
printDecision(
  'No Match (irrelevant)',
  provider.analyzePrompt("What's the weather in London?")
);

// 14. Dynamic session ID update
console.log('\n\n── Dynamic Session ID Update ──');
provider.setCurrentSessionId('session-xyz-789');
const decisionWithNewSession = provider.analyzePrompt('B');
console.log(`  After setCurrentSessionId('session-xyz-789'):`);
console.log(`  Session ID in args: ${decisionWithNewSession.arguments?.session_id}`);

// 15. Provider Info
console.log('\n\n── Provider Info ──');
const info = provider.getProviderInfo();
console.log(`  Name:               ${info.name}`);
console.log(`  Version:            ${info.version}`);
console.log(`  Tools supported:    ${info.supportedTools.length}`);
console.log(`  Confidence thresh:  ${info.confidenceThreshold}`);

console.log('\n✓ Demo complete.');
