/**
 * GraphMemoryProvider — analyzes user prompts and decides which graph-memory
 * MCP tool to call for session management operations.
 *
 * Uses keyword matching and regex patterns to detect intent, extract arguments
 * from natural language prompts, and return a ProviderDecision with the
 * appropriate tool name, arguments, and confidence score.
 *
 * DETECTED INTENTS:
 *   Session Creation    → graph-memory__create_session
 *   Session Resumption  → graph-memory__find_sessions_by_reference
 *   Session Listing     → graph-memory__get_sessions
 *   Session Status      → graph-memory__get_session_context
 *   Session Closure     → graph-memory__close_session
 *   Store Feedback      → graph-memory__store_feedback
 *   Resolve Selection   → graph-memory__resolve_selection
 *
 * USAGE:
 *   const provider = new GraphMemoryProvider({ userId: 'user-123' });
 *   const decision = provider.analyzePrompt("Start a session for camera driver on IMX8M");
 *   // → { toolName: 'graph-memory__create_session', arguments: { ... }, confidence: 0.95 }
 */
import type { ProviderDecision, ToolCallProvider, ProviderInfo } from './types.js';

// ────────────────────────────────────────────────────────────────────────────
// Public Types
// ────────────────────────────────────────────────────────────────────────────

export interface GraphMemoryProviderOptions {
  /** Current session ID to use for operations that need it */
  currentSessionId?: string;
  /** User ID for session operations */
  userId?: string;
}

export interface SessionDetails {
  /** Project name (slugified) */
  project?: string;
  /** Target hardware platform */
  target_hardware?: string;
  /** BSP version or identifier */
  target_bsp?: string;
  /** Session title (auto-generated if not provided) */
  title?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Pattern Definitions
// ────────────────────────────────────────────────────────────────────────────

interface IntentPattern {
  /** Human-readable intent label */
  intent: string;
  /** MCP tool name to call */
  toolName: string;
  /** Keywords to search for (case-insensitive, whole-word) */
  keywords: string[];
  /** Regex patterns with capture groups for argument extraction */
  patterns: RegExp[];
  /** Base confidence when matched */
  baseConfidence: number;
  /** Whether a numeric confidence boost is allowed */
  allowExactBoost: boolean;
}

const INTENT_PATTERNS: IntentPattern[] = [
  // ── Selection Resolution ───────────────────────────────────────
  // Check first: short inputs that match immediately
  {
    intent: 'resolve_selection',
    toolName: 'graph-memory__resolve_selection',
    keywords: [],
    patterns: [
      // Single letter: A, B, C
      /^[A-Za-z]$/,
      // Digit: 1, 2, 3
      /^\d$/,
      // "option B", "option 2"
      /^(?:option|select|choose|pick|the)\s+([A-Za-z\d]+)$/i,
      // Ordinals: first, second, third, 1st, 2nd, 3rd
      /^(?:first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)$/i,
      // "the first one", "the second option"
      /^the\s+(?:first|second|third|1st|2nd|3rd)\s+(?:one|option)/i,
    ],
    baseConfidence: 0.95,
    allowExactBoost: false,
  },

  // ── Session Creation ───────────────────────────────────────────
  {
    intent: 'session_create',
    toolName: 'graph-memory__create_session',
    keywords: ['start', 'begin', 'new', 'create', 'initiate', 'launch'],
    patterns: [
      // "Start a session for camera driver on i.MX8M Plus with BSP 5.7.0"
      // Group 1 = project, Group 2 = hardware, Group 3 = BSP
      /(?:start|begin|new|create|initiate|launch)\s+a\s+session\s+for\s+(.+?)(?:\s+on\s+(.+?))?(?:\s+with\s+(?:bsp|BSP)\s+(.+?))?$/i,
      // "new session for wifi"
      /(?:start|begin|new|create)\s+session\s+(?:for\s+)?(.+?)(?:\s+on\s+(.+?))?(?:\s+with\s+(?:bsp|BSP)\s+(.+?))?$/i,
    ],

    baseConfidence: 0.95,
    allowExactBoost: true,
  },

  // ── Session Resumption ─────────────────────────────────────────
  {
    intent: 'session_resume',
    toolName: 'graph-memory__find_sessions_by_reference',
    keywords: ['resume', 'continue', 'switch to', 'switch back', 'open session', 'reopen'],
    patterns: [
      /(?:resume|continue|switch\s+to|open)\s+(?:my\s+)?(?:(.+?)\s+)?session/i,
      /(?:resume|continue|switch\s+back\s+to)\s+(?:the\s+)?["""]?(.+?)["""]?\s+session/i,
    ],
    baseConfidence: 0.85,
    allowExactBoost: false,
  },

  // ── Session Listing ────────────────────────────────────────────
  {
    intent: 'session_list',
    toolName: 'graph-memory__get_sessions',
    keywords: ['list', 'view', 'my sessions', 'all sessions', 'list sessions', 'show sessions', 'view sessions'],
    patterns: [
      /list\s+(?:my\s+)?sessions/i,
      /view\s+(?:my\+)?sessions/i,
      /show\s+(?:my\s+)?(?:active\s+)?sessions/i,
      /what\s+sessions\s+(?:do\s+)?(?:i|I)\s+have/i,
    ],
    baseConfidence: 0.9,
    allowExactBoost: false,
  },

  // ── Session Status / Context ───────────────────────────────────
  {
    intent: 'session_status',
    toolName: 'graph-memory__get_session_context',
    keywords: ['status', 'progress', 'where am i', "what's the state", 'what is the state', 'show context', 'session state', 'context'],
    patterns: [
      /(?:what(?:'s| is)\s+the\s+)?status\s+(?:of\s+)?(?:the\s+)?(?:current\s+)?session/i,
      /(?:show|get)\s+(?:the\s+)?(?:current\s+)?(?:session\s+)?context/i,
      /(?:where\s+am\s+i|what'?s?\s+(?:the\s+)?state)/i,
      /(?:show|get)\s+(?:my\s+)?progress/i,
    ],
    baseConfidence: 0.85,
    allowExactBoost: false,
  },

  // ── Session Closure ────────────────────────────────────────────
  {
    intent: 'session_close',
    toolName: 'graph-memory__close_session',
    keywords: ['close', 'end', 'finish', 'done', 'complete', 'wrap up', 'stop session'],
    patterns: [
      /(?:close|end|finish|complete|wrap\s+up)\s+(?:this\s+)?(?:session|conversation)/i,
      /i[''']?m\s+(?:done|finished)\s+(?:with\s+)?(?:this\s+)?/i,
      /(?:that[''']?s\s+)?(?:all|enough)\s+for\s+(?:now|today)/i,
    ],
    baseConfidence: 0.9,
    allowExactBoost: false,
  },

  // ── Feedback ───────────────────────────────────────────────────
  {
    intent: 'store_feedback',
    toolName: 'graph-memory__store_feedback',
    keywords: ["didn't work", 'failed', 'wrong', 'error', 'not working', 'correction', 'incorrect', 'mistake', 'that is not', "that's not"],
    patterns: [
      /(?:that|this)\s+(?:didn'?t\s+work|failed|is\s+(?:wrong|incorrect|not\s+(?:right|correct|what\s+I\s+wanted)))/i,
      /correction:\s*(.+)/i,
      /(?:there'?s?\s+(?:a\s+)?)?(?:mistake|error|bug)\s+(?:in\s+)?(.+)/i,
    ],
    baseConfidence: 0.85,
    allowExactBoost: true,
  },
];

// ────────────────────────────────────────────────────────────────────────────
// Standalone pattern matching config for _matchPatterns
// ────────────────────────────────────────────────────────────────────────────

/**
 * A pattern entry for the standalone _matchPatterns function.
 * @public Exported for testing.
 */
export interface PatternConfig {
  regex: RegExp;
  confidence: number;
  extract: (match: RegExpExecArray) => Record<string, any>;
}

// ────────────────────────────────────────────────────────────────────────────
// Feedback type detection
// ────────────────────────────────────────────────────────────────────────────

const CORRECTION_KEYWORDS = [
  'correction', 'correct this', 'fix this', 'instead', 'should be',
];

function detectFeedbackType(text: string): 'negative' | 'correction' {
  const lower = text.toLowerCase();
  for (const kw of CORRECTION_KEYWORDS) {
    if (lower.includes(kw)) return 'correction';
  }
  return 'negative';
}

// ────────────────────────────────────────────────────────────────────────────
// Ordinal / digit-to-letter map for selection resolution
// ────────────────────────────────────────────────────────────────────────────

const ORDINAL_MAP: Record<string, string> = {
  first: 'A', second: 'B', third: 'C', fourth: 'D', fifth: 'E',
  '1st': 'A', '2nd': 'B', '3rd': 'C', '4th': 'D', '5th': 'E',
};

const DIGIT_TO_LETTER: Record<string, string> = {
  '1': 'A', '2': 'B', '3': 'C', '4': 'D', '5': 'E',
};

// ────────────────────────────────────────────────────────────────────────────
// Standalone helper functions (exported for testing)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Extract session details (project, hardware, BSP, title) from text.
 *
 * Example:
 *   _extractSessionDetails("Start a session for camera driver on i.MX8M Plus with BSP 5.7.0")
 *   → { project: "camera_driver", target_hardware: "i.MX8M Plus", target_bsp: "5.7.0",
 *       title: "camera driver on i.MX8M Plus BSP 5.7.0" }
 */
export function _extractSessionDetails(text: string): SessionDetails {
  const details: SessionDetails = {};
  const trimmed = text.trim();

  // Two-phase extraction:
  // Phase 1: Find the "for X on Y with BSP Z" pattern using step-by-step matching
  // instead of a single complex regex that fails with lazy quantifiers.
  //
  // Step 1: Match "for" or "of" preposition and capture the rest
  const afterPrep = /(?:for|of)\s+(.+)/i.exec(trimmed);

  if (afterPrep) {
    const rest = afterPrep[1];

    // Step 2: Check if " on " exists in the rest (meaning it's a full spec)
    const onSplit = /^(.*?)\s+on\s+(.*)$/i.exec(rest);

    if (onSplit) {
      // We have a project and a hardware section
      details.project = _slugify(onSplit[1].trim());
      const restAfterOn = onSplit[2];

      // Step 3: Check for "with BSP" in the remainder after "on"
      const bspSplit = /^(.*?)\s+with\s+(?:bsp|BSP)\s+(.*)$/i.exec(restAfterOn);

      if (bspSplit) {
        details.target_hardware = bspSplit[1].trim();
        details.target_bsp = bspSplit[2].trim();
      } else {
        // No "with BSP" — entire rest is the hardware
        details.target_hardware = restAfterOn.trim();
      }
    } else {
      // No "on" — just a simple project name
      const project = rest.trim();
      if (project && !/^(?:a|an|the|session|on|with)$/i.test(project)) {
        details.project = _slugify(project);
      }
    }
  } else {
    // No "for X" pattern.
    // Try simpler patterns:
    //   "new session for wifi"  → project: wifi
    //   "create session audio" → project: audio
    //   "begin a session"      → no project

    const simplerPattern = /(?:for|of|session\s+for)\s+(.+?)(?:\s|$)/i;
    const simplerMatch = simplerPattern.exec(trimmed);

    if (simplerMatch) {
      const project = simplerMatch[1].trim();
      if (project && !/^(?:a|an|the|session|on|with)$/i.test(project)) {
        details.project = _slugify(project);
      }
    } else {
      // Strip leading keywords and "a/an/the/session" words
      const afterKeyword = trimmed.replace(
        /^(?:start|begin|new|create|initiate|launch)\s+(?:a\s+)?(?:new\s+)?(?:session\s+)?(?:for\s+)?/i,
        '',
      );

      // Find first meaningful word (not "a", "an", "the", "session")
      const words = afterKeyword.split(/\s+/);
      const skipWords = new Set(['a', 'an', 'the', 'session', 'for', 'on', 'with']);
      let projectWord: string | undefined;

      for (const word of words) {
        if (word && !skipWords.has(word.toLowerCase())) {
          projectWord = word;
          break;
        }
      }

      if (projectWord) {
        details.project = _slugify(projectWord);
      }
    }
  }

  // Build title from the extracted details preserving original wording
  if (details.project && afterPrep) {
    const rest = afterPrep[1];
    const onSplit = /^(.*?)\s+on\s+(.*)$/i.exec(rest);

    if (onSplit) {
      const projectRaw = onSplit[1].trim();
      const titleParts: string[] = [projectRaw];
      const restAfterOn = onSplit[2];
      const bspSplit = /^(.*?)\s+with\s+(?:bsp|BSP)\s+(.*)$/i.exec(restAfterOn);

      if (bspSplit) {
        titleParts.push('on', bspSplit[1].trim(), 'BSP', bspSplit[2].trim());
      } else {
        titleParts.push('on', restAfterOn.trim());
      }
      details.title = titleParts.join(' ');
    } else {
      // Simple project-only title
      details.title = rest.trim();
    }
  } else if (details.project && !details.title) {
    details.title = details.project;
  }

  return details;
}


/**
 * Extract a reference string for session lookup from text.
 *
 * Example:
 *   _extractReference("resume my camera driver session") → "camera driver"
 *   _extractReference("continue the bootloader session") → "bootloader"
 */
export function _extractReference(text: string): string {
  const trimmed = text.trim();

  // Pattern: "resume my <project> session" or "continue the <project> session"
  // The session keyword acts as a terminator for the capture group
  const resumePattern = /(?:resume|continue)\s+(?:my\s+)?(.+?)\s+session/i;
  const resumeMatch = resumePattern.exec(trimmed);
  if (resumeMatch) {
    let ref = resumeMatch[1].trim();
    // Strip leading "the " if present
    ref = ref.replace(/^the\s+/i, '');
    return ref;
  }

  // Pattern: "switch to <project>" (session implied)
  const switchPattern = /switch\s+(?:to|back\s+to)\s+(.+)/i;
  const switchMatch = switchPattern.exec(trimmed);
  if (switchMatch) {
    return switchMatch[1].trim();
  }

  // Pattern: "open <quoted string>" — explicit quoted capture using greedy match
  // Use a positive lookahead for the closing quote to ensure proper capture
  const quotedPattern = /open\s+[""'](.+?)[""']$/;
  const quotedMatch = quotedPattern.exec(trimmed);
  if (quotedMatch) {
    return quotedMatch[1].trim();
  }

  // Pattern: "open <project>" (without quotes)
  const openPattern = /open\s+(.+)/i;
  const openMatch = openPattern.exec(trimmed);
  if (openMatch) {
    return openMatch[1].trim();
  }

  return '';
}


/**
 * Standalone pattern matching function.
 *
 * Given an array of PatternConfig objects (each with a regex, confidence, and
 * extract callback), finds the matching pattern with the **highest confidence**.
 * Returns the matched pattern config, the match, and the extract result.
 *
 * @param patterns - Array of PatternConfig (ordered by priority)
 * @param text - The input text to match against
 * @returns The best match (highest confidence) or null if no pattern matches
 *
 * @public Exported for testing.
 */
export function _matchPatterns(
  patterns: PatternConfig[],
  text: string,
): { pattern: PatternConfig; match: RegExpExecArray; result: Record<string, any> } | null {
  let best: { pattern: PatternConfig; match: RegExpExecArray; result: Record<string, any> } | null = null;

  for (const pattern of patterns) {
    const match = pattern.regex.exec(text);
    if (match) {
      const result = pattern.extract(match);
      if (!best || pattern.confidence > best.pattern.confidence) {
        best = { pattern, match, result };
      }
    }
  }

  return best;
}

// ────────────────────────────────────────────────────────────────────────────
// GraphMemoryProvider
// ────────────────────────────────────────────────────────────────────────────

export class GraphMemoryProvider implements ToolCallProvider {
  private currentSessionId: string | null = null;
  private userId: string;

  constructor(options?: GraphMemoryProviderOptions) {
    this.currentSessionId = options?.currentSessionId ?? null;
    this.userId = options?.userId ?? 'default-user';
  }

  // ───── Public API ─────

  /** Set the current session ID for subsequent operations. */
  setCurrentSessionId(sessionId: string): void {
    this.currentSessionId = sessionId;
  }

  /** Set the user ID for session operations. */
  setUserId(userId: string): void {
    this.userId = userId;
  }

  /**
   * Analyze a user prompt and decide which graph-memory tool to call.
   *
   * @param prompt - The user's natural language input
   * @returns A ProviderDecision with toolName, arguments, and confidence
   */
  analyzePrompt(prompt: string): ProviderDecision {
    const startTime = Date.now();
    const trimmed = prompt.trim();

    // Handle empty prompt
    if (!trimmed) {
      return {
        toolName: undefined,
        arguments: {},
        originalPrompt: prompt,
        confidence: 0.0,
        reasoning: 'Empty prompt',
        augmented: false,
      };
    }

    // 1. Check all intent patterns for a match
    const matchResult = this._matchIntentPatterns(trimmed);

    if (matchResult) {
      const { toolName, args, confidence, reasoning } = matchResult;

      return {
        toolName,
        arguments: args,
        originalPrompt: prompt,
        confidence,
        reasoning: `${reasoning} (analyzed in ${Date.now() - startTime}ms)`,
        augmented: false,
      };
    }

    // 2. No match — return a no-op decision
    return {
      toolName: undefined,
      arguments: {},
      originalPrompt: prompt,
      confidence: 0.0,
      reasoning: `No session-related patterns detected in prompt (analyzed in ${Date.now() - startTime}ms)`,
      augmented: false,
    };
  }

  /** Return metadata about this provider. */
  getProviderInfo(): ProviderInfo {
    return {
      name: 'GraphMemoryProvider',
      version: '1.0.0',
      description:
        'Analyzes user prompts and decides which graph-memory session ' +
        'management tool to call based on keyword matching and regex patterns. ' +
        'Supports session CRUD, feedback, and selection resolution.',
      supportedTools: INTENT_PATTERNS.map((p) => p.toolName),
      confidenceThreshold: 0.5,
    };
  }

  // ───── Session ID Helpers ─────

  /** Get the current session ID, or null if not set. */
  _getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  // ───── Internal Pattern Matching Engine ─────

  /**
   * Match against the built-in INTENT_PATTERNS list.
   * Returns the first matching result, or null if no pattern matches.
   */
  private _matchIntentPatterns(
    text: string,
  ): { toolName: string; args: Record<string, any>; confidence: number; reasoning: string } | null {
    const trimmed = text.trim();

    for (const intent of INTENT_PATTERNS) {
      // Try regex patterns first
      let bestPatternMatch: RegExpExecArray | null = null;
      let bestPatternIndex = -1;

      for (let i = 0; i < intent.patterns.length; i++) {
        const pattern = intent.patterns[i];
        const match = pattern.exec(trimmed);
        if (match) {
          bestPatternMatch = match;
          bestPatternIndex = i;
          break;
        }
      }

      // Selection patterns don't need keywords
      const isSelection = intent.intent === 'resolve_selection';

      if (isSelection && bestPatternMatch) {
        const args = this._buildArgs(intent, bestPatternMatch, bestPatternIndex);
        return {
          toolName: intent.toolName,
          args,
          confidence: intent.baseConfidence,
          reasoning: `Selection pattern matched: "${bestPatternMatch[0]}" → ${intent.toolName}`,
        };
      }

      const hasKeyword = this._hasAnyKeyword(trimmed, intent.keywords);

      if (!hasKeyword && !bestPatternMatch) {
        continue;
      }

      // If we have a pattern match, use it to extract args
      if (bestPatternMatch) {
        const args = this._buildArgs(intent, bestPatternMatch, bestPatternIndex);
        const confidence = this._scoreConfidence(intent, trimmed, true);
        const matchedText = bestPatternMatch[0].substring(0, 60);
        return {
          toolName: intent.toolName,
          args,
          confidence,
          reasoning: `Pattern matched "${matchedText}..." → ${intent.toolName}`,
        };
      }

      // If only keywords matched (no regex), use keyword-based extraction
      if (hasKeyword) {
        const args = this._buildArgsFromKeywords(intent, trimmed);
        const confidence = this._scoreConfidence(intent, trimmed, false);
        const matchedKw = this._getMatchingKeyword(trimmed, intent.keywords);
        return {
          toolName: intent.toolName,
          args,
          confidence,
          reasoning: `Keyword matched "${matchedKw}" → ${intent.toolName}`,
        };
      }
    }

    return null;
  }

  // ───── Argument Builders ─────

  /** Build arguments from regex capture groups for the matched intent. */
  private _buildArgs(
    intent: IntentPattern,
    match: RegExpExecArray,
    _patternIndex: number,
  ): Record<string, any> {
    const args: Record<string, any> = {};

    switch (intent.intent) {
      case 'session_create': {
        args.user_id = this.userId;
        const project = match[1]?.trim();
        if (project) {
          args.project = _slugify(project);
        }
        if (match[2]?.trim()) {
          args.target_hardware = match[2].trim();
        }
        if (match[3]?.trim()) {
          args.target_bsp = match[3].trim();
        }
        // Build title from extracted session details
        const details = _extractSessionDetails(match[0]);
        if (details.title) {
          args.title = details.title;
        }
        break;
      }

      case 'session_resume': {
        args.user_id = this.userId;
        const reference = _extractReference(match[0]);
        if (reference) {
          args.reference = reference;
        } else {
          args.reference = match[1]?.trim() || this._extractReferenceFallback(match[0]);
        }
        break;
      }

      case 'session_list': {
        args.user_id = this.userId;
        if (/\b(?:active|open)\b/i.test(match[0])) {
          args.state = 'active';
        }
        break;
      }

      case 'session_status': {
        const sessionId = this._getCurrentSessionId();
        if (sessionId) {
          args.session_id = sessionId;
        }
        break;
      }

      case 'session_close': {
        const sessionId = this._getCurrentSessionId();
        if (sessionId) {
          args.session_id = sessionId;
        }
        break;
      }

      case 'store_feedback': {
        const feedbackText = match[1]?.trim() || match[0];
        // Detect type from the full match text (match[0]) which includes
        // keywords like "correction:" that are consumed by the regex delimiter
        // and won't appear in match[1].
        const fullMatchText = match[0];
        const feedbackType = detectFeedbackType(fullMatchText);
        args.type = feedbackType;
        args.text = feedbackText;

        const sessionId = this._getCurrentSessionId();
        if (sessionId) {
          args.session_id = sessionId;
        }
        break;
      }

      case 'resolve_selection': {
        const sessionId = this._getCurrentSessionId();
        if (sessionId) {
          args.session_id = sessionId;
        }
        // Determine label from the match
        const label = this._resolveSelectionLabel(match);
        if (label) {
          args.label = label;
        }
        break;
      }
    }

    return args;
  }

  /**
   * Resolve a selection match to a letter label (A, B, C, etc.).
   */
  private _resolveSelectionLabel(match: RegExpExecArray): string | undefined {
    const fullText = match[0].trim();

    // Single letter: A, B, C
    if (/^[A-Za-z]$/.test(fullText)) {
      return fullText.toUpperCase();
    }

    // Digit: 1, 2, 3 → map to letter
    if (/^\d$/.test(fullText)) {
      return DIGIT_TO_LETTER[fullText] || fullText;
    }

    // Lowercase for ordinal lookup
    const lower = fullText.toLowerCase();

    // Ordinal words: first, second, third
    if (ORDINAL_MAP[lower]) {
      return ORDINAL_MAP[lower];
    }

    // Digit ordinals: 1st, 2nd, 3rd
    if (ORDINAL_MAP[lower]) {
      return ORDINAL_MAP[lower];
    }

    // "option B", "option 2", "select A", "pick C"
    if (match[1]) {
      const label = match[1].toUpperCase();
      // If it's a digit, map to letter
      if (/^\d$/.test(label)) {
        return DIGIT_TO_LETTER[label] || label;
      }
      return label;
    }

    // "the first one", "the second option"
    const ordinalInPhrase = fullText.match(
      /(?:first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)/i,
    );
    if (ordinalInPhrase) {
      return ORDINAL_MAP[ordinalInPhrase[0].toLowerCase()] || ordinalInPhrase[0].toUpperCase();
    }

    return undefined;
  }

  /** Build arguments from keywords alone (no regex match). */
  private _buildArgsFromKeywords(intent: IntentPattern, text: string): Record<string, any> {
    const args: Record<string, any> = {};

    switch (intent.intent) {
      case 'session_create': {
        const details = _extractSessionDetails(text);
        args.user_id = this.userId;
        if (details.project) {
          args.project = details.project;
        }
        if (details.target_hardware) {
          args.target_hardware = details.target_hardware;
        }
        if (details.target_bsp) {
          args.target_bsp = details.target_bsp;
        }
        if (details.title) {
          args.title = details.title;
        }
        break;
      }

      case 'session_resume': {
        const reference = _extractReference(text);
        args.user_id = this.userId;
        args.reference = reference || text;
        break;
      }

      case 'session_list': {
        args.user_id = this.userId;
        if (/\b(?:active|open)\b/i.test(text)) {
          args.state = 'active';
        }
        break;
      }

      case 'session_status': {
        const sessionId = this._getCurrentSessionId();
        if (sessionId) {
          args.session_id = sessionId;
        }
        break;
      }

      case 'session_close': {
        const sessionId = this._getCurrentSessionId();
        if (sessionId) {
          args.session_id = sessionId;
        }
        break;
      }

      case 'store_feedback': {
        args.type = detectFeedbackType(text);
        args.text = text;
        const sessionId = this._getCurrentSessionId();
        if (sessionId) {
          args.session_id = sessionId;
        }
        break;
      }

      case 'resolve_selection': {
        const selection = this._detectSelection(text);
        if (selection) {
          Object.assign(args, this._buildSelectionArgs(selection));
          const sessionId = this._getCurrentSessionId();
          if (sessionId) {
            args.session_id = sessionId;
          }
        }
        break;
      }
    }

    return args;
  }

  /** Build arguments for a selection detection. */
  private _buildSelectionArgs(selection: string): Record<string, any> {
    const args: Record<string, any> = {};
    const sessionId = this._getCurrentSessionId();
    if (sessionId) {
      args.session_id = sessionId;
    }

    const upper = selection.toUpperCase();

    // Map digits to letters
    if (/^\d$/.test(upper)) {
      args.label = DIGIT_TO_LETTER[upper] || upper;
    } else if (/^[A-Z]$/.test(upper)) {
      args.label = upper;
    } else if (ORDINAL_MAP[selection.toLowerCase()]) {
      args.label = ORDINAL_MAP[selection.toLowerCase()];
    } else {
      args.label = selection;
    }

    return args;
  }

  // ───── Extraction Helpers ─────

  /**
   * Detect if the standalone text is a selection (letter, digit, ordinal).
   * Only matches if the ENTIRE input is a selection.
   */
  private _detectSelection(text: string): string | null {
    const trimmed = text.trim();

    // Single letter: A, B, C
    if (/^[A-Za-z]$/.test(trimmed)) {
      return trimmed.toUpperCase();
    }

    // Single digit: 1, 2, 3
    if (/^\d$/.test(trimmed)) {
      return trimmed;
    }

    // Ordinal: first, second, 1st, 2nd
    const lower = trimmed.toLowerCase();
    if (ORDINAL_MAP[lower]) {
      return ORDINAL_MAP[lower];
    }

    // "option B", "option 2", "select A", "pick C"
    const optionRef = /^(?:option|select|choose|pick|the)\s+([A-Za-z\d]+)$/i;
    const optionMatch = optionRef.exec(trimmed);
    if (optionMatch) {
      return optionMatch[1].toUpperCase();
    }

    return null;
  }

  /**
   * Fallback reference extraction when capture groups don't match.
   */
  private _extractReferenceFallback(text: string): string {
    // Remove known keywords to get the remainder
    const cleaned = text
      .replace(/\b(resume|continue|open|session|switch\s+(to|back\s+to)|the|my)\b/gi, '')
      .trim();
    return cleaned || text;
  }

  // ───── Confidence Scoring ─────

  /**
   * Calculate confidence score for a matched intent.
   */
  private _scoreConfidence(intent: IntentPattern, text: string, hasPatternMatch: boolean): number {
    let confidence = intent.baseConfidence;

    // Boost for exact pattern match
    if (hasPatternMatch && intent.allowExactBoost) {
      confidence += 0.1;
    }

    // Boost for multiple keyword matches
    const keywordCount = this._countMatchingKeywords(text, intent.keywords);
    if (keywordCount > 1) {
      confidence += 0.05 * Math.min(keywordCount - 1, 3);
    }

    // Boost if the text also contains session-related words
    if (/\bsession\b/i.test(text)) {
      confidence += 0.05;
    }

    // Cap at 0.99
    return Math.min(confidence, 0.99);
  }

  // ───── Utility Methods ─────

  /** Check if any of the keywords appear in the text (case-insensitive). */
  private _hasAnyKeyword(text: string, keywords: string[]): boolean {
    const lower = text.toLowerCase();
    return keywords.some((kw) => lower.includes(kw.toLowerCase()));
  }

  /** Count how many keywords appear in the text. */
  private _countMatchingKeywords(text: string, keywords: string[]): number {
    const lower = text.toLowerCase();
    return keywords.filter((kw) => lower.includes(kw.toLowerCase())).length;
  }

  /** Get the first keyword that matches. */
  private _getMatchingKeyword(text: string, keywords: string[]): string {
    const lower = text.toLowerCase();
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) return kw;
    }
    return 'unknown';
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Pure utility function (standalone, not a method)
// ────────────────────────────────────────────────────────────────────────────

/** Slugify a string for use as a project name. */
function _slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .trim();
}
