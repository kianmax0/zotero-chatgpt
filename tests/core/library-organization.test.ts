import { expect, it, vi } from 'vitest';
import type { ModelOption } from '../../packages/contracts/src/runtime.ts';
import type { NativeOrganizationItemSnapshot } from '../../packages/contracts/src/native.ts';
import type { ActionTaskRecord, ActionTasks } from '../../packages/contracts/src/tasks.ts';
import type { CodexConnection } from '../../packages/core/src/codex/connection.ts';
import { reconcileLibraryOrganization, runLibraryOrganization } from '../../packages/core/src/library/organization.ts';
import { clientId } from '../contracts/factories.ts';

const selected: NativeOrganizationItemSnapshot = {
  clientId, libraryId: 1, key: 'ITEMONE1',
  metadata: { itemType: 'journalArticle', title: 'A frozen library item', creators: [] },
  tags: ['existing'], collectionKeys: [], attachmentKeys: [], dateModified: '2026-09-23 10:00:00',
  contentSignature: 'frozen-content', organizationSignature: 'frozen-organization',
};
const model: ModelOption = {
  id: 'gpt-6-sol', displayName: 'GPT-6 Sol', isDefault: true,
  supportedReasoningEfforts: [{ id: 'medium', description: '' }], defaultReasoningEffort: 'medium',
  serviceTiers: [], defaultServiceTier: null,
};

class MemoryStorage {
  files = new Map<string, Uint8Array>();
  read = vi.fn((path: string) => Promise.resolve(this.files.get(path)?.slice() ?? null));
  writeAtomic = vi.fn((path: string, bytes: Uint8Array) => { this.files.set(path, bytes.slice()); return Promise.resolve(); });
  append = vi.fn(() => Promise.resolve());
  remove = vi.fn((path: string) => { this.files.delete(path); return Promise.resolve(); });
}

function fixture(answer = '{"candidates":[{"itemIndex":0,"tags":["topic"],"collectionIndexes":[0]}]}') {
  const calls: Array<{ method: string; params: unknown }> = [];
  const request = vi.fn((method: string, params: unknown): Promise<unknown> => {
    calls.push({ method, params });
    if (method === 'thread/start') return Promise.resolve({
      cwd: '/private/tmp/agent', approvalPolicy: 'never', approvalsReviewer: 'user',
      sandbox: { type: 'readOnly', networkAccess: false }, instructionSources: [],
      modelProvider: 'openai', model: 'gpt-6-sol', serviceTier: 'default', reasoningEffort: 'medium',
      thread: { id: 'thread-1', cwd: '/private/tmp/agent', modelProvider: 'openai', ephemeral: false, turns: [] },
    });
    if (method === 'turn/start') return Promise.resolve({ turn: { id: 'turn-1' } });
    if (method === 'thread/read') return Promise.resolve({ thread: { turns: [{ id: 'turn-1', status: 'completed', clientUserMessageId: 'request-1', items: [{ id: 'item-1', type: 'agentMessage', phase: 'final_answer', text: answer }], error: null }] } });
    throw new Error('Unexpected RPC');
  });
  const planOrganization = vi.fn(() => Promise.resolve({ kind: 'organization', state: 'review' } as ActionTaskRecord));
  const storage = new MemoryStorage();
  const input = {
    connection: { request, onFailure: () => () => {} } as Pick<CodexConnection, 'request' | 'onFailure'>,
    storage,
    tasks: { planOrganization } as Pick<ActionTasks, 'planOrganization'>,
    sessionId: '123e4567-e89b-42d3-a456-426614174000', requestId: 'request-1', question: 'Organize this paper by topic.',
    selection: [selected], collections: [{ clientId, libraryId: 1, collectionKey: 'COLLECT1', name: 'Methods' }],
    model, cwd: '/private/tmp/agent',
  };
  return { input, calls, request, planOrganization, storage };
}

it('sends only frozen metadata and indexes, then creates a review without native writes', async () => {
  const f = fixture();
  expect(await runLibraryOrganization(f.input)).toMatchObject({ kind: 'organization', state: 'review' });
  expect(f.calls.map(call => call.method)).toEqual(['thread/start', 'turn/start', 'thread/read']);
  const thread = f.calls[0]!.params as Record<string, unknown>;
  expect(thread.ephemeral).toBe(false);
  const turn = f.calls[1]!.params as { input: Array<{ text: string }> };
  expect(turn.input[0]!.text).toContain('A frozen library item');
  expect(turn.input[0]!.text).toContain('Methods');
  expect(turn.input[0]!.text).not.toContain('ITEMONE1');
  expect(turn.input[0]!.text).not.toContain('COLLECT1');
  expect(f.planOrganization).toHaveBeenCalledWith(expect.objectContaining({
    conversationId: '123e4567-e89b-42d3-a456-426614174000', modelRequestId: 'request-1',
    proposals: [{ itemIndex: 0, tags: ['topic'], collectionIndexes: [0] }],
    selection: [selected],
  }));
});

it('rejects model-selected native keys without creating a task', async () => {
  const f = fixture('{"candidates":[{"itemIndex":0,"tags":["topic"],"collectionKeys":["COLLECT1"]}]}');
  await expect(runLibraryOrganization(f.input)).rejects.toThrow();
  expect(f.planOrganization).not.toHaveBeenCalled();
  expect(f.storage.files.size).toBe(0);
});

it('rejects a mixed-library selection before any Codex turn', async () => {
  const f = fixture();
  f.input.selection.push({ ...selected, key: 'ITEMTWO2', libraryId: 2 });
  await expect(runLibraryOrganization(f.input)).rejects.toThrow();
  expect(f.request).not.toHaveBeenCalled();
});

it('does not start a second model turn for the same library session while one is running', async () => {
  const f = fixture();
  const first = runLibraryOrganization(f.input);
  await expect(runLibraryOrganization({ ...f.input, requestId: 'request-2' })).rejects.toThrow(/still running/u);
  await first;
  expect(f.calls.filter(call => call.method === 'turn/start')).toHaveLength(1);
});

it('refuses a thread whose effective sandbox is not read-only', async () => {
  const f = fixture();
  f.request.mockImplementationOnce(() => Promise.resolve({
    cwd: '/private/tmp/agent', approvalPolicy: 'never', approvalsReviewer: 'user',
    sandbox: { type: 'dangerFullAccess', networkAccess: true }, instructionSources: [],
    modelProvider: 'openai', model: 'gpt-6-sol', serviceTier: 'default', reasoningEffort: 'medium',
    thread: { id: 'thread-1', cwd: '/private/tmp/agent', modelProvider: 'openai', ephemeral: false, turns: [] },
  }));
  await expect(runLibraryOrganization(f.input)).rejects.toThrow(/thread response differs/u);
  expect(f.request).toHaveBeenCalledOnce();
  expect(f.request.mock.calls[0]?.[0]).toBe('thread/start');
  expect(f.planOrganization).not.toHaveBeenCalled();
});

it('retains a timed-out turn and reconciles its late completion without starting a second turn', async () => {
  const f = fixture();
  f.request.mockImplementation((method: string, params: unknown): Promise<unknown> => {
    f.calls.push({ method, params });
    if (method === 'thread/start') return Promise.resolve({
      cwd: '/private/tmp/agent', approvalPolicy: 'never', approvalsReviewer: 'user',
      sandbox: { type: 'readOnly', networkAccess: false }, instructionSources: [],
      modelProvider: 'openai', model: 'gpt-6-sol', serviceTier: 'default', reasoningEffort: 'medium',
      thread: { id: 'thread-1', cwd: '/private/tmp/agent', modelProvider: 'openai', ephemeral: false, turns: [] },
    });
    if (method === 'turn/start') return Promise.resolve({ turn: { id: 'turn-1' } });
    if (method === 'thread/read') return Promise.resolve({ thread: { turns: [{
      id: 'turn-1', status: 'inProgress', clientUserMessageId: 'request-1', items: [], error: null,
    }] } });
    throw new Error('Unexpected RPC');
  });
  await expect(runLibraryOrganization({ ...f.input, timeoutMs: 0 })).rejects.toThrow(/could not be confirmed/u);
  const saved = JSON.parse(new TextDecoder().decode(f.storage.files.get('pending-library-organizations/123e4567-e89b-42d3-a456-426614174000.json'))) as { threadId: string; turnId: string; requestId: string };
  expect(saved).toMatchObject({ threadId: 'thread-1', turnId: 'turn-1', requestId: 'request-1' });
  expect(f.calls.filter(call => call.method === 'turn/start')).toHaveLength(1);

  f.request.mockImplementation((method: string, params: unknown): Promise<unknown> => {
    f.calls.push({ method, params });
    if (method === 'thread/read') return Promise.resolve({ thread: { turns: [{
      id: 'turn-1', status: 'completed', clientUserMessageId: 'request-1',
      items: [{ id: 'answer-1', type: 'agentMessage', phase: 'final_answer', text: '{"candidates":[{"itemIndex":0,"tags":["topic"],"collectionIndexes":[0]}]}' }], error: null,
    }] } });
    throw new Error(`Unexpected retry RPC: ${method}`);
  });
  const task = await reconcileLibraryOrganization({ storage: f.storage, connection: f.input.connection, tasks: f.input.tasks, sessionId: f.input.sessionId });
  expect(task).toMatchObject({ kind: 'organization', state: 'review' });
  expect(f.calls.filter(call => call.method === 'turn/start')).toHaveLength(1);
  expect(f.calls.at(-1)).toMatchObject({ method: 'thread/read', params: { threadId: 'thread-1' } });
  expect(f.planOrganization).toHaveBeenCalledOnce();
  expect(f.planOrganization).toHaveBeenCalledWith(expect.objectContaining({
    modelRequestId: 'request-1', question: f.input.question, selection: [selected],
    proposals: [{ itemIndex: 0, tags: ['topic'], collectionIndexes: [0] }],
  }));
  expect(f.storage.files.has('pending-library-organizations/123e4567-e89b-42d3-a456-426614174000.json')).toBe(false);
});

it('resumes a saved thread before readback when a restarted app-server cannot read it directly', async () => {
  const f = fixture();
  f.request.mockImplementation((method: string, params: unknown): Promise<unknown> => {
    f.calls.push({ method, params });
    if (method === 'thread/start') return Promise.resolve({
      cwd: '/private/tmp/agent', approvalPolicy: 'never', approvalsReviewer: 'user',
      sandbox: { type: 'readOnly', networkAccess: false }, instructionSources: [],
      modelProvider: 'openai', model: 'gpt-6-sol', serviceTier: 'default', reasoningEffort: 'medium',
      thread: { id: 'thread-1', cwd: '/private/tmp/agent', modelProvider: 'openai', ephemeral: false, turns: [] },
    });
    if (method === 'turn/start') return Promise.resolve({ turn: { id: 'turn-1' } });
    throw new Error('No readback before restart');
  });
  await expect(runLibraryOrganization({ ...f.input, timeoutMs: 0 })).rejects.toThrow();
  let reads = 0;
  f.request.mockImplementation((method: string, params: unknown): Promise<unknown> => {
    f.calls.push({ method, params });
    if (method === 'thread/read') {
      if (++reads === 1) return Promise.reject(new Error('Thread must be resumed'));
      return Promise.resolve({ thread: { turns: [{ id: 'turn-1', status: 'completed', clientUserMessageId: 'request-1', items: [{ id: 'answer-1', type: 'agentMessage', phase: 'final_answer', text: '{"candidates":[{"itemIndex":0,"tags":["topic"],"collectionIndexes":[0]}]}' }], error: null }] } });
    }
    if (method === 'thread/resume') return Promise.resolve({
      cwd: '/private/tmp/agent', approvalPolicy: 'never', approvalsReviewer: 'user',
      sandbox: { type: 'readOnly', networkAccess: false }, instructionSources: [],
      modelProvider: 'openai', model: 'gpt-6-sol', serviceTier: 'default', reasoningEffort: 'medium',
      thread: { id: 'thread-1', cwd: '/private/tmp/agent', modelProvider: 'openai', ephemeral: false, turns: [] },
    });
    throw new Error(`Unexpected RPC: ${method}`);
  });
  await expect(reconcileLibraryOrganization({ storage: f.storage, connection: f.input.connection, tasks: f.input.tasks, sessionId: f.input.sessionId }))
    .resolves.toMatchObject({ kind: 'organization', state: 'review' });
  expect(f.calls.filter(call => call.method === 'turn/start')).toHaveLength(1);
  expect(f.calls.slice(-3).map(call => call.method)).toEqual(['thread/read', 'thread/resume', 'thread/read']);
});

it('keeps an in-progress request pending and creates no review task or native change', async () => {
  const f = fixture();
  f.request.mockImplementation((method: string, params: unknown): Promise<unknown> => {
    f.calls.push({ method, params });
    if (method === 'thread/start') return Promise.resolve({
      cwd: '/private/tmp/agent', approvalPolicy: 'never', approvalsReviewer: 'user',
      sandbox: { type: 'readOnly', networkAccess: false }, instructionSources: [],
      modelProvider: 'openai', model: 'gpt-6-sol', serviceTier: 'default', reasoningEffort: 'medium',
      thread: { id: 'thread-1', cwd: '/private/tmp/agent', modelProvider: 'openai', ephemeral: false, turns: [] },
    });
    if (method === 'turn/start') return Promise.resolve({ turn: { id: 'turn-1' } });
    throw new Error(`Unexpected RPC: ${method}`);
  });
  await expect(runLibraryOrganization({ ...f.input, timeoutMs: 0 })).rejects.toThrow();
  f.request.mockImplementation((method: string, params: unknown): Promise<unknown> => {
    f.calls.push({ method, params });
    if (method === 'thread/read') return Promise.resolve({ thread: { turns: [{
      id: 'turn-1', status: 'inProgress', clientUserMessageId: 'request-1', items: [], error: null,
    }] } });
    throw new Error(`Unexpected retry RPC: ${method}`);
  });
  await expect(reconcileLibraryOrganization({ storage: f.storage, connection: f.input.connection, tasks: f.input.tasks, sessionId: f.input.sessionId }))
    .rejects.toThrow(/still running/u);
  expect(f.calls.filter(call => call.method === 'turn/start')).toHaveLength(1);
  expect(f.planOrganization).not.toHaveBeenCalled();
});
