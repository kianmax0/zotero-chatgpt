import { expect, it, vi } from 'vitest';
import type { ModelOption, StoragePort } from '../../packages/contracts/src/runtime.ts';
import type { CodexConnection } from '../../packages/core/src/codex/connection.ts';
import { attachLibraryAgentDisplayText, getLibraryAgentSession, sendLibraryAgentMessage, type LibraryAgentProgress } from '../../packages/core/src/library/session.ts';

const model: ModelOption = {
  id: 'gpt-6-sol', displayName: 'GPT-6 Sol', isDefault: true,
  supportedReasoningEfforts: [{ id: 'medium', description: '' }], defaultReasoningEffort: 'medium',
  serviceTiers: [], defaultServiceTier: null,
};
const sessionId = '123e4567-e89b-42d3-a456-426614174000';
const request1 = '123e4567-e89b-42d3-a456-426614174001';
const request2 = '123e4567-e89b-42d3-a456-426614174002';
const threadId = 'library-thread';

class MemoryStorage implements StoragePort {
  files = new Map<string, Uint8Array>();
  read = vi.fn((name: string) => Promise.resolve(this.files.get(name)?.slice() ?? null));
  writeAtomic = vi.fn((name: string, data: Uint8Array) => { this.files.set(name, data.slice()); return Promise.resolve(); });
  append = vi.fn(() => Promise.resolve());
  remove = vi.fn((name: string) => { this.files.delete(name); return Promise.resolve(); });
}

function fixture() {
  const storage = new MemoryStorage();
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const turns: Array<Record<string, unknown>> = [];
  const answers = new Map<string, { status: string; text: string }>();
  let turnCount = 0;
  let failStart: 'thread' | 'turn' | null = null;
  const request = vi.fn((method: string, paramsValue: unknown): Promise<unknown> => {
    const params = paramsValue as Record<string, unknown>;
    calls.push({ method, params });
    if (method === 'thread/start') {
      if (failStart === 'thread') throw new Error('uncertain thread start');
      return Promise.resolve({
        cwd: '/private/tmp/library', approvalPolicy: 'never', approvalsReviewer: 'user',
        sandbox: { type: 'readOnly', networkAccess: false }, instructionSources: [],
        modelProvider: 'openai', model: params.model, serviceTier: 'default', reasoningEffort: params.config && (params.config as Record<string, unknown>).model_reasoning_effort,
        thread: { id: threadId, cwd: '/private/tmp/library', modelProvider: 'openai', ephemeral: false, turns: [] },
      });
    }
    if (method === 'thread/resume') return Promise.resolve({
      cwd: '/private/tmp/library', approvalPolicy: 'never', approvalsReviewer: 'user',
      sandbox: { type: 'readOnly', networkAccess: false }, instructionSources: [],
      modelProvider: 'openai', model: 'gpt-6-sol', serviceTier: 'default', reasoningEffort: 'medium',
      thread: { id: threadId, cwd: '/private/tmp/library', modelProvider: 'openai', ephemeral: false, turns },
    });
    if (method === 'turn/start') {
      if (failStart === 'turn') throw new Error('uncertain turn start');
      const id = `turn-${++turnCount}`;
      turns.push({ id, status: answers.get(String(params.clientUserMessageId))?.status ?? 'completed', clientUserMessageId: params.clientUserMessageId, items: [{ id: `answer-${id}`, type: 'agentMessage', phase: 'final_answer', text: answers.get(String(params.clientUserMessageId))?.text ?? `Answer ${id}` }] });
      return Promise.resolve({ turn: { id } });
    }
    if (method === 'thread/read') return Promise.resolve({ thread: { id: threadId, turns } });
    throw new Error(`unexpected method ${method}`);
  });
  const connection = { request, onFailure: () => () => {} } as Pick<CodexConnection, 'request' | 'onFailure'>;
  let idCount = 10;
  const base = {
    connection, storage, sessionId, question: 'Find useful papers about predictive coding.',
    context: { selectedCollection: { title: 'Predictive coding' }, items: [{ title: 'A paper' }] },
    mentions: [{ type: 'collection' as const, id: 'COLLECTION', label: '@Predictive coding' }],
    skill: { id: 'discover', name: 'Find papers', instructions: 'Search scholarly sources using the permitted workflow.' },
    model, cwd: '/private/tmp/library', uuid: () => `123e4567-e89b-42d3-a456-${String(idCount++).padStart(12, '0')}`,
    now: () => '2026-09-23T10:00:00.000Z', wait: () => Promise.resolve(), timeoutMs: 20,
  };
  return { base, storage, calls, request, turns, answers, setFailStart(value: 'thread' | 'turn' | null) { failStart = value; } };
}

it('persists a frozen transcript and executes one tool-free read-only Codex turn', async () => {
  const f = fixture();
  const input = { ...f.base, requestId: request1 };
  const result = await sendLibraryAgentMessage(input);
  expect(result).toMatchObject({ format: 'text', answer: 'Answer turn-1' });
  expect(f.calls.map(call => call.method)).toEqual(['thread/start', 'turn/start', 'thread/read']);
  const start = f.calls[0]!.params;
  const turn = f.calls[1]!.params;
  expect(start.baseInstructions).toContain('"kind":"discover"');
  expect(start.baseInstructions).toContain('"kind":"organize"');
  expect(start.ephemeral).toBe(false);
  expect(start.sandbox).toBe('read-only');
  expect(turn.approvalPolicy).toBe('never');
  expect(turn.sandboxPolicy).toEqual({ type: 'readOnly', networkAccess: false });
  expect(JSON.stringify(turn)).toContain('@Predictive coding');
  expect(JSON.stringify(turn)).toContain('predictive coding');
  const payload = JSON.parse((turn.input as Array<{ text: string }>)[0]!.text) as { mentions: Array<Record<string, unknown>> };
  expect(payload.mentions).toEqual([{ type: 'collection', label: '@Predictive coding' }]);
  expect(JSON.stringify(payload.mentions)).not.toContain('COLLECTION');
  expect(result.session.messages.map(message => message.role)).toEqual(['user', 'status', 'assistant']);
  expect(result.session.messages[0]).toMatchObject({ scope: { model: 'gpt-6-sol', mentions: f.base.mentions, skill: f.base.skill } });
  expect(await getLibraryAgentSession({ storage: f.storage, sessionId })).toMatchObject({ threadId, messages: result.session.messages });
  const repeated = await sendLibraryAgentMessage(input);
  expect(repeated.format).toBe('text');
  if (repeated.format === 'text') expect(repeated.answer).toBe('Answer turn-1');
  expect(f.calls.filter(call => call.method === 'turn/start')).toHaveLength(1);
});

it('continues two turns in one durable thread and freezes different per-request scopes', async () => {
  const f = fixture();
  await sendLibraryAgentMessage({ ...f.base, requestId: request1 });
  await sendLibraryAgentMessage({ ...f.base, question: 'Summarize that paper', context: { paper: 'Changed after turn one' }, mentions: [], skill: null, requestId: request2 });
  expect(f.calls.filter(call => call.method === 'thread/start')).toHaveLength(1);
  expect(f.calls.filter(call => call.method === 'turn/start')).toHaveLength(2);
  expect(f.calls.filter(call => call.method === 'thread/resume')).toHaveLength(1);
  expect(f.calls.find(call => call.method === 'thread/resume')?.params.baseInstructions).toContain('"kind":"metadata"');
  const session = await getLibraryAgentSession({ storage: f.storage, sessionId });
  expect(session.threadId).toBe(threadId);
  expect(session.messages.filter(message => message.role === 'assistant').map(message => message.content)).toEqual(['Answer turn-1', 'Answer turn-2']);
  expect(session.messages[0]!.scope).toMatchObject({ context: f.base.context, mentions: f.base.mentions, skill: f.base.skill });
  expect(session.messages[3]!.scope).toMatchObject({ context: { paper: 'Changed after turn one' }, mentions: [], skill: null });
});

it('emits progress while polling and returns strict JSON objects when requested', async () => {
  const f = fixture();
  f.answers.set(request1, { status: 'completed', text: '{"papers":[{"doi":"10.1234/example"}]}' });
  const progress: LibraryAgentProgress[] = [];
  const jsonInput = { ...f.base, requestId: request1, outputFormat: 'json' as const, onProgress: (event: LibraryAgentProgress) => progress.push(event) };
  const response = await sendLibraryAgentMessage(jsonInput);
  expect(response).toMatchObject({ format: 'json', rawAnswer: '{"papers":[{"doi":"10.1234/example"}]}', value: { papers: [{ doi: '10.1234/example' }] } });
  expect(response.session.messages.at(-1)?.content).toBe('Structured Agent response is ready for validation.');
  expect(JSON.stringify(response.session)).not.toContain('10.1234/example');
  const displayed = await attachLibraryAgentDisplayText({ storage: f.storage, sessionId, requestId: request1, displayText: 'Found one paper with DOI 10.1234/example.' });
  expect(displayed.messages.at(-1)?.content).toBe('Found one paper with DOI 10.1234/example.');
  const stored = JSON.parse(new TextDecoder().decode(f.storage.files.get('library-agent-sessions/' + sessionId + '.json'))) as { messages: Array<Record<string, unknown>> };
  expect(stored.messages.at(-1)?.rawResult).toBe('{"papers":[{"doi":"10.1234/example"}]}');
  const repeated = await sendLibraryAgentMessage(jsonInput);
  expect(repeated.format).toBe('json');
  if (repeated.format === 'json') expect(repeated.value).toEqual({ papers: [{ doi: '10.1234/example' }] });
  expect(f.calls.filter(call => call.method === 'turn/start')).toHaveLength(1);
  expect(progress.map(event => event.state)).toEqual(['starting', 'completed']);
  expect(progress.every(event => event.answer === undefined)).toBe(true);
});

it('reports a running response through the progress callback while polling', async () => {
  const f = fixture();
  f.answers.set(request1, { status: 'inProgress', text: 'Partial response' });
  const progress: LibraryAgentProgress[] = [];
  let waited = false;
  const response = await sendLibraryAgentMessage({
    ...f.base, requestId: request1,
    wait: () => {
      if (!waited && f.turns[0]) {
        waited = true;
        f.turns[0].status = 'completed';
        const items = f.turns[0].items as Array<Record<string, unknown>>;
        items[0]!.text = 'Final response';
      }
      return Promise.resolve();
    },
    onProgress: (event: LibraryAgentProgress) => progress.push(event),
  });
  expect(response.format).toBe('text');
  if (response.format === 'text') expect(response.answer).toBe('Final response');
  expect(progress).toContainEqual(expect.objectContaining({ state: 'running', answer: 'Partial response' }));
});

it('reconciles an uncertain turn after restart and returns the same result without a duplicate turn', async () => {
  const f = fixture();
  f.setFailStart('turn');
  await expect(sendLibraryAgentMessage({ ...f.base, requestId: request1 })).rejects.toThrow(/uncertain/u);
  expect(f.calls.filter(call => call.method === 'turn/start')).toHaveLength(1);
  f.setFailStart(null);
  // Simulate that the upstream accepted the turn even though its start response was lost.
  f.turns.push({ id: 'turn-recovered', status: 'completed', clientUserMessageId: request1, items: [{ id: 'final', type: 'agentMessage', phase: 'final_answer', text: 'Recovered answer' }] });
  const recovered = await sendLibraryAgentMessage({ ...f.base, requestId: request1 });
  expect(recovered.format).toBe('text');
  if (recovered.format === 'text') expect(recovered.answer).toBe('Recovered answer');
  expect(f.calls.filter(call => call.method === 'turn/start')).toHaveLength(1);
  expect(f.calls.map(call => call.method)).toContain('thread/read');
});

it('never starts a second thread when the first thread/start result is uncertain', async () => {
  const f = fixture();
  f.setFailStart('thread');
  await expect(sendLibraryAgentMessage({ ...f.base, requestId: request1 })).rejects.toThrow(/uncertain/u);
  f.setFailStart(null);
  await expect(sendLibraryAgentMessage({ ...f.base, requestId: request1 })).rejects.toThrow(/not be identified/u);
  expect(f.calls.filter(call => call.method === 'thread/start')).toHaveLength(1);
  expect(f.calls.filter(call => call.method === 'turn/start')).toHaveLength(0);
});

it('rejects unsupported model and malformed strict JSON output', async () => {
  const f = fixture();
  await expect(sendLibraryAgentMessage({ ...f.base, model: { ...model, id: 'gpt-5.5' }, requestId: request1 })).rejects.toThrow(/GPT-6/u);
  expect(f.request).not.toHaveBeenCalled();
  f.answers.set(request1, { status: 'completed', text: 'Here is JSON: {"ok":true}' });
  await expect(sendLibraryAgentMessage({ ...f.base, requestId: request1, outputFormat: 'json' })).rejects.toThrow(/JSON object/u);
  expect(f.calls.filter(call => call.method === 'turn/start')).toHaveLength(1);
});
