import { expect, it, vi } from 'vitest';
import type { ModelOption, StoragePort } from '../../packages/contracts/src/runtime.ts';
import type { NativeFigureSelection } from '../../packages/contracts/src/native.ts';
import type { ActionTaskRecord } from '../../packages/contracts/src/tasks.ts';
import type { CodexConnection } from '../../packages/core/src/codex/connection.ts';
import { runFigureAgent } from '../../packages/core/src/figure/agent.ts';
import { paperA, TINY_PNG_DATA_URL } from '../contracts/factories.ts';

const sessionId = '123e4567-e89b-42d3-a456-426614174000';
const requestId = '123e4567-e89b-42d3-a456-426614174001';
const model: ModelOption = {
  id: 'gpt-6-sol', displayName: 'GPT-6 Sol', isDefault: true,
  supportedReasoningEfforts: [{ id: 'medium', description: '' }], defaultReasoningEffort: 'medium',
  serviceTiers: [], defaultServiceTier: null,
};
const selection: NativeFigureSelection = {
  paper: paperA, revision: { fingerprint: 'pdf-revision-1', size: 100, modifiedAt: 1 },
  pageIndex: 2, rect: [100, 100, 500, 500],
};
const crop = {
  id: '6c8e0a2b-4d1f-4e3a-9c5b-1a7d3e5f9b20', name: 'figure-crop.png', mime: 'image/png' as const,
  dataUrl: TINY_PNG_DATA_URL,
  origin: { kind: 'paper' as const, paper: paperA, pageIndex: 2, revision: selection.revision },
};
const validRaw = '{"callouts":[{"box":[0.1,0.2,0.7,0.8],"strokes":[[[0.1,0.2],[0.7,0.8]]],"explanation":"The solid line shows the main trend."}]}';

class MemoryStorage implements StoragePort {
  files = new Map<string, Uint8Array>();
  read = vi.fn((name: string) => Promise.resolve(this.files.get(name)?.slice() ?? null));
  writeAtomic = vi.fn((name: string, bytes: Uint8Array) => { this.files.set(name, bytes.slice()); return Promise.resolve(); });
  append = vi.fn(() => Promise.resolve());
  remove = vi.fn((name: string) => { this.files.delete(name); return Promise.resolve(); });
}

function fixture(answer = validRaw) {
  const storage = new MemoryStorage();
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const turns: Array<Record<string, unknown>> = [];
  let pendingBeforeThreadStart = false;
  let turnIdPersistedBeforeRead = false;
  let shouldFailStart: 'thread' | 'turn' | null = null;
  const request = vi.fn((method: string, value: unknown): Promise<unknown> => {
    const params = value as Record<string, unknown>;
    calls.push({ method, params });
    if (method === 'thread/start') {
      const saved = storage.files.get(`figure-agent-sessions/${sessionId}.json`);
      const persisted = saved ? JSON.parse(new TextDecoder().decode(saved)) as { pending?: { requestId?: string } | null } : null;
      pendingBeforeThreadStart = persisted?.pending?.requestId === requestId;
      if (shouldFailStart === 'thread') return Promise.reject(new Error('lost thread start response'));
      return Promise.resolve({
        cwd: '/private/tmp/figure', approvalPolicy: 'never', approvalsReviewer: 'user',
        sandbox: { type: 'readOnly', networkAccess: false }, instructionSources: [], modelProvider: 'openai',
        model: params.model, serviceTier: 'default', reasoningEffort: 'medium',
        thread: { id: 'figure-thread', cwd: '/private/tmp/figure', modelProvider: 'openai', ephemeral: false, turns: [] },
      });
    }
    if (method === 'thread/resume') return Promise.resolve({
      cwd: '/private/tmp/figure', approvalPolicy: 'never', approvalsReviewer: 'user',
      sandbox: { type: 'readOnly', networkAccess: false }, instructionSources: [], modelProvider: 'openai',
      model: 'gpt-6-sol', serviceTier: 'default', reasoningEffort: 'medium',
      thread: { id: 'figure-thread', cwd: '/private/tmp/figure', modelProvider: 'openai', ephemeral: false, turns },
    });
    if (method === 'turn/start') {
      if (shouldFailStart === 'turn') return Promise.reject(new Error('lost turn start response'));
      const turnId = `turn-${turns.length + 1}`;
      turns.push({ id: turnId, status: 'completed', clientUserMessageId: params.clientUserMessageId, items: [{ id: `item-${turnId}`, type: 'agentMessage', phase: 'final_answer', text: answer }] });
      return Promise.resolve({ turn: { id: turnId } });
    }
    if (method === 'thread/read') {
      const saved = storage.files.get(`figure-agent-sessions/${sessionId}.json`);
      const persisted = saved ? JSON.parse(new TextDecoder().decode(saved)) as { pending?: { turnId?: string } | null } : null;
      turnIdPersistedBeforeRead = persisted?.pending?.turnId === 'turn-1';
      return Promise.resolve({ thread: { id: 'figure-thread', turns } });
    }
    return Promise.reject(new Error(`Unexpected RPC ${method}`));
  });
  const task = { kind: 'figure-annotations', state: 'review', id: requestId } as ActionTaskRecord;
  const planFigureAnnotations = vi.fn(() => Promise.resolve(task));
  const connection = { request, onFailure: () => () => {} } as Pick<CodexConnection, 'request' | 'onFailure'>;
  const input = {
    connection, storage, tasks: { planFigureAnnotations }, sessionId, requestId, selection, image: crop,
    question: 'Explain the main relationship in this figure.', model, cwd: '/private/tmp/figure',
    wait: () => Promise.resolve(), timeoutMs: 10,
  };
  return { input, storage, calls, request, turns, planFigureAnnotations, pendingBeforeThreadStart: () => pendingBeforeThreadStart, turnIdPersistedBeforeRead: () => turnIdPersistedBeforeRead, setFailure(value: 'thread' | 'turn' | null) { shouldFailStart = value; } };
}

it('sends the frozen crop as image input under a read-only strict figure schema and creates a review task', async () => {
  const f = fixture();
  expect(await runFigureAgent(f.input)).toMatchObject({ kind: 'figure-annotations', state: 'review' });
  expect(f.calls.map(call => call.method)).toEqual(['thread/start', 'turn/start', 'thread/read']);
  expect(f.calls[0]!.params.baseInstructions).toContain('normalized to the crop');
  expect(f.pendingBeforeThreadStart()).toBe(true);
  expect(f.turnIdPersistedBeforeRead()).toBe(true);
  expect(f.calls[0]!.params.sandbox).toBe('read-only');
  const turn = f.calls[1]!.params;
  expect(turn.sandboxPolicy).toEqual({ type: 'readOnly', networkAccess: false });
  expect((turn.input as Array<{ type: string; url?: string }>)[1]).toMatchObject({ type: 'image', url: crop.dataUrl });
  expect(f.planFigureAnnotations).toHaveBeenCalledWith(expect.objectContaining({
    conversationId: sessionId, modelRequestId: requestId, selection, image: crop,
    proposals: [{ box: [0.1, 0.2, 0.7, 0.8], strokes: [[[0.1, 0.2], [0.7, 0.8]]], explanation: 'The solid line shows the main trend.' }],
  }));
  const raw = JSON.parse(new TextDecoder().decode(f.storage.files.get(`figure-agent-results/${requestId}.json`))) as { rawAnswer: string };
  expect(raw.rawAnswer).toBe(validRaw);
});

it('rejects invalid normalized geometry without creating a native task', async () => {
  const f = fixture('{"callouts":[{"box":[-0.1,0.2,0.7,0.8],"strokes":[[[0.1,0.2],[0.7,0.8]]],"explanation":"Invalid bounds."}]}');
  await expect(runFigureAgent(f.input)).rejects.toThrow();
  expect(f.planFigureAnnotations).not.toHaveBeenCalled();
  const saved = JSON.parse(new TextDecoder().decode(f.storage.files.get(`figure-agent-sessions/${sessionId}.json`))) as { pending: unknown };
  expect(saved.pending).toBeNull();
});

it('reconciles an uncertain turn after restart without starting another model turn', async () => {
  const f = fixture();
  f.setFailure('turn');
  await expect(runFigureAgent(f.input)).rejects.toThrow(/uncertain/u);
  expect(f.calls.filter(call => call.method === 'turn/start')).toHaveLength(1);
  f.setFailure(null);
  f.turns.push({ id: 'late-turn', status: 'completed', clientUserMessageId: requestId, items: [{ id: 'late-answer', type: 'agentMessage', phase: 'final_answer', text: validRaw }] });
  expect(await runFigureAgent(f.input)).toMatchObject({ kind: 'figure-annotations', state: 'review' });
  expect(f.calls.filter(call => call.method === 'turn/start')).toHaveLength(1);
  expect(f.calls.map(call => call.method)).toContain('thread/read');
});

it('does not restart an unidentified thread after thread/start response loss', async () => {
  const f = fixture();
  f.setFailure('thread');
  await expect(runFigureAgent(f.input)).rejects.toThrow(/uncertain/u);
  f.setFailure(null);
  await expect(runFigureAgent(f.input)).rejects.toThrow(/not be identified/u);
  expect(f.calls.filter(call => call.method === 'thread/start')).toHaveLength(1);
  expect(f.calls.filter(call => call.method === 'turn/start')).toHaveLength(0);
});

it('rejects an image crop bound to another PDF revision before opening Codex', async () => {
  const f = fixture();
  await expect(runFigureAgent({ ...f.input, image: { ...crop, origin: { ...crop.origin, revision: { ...selection.revision, fingerprint: 'changed' } } } })).rejects.toThrow(/does not match/u);
  expect(f.request).not.toHaveBeenCalled();
});

it('reuses the private validated result on a successful request retry', async () => {
  const f = fixture();
  await runFigureAgent(f.input);
  await runFigureAgent(f.input);
  expect(f.calls.filter(call => call.method === 'turn/start')).toHaveLength(1);
  expect(f.planFigureAnnotations).toHaveBeenCalledTimes(2);
});
