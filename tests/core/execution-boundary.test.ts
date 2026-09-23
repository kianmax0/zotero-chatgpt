import { afterEach, describe, expect, it } from 'vitest';
import { createReaderClient } from '../../packages/core/src/index.ts';
import { ConversationStore } from '../../packages/core/src/sessions/store.ts';
import type { ReaderClient } from '../../packages/contracts/src/runtime.ts';
import type { SendInput } from '../../packages/contracts/src/index.ts';
import { MemoryStorage, flush } from './doubles.ts';
import { server, methods, turn } from './fixtures.ts';
import { citationA, paperA, settings } from '../contracts/factories.ts';
import { documentA } from '../contracts/document-fixture.ts';

const clients: ReaderClient[] = [];
let ids = 0;
afterEach(async () => { for (const c of clients.splice(0)) await c.close().catch(() => undefined); });
const uuid = () => `bbbbbbbb-0000-4000-8000-${String(++ids).padStart(12, '0')}`;
const requestId = (n: number) => `22222222-0000-4000-8000-${String(n).padStart(12, '0')}`;

/**
 * The Codex Agent runtime entry point, observed at the process boundary. Any of these methods means
 * an Agent execution lifecycle started (a native thread, a resumable turn or an interrupt). This is
 * the breakpoint the acceptance criterion describes: a Chat request must never reach it.
 */
const AGENT_ENTRY = new Set(['thread/start', 'thread/resume', 'turn/start', 'turn/interrupt']);
const agentEntries = (p: ReturnType<typeof server>['p']) => methods(p).filter(method => AGENT_ENTRY.has(method));
const complete = (p: ReturnType<typeof server>['p'], threadId: string, turnId: string, itemId: string, text: string) => {
  p.emit({ method: 'item/completed', params: { threadId, turnId, item: { type: 'agentMessage', id: itemId, text, phase: 'final_answer', memoryCitation: null } } });
  p.emit({ method: 'turn/completed', params: { threadId, turn: { ...turn, id: turnId, status: 'completed', items: [{ type: 'agentMessage', id: itemId, text, phase: 'final_answer' }] } } });
};

async function setup(lines: string[] = [], storage = new MemoryStorage()) {
  const s = server();
  const c = await createReaderClient(s.p, storage, { codexVersion: '0.156.1', cwd: '/isolated', uuid, loginTimeoutMs: 1000, deltaFlushMs: 1, now: () => '2026-09-09T08:00:00.000Z', trace: line => lines.push(line) });
  clients.push(c);
  await c.refreshAccount();
  const conversation = await c.current(paperA, 'Synthetic Paper A');
  const request = (n: number, overrides: Partial<SendInput> = {}): SendInput => ({ requestId: requestId(n), conversationId: conversation.id, action: 'ask', question: '', citations: [], settings, ...overrides });
  const state = async (input: SendInput) => (await c.request(conversation.id, input.requestId)).state;
  return { ...s, c, conversation, request, state };
}

describe('Chat never enters the Codex Agent runtime', () => {
  it('G: opening a conversation in default Chat mode starts no Codex thread or turn', async () => {
    const { p, conversation } = await setup();
    // The handshake and account/model catalog are the shared platform layer. What must not happen on
    // open is Agent execution: no thread, no resume, no turn for a conversation nobody has asked about.
    expect(methods(p)).not.toContain('thread/start');
    expect(agentEntries(p)).toEqual([]);
    expect(conversation.activeRequestId).toBeNull();
  });

  it('H: an interrupted chat request fails instead of entering Agent reconciliation', async () => {
    const storage = new MemoryStorage();
    const store = new ConversationStore(storage, { uuid, now: () => '2026-09-09T08:00:00.000Z' });
    const created = await store.create(paperA, 'Synthetic Paper A', settings);
    // A chat request left running, in a conversation that already holds an Agent thread. If chat runs
    // were `uncertain`, reopening would resume that thread — an Agent call caused by a Chat request.
    created.messages.push({ id: 'm-user', requestId: requestId(9), role: 'user', phase: null, settings, text: 'hello', citations: [], status: 'completed' });
    created.requests.push({ requestId: requestId(9), hash: 'unused', state: 'running', turnId: null, createdAt: 'now', updatedAt: 'now', action: 'ask' });
    created.activeRequestId = requestId(9);
    created.upstream.threadId = 'thread-from-an-earlier-agent-turn';
    await store.save(created);

    const { c, p } = await setup([], storage);
    await flush();
    expect(await c.request(created.id, requestId(9))).toMatchObject({ state: 'failed' });
    expect(methods(p)).not.toContain('thread/resume');
    expect(methods(p)).not.toContain('thread/read');
  });

  it('J: warm Codex does not recover stored Agent work while Chat only browses local history', async () => {
    const storage = new MemoryStorage();
    const store = new ConversationStore(storage, { uuid, now: () => '2026-09-09T08:00:00.000Z' });
    const created = await store.create(paperA, 'Synthetic Paper A', settings);
    created.messages.push({ id: 'm-agent-user', requestId: requestId(10), role: 'user', phase: null, mode: 'agent', settings, text: 'old agent work', citations: [], status: 'completed' });
    created.requests.push({ requestId: requestId(10), hash: 'unused', hashVersion: 3, state: 'running', turnId: 'old-turn', createdAt: 'now', updatedAt: 'now', action: 'ask' });
    created.activeRequestId = requestId(10); created.upstream.threadId = 'old-agent-thread';
    await store.save(created);

    const { c, p } = await setup([], storage);
    await c.peekCurrent(paperA); await c.get(created.id); await c.select(paperA, created.id); await flush();
    expect(methods(p)).not.toContain('thread/resume');
    expect(methods(p)).not.toContain('thread/read');
    expect(methods(p)).not.toContain('turn/start');

    await c.ensureAgentReady!(); await flush();
    expect(methods(p)).toContain('thread/resume');
    expect(methods(p)).toContain('thread/read');
  });

  it('A: a plain chat message never touches the Codex runtime and fails honestly', async () => {
    const lines: string[] = [];
    const { c, p, request, conversation } = await setup(lines);
    // Chat's transport is an unresolved platform boundary in this build. The request is refused with
    // that reason before it is hashed, recorded or routed, so it cannot silently become a Codex turn.
    const failure: unknown = await c.send(request(1, { question: 'hello' })).catch((error: unknown) => error);
    expect((failure as { code?: string }).code).toBe('UNSUPPORTED_INTERACTION');
    expect((failure as Error).message).toContain('chat transport');
    await flush();
    expect(agentEntries(p)).toEqual([]);
    // Nothing reached the conversation controller: the trace the controller writes is empty.
    expect(lines).toEqual([]);
    expect((await c.get(conversation.id)).messages).toEqual([]);
    expect((await c.get(conversation.id)).activeRequestId).toBeNull();
  });

  it('B: a chat message with the current PDF still never touches the Codex runtime', async () => {
    const { c, p, request, conversation } = await setup();
    const input = request(2, { question: 'Summarize this paper.', document: documentA });
    await expect(c.send(input)).rejects.toMatchObject({ code: 'UNSUPPORTED_INTERACTION' });
    await flush();
    expect(agentEntries(p)).toEqual([]);
    // No record, no snapshot and no assistant message: a refused Chat request has no side effects.
    const after = await c.get(conversation.id);
    expect(after.messages).toEqual([]); expect(after.activeRequestId).toBeNull();
  });

  it('C: a complex chat prompt is not escalated to Agent by its size or reasoning demand', async () => {
    const { c, p, request } = await setup();
    const input = request(3, { question: 'Read all 20 pages and explain the full mathematical derivation in detail, then compare every method.' });
    await expect(c.send(input)).rejects.toMatchObject({ code: 'UNSUPPORTED_INTERACTION' });
    await flush();
    expect(agentEntries(p)).toEqual([]);
  });

  it('D: a chat request that asks for an action neither writes nor switches mode', async () => {
    const { c, p, conversation, request } = await setup();
    const input = request(4, { question: 'Highlight all important paragraphs.' });
    await expect(c.send(input)).rejects.toMatchObject({ code: 'UNSUPPORTED_INTERACTION' });
    await flush();
    expect(agentEntries(p)).toEqual([]);
    // No write happened and the conversation is not left busy: the user must switch to Agent themselves.
    const after = await c.get(conversation.id);
    expect(after.activeRequestId).toBeNull();
    expect(after.messages).toEqual([]);
  });

  it('I: a Chat refusal is not an auth failure, so an uninitialized Codex cannot make Chat look signed-out', async () => {
    const s = server();
    const c = await createReaderClient(s.p, new MemoryStorage(), { codexVersion: '0.156.1', cwd: '/isolated', uuid, loginTimeoutMs: 1000, deltaFlushMs: 1, now: () => '2026-09-09T08:00:00.000Z', trace: () => undefined });
    clients.push(c);
    // No refreshAccount: the Codex channel was never opened, so the catalog is empty and the runtime
    // would answer AUTH_REQUIRED to an Agent request. Chat must refuse for its own reason instead.
    expect(c.snapshot()).toMatchObject({ runtime: 'ready', account: { state: 'signedOut' }, models: [] });
    await expect(c.send({ requestId: requestId(8), conversationId: '33333333-0000-4000-8000-000000000008', action: 'ask', question: 'hello', citations: [], settings, mode: 'chat' })).rejects.toMatchObject({ code: 'UNSUPPORTED_INTERACTION' });
    // The refusal did not start Codex: no handshake, no protocol call, no process termination.
    expect(methods(s.p)).toEqual([]);
    expect(s.p.terminated).toBe(false);
  });
});

describe('Agent keeps entering the Codex runtime', () => {
  it('E: an agent request starts a native thread and turn', async () => {
    const lines: string[] = [];
    const { c, p, request, state } = await setup(lines);
    await c.send(request(5, { mode: 'agent', question: 'Highlight important paragraphs.', citations: [citationA] })); await flush();
    expect(agentEntries(p)).toContain('thread/start');
    expect(agentEntries(p)).toContain('turn/start');
    expect(lines).toEqual(['[conversation] mode=agent', '[execution-router] executor=agent', '[agent] runtime_started=true']);
    expect(await state(request(5))).toBe('running');
  });

  it('F: switching Agent then Chat does not reuse the Agent runtime for Chat', async () => {
    const { c, conversation, p, request, state } = await setup();
    const agent = request(6, { mode: 'agent', question: 'Make an annotation.', citations: [citationA] });
    await c.send(agent); await flush();
    complete(p, 'thread-1', 'turn-1', 'item-1', 'Annotation added.'); await flush();
    const entered = agentEntries(p).length;
    const chat = request(7, { mode: 'chat', question: 'Which annotation matters most?' });
    await expect(c.send(chat)).rejects.toMatchObject({ code: 'UNSUPPORTED_INTERACTION' });
    await flush();
    // Chat adds no thread, no resume and no turn on top of the Agent execution that already ran.
    expect(agentEntries(p)).toHaveLength(entered);
    // The Agent request keeps its own lifecycle and answer in the same conversation; the refused Chat
    // request left no record behind.
    expect(await state(agent)).toBe('completed');
    const messages = (await c.get(conversation.id)).messages;
    expect(messages.find(message => message.requestId === agent.requestId && message.role === 'assistant')?.text).toBe('Annotation added.');
    expect(messages.some(message => message.requestId === chat.requestId)).toBe(false);
  });
});
