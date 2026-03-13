import { describe, it, expect, beforeEach } from 'vitest';
import { useWsStore } from './store';
import type { ChatMessage, PendingApproval, SessionUsage } from '@agemon/shared';

describe('WsStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useWsStore.setState({
      connected: false,
      chatMessages: {},
      pendingInputs: [],
      pendingApprovals: [],
      agentActivity: {},
      unreadSessions: {},
      configOptions: {},
      availableCommands: {},
      turnsInFlight: {},
      sessionUsage: {},
      toolCalls: {},
    });
  });

  describe('appendChatMessage', () => {
    it('should add a new message to an empty session', () => {
      const msg: ChatMessage = {
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
        eventType: 'prompt',
        timestamp: new Date().toISOString(),
      };

      useWsStore.getState().appendChatMessage('session-1', msg);

      const messages = useWsStore.getState().chatMessages['session-1'];
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual(msg);
    });

    it('should accumulate content for streaming chunks with same ID', () => {
      const msg1: ChatMessage = {
        id: 'msg-1',
        role: 'agent',
        content: 'Hello',
        eventType: 'thought',
        timestamp: new Date().toISOString(),
      };
      const msg2: ChatMessage = {
        id: 'msg-1',
        role: 'agent',
        content: ' world',
        eventType: 'thought',
        timestamp: new Date().toISOString(),
      };

      useWsStore.getState().appendChatMessage('session-1', msg1);
      useWsStore.getState().appendChatMessage('session-1', msg2);

      const messages = useWsStore.getState().chatMessages['session-1'];
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Hello world');
    });

    it('should cap messages at MAX_MESSAGES_PER_SESSION (500)', () => {
      const sessionId = 'session-overflow';

      // Add 505 messages
      for (let i = 0; i < 505; i++) {
        const msg: ChatMessage = {
          id: `msg-${i}`,
          role: 'user',
          content: `Message ${i}`,
          eventType: 'prompt',
          timestamp: new Date().toISOString(),
        };
        useWsStore.getState().appendChatMessage(sessionId, msg);
      }

      const messages = useWsStore.getState().chatMessages[sessionId];
      expect(messages).toHaveLength(500);
      // Should keep the most recent 500 (drop first 5)
      expect(messages[0].id).toBe('msg-5');
      expect(messages[499].id).toBe('msg-504');
    });
  });

  describe('setChatMessages / clearChatMessages', () => {
    it('should set messages for a session', () => {
      const msgs: ChatMessage[] = [
        { id: 'msg-1', role: 'user', content: 'Hi', eventType: 'prompt', timestamp: new Date().toISOString() },
        { id: 'msg-2', role: 'agent', content: 'Hello', eventType: 'thought', timestamp: new Date().toISOString() },
      ];

      useWsStore.getState().setChatMessages('session-1', msgs);

      expect(useWsStore.getState().chatMessages['session-1']).toEqual(msgs);
    });

    it('should clear messages for a session', () => {
      useWsStore.setState({
        chatMessages: {
          'session-1': [{ id: 'msg-1', role: 'user', content: 'Hi', eventType: 'prompt', timestamp: new Date().toISOString() }],
          'session-2': [{ id: 'msg-2', role: 'user', content: 'Hey', eventType: 'prompt', timestamp: new Date().toISOString() }],
        },
      });

      useWsStore.getState().clearChatMessages('session-1');

      expect(useWsStore.getState().chatMessages['session-1']).toBeUndefined();
      expect(useWsStore.getState().chatMessages['session-2']).toHaveLength(1);
    });
  });

  describe('pendingInputs', () => {
    it('should add a pending input', () => {
      const input = {
        inputId: 'input-1',
        taskId: 'task-1',
        sessionId: 'session-1',
        question: 'What is your name?',
        receivedAt: Date.now(),
      };

      useWsStore.getState().addPendingInput(input);

      expect(useWsStore.getState().pendingInputs).toHaveLength(1);
      expect(useWsStore.getState().pendingInputs[0]).toEqual(input);
    });

    it('should remove a pending input by ID', () => {
      useWsStore.setState({
        pendingInputs: [
          { inputId: 'input-1', taskId: 'task-1', sessionId: 'session-1', question: 'Q1', receivedAt: Date.now() },
          { inputId: 'input-2', taskId: 'task-1', sessionId: 'session-1', question: 'Q2', receivedAt: Date.now() },
        ],
      });

      useWsStore.getState().removePendingInput('input-1');

      expect(useWsStore.getState().pendingInputs).toHaveLength(1);
      expect(useWsStore.getState().pendingInputs[0].inputId).toBe('input-2');
    });
  });

  describe('pendingApprovals', () => {
    const makeApproval = (overrides: Partial<PendingApproval> = {}): PendingApproval => ({
      id: 'approval-1',
      taskId: 'task-1',
      sessionId: 'session-1',
      toolName: 'Bash',
      toolTitle: 'Bash: rm -rf /',
      context: { command: 'rm -rf /' },
      options: [{ kind: 'allow_once', optionId: 'opt-1', label: 'Allow once' }],
      status: 'pending',
      createdAt: new Date().toISOString(),
      ...overrides,
    });

    it('should add a pending approval', () => {
      const approval = makeApproval();

      useWsStore.getState().addPendingApproval(approval);

      expect(useWsStore.getState().pendingApprovals).toHaveLength(1);
      expect(useWsStore.getState().pendingApprovals[0]).toEqual(approval);
    });

    it('should resolve a pending approval', () => {
      const approval = makeApproval({ context: { command: 'ls' } });

      useWsStore.setState({ pendingApprovals: [approval] });
      useWsStore.getState().resolvePendingApproval('approval-1', 'allow_once');

      const resolved = useWsStore.getState().pendingApprovals[0];
      expect(resolved.status).toBe('resolved');
      expect(resolved.decision).toBe('allow_once');
    });

    it('should merge approvals from server with client state', () => {
      const clientApproval = makeApproval({ id: 'client-1', context: { command: 'echo' } });
      const serverApproval = makeApproval({ id: 'server-1', context: { command: 'ls' } });

      useWsStore.setState({ pendingApprovals: [clientApproval] });
      useWsStore.getState().mergePendingApprovals('task-1', [serverApproval]);

      const approvals = useWsStore.getState().pendingApprovals;
      // Should keep client approval that wasn't in server response + server approval
      expect(approvals).toHaveLength(2);
      expect(approvals.some(a => a.id === 'client-1')).toBe(true);
      expect(approvals.some(a => a.id === 'server-1')).toBe(true);
    });

    it('should cap approvals at MAX_APPROVALS (200)', () => {
      const approvals: PendingApproval[] = [];
      // Create 100 pending and 150 resolved (total 250)
      for (let i = 0; i < 100; i++) {
        approvals.push(makeApproval({
          id: `pending-${i}`,
          context: { command: `cmd-${i}` },
          status: 'pending',
          createdAt: new Date(Date.now() - 100000 + i).toISOString(),
        }));
      }
      for (let i = 0; i < 150; i++) {
        approvals.push(makeApproval({
          id: `resolved-${i}`,
          context: { command: `cmd-${i}` },
          status: 'resolved',
          decision: 'allow_once',
          createdAt: new Date(Date.now() - 100000 + i).toISOString(),
        }));
      }

      useWsStore.getState().mergePendingApprovals('task-1', approvals);

      const result = useWsStore.getState().pendingApprovals;
      expect(result).toHaveLength(200);
      // All pending should be kept
      expect(result.filter(a => a.status === 'pending')).toHaveLength(100);
      // Only most recent 100 resolved
      expect(result.filter(a => a.status === 'resolved')).toHaveLength(100);
    });
  });

  describe('unread sessions', () => {
    it('should mark a session as unread', () => {
      useWsStore.getState().markUnread('session-1');

      expect(useWsStore.getState().unreadSessions['session-1']).toBe(true);
    });

    it('should clear unread status', () => {
      useWsStore.setState({ unreadSessions: { 'session-1': true, 'session-2': true } });
      useWsStore.getState().clearUnread('session-1');

      expect(useWsStore.getState().unreadSessions['session-1']).toBeUndefined();
      expect(useWsStore.getState().unreadSessions['session-2']).toBe(true);
    });

    it('should not change state when clearing an already-clear session', () => {
      const initialState = { unreadSessions: { 'session-2': true } };
      useWsStore.setState(initialState);

      useWsStore.getState().clearUnread('session-1');

      expect(useWsStore.getState().unreadSessions).toEqual(initialState.unreadSessions);
    });
  });

  describe('turnInFlight', () => {
    it('should set turn in flight', () => {
      useWsStore.getState().setTurnInFlight('session-1', true);

      expect(useWsStore.getState().turnsInFlight['session-1']).toBe(true);
    });

    it('should clear turn in flight', () => {
      useWsStore.setState({ turnsInFlight: { 'session-1': true, 'session-2': true } });
      useWsStore.getState().setTurnInFlight('session-1', false);

      expect(useWsStore.getState().turnsInFlight['session-1']).toBeUndefined();
      expect(useWsStore.getState().turnsInFlight['session-2']).toBe(true);
    });
  });

  describe('sessionUsage', () => {
    it('should set session usage', () => {
      const usage: SessionUsage = {
        inputTokens: 100,
        outputTokens: 50,
        cachedReadTokens: 20,
        cachedWriteTokens: 10,
        contextWindow: 200000,
      };

      useWsStore.getState().setSessionUsage('session-1', usage);

      expect(useWsStore.getState().sessionUsage['session-1']).toEqual(usage);
    });

    it('should update session usage with new values', () => {
      const usage1: SessionUsage = {
        inputTokens: 100,
        outputTokens: 50,
        cachedReadTokens: 20,
        cachedWriteTokens: 10,
        contextWindow: 200000,
      };
      const usage2: SessionUsage = {
        inputTokens: 150,
        outputTokens: 75,
        cachedReadTokens: 30,
        cachedWriteTokens: 15,
        contextWindow: 200000,
      };

      useWsStore.getState().setSessionUsage('session-1', usage1);
      useWsStore.getState().setSessionUsage('session-1', usage2);

      expect(useWsStore.getState().sessionUsage['session-1']).toEqual(usage2);
    });
  });
});
