import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReaderClient } from '../../packages/core/src/index.ts';
import { ConversationStore } from '../../packages/core/src/sessions/store.ts';
import type { ReaderClient } from '../../packages/contracts/src/runtime.ts';
import type { ReaderEvent, SendInput } from '../../packages/contracts/src/index.ts';
import { validateCitation } from '../../packages/contracts/src/validation.ts';
import { MemoryStorage, flush } from './doubles.ts';
import { server, methods, thread, turn } from './fixtures.ts';
import { citationA, paperA, settings } from '../contracts/factories.ts';
const clients: ReaderClient[] = [];
let ids = 0;
afterEach(async () => { for (const c of clients.splice(0)) await c.close().catch(() => undefined); vi.useRealTimers(); });
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;
const requestId = (n: number) => `11111111-0000-4000-8000-${String(n).padStart(12, '0')}`;
// Mirrors `hashInput` in `packages/core/src/sessions/service.ts` for the versions these tests seed:
// `images` is hashed by every version, v2 adds `paper`, v3 additionally hashes the frozen `mode`.
// Citations are normalized exactly as `validateCitation` does it on the way in, because the hash is
// taken over the validated input and is order-sensitive.
async function hashInput(input: SendInput, version: 1 | 2 | 3 = 1): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify({ conversationId: input.conversationId, action: input.action, question: input.question, citations: input.citations.map(validateCitation), settings: input.settings, images: input.images ?? [], ...(version >= 2 && input.paper ? { paper: input.paper } : {}), ...(version === 3 && input.organization ? { organization: input.organization } : {}), ...(version === 3 ? { mode: input.mode ?? 'chat' } : {}) }));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
async function setup(configure?: (s: ReturnType<typeof server>) => void, storage = new MemoryStorage()) {
  const s = server(); configure?.(s);
  const c = await createReaderClient(s.p, storage, { codexVersion: '0.156.1', cwd: '/isolated', uuid, loginTimeoutMs: 1000, deltaFlushMs: 1, now: () => '2026-09-09T08:00:00.000Z' }); clients.push(c);
  const events: ReaderEvent[] = []; c.subscribe(e => events.push(e));
  return { ...s, storage, c, events };
}
async function signedIn(configure?: (s: ReturnType<typeof server>) => void, storage?: MemoryStorage) {
  const rig = await setup(configure, storage); await rig.c.refreshAccount();
  const conversation = await rig.c.current(paperA, 'Synthetic Paper A');
  await rig.c.ensureAgentReady!();
  // Recovery is Agent-only: only a Codex request can be interrupted with native work to reconcile, so
  // these helpers declare `mode: 'agent'` explicitly. `absent` is the Chat request (D3) variant.
  const absent = (n: number, overrides: Partial<SendInput> = {}): SendInput => ({ requestId: requestId(n), conversationId: conversation.id, action: 'explain', question: '', citations: [citationA], settings, ...overrides });
  const explain = (n: number, overrides: Partial<SendInput> = {}): SendInput => ({ ...absent(n, overrides), mode: overrides.mode ?? 'agent' });
  return { ...rig, conversation, explain, absent };
}
const tick = (ms = 5) => new Promise<void>(resolve => setTimeout(resolve, ms));
const stream = (p: ReturnType<typeof server>['p'], threadId: string, turnId: string, itemId: string, delta: string) => p.emit({ method: 'item/agentMessage/delta', params: { threadId, turnId, itemId, delta } });
describe('process restart and uncertain reconciliation', () => {
  it('redelivers a persisted accepted request exactly once after a crash before dispatch', async () => {
    const storage = new MemoryStorage();
    const store = new ConversationStore(storage, { uuid, now: () => '2026-09-09T08:00:00.000Z' });
    const created = await store.create(paperA, 'Synthetic Paper A', settings);
    const input: SendInput = { requestId: requestId(1), conversationId: created.id, action: 'explain', question: '', citations: [citationA], settings, mode: 'agent' };
    const hash = await hashInput(input);
    created.requests.push({ requestId: input.requestId, hash, state: 'accepted', turnId: null, createdAt: 'now', updatedAt: 'now', action: 'explain' });
    created.messages.push({ id: 'm-user', requestId: input.requestId, role: 'user', phase: null, settings, text: '', citations: [citationA], status: 'completed', mode: 'agent' });
    created.activeRequestId = input.requestId;
    await store.save(created);
    const { c, p } = await signedIn(undefined, storage);
    await flush(); await tick(20);
    expect(methods(p).slice(0, 3)).toEqual(['initialize', 'initialized', 'config/read']);
    expect(methods(p).filter(m => m === 'turn/start')).toHaveLength(1);
    expect(await c.request(created.id, input.requestId)).toMatchObject({ state: 'running' });
    expect(methods(p).filter(m => m === 'turn/start')).toHaveLength(1);
  });
  it('reconstructs a hashVersion 3 request whose frozen mode is agent', async () => {
    const storage = new MemoryStorage();
    const store = new ConversationStore(storage, { uuid, now: () => '2026-09-09T08:00:00.000Z' });
    const created = await store.create(paperA, 'Synthetic Paper A', settings);
    const input: SendInput = { requestId: requestId(1), conversationId: created.id, action: 'explain', question: '', citations: [citationA], settings, mode: 'agent' };
    const hash = await hashInput(input, 3);
    created.requests.push({ requestId: input.requestId, hash, hashVersion: 3, state: 'accepted', turnId: null, createdAt: 'now', updatedAt: 'now', action: 'explain' });
    created.messages.push({ id: 'm-user', requestId: input.requestId, role: 'user', phase: null, settings, text: '', citations: [citationA], status: 'completed', mode: 'agent' });
    created.activeRequestId = input.requestId;
    await store.save(created);
    const { c, p } = await signedIn(undefined, storage);
    await flush(); await tick(20);
    // The frozen mode participates in the v3 hash, so a mismatch would leave the request uncertain.
    expect(methods(p).filter(m => m === 'turn/start')).toHaveLength(1);
    expect(await c.request(created.id, input.requestId)).toMatchObject({ state: 'running' });
  });
  it('reconstructs the exact frozen organization scope instead of reading the current selection', async () => {
    const storage = new MemoryStorage();
    const store = new ConversationStore(storage, { uuid, now: () => '2026-09-09T08:00:00.000Z' });
    const created = await store.create(paperA, 'Synthetic Paper A', settings);
    const organization = {
      selection: [{ clientId: paperA.clientId, libraryId: 1, key: 'ITEMONE1', metadata: { itemType: 'journalArticle' as const, title: 'Frozen selection', creators: [] }, tags: ['existing'], collectionKeys: [], attachmentKeys: [], dateModified: 'then', contentSignature: 'full', organizationSignature: 'non-organization' }],
      collections: [{ clientId: paperA.clientId, libraryId: 1, collectionKey: 'COLLECT1', name: 'Topic A' }],
    };
    const input: SendInput = { requestId: requestId(1), conversationId: created.id, action: 'ask', question: 'Organize these.', citations: [], settings, mode: 'agent', organization };
    const hash = await hashInput(input, 3);
    created.requests.push({ requestId: input.requestId, hash, hashVersion: 3, state: 'accepted', turnId: null, createdAt: 'now', updatedAt: 'now', action: 'ask' });
    created.messages.push({ id: 'm-user', requestId: input.requestId, role: 'user', phase: null, settings, text: input.question, citations: [], status: 'completed', mode: 'agent', organization });
    created.activeRequestId = input.requestId; await store.save(created);
    const { c, p } = await signedIn(undefined, storage); await flush(); await tick(20);
    expect(methods(p).filter(method => method === 'turn/start')).toHaveLength(1);
    expect(await c.request(created.id, input.requestId)).toMatchObject({ state: 'running' });
    const reloaded = await new ConversationStore(storage, { uuid, now: () => '2026-09-09T08:00:00.000Z' }).get(created.id);
    expect(reloaded.messages.find(message => message.requestId === input.requestId && message.role === 'user')?.organization).toEqual(organization);
  });
  it('redelivers a hashVersion 3 request with no mode as chat and never enters the Codex runtime (D3)', async () => {
    const storage = new MemoryStorage();
    const store = new ConversationStore(storage, { uuid, now: () => '2026-09-09T08:00:00.000Z' });
    const created = await store.create(paperA, 'Synthetic Paper A', settings);
    const input: SendInput = { requestId: requestId(1), conversationId: created.id, action: 'explain', question: '', citations: [citationA], settings };
    const hash = await hashInput(input, 3);
    created.requests.push({ requestId: input.requestId, hash, hashVersion: 3, state: 'accepted', turnId: null, createdAt: 'now', updatedAt: 'now', action: 'explain' });
    created.messages.push({ id: 'm-user', requestId: input.requestId, role: 'user', phase: null, settings, text: '', citations: [citationA], status: 'completed' });
    created.activeRequestId = input.requestId;
    await store.save(created);
    const { c, p } = await signedIn(undefined, storage);
    await flush(); await tick(20);
    // Chat has no Codex thread to resume: redelivery reaches the chat transport and fails honestly.
    expect(methods(p).filter(m => m === 'turn/start')).toHaveLength(0);
    expect(await c.request(created.id, input.requestId)).toMatchObject({ state: 'failed' });
  });
  it('keeps a hashVersion 2 record written before the mode field reconstructable (invariant 11)', async () => {
    const storage = new MemoryStorage();
    const store = new ConversationStore(storage, { uuid, now: () => '2026-09-09T08:00:00.000Z' });
    const created = await store.create(paperA, 'Synthetic Paper A', settings);
    const input: SendInput = { requestId: requestId(1), conversationId: created.id, action: 'explain', question: '', citations: [citationA], settings, mode: 'agent' };
    const hash = await hashInput(input, 2);
    created.requests.push({ requestId: input.requestId, hash, hashVersion: 2, state: 'accepted', turnId: null, createdAt: 'now', updatedAt: 'now', action: 'explain' });
    created.messages.push({ id: 'm-user', requestId: input.requestId, role: 'user', phase: null, settings, text: '', citations: [citationA], status: 'completed', mode: 'agent' });
    created.activeRequestId = input.requestId;
    await store.save(created);
    const { c, p } = await signedIn(undefined, storage);
    await flush(); await tick(20);
    // v2 must keep hashing without `mode`; otherwise already-persisted requests become uncertain.
    expect(methods(p).filter(m => m === 'turn/start')).toHaveLength(1);
    expect(await c.request(created.id, input.requestId)).toMatchObject({ state: 'running' });
  });
  it('retries accepted redelivery after sign-in if the conversation was opened while signed out', async () => {
    const storage = new MemoryStorage();
    const store = new ConversationStore(storage, { uuid, now: () => '2026-09-09T08:00:00.000Z' });
    const created = await store.create(paperA, 'Synthetic Paper A', settings);
    const input: SendInput = { requestId: requestId(1), conversationId: created.id, action: 'explain', question: '', citations: [citationA], settings, mode: 'agent' };
    const hash = await hashInput(input);
    created.requests.push({ requestId: input.requestId, hash, state: 'accepted', turnId: null, createdAt: 'now', updatedAt: 'now', action: 'explain' });
    created.messages.push({ id: 'm-user', requestId: input.requestId, role: 'user', phase: null, settings, text: '', citations: [citationA], status: 'completed', mode: 'agent' });
    created.activeRequestId = input.requestId;
    await store.save(created);
    const unsigned = await setup(s => {
      s.handlers.set('account/read', () => ({ account: null, requiresOpenaiAuth: true }));
    }, storage);
    await unsigned.c.refreshAccount();
    await unsigned.c.current(paperA, 'Synthetic Paper A');
    expect(methods(unsigned.p)).not.toContain('turn/start');
    unsigned.handlers.set('account/read', () => ({ account: { type: 'chatgpt', email: 'private@example.test', planType: 'plus' }, requiresOpenaiAuth: true }));
    await unsigned.c.refreshAccount();
    await unsigned.c.get(created.id);
    await unsigned.c.ensureAgentReady!();
    await flush(); await tick(20);
    expect(methods(unsigned.p).filter(m => m === 'turn/start')).toHaveLength(1);
    expect(await unsigned.c.request(created.id, input.requestId)).toMatchObject({ state: 'running' });
  });
  it('resumes the Codex thread before reading history after a process restart', async () => {
    const { storage, explain } = await signedIn();
    const first = clients.at(-1)!;
    await first.send(explain(1)); await flush();
    await first.close();
    const reopened = await signedIn(s => {
      s.handlers.set('thread/read', () => ({
        thread: {
          ...thread, id: 'thread-1', turns: [{
            id: 'turn-1', status: 'completed',
            items: [
              { type: 'userMessage', id: 'u1', clientId: requestId(1) },
              { type: 'agentMessage', id: 'item-1', text: '对账得到的回答', phase: 'final_answer' },
            ],
          }],
        },
      }));
    }, storage);
    await flush(); await tick(20);
    const called = methods(reopened.p);
    const resumeAt = called.indexOf('thread/resume');
    const readAt = called.indexOf('thread/read');
    expect(resumeAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(resumeAt);
    expect(called.filter(m => m === 'turn/start')).toHaveLength(0);
    expect(await reopened.c.request(explain(1).conversationId, requestId(1))).toMatchObject({ state: 'completed' });
  });
  it('reconciles an uncertain running request from thread/read completed history and allows a follow-up', async () => {
    const { storage, explain } = await signedIn();
    const first = clients.at(-1)!;
    await first.send(explain(1)); await flush();
    await first.close();
    const reopened = await signedIn(s => {
      s.handlers.set('thread/read', () => ({
        thread: {
          ...thread, id: 'thread-1', turns: [{
            id: 'turn-1', status: 'completed',
            items: [
              { type: 'userMessage', id: 'u1', clientId: requestId(1) },
              { type: 'agentMessage', id: 'item-1', text: '对账得到的回答', phase: 'final_answer' },
            ],
          }],
        },
      }));
    }, storage);
    await flush(); await tick(20);
    expect(methods(reopened.p).slice(0, 3)).toEqual(['initialize', 'initialized', 'config/read']);
    expect(methods(reopened.p)).toContain('thread/read');
    expect(methods(reopened.p).filter(m => m === 'turn/start')).toHaveLength(0);
    const conversation = await reopened.c.get(explain(1).conversationId);
    expect(await reopened.c.request(conversation.id, requestId(1))).toMatchObject({ state: 'completed' });
    expect(conversation.activeRequestId).toBeNull();
    expect(conversation.messages.some(m => m.role === 'assistant' && m.text === '对账得到的回答' && m.status === 'completed')).toBe(true);
    await reopened.c.send({ ...explain(2), action: 'ask', question: '继续', citations: [] }); await flush();
    expect(methods(reopened.p).filter(m => m === 'turn/start')).toHaveLength(1);
    expect(methods(reopened.p)).toContain('thread/resume');
  });
  it('restores an in-progress upstream turn without starting a new one', async () => {
    const { storage, explain } = await signedIn();
    const first = clients.at(-1)!;
    await first.send(explain(1)); await flush();
    await first.close();
    const reopened = await signedIn(s => {
      s.handlers.set('thread/read', () => ({
        thread: {
          ...thread, id: 'thread-1', turns: [{
            id: 'turn-1', status: 'inProgress',
            items: [{ type: 'userMessage', id: 'u1', clientId: requestId(1) }],
          }],
        },
      }));
    }, storage);
    await flush(); await tick(20);
    expect(methods(reopened.p).slice(0, 3)).toEqual(['initialize', 'initialized', 'config/read']);
    expect(methods(reopened.p)).toContain('thread/read');
    expect(methods(reopened.p)).toContain('thread/resume');
    expect(await reopened.c.request(explain(1).conversationId, requestId(1))).toMatchObject({ state: 'running' });
    expect(methods(reopened.p)).not.toContain('turn/start');
    reopened.p.emit({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', delta: '仍在' } });
    await tick(15);
    const live = await reopened.c.get(explain(1).conversationId);
    expect(live.messages.some(m => m.role === 'assistant' && m.text.includes('仍在'))).toBe(true);
    expect(live.activeRequestId).toBe(requestId(1));
  });
  it('keeps an unreconciled uncertain request isolated; waiting does not invent a terminal state', async () => {
    const { c, p, storage, events, explain } = await signedIn();
    await c.send(explain(1)); await flush(); p.end(); await flush();
    expect(events.at(-1)?.type).toBe('uncertain');
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    vi.useRealTimers();
    const reopened = await signedIn(s => {
      s.handlers.set('thread/read', () => { throw new Error('upstream history missing'); });
    }, storage);
    await flush(); await tick(20);
    const conversation = await reopened.c.current(paperA, 'Synthetic Paper A');
    expect(await reopened.c.request(conversation.id, requestId(1))).toMatchObject({ state: 'uncertain' });
    await expect(reopened.c.send({ ...explain(2), conversationId: conversation.id })).rejects.toMatchObject({ code: 'BUSY' });
    expect(methods(reopened.p)).not.toContain('turn/start');
    const fresh = await reopened.c.newConversation(paperA, 'Synthetic Paper A');
    expect(fresh.id).not.toBe(conversation.id);
    expect(await reopened.c.request(conversation.id, requestId(1))).toMatchObject({ state: 'uncertain' });
  });
  it('keeps an in-progress request isolated when thread/resume fails after process restart', async () => {
    const { storage, explain } = await signedIn();
    const first = clients.at(-1)!;
    await first.send(explain(1)); await flush();
    await first.close();
    const reopened = await signedIn(s => {
      s.handlers.set('thread/read', () => ({
        thread: {
          ...thread, id: 'thread-1', turns: [{
            id: 'turn-1', status: 'inProgress',
            items: [{ type: 'userMessage', id: 'u1', clientId: requestId(1) }],
          }],
        },
      }));
      s.handlers.set('thread/resume', () => { throw new Error('thread missing after restart'); });
    }, storage);
    await flush(); await tick(20);
    expect(await reopened.c.request(explain(1).conversationId, requestId(1))).toMatchObject({ state: 'uncertain' });
    expect(methods(reopened.p)).not.toContain('turn/start');
    await expect(reopened.c.send({ ...explain(2), action: 'ask', question: '继续', citations: [] })).rejects.toMatchObject({ code: 'BUSY' });
  });
  it('reconciles an interrupted upstream turn as cancelled and allows a follow-up', async () => {
    const { storage, explain } = await signedIn();
    const first = clients.at(-1)!;
    await first.send(explain(1)); await flush();
    await first.close();
    const reopened = await signedIn(s => {
      s.handlers.set('thread/read', () => ({
        thread: {
          ...thread, id: 'thread-1', turns: [{
            id: 'turn-1', status: 'interrupted',
            items: [{ type: 'userMessage', id: 'u1', clientId: requestId(1) }],
          }],
        },
      }));
    }, storage);
    await flush(); await tick(20);
    expect(await reopened.c.request(explain(1).conversationId, requestId(1))).toMatchObject({ state: 'cancelled' });
    await reopened.c.send({ ...explain(2), action: 'ask', question: '继续', citations: [] }); await flush();
    expect(methods(reopened.p).filter(m => m === 'turn/start')).toHaveLength(1);
  });
  it('reconciles a failed upstream turn without inventing an answer', async () => {
    const { storage, explain } = await signedIn();
    const first = clients.at(-1)!;
    await first.send(explain(1)); await flush();
    await first.close();
    const reopened = await signedIn(s => {
      s.handlers.set('thread/read', () => ({
        thread: {
          ...thread, id: 'thread-1', turns: [{
            id: 'turn-1', status: 'failed', error: { codexErrorInfo: 'usageLimitExceeded' },
            items: [{ type: 'userMessage', id: 'u1', clientId: requestId(1) }],
          }],
        },
      }));
    }, storage);
    await flush(); await tick(20);
    expect(await reopened.c.request(explain(1).conversationId, requestId(1))).toMatchObject({ state: 'failed' });
    const live = await reopened.c.get(explain(1).conversationId);
    expect(live.activeRequestId).toBeNull();
    expect(live.messages.some(m => m.role === 'assistant' && m.text.includes('对账'))).toBe(false);
    expect(reopened.events.some(e => e.type === 'failed' && e.code === 'RATE_LIMITED')).toBe(true);
  });
  it('does not let a late cancel notice overwrite a completed turn', async () => {
    const { c, p, events, explain } = await signedIn();
    await c.send(explain(1)); await flush();
    p.emit({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'agentMessage', id: 'item-1', text: '完成', phase: 'final_answer' } } });
    p.emit({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { ...turn, status: 'completed', items: [{ type: 'agentMessage', id: 'item-1', text: '完成', phase: 'final_answer' }] } } });
    await flush();
    p.emit({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { ...turn, status: 'interrupted', items: [] } } });
    await flush();
    expect(events.filter(e => e.type === 'completed')).toHaveLength(1);
    expect(events.filter(e => e.type === 'cancelled')).toHaveLength(0);
    expect(await c.request(explain(1).conversationId, requestId(1))).toMatchObject({ state: 'completed' });
  });
  it('interrupts a turn that was still starting when the user cancelled', async () => {
    const { c, p, events, explain, handlers } = await signedIn();
    let resume!: (value: unknown) => void;
    handlers.set('turn/start', () => new Promise(resolve => { resume = resolve; }));
    const sending = c.send(explain(1)); await sending; await flush();
    await c.cancel(explain(1).conversationId, requestId(1));
    expect(methods(p)).not.toContain('turn/interrupt');
    resume({ turn: { ...turn, id: 'turn-1', threadId: 'thread-1' } });
    await flush(); await tick(20);
    expect(methods(p)).toContain('turn/interrupt');
    p.emit({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { ...turn, status: 'interrupted', items: [] } } });
    await flush();
    expect(events.at(-1)?.type).toBe('cancelled');
    expect(await c.request(explain(1).conversationId, requestId(1))).toMatchObject({ state: 'cancelled' });
  });
  it('a truncated protocol frame during a turn is uncertain and never resent', async () => {
    const { c, p, storage, events, explain } = await signedIn();
    await c.send(explain(1)); await flush();
    p.push('{"method":"item/agentMessage/delta","params":{"token":"secret-value"');
    p.end();
    await flush();
    expect(events.at(-1)?.type).toBe('uncertain');
    expect(JSON.stringify(events)).not.toContain('secret-value');
    const reopened = await signedIn(undefined, storage);
    expect(await reopened.c.request(explain(1).conversationId, requestId(1))).toMatchObject({ state: 'uncertain' });
    expect(methods(reopened.p)).not.toContain('turn/start');
  });
  it('remounting reads a consistent snapshot and only later seqs without starting another turn', async () => {
    const { c, p, explain } = await signedIn();
    await c.send(explain(1)); await flush();
    stream(p, 'thread-1', 'turn-1', 'item-1', '先验'); await tick(10);
    const buffered: ReaderEvent[] = [];
    const unsub = c.subscribe(event => { buffered.push(event); });
    const snapshot = await c.get(explain(1).conversationId);
    expect(snapshot.lastSeq).toBeGreaterThan(0);
    expect(snapshot.messages.some(m => m.text.includes('先验'))).toBe(true);
    const late = buffered.filter(event => event.seq > snapshot.lastSeq);
    stream(p, 'thread-1', 'turn-1', 'item-1', '是信念'); await tick(10);
    expect(buffered.filter(event => event.seq > snapshot.lastSeq).length).toBeGreaterThan(late.length);
    expect(methods(p).filter(m => m === 'turn/start')).toHaveLength(1);
    unsub();
  });
});
