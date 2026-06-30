import { describe, it, expect } from 'vitest';
import {
  SessionProvider,
  _extractSessionDetails,
  _extractReference,
  _matchPatterns,
} from '../../../src/providers/SessionProvider';

describe('SessionProvider', () => {
  // ───── _extractSessionDetails ─────

  describe('_extractSessionDetails', () => {
    it('extracts project, hardware, and BSP from full spec', () => {
      const result = _extractSessionDetails(
        'Start a session for camera driver on i.MX8M Plus with BSP 5.7.0'
      );
      expect(result.project).toBe('camera_driver');
      expect(result.target_hardware).toBe('i.MX8M Plus');
      expect(result.target_bsp).toBe('5.7.0');
      expect(result.title).toBe('camera driver on i.MX8M Plus BSP 5.7.0');
    });

    it('extracts simple project name', () => {
      const result = _extractSessionDetails('new session for wifi');
      expect(result.project).toBe('wifi');
      expect(result.target_hardware).toBeUndefined();
      expect(result.title).toBe('wifi');
    });

    it('returns undefined for generic begin', () => {
      const result = _extractSessionDetails('begin a session');
      expect(result.project).toBeUndefined();
      expect(result.title).toBeUndefined();
    });

    it('extracts audio driver on QCS6490 with BSP 6.1.0', () => {
      const result = _extractSessionDetails(
        'create session for audio driver on QCS6490 with BSP 6.1.0'
      );
      expect(result.project).toBe('audio_driver');
      expect(result.target_hardware).toBe('QCS6490');
      expect(result.target_bsp).toBe('6.1.0');
      expect(result.title).toBe('audio driver on QCS6490 BSP 6.1.0');
    });
  });

  // ───── _extractReference ─────

  describe('_extractReference', () => {
    it('extracts reference from "resume my X session"', () => {
      expect(_extractReference('resume my camera driver session')).toBe('camera driver');
    });

    it('extracts reference from "continue the X session"', () => {
      expect(_extractReference('continue the bootloader session')).toBe('bootloader');
    });

    it('extracts quoted reference', () => {
      expect(_extractReference('open "QCS6490"')).toBe('QCS6490');
    });

    it('extracts reference from "switch to X"', () => {
      expect(_extractReference('switch to wifi')).toBe('wifi');
    });
  });

  // ───── _matchPatterns ─────

  describe('_matchPatterns', () => {
    it('selects the highest confidence pattern', () => {
      const patterns = [
        { regex: /^test (.+)$/i, confidence: 0.8, extract: () => ({}) },
        { regex: /^test (.+) with (.+)$/i, confidence: 0.9, extract: () => ({}) },
      ];
      const result = _matchPatterns(patterns, 'test hello with world');
      expect(result).not.toBeNull();
      expect(result!.pattern.confidence).toBe(0.9);
    });

    it('returns null when no pattern matches', () => {
      const patterns = [
        { regex: /^hello/i, confidence: 0.5, extract: () => ({}) },
      ];
      const result = _matchPatterns(patterns, 'no match');
      expect(result).toBeNull();
    });
  });

  // ───── SessionProvider - Constructor ─────

  describe('constructor', () => {
    it('creates instance with no options', () => {
      const provider = new SessionProvider();
      expect(provider).toBeInstanceOf(SessionProvider);
    });

    it('creates instance with options', () => {
      const provider = new SessionProvider({ currentSessionId: 'session-123', userId: 'user-456' });
      expect(provider).toBeInstanceOf(SessionProvider);
    });
  });

  // ───── Selection Detection ─────

  describe('selection detection', () => {
    it('detects single letter B', () => {
      const provider = new SessionProvider({ currentSessionId: 'session-1' });
      const decision = provider.analyzePrompt('B');
      expect(decision.toolName).toBe('graph-memory__resolve_selection');
      expect(decision.arguments?.label).toBe('B');
      expect(decision.arguments?.session_id).toBe('session-1');
      expect(decision.confidence).toBeGreaterThan(0.9);
    });

    it('detects "option C"', () => {
      const provider = new SessionProvider({ currentSessionId: 'session-1' });
      const decision = provider.analyzePrompt('option C');
      expect(decision.toolName).toBe('graph-memory__resolve_selection');
      expect(decision.arguments?.label).toBe('C');
    });

    it('detects ordinal "second" maps to B', () => {
      const provider = new SessionProvider({ currentSessionId: 'session-1' });
      const decision = provider.analyzePrompt('second');
      expect(decision.toolName).toBe('graph-memory__resolve_selection');
      expect(decision.arguments?.label).toBe('B');
    });

    it('detects digit "3" maps to C', () => {
      const provider = new SessionProvider({ currentSessionId: 'session-1' });
      const decision = provider.analyzePrompt('3');
      expect(decision.toolName).toBe('graph-memory__resolve_selection');
      expect(decision.arguments?.label).toBe('C');
    });

    it('handles selection without session ID', () => {
      const provider = new SessionProvider();
      const decision = provider.analyzePrompt('A');
      expect(decision.toolName).toBe('graph-memory__resolve_selection');
      expect(decision.arguments?.session_id).toBeUndefined();
    });
  });

  // ───── Feedback Detection ─────

  describe('feedback detection', () => {
    it('detects negative feedback', () => {
      const provider = new SessionProvider({ currentSessionId: 'session-1' });
      const decision = provider.analyzePrompt("That didn't work");
      expect(decision.toolName).toBe('graph-memory__store_feedback');
      expect(decision.arguments?.type).toBe('negative');
      expect(decision.arguments?.session_id).toBe('session-1');
      expect(decision.confidence).toBeGreaterThan(0.8);
    });

    it('detects correction feedback', () => {
      const provider = new SessionProvider({ currentSessionId: 'session-1' });
      const decision = provider.analyzePrompt('correction: The BSP version is 5.7.1 not 5.7.0');
      expect(decision.toolName).toBe('graph-memory__store_feedback');
      expect(decision.arguments?.type).toBe('correction');
      expect(decision.arguments?.text).toBe('The BSP version is 5.7.1 not 5.7.0');
    });

    it('detects "this is wrong" as negative feedback', () => {
      const provider = new SessionProvider({ currentSessionId: 'session-1' });
      const decision = provider.analyzePrompt('this is wrong');
      expect(decision.toolName).toBe('graph-memory__store_feedback');
      expect(decision.arguments?.type).toBe('negative');
    });
  });

  // ───── Session Creation ─────

  describe('session creation', () => {
    it('detects full session creation with hardware and BSP', () => {
      const provider = new SessionProvider({ userId: 'user-1' });
      const decision = provider.analyzePrompt('Start a session for camera driver on i.MX8M Plus with BSP 5.7.0');
      expect(decision.toolName).toBe('graph-memory__create_session');
      expect(decision.arguments?.project).toBe('camera_driver');
      expect(decision.arguments?.target_hardware).toBe('i.MX8M Plus');
      expect(decision.arguments?.target_bsp).toBe('5.7.0');
      expect(decision.arguments?.user_id).toBe('user-1');
      expect(decision.confidence).toBeGreaterThan(0.9);
    });

    it('detects simple session creation', () => {
      const provider = new SessionProvider();
      const decision = provider.analyzePrompt('new session for wifi');
      expect(decision.toolName).toBe('graph-memory__create_session');
      expect(decision.arguments?.project).toBe('wifi');
      expect(decision.confidence).toBeGreaterThan(0.9);
    });

    it('detects generic session begin', () => {
      const provider = new SessionProvider();
      const decision = provider.analyzePrompt('begin a session');
      expect(decision.toolName).toBe('graph-memory__create_session');
      expect(decision.arguments?.project).toBeUndefined();
    });
  });

  // ───── Session Listing ─────

  describe('session listing', () => {
    it('detects "list my sessions"', () => {
      const provider = new SessionProvider();
      const decision = provider.analyzePrompt('list my sessions');
      expect(decision.toolName).toBe('graph-memory__get_sessions');
      expect(decision.confidence).toBeGreaterThan(0.9);
    });

    it('detects "show active sessions"', () => {
      const provider = new SessionProvider();
      const decision = provider.analyzePrompt('show active sessions');
      expect(decision.toolName).toBe('graph-memory__get_sessions');
    });

    it('detects "view sessions"', () => {
      const provider = new SessionProvider();
      const decision = provider.analyzePrompt('view sessions');
      expect(decision.toolName).toBe('graph-memory__get_sessions');
    });
  });

  // ───── Session Status ─────

  describe('session status', () => {
    it('detects status query', () => {
      const provider = new SessionProvider({ currentSessionId: 'session-1' });
      const decision = provider.analyzePrompt("what's the status");
      expect(decision.toolName).toBe('graph-memory__get_session_context');
      expect(decision.arguments?.session_id).toBe('session-1');
      expect(decision.confidence).toBeGreaterThan(0.8);
    });

    it('detects progress query', () => {
      const provider = new SessionProvider({ currentSessionId: 'session-1' });
      const decision = provider.analyzePrompt('show progress');
      expect(decision.toolName).toBe('graph-memory__get_session_context');
    });

    it('detects "where am I" query', () => {
      const provider = new SessionProvider({ currentSessionId: 'session-1' });
      const decision = provider.analyzePrompt('where am I');
      expect(decision.toolName).toBe('graph-memory__get_session_context');
    });
  });

  // ───── Session Resume ─────

  describe('session resume', () => {
    it('detects resume by project', () => {
      const provider = new SessionProvider();
      const decision = provider.analyzePrompt('resume my camera driver session');
      expect(decision.toolName).toBe('graph-memory__find_sessions_by_reference');
      expect(decision.arguments?.reference).toBe('camera driver');
      expect(decision.confidence).toBeGreaterThan(0.8);
    });

    it('detects continue session', () => {
      const provider = new SessionProvider();
      const decision = provider.analyzePrompt('continue the bootloader session');
      expect(decision.toolName).toBe('graph-memory__find_sessions_by_reference');
      expect(decision.arguments?.reference).toBe('bootloader');
    });

    it('detects switch to session', () => {
      const provider = new SessionProvider();
      const decision = provider.analyzePrompt('switch to wifi');
      expect(decision.toolName).toBe('graph-memory__find_sessions_by_reference');
      expect(decision.arguments?.reference).toBe('wifi');
    });
  });

  // ───── Session Close ─────

  describe('session close', () => {
    it('detects close session', () => {
      const provider = new SessionProvider({ currentSessionId: 'session-1' });
      const decision = provider.analyzePrompt('close this session');
      expect(decision.toolName).toBe('graph-memory__close_session');
      expect(decision.arguments?.session_id).toBe('session-1');
      expect(decision.confidence).toBeGreaterThan(0.9);
    });

    it('detects "done with this"', () => {
      const provider = new SessionProvider({ currentSessionId: 'session-1' });
      const decision = provider.analyzePrompt("I'm done with this");
      expect(decision.toolName).toBe('graph-memory__close_session');
      expect(decision.confidence).toBeGreaterThan(0.8);
    });

    it('detects "end session"', () => {
      const provider = new SessionProvider({ currentSessionId: 'session-1' });
      const decision = provider.analyzePrompt('end session');
      expect(decision.toolName).toBe('graph-memory__close_session');
    });
  });

  // ───── No Match ─────

  describe('no match', () => {
    it('returns no tool for weather query', () => {
      const provider = new SessionProvider();
      const decision = provider.analyzePrompt("What's the weather?");
      expect(decision.toolName).toBeUndefined();
      expect(decision.confidence).toBe(0);
      expect(decision.augmented).toBe(false);
    });

    it('returns no tool for joke', () => {
      const provider = new SessionProvider();
      const decision = provider.analyzePrompt('Tell me a joke');
      expect(decision.toolName).toBeUndefined();
      expect(decision.confidence).toBe(0);
    });

    it('returns no tool for empty prompt', () => {
      const provider = new SessionProvider();
      const decision = provider.analyzePrompt('');
      expect(decision.toolName).toBeUndefined();
      expect(decision.confidence).toBe(0);
      expect(decision.reasoning).toBe('Empty prompt');
    });
  });

  // ───── setCurrentSessionId / setUserId ─────

  describe('setCurrentSessionId / setUserId', () => {
    it('setCurrentSessionId takes effect', () => {
      const provider = new SessionProvider();
      provider.setCurrentSessionId('session-42');
      const decision = provider.analyzePrompt('B');
      expect(decision.arguments?.session_id).toBe('session-42');

      provider.setCurrentSessionId('session-99');
      const decision2 = provider.analyzePrompt('B');
      expect(decision2.arguments?.session_id).toBe('session-99');
    });

    it('setUserId takes effect', () => {
      const provider = new SessionProvider();
      provider.setUserId('user-abc');
      const decision = provider.analyzePrompt('start a session for test');
      expect(decision.arguments?.user_id).toBe('user-abc');
    });
  });

  // ───── getProviderInfo ─────

  describe('getProviderInfo', () => {
    it('returns correct metadata', () => {
      const provider = new SessionProvider();
      const info = provider.getProviderInfo();
      expect(info.name).toBe('SessionProvider');
      expect(info.version).toBe('1.0.0');
      expect(Array.isArray(info.supportedTools)).toBe(true);
      expect(info.supportedTools.length).toBeGreaterThan(0);
      expect(info.confidenceThreshold).toBe(0.5);
    });
  });
});
