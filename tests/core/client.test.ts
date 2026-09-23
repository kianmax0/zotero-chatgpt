import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReaderClient, type ReaderOptions } from '../../packages/core/src/index.ts';
import type { ReaderClient } from '../../packages/contracts/src/runtime.ts';
import type { ReaderEvent, SendInput } from '../../packages/contracts/src/index.ts';
import { MemoryStorage, flush } from './doubles.ts';
import { server, model, methods, threadResponse, turn, configResponse } from './fixtures.ts';
import { citationA, citationB, imageA, paperA, paperB, settings } from '../contracts/factories.ts';
import { documentA } from '../contracts/document-fixture.ts';
import { builtinSkills, DEFAULT_PREFERENCES } from '../../packages/core/src/workspace/skills.ts';
const clients: ReaderClient[] = [];
let ids = 0;
afterEach(async () => { for (const c of clients.splice(0)) await c.close().catch(() => undefined); vi.useRealTimers(); });
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;
const requestId = (n: number) => `11111111-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function setup(configure?: (s: ReturnType<typeof server>) => void, storage = new MemoryStorage(), options: Pick<ReaderOptions, 'generatedImage'> = {}) {
  const s = server(); configure?.(s);
  const c = await createReaderClient(s.p, storage, { codexVersion: '0.156.1', cwd: '/isolated', uuid, loginTimeoutMs: 1000, deltaFlushMs: 1, now: () => '2026-09-09T08:00:00.000Z', ...options }); clients.push(c);
  const events: ReaderEvent[] = []; c.subscribe(e => events.push(e));
  return { ...s, storage, c, events };
}
async function signedIn(configure?: (s: ReturnType<typeof server>) => void, storage?: MemoryStorage) {
  const rig = await setup(configure, storage); await rig.c.refreshAccount();
  const conversation = await rig.c.current(paperA, 'Synthetic Paper A');
  // `absent` freezes no mode, so it is a Chat request (D3). `explain` is the Codex-protocol helper the
  // protocol tests below use: it declares Agent explicitly, because after the runtime split a request
  // without `mode: 'agent'` never reaches the Codex runtime.
  const absent = (n: number, overrides: Partial<SendInput> = {}): SendInput => ({ requestId: requestId(n), conversationId: conversation.id, action: 'explain', question: '', citations: [citationA], settings, ...overrides });
  const explain = (n: number, overrides: Partial<SendInput> = {}): SendInput => ({ ...absent(n, overrides), mode: overrides.mode ?? 'agent' });
  return { ...rig, conversation, explain, absent };
}
const tick = (ms = 5) => new Promise<void>(resolve => setTimeout(resolve, ms));
const stream = (p: ReturnType<typeof server>['p'], threadId: string, turnId: string, itemId: string, delta: string) => p.emit({ method: 'item/agentMessage/delta', params: { threadId, turnId, itemId, delta } });
const complete = (p: ReturnType<typeof server>['p'], threadId: string, turnId: string, itemId: string, text: string) => {
  p.emit({ method: 'item/completed', params: { threadId, turnId, item: { type: 'agentMessage', id: itemId, text, phase: 'final_answer', memoryCitation: null } } });
  p.emit({ method: 'turn/completed', params: { threadId, turn: { ...turn, id: turnId, status: 'completed', items: [{ type: 'agentMessage', id: itemId, text, phase: 'final_answer' }] } } });
};

it('opening the same attachment concurrently creates one conversation and no model turn', async () => {
  const { c, p } = await setup(); await c.refreshAccount();
  const opened = await Promise.all(Array.from({ length: 4 }, () => c.current(paperA, 'Same title')));
  expect(new Set(opened.map(c => c.id)).size).toBe(1);
  expect(await c.list(paperA)).toHaveLength(1);
  expect(methods(p)).not.toContain('turn/start');
});

it('opens an attachment conversation before login using the public model catalog but refuses generation', async () => {
  const { c, p } = await setup(s => s.handlers.set('account/read', () => ({ account: null, requiresOpenaiAuth: true })));
  await c.refreshAccount();
  const local = await c.current(paperA, 'Full article title');
  expect(local.title).toBe('Full article title');
  // Generation is an Agent action: the sign-in requirement is Codex-side and is asserted as Agent.
  // Chat has no transport in this build, so a mode-less send would refuse for that reason instead.
  await expect(c.send({ requestId: requestId(650), conversationId: local.id, action: 'ask', question: 'x?', citations: [], settings, mode: 'agent' })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  expect(methods(p)).not.toContain('turn/start');
});

it('deleting an active chat refuses without cancelling the turn or losing its journal', async () => {
  const { c, p, conversation, explain } = await signedIn();
  await c.send(explain(401)); await tick();
  await expect(c.deleteConversation(paperA, conversation.id)).rejects.toMatchObject({ code: 'BUSY' });
  expect((await c.get(conversation.id)).activeRequestId).toBe(requestId(401));
  expect(methods(p)).not.toContain('turn/interrupt');
});

it('sends the full current PDF once, reuses it on follow-up, and reloads after compaction', async () => {
  const { c, p, conversation, explain } = await signedIn();
  const source = structuredClone(documentA);
  await c.send({ ...explain(501), document: source }); await tick();
  const payload = () => p.writes.map(line => JSON.parse(line) as { method: string; params: { input: Array<{ text: string }> } }).filter(line => line.method === 'turn/start').at(-1)!.params.input[0]!.text;
  expect(payload()).toContain('hidden state'); expect(payload()).toContain('y = x + 7');
  source.pages[0]!.text = 'MUTATED AFTER SEND';
  expect(payload()).not.toContain('MUTATED');
  complete(p, 'thread-1', 'turn-1', 'item-1', 'Synthetic protocol test response'); await tick();
  await c.send({ ...explain(502), document: documentA }); await tick();
  expect(payload()).not.toContain('hidden state'); expect(payload()).toContain('reuse');
  complete(p, 'thread-1', 'turn-2', 'item-2', 'Synthetic protocol test response'); await tick();
  p.emit({ method: 'thread/compacted', params: { threadId: 'thread-1', turnId: 'turn-1' } }); await tick();
  await c.send({ ...explain(503), document: documentA }); await tick();
  expect(payload()).toContain('hidden state');
  expect((await c.get(conversation.id)).messages[0]).toMatchObject({ document: { id: documentA.id, totalPages: 2 } });
});

it('rejects PDF context from a different attachment without dispatching', async () => {
  const { c, p, explain } = await signedIn();
  await expect(c.send({ ...explain(504), document: { ...documentA, paper: paperB } })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(methods(p)).not.toContain('turn/start');
});
it('renames without losing the original title and branches before an old question without replaying it', async () => {
  const { c, p, conversation, explain } = await signedIn();
  await c.send(explain(701)); await tick(); complete(p, 'thread-1', 'turn-1', 'reply', 'Previous answer'); await tick();
  const renamed = await c.renameConversation!(conversation.id, 'My discussion');
  expect(renamed).toMatchObject({ title: 'My discussion', paperIdentity: { title: 'Synthetic Paper A' }, titleCustomized: true });
  const user = renamed.messages.find(m => m.role === 'user')!;
  const branch = await c.branchConversation!(conversation.id, user.id);
  expect(branch.id).not.toBe(conversation.id); expect(branch.messages).toEqual([]); expect(branch.parentConversationId).toBe(conversation.id);
  expect(methods(p).filter(method => method === 'turn/start')).toHaveLength(1);
});
it('sends referenced sources and frozen workflow instructions, then preserves them on disk', async () => {
  const { c, p, storage, conversation, explain } = await signedIn();
  const workflow = { skill: builtinSkills().find(s => s.id === 'builtin-derive')!, preferences: { ...DEFAULT_PREFERENCES, language: 'zh' }, profileId: null };
  const ref = { id: 'paper-b', kind: 'article' as const, label: 'Second article', paper: paperB, capturedAt: '2026-09-12T10:00:00.000Z', document: { ...documentA, paper: paperB, pages: [{ ...documentA.pages[0]!, text: 'Reference-only finding 91.' }] } };
  await c.send(explain(702, { workflow, references: [ref] })); await tick();
  const line = p.writes.map(line => JSON.parse(line) as { method: string; params: { input: Array<{ text: string }> } }).find(line => line.method === 'turn/start');
  expect(line?.params.input[0]?.text).toContain('Reference-only finding 91'); expect(line?.params.input[0]?.text).toContain('builtin-derive');
  const saved = JSON.parse(new TextDecoder().decode(storage.files.get(`conversations/${conversation.id}.json`))) as { schemaVersion: number; messages: Array<{ workflow: unknown; referenceDocuments: unknown[] }> };
  expect(saved.schemaVersion).toBe(3); expect(saved.messages[0]?.workflow).toMatchObject({ preferences: { language: 'zh' } }); expect(saved.messages[0]?.referenceDocuments).toHaveLength(1);
});
it('persists real usage separately from cumulative history and emits it to views', async () => {
  const { c, p, events, conversation, explain } = await signedIn(); await c.send(explain(703)); await tick();
  const usage = { inputTokens: 100, cachedInputTokens: 20, outputTokens: 10, reasoningOutputTokens: 2, totalTokens: 110 };
  p.emit({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread-1', turnId: 'turn-1', tokenUsage: { last: usage, total: { ...usage, totalTokens: 900 }, modelContextWindow: 12345 } } }); await tick();
  expect((await c.get(conversation.id)).usage).toMatchObject({ contextWindow: 12345, last: { totalTokens: 110 }, total: { totalTokens: 900 } });
  expect(events.some(event => event.type === 'usage')).toBe(true);
});
it('starts every multi-pass step in a fresh thread without replaying previous raw inputs', async () => {
  const { c, p, explain } = await signedIn();
  await c.send(explain(710, { mode: 'agent', document: documentA, batch: { id: requestId(711), index: 0, total: 3, phase: 'map', question: 'Read all pages' } })); await tick();
  complete(p, 'thread-1', 'turn-1', 'part-1', 'First part findings'); await tick();
  await c.send(explain(712, { mode: 'agent', batch: { id: requestId(711), index: 2, total: 3, phase: 'reduce', question: 'Read all pages', summaries: [{ index: 0, pages: [0, 1], text: 'First part findings' }] } })); await tick();
  expect(methods(p).filter(method => method === 'thread/start')).toHaveLength(2);
  const last = p.writes.map(line => JSON.parse(line) as { method: string; params: { input: Array<{ text: string }> } }).filter(line => line.method === 'turn/start').at(-1)!;
  expect(last.params.input[0]?.text).toContain('First part findings'); expect(last.params.input[0]?.text).not.toContain('hidden state');
});
it('refuses Agent work sent as Chat at the runtime, not just in the composer', async () => {
  const { c, p, explain, absent } = await signedIn();
  const batch = { id: requestId(791), index: 0, total: 2, phase: 'map' as const, question: 'Read all pages' };
  // An absent mode is Chat (D3), and a multi-pass batch is Agent work: the session service refuses
  // both, so a caller that skipped the presenter cannot start a reading job as Chat.
  await expect(c.send(absent(790, { batch }))).rejects.toMatchObject({ code: 'UNSUPPORTED_INTERACTION' });
  await expect(c.send(explain(792, { mode: 'chat', batch }))).rejects.toMatchObject({ code: 'UNSUPPORTED_INTERACTION' });
  const diagram = { skill: builtinSkills().find(skill => skill.id === 'builtin-diagram')!, preferences: DEFAULT_PREFERENCES, profileId: null };
  await expect(c.send(explain(793, { mode: 'chat', workflow: diagram }))).rejects.toMatchObject({ code: 'UNSUPPORTED_INTERACTION' });
  // A refused request is never committed, so no thread or turn was ever started for it.
  expect(methods(p)).not.toContain('turn/start');
  expect(await c.get(explain(790).conversationId)).toMatchObject({ activeRequestId: null });
});
it('requires an enabled image generation capability and actual image output for the diagram workflow', async () => {
  const { c, p, explain } = await signedIn();
  const workflow = { skill: builtinSkills().find(skill => skill.id === 'builtin-diagram')!, preferences: DEFAULT_PREFERENCES, profileId: null };
  await c.send(explain(720, { mode: 'agent', workflow })); await tick();
  expect(methods(p)).toContain('experimentalFeature/list');
  complete(p, 'thread-1', 'turn-1', 'text-only', 'I would draw a diagram'); await tick();
  expect((await c.request(explain(720).conversationId, requestId(720))).state).toBe('failed');
});
it('durably queues a frozen question, runs it after completion and can cancel a waiting question', async () => {
  const { c, p, explain, conversation, storage } = await signedIn();
  await c.send(explain(730)); await tick();
  const queued = explain(731, { question: 'Frozen queued question' });
  await c.enqueue!(queued); queued.question = 'Changed draft';
  await c.enqueue!(explain(732, { question: 'Cancel this question' }));
  expect((await c.get(conversation.id)).queuedRequestIds).toEqual([requestId(731), requestId(732)]);
  expect(new TextDecoder().decode(storage.files.get(`conversations/${conversation.id}.json`))).toContain('Frozen queued question');
  await c.cancel(conversation.id, requestId(732));
  expect(methods(p).filter(method => method === 'turn/start')).toHaveLength(1);
  complete(p, 'thread-1', 'turn-1', 'current', 'Finished current question'); await tick(20);
  expect(methods(p).filter(method => method === 'turn/start')).toHaveLength(2);
  expect((await c.get(conversation.id)).activeRequestId).toBe(requestId(731));
  expect((await c.request(conversation.id, requestId(732))).state).toBe('cancelled');
});
it('stores one verified image per native item and disables generation on the next ordinary question', async () => {
  const generated = { ...imageA, origin: { kind: 'generated' as const, model: settings.model } };
  const decode = vi.fn(() => Promise.resolve(generated));
  const { c, p, events } = await setup(undefined, undefined, { generatedImage: decode }); await c.refreshAccount();
  const conversation = await c.current(paperA, 'Diagram example');
  const input: SendInput = { requestId: requestId(750), conversationId: conversation.id, action: 'ask', question: 'Draw the paper mechanism', citations: [], settings, mode: 'agent', workflow: { skill: builtinSkills().find(skill => skill.id === 'builtin-diagram')!, preferences: DEFAULT_PREFERENCES, profileId: null } };
  await c.send(input); await tick();
  const output = { type: 'imageGeneration', id: 'rendered-image', status: 'completed', result: imageA.dataUrl };
  p.emit({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item: output } });
  p.emit({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { ...turn, status: 'completed', items: [output] } } }); await tick();
  expect((await c.request(conversation.id, input.requestId)).state).toBe('completed');
  expect((await c.get(conversation.id)).messages.flatMap(message => message.generatedImages ?? [])).toEqual([generated]);
  expect(decode).toHaveBeenCalledTimes(1); expect(events.filter(event => event.type === 'image')).toHaveLength(1);
  // The follow-up is an ordinary Agent question: the non-read skill is dropped but it is still Agent work.
  const { workflow: _workflow, ...ordinary } = input; void _workflow;
  await c.send({ ...ordinary, requestId: requestId(751), question: 'Explain the diagram' }); await tick();
  const resume = p.writes.map(line => JSON.parse(line) as { method: string; params: { config: Record<string, unknown> } }).find(line => line.method === 'thread/resume');
  expect(resume?.params.config['features.image_generation']).toBe(false);
});
it('reconciles a completed image task from native history after restart without resending', async () => {
  const storage = new MemoryStorage();
  const first = await signedIn(undefined, storage);
  const input = first.explain(760, { mode: 'agent', workflow: { skill: builtinSkills().find(skill => skill.id === 'builtin-diagram')!, preferences: DEFAULT_PREFERENCES, profileId: null } });
  await first.c.send(input); await tick(); await first.c.close();
  const generated = { ...imageA, origin: { kind: 'generated' as const, model: settings.model } };
  const next = await setup(server => server.handlers.set('thread/read', () => ({ thread: { ...threadResponse.thread, turns: [{ ...turn, status: 'completed', items: [{ type: 'userMessage', clientId: input.requestId }, { type: 'imageGeneration', id: 'recovered-output', status: 'completed', result: imageA.dataUrl }] }] } })), storage, { generatedImage: () => Promise.resolve(generated) });
  await next.c.refreshAccount(); const restored = await next.c.current(paperA, 'Synthetic Paper A'); await next.c.ensureAgentReady!();
  expect((await next.c.request(restored.id, input.requestId)).state).toBe('completed');
  expect((await next.c.get(restored.id)).messages.flatMap(message => message.generatedImages ?? [])).toEqual([generated]);
  expect(methods(next.p)).not.toContain('turn/start');
});
it('keeps queued questions behind the complete reading batch, including the gaps between passes', async () => {
  const { c, p, explain, conversation } = await signedIn(); const batch = requestId(771);
  await c.send(explain(770, { mode: 'agent', batch: { id: batch, index: 0, total: 3, phase: 'map', question: 'Read all' } })); await tick();
  await c.enqueue!(explain(772, { question: 'Question after the complete reading task' }));
  complete(p, 'thread-1', 'turn-1', 'part-0', 'First findings'); await tick(15);
  expect(methods(p).filter(method => method === 'turn/start')).toHaveLength(1);
  expect((await c.get(conversation.id)).activeBatchId).toBe(batch);
  await c.send(explain(773, { mode: 'agent', batch: { id: batch, index: 1, total: 3, phase: 'map', question: 'Read all' } })); await tick();
  complete(p, 'thread-2', 'turn-2', 'part-1', 'Second findings'); await tick();
  await c.send(explain(774, { mode: 'agent', batch: { id: batch, index: 2, total: 3, phase: 'reduce', question: 'Read all' } })); await tick();
  complete(p, 'thread-3', 'turn-3', 'synthesis', 'Complete synthesis'); await tick(15);
  expect(methods(p).filter(method => method === 'turn/start')).toHaveLength(4);
  expect((await c.get(conversation.id)).activeBatchId).toBeUndefined();
  expect((await c.get(conversation.id)).activeRequestId).toBe(requestId(772));
});
it('never interrupts another conversation when cancel receives a mismatched conversation id', async () => {
  const { c, p, explain } = await signedIn(); await c.send(explain(780)); await tick();
  const other = await c.newConversation(paperB, 'Other PDF');
  await expect(c.cancel(other.id, requestId(780))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(methods(p)).not.toContain('turn/interrupt');
});
it('reconstructs an accepted document workflow without inventing an omitted paper identity', async () => {
  const { c, p, explain, conversation } = await signedIn(); await c.send(explain(781)); await tick();
  await c.enqueue!(explain(782, { document: documentA, workflow: { skill: null, preferences: DEFAULT_PREFERENCES, profileId: null } }));
  complete(p, 'thread-1', 'turn-1', 'first', 'Finished'); await tick(15);
  expect((await c.request(conversation.id, requestId(782))).state).toBe('running');
  expect(methods(p).filter(method => method === 'turn/start')).toHaveLength(2);
});
it('updates the same assistant item after in-progress recovery instead of retaining a duplicate partial answer', async () => {
  const storage = new MemoryStorage(); const first = await signedIn(undefined, storage);
  const input = first.explain(783); await first.c.send(input); await tick();
  stream(first.p, 'thread-1', 'turn-1', 'same-item', 'Partial'); await tick(); await first.c.close();
  const next = await setup(server => server.handlers.set('thread/read', () => ({ thread: { ...threadResponse.thread, turns: [{ ...turn, items: [{ type: 'userMessage', clientId: input.requestId }, { type: 'agentMessage', id: 'same-item', text: 'Partial', phase: 'final_answer' }] }] } })), storage);
  await next.c.refreshAccount(); await next.c.current(paperA, 'Synthetic Paper A'); await next.c.ensureAgentReady!();
  complete(next.p, 'thread-1', 'turn-1', 'same-item', 'Partial followed by complete answer'); await tick();
  const assistants = (await next.c.get(input.conversationId)).messages.filter(message => message.role === 'assistant');
  expect(assistants).toHaveLength(1); expect(assistants[0]?.text).toBe('Partial followed by complete answer');
});
it('rejects forbidden native tool activity during history recovery just as it does live', async () => {
  const storage = new MemoryStorage(); const first = await signedIn(undefined, storage);
  const input = first.explain(784); await first.c.send(input); await tick(); await first.c.close();
  const next = await setup(server => server.handlers.set('thread/read', () => ({ thread: { ...threadResponse.thread, turns: [{ ...turn, status: 'completed', items: [{ type: 'userMessage', clientId: input.requestId }, { type: 'commandExecution', id: 'forbidden' }, { type: 'agentMessage', id: 'answer', text: 'Untrusted result', phase: 'final_answer' }] }] } })), storage);
  await next.c.refreshAccount(); const restored = await next.c.current(paperA, 'Synthetic Paper A'); await next.c.ensureAgentReady!();
  expect((await next.c.request(restored.id, input.requestId)).state).not.toBe('completed');
  expect(next.c.snapshot().runtime).toBe('error'); expect(methods(next.p)).not.toContain('turn/start');
});
it('retains an already persisted image when its temporary native output path has expired during recovery', async () => {
  const storage = new MemoryStorage(); const generated = { ...imageA, origin: { kind: 'generated' as const, model: settings.model } };
  const first = await setup(undefined, storage, { generatedImage: () => Promise.resolve(generated) }); await first.c.refreshAccount(); const conversation = await first.c.current(paperA, 'Diagram');
  const input: SendInput = { requestId: requestId(785), conversationId: conversation.id, question: 'Draw', action: 'ask', citations: [], settings, mode: 'agent', workflow: { skill: builtinSkills().find(skill => skill.id === 'builtin-diagram')!, preferences: DEFAULT_PREFERENCES, profileId: null } };
  const item = { type: 'imageGeneration', id: 'saved-image', status: 'completed', result: '', savedPath: '/expired.png' };
  await first.c.send(input); await tick(); first.p.emit({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item } }); await tick(); await first.c.close();
  const next = await setup(server => server.handlers.set('thread/read', () => ({ thread: { ...threadResponse.thread, turns: [{ ...turn, status: 'completed', items: [{ type: 'userMessage', clientId: input.requestId }, item] }] } })), storage, { generatedImage: () => Promise.reject(new Error('Expired')) });
  await next.c.refreshAccount(); const restored = await next.c.current(paperA, 'Diagram'); await next.c.ensureAgentReady!();
  expect((await next.c.request(restored.id, input.requestId)).state).toBe('completed');
  expect(restored.messages.flatMap(message => message.generatedImages ?? [])).toEqual([generated]);
});

describe('runtime handshake and policy', () => {
  it('handshakes, validates policy before ready, loads paginated model defaults and exposes immutable snapshots', async () => {
    const { c, p } = await setup(s => s.handlers.set('model/list', params => params.cursor ? { data: [{ ...model, model: 'second', isDefault: false }], nextCursor: null } : { data: [model], nextCursor: 'page2' }));
    // Laziness is part of the contract: constructing the client is not a handshake.
    expect(methods(p)).toEqual([]);
    await c.refreshAccount();
    expect(methods(p).slice(0, 3)).toEqual(['initialize', 'initialized', 'config/read']);
    expect(c.snapshot().models.map(m => m.id)).toEqual(['catalog-default', 'second']);
    const snapshot = c.snapshot(); snapshot.models.length = 0; expect(c.snapshot().models).toHaveLength(2);
    let notified = false; c.observe(() => { notified = true; })(); expect(notified).toBe(true);
  });
  it.each(['external-mcp', 'wrong-feature', 'managed-layer', 'foreign-user-layer', 'unknown-origin', 'missing-layers', 'chatgpt-base-url', 'home-mismatch'])('fails closed on effective policy violation: %s', async violation => {
    const s = server(); const fixture = configResponse();
    if (violation === 'external-mcp') fixture.config.mcp_servers = { remote: { url: 'https://example.test' } };
    if (violation === 'wrong-feature') fixture.config.features.shell_tool = true;
    if (violation === 'managed-layer') fixture.layers.push({ name: { type: 'system', file: '/etc/codex/extra.toml' }, config: { approval_policy: 'never' }, version: 'sha256:managed' });
    if (violation === 'foreign-user-layer') fixture.layers[1]!.name.file = '/outside/config.toml';
    if (violation === 'unknown-origin') fixture.origins.approval_policy!.name.type = 'enterpriseManaged';
    s.handlers.set('config/read', () => violation === 'missing-layers' ? { ...fixture, layers: null } : violation === 'chatgpt-base-url' ? { ...fixture, config: { ...fixture.config, chatgpt_base_url: 'https://example.test/' } } : fixture);
    const options = { codexVersion: '0.156.1', cwd: '/isolated', uuid, ...(violation === 'home-mismatch' ? { codexHome: '/isolated/other-account' } : {}) };
    const client = await createReaderClient(s.p, new MemoryStorage(), options); clients.push(client);
    // The policy read happens on the first Agent request, not at construction.
    await expect(client.refreshAccount()).rejects.toThrow('policy');
    expect(s.p.terminated).toBe(true); expect(methods(s.p)).not.toContain('account/read');
  });
  it('does not accept the expected version only inside a client-supplied user-agent suffix', async () => {
    const s = server(); s.handlers.set('initialize', () => ({ userAgent: 'codex/9.0.0 (zchatgpt; 0.156.1)', codexHome: '/isolated', platformFamily: 'unix', platformOs: 'macos' }));
    const client = await createReaderClient(s.p, new MemoryStorage(), { codexVersion: '0.156.1', cwd: '/isolated', uuid }); clients.push(client);
    await expect(client.refreshAccount()).rejects.toThrow('version');
    expect(s.p.terminated).toBe(true);
  });
  it('rejects the previous pinned runtime version before connecting', async () => {
    const s = server();
    await expect(createReaderClient(s.p, new MemoryStorage(), { codexVersion: '0.154.0', cwd: '/isolated', uuid })).rejects.toThrow('Unsupported runtime version');
    expect(methods(s.p)).toEqual([]);
  });
  it('latches overflow once and stops the transport', async () => {
    const { c, p } = await setup(); await c.refreshAccount(); let terminations = 0; const terminate = p.terminate.bind(p); p.terminate = () => { terminations++; return terminate(); };
    p.push(Array.from({ length: 10000 }, () => JSON.stringify({ method: 'thread/status/changed', params: { threadId: 'thread-1' } }) + '\n').join(''));
    await flush(); expect(terminations).toBe(1); expect(c.snapshot().runtime).toBe('error');
  });
  it('close settles a blocked server-response write without the process releasing its stdin promise', async () => {
    const { c, p } = await setup(); await c.refreshAccount(); p.writeStdin = () => new Promise<void>(() => undefined);
    p.emit({ id: 900, method: 'item/tool/call', params: {} }); await flush();
    let closed = false; const closing = c.close().then(() => { closed = true; }); await flush(); expect(closed).toBe(true); await closing;
  });
});
describe('official login', () => {
  it('single-flights login, accepts early completion and never persists URLs', async () => {
    const { c, p, handlers, storage } = await setup();
    handlers.set('account/login/start', () => { p.emit({ method: 'account/login/completed', params: { loginId: 'login-1', success: true, error: null } }); return { type: 'chatgpt', loginId: 'login-1', authUrl: 'https://auth.openai.com/oauth/authorize?state=secret' }; });
    const [a, b] = await Promise.all([c.startLogin(), c.startLogin()]); expect(a).toEqual(b); await flush();
    expect(methods(p).filter(m => m === 'account/login/start')).toHaveLength(1); expect(c.snapshot().login?.state).toBe('succeeded'); expect(storage.writes.join('')).not.toContain('secret');
  });
  it('rejects a non-official login URL, bounds the timeout and cancels without logout', async () => {
    const { c, p, handlers } = await setup(); handlers.set('account/login/start', () => ({ type: 'chatgpt', loginId: 'bad', authUrl: 'https://auth.openai.com.evil.test/' }));
    await expect(c.startLogin()).rejects.toThrow('official');
    handlers.set('account/login/start', () => ({ type: 'chatgpt', loginId: 'good', authUrl: 'https://auth.openai.com/oauth/authorize' }));
    vi.useFakeTimers(); await c.startLogin(); await vi.advanceTimersByTimeAsync(1001); expect(c.snapshot().login?.state).toBe('failed'); vi.useRealTimers();
    await c.startLogin(); await c.cancelLogin(); expect(c.snapshot().login?.state).toBe('cancelled'); expect(methods(p)).not.toContain('account/logout');
  });
  it('fails a pending login after process loss and settles one on close', async () => {
    const { c, p } = await setup(); await c.startLogin(); p.end(); await flush();
    expect(c.snapshot().login?.state).toBe('failed'); expect(c.snapshot().account.state).toBe('signedOut');
    const other = await setup(); await other.c.startLogin(); await other.c.close();
    expect(other.c.snapshot()).toMatchObject({ runtime: 'stopped', account: { state: 'signedOut' }, login: { state: 'cancelled' } });
  });
  it('signed-out refresh stays usable for login and refuses to create conversations without a catalog', async () => {
    const { c, p } = await setup(s => { s.handlers.set('account/read', () => ({ account: null, requiresOpenaiAuth: true })); s.handlers.set('model/list', () => { throw new Error('must not query'); }); });
    await c.refreshAccount(); expect(c.snapshot().account.state).toBe('signedOut'); expect(methods(p)).toContain('model/list'); expect(methods(p)).not.toContain('turn/start');
    await expect(c.current(paperA, 'Paper A')).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
    expect(await c.current(paperA, 'Paper A', settings)).toMatchObject({ settings });
  });
});
describe('attachment conversations', () => {
  it('binds one current conversation per attachment with catalog defaults and keeps siblings apart', async () => {
    const { c } = await signedIn();
    const a = await c.current(paperA, 'Synthetic Paper A'); const again = await c.current(paperA, 'Synthetic Paper A'); const b = await c.current(paperB, 'Supplement B');
    expect(again.id).toBe(a.id); expect(b.id).not.toBe(a.id);
    expect(a.settings).toEqual({ model: 'catalog-default', serviceTier: 'priority', effort: 'medium' }); expect(a.paper).toEqual(paperA);
    expect((await c.list(paperA)).map(x => x.id)).toEqual([a.id]);
  });
  it('peeks the current chat without creating one, and deleting the last chat leaves none behind', async () => {
    const { c, storage } = await signedIn();
    expect(await c.peekCurrent(paperB)).toBeNull();
    expect((await c.list(paperB))).toEqual([]);
    expect([...storage.files.keys()].some(path => path.includes(paperB.attachmentKey))).toBe(false);
    const b = await c.newConversation(paperB, 'Supplement B');
    expect((await c.peekCurrent(paperB))?.id).toBe(b.id);
    // The attachment ends up with no chat: no replacement empty chat is created or written.
    expect(await c.deleteConversation(paperB, b.id)).toBeNull();
    expect(await c.peekCurrent(paperB)).toBeNull();
    expect((await c.list(paperB))).toEqual([]);
  });
  it('names a chat after its first question unless the owner named it, and never renames it again', async () => {
    const { c, p, conversation, explain } = await signedIn();
    expect(conversation.title).toBe('Synthetic Paper A');
    await c.send(explain(701, { action: 'ask', question: '  这里的先验\n指什么？  ', citations: [] })); await tick();
    expect((await c.get(conversation.id)).title).toBe('这里的先验');
    complete(p, 'thread-1', 'turn-1', 'reply', 'answer'); await tick();
    await c.send(explain(702, { action: 'ask', question: 'A second question', citations: [] })); await tick();
    expect((await c.get(conversation.id)).title).toBe('这里的先验');
    // A selection-only explain has no question text, so the created name stays.
    const second = await c.newConversation(paperA, 'Synthetic Paper A');
    await c.send(explain(703, { conversationId: second.id })); await tick();
    expect((await c.get(second.id)).title).toBe('Synthetic Paper A');
    // An owner-given name wins over the derived one.
    const third = await c.newConversation(paperA, 'Synthetic Paper A');
    await c.renameConversation!(third.id, 'My notes');
    await c.send(explain(704, { conversationId: third.id, action: 'ask', question: 'Something else', citations: [] })); await tick();
    expect((await c.get(third.id)).title).toBe('My notes');
    const long = 'word '.repeat(30).trim();
    const fourth = await c.newConversation(paperA, 'Synthetic Paper A');
    await c.send(explain(705, { conversationId: fourth.id, action: 'ask', question: long, citations: [] })); await tick();
    const title = (await c.get(fourth.id)).title;
    expect(title.endsWith('…')).toBe(true); expect(Array.from(title).length).toBeLessThanOrEqual(61);
  });
  it('selects a previous conversation as current for the same attachment', async () => {
    const { c } = await signedIn();
    const first = await c.current(paperA, 'Synthetic Paper A');
    const second = await c.newConversation(paperA, 'Synthetic Paper A');
    expect((await c.current(paperA, 'Synthetic Paper A')).id).toBe(second.id);
    expect((await c.select(paperA, first.id)).id).toBe(first.id);
    expect((await c.current(paperA, 'Synthetic Paper A')).id).toBe(first.id);
    expect((await c.list(paperA)).map(x => x.id)).toEqual([first.id, second.id]);
  });
  it('journals accepted then dispatching before thread creation or turn submission and records the user message', async () => {
    const { c, p, storage, events, explain } = await signedIn();
    const before = storage.writes.length;
    const receipt = await c.send(explain(1));
    expect(receipt).toEqual({ requestId: requestId(1), state: 'accepted', replay: false });
    expect(storage.writes[before]).toContain('"accepted"'); expect(events.map(e => e.type)).toEqual(['accepted']);
    await flush();
    const order = storage.writes.slice(before).flatMap(w => {
      try {
        const parsed = JSON.parse(w) as { requests?: { state: string }[] };
        const state = parsed.requests?.at(-1)?.state;
        return state ? [state] : [];
      } catch { return []; }
    });
    expect(order.slice(0, 2)).toEqual(['accepted', 'dispatching']);
    expect(methods(p).indexOf('thread/start')).toBeGreaterThan(-1); expect(methods(p).filter(m => m === 'turn/start')).toHaveLength(1);
    const conversation = await c.get(explain(1).conversationId);
    expect(conversation.messages[0]).toMatchObject({ role: 'user', requestId: requestId(1), citations: [citationA], status: 'completed' });
    expect(conversation.activeRequestId).toBe(requestId(1));
    expect(await c.request(conversation.id, requestId(1))).toEqual({ requestId: requestId(1), state: 'running', replay: false });
    const turnStart = p.writes.map(w => JSON.parse(w) as { method?: string; params?: { input?: Array<{ text: string }>; threadId?: string; effort?: string } }).find(m => m.method === 'turn/start')!;
    expect(turnStart.params?.threadId).toBe('thread-1'); expect(turnStart.params?.effort).toBe('medium');
    expect(turnStart.params?.input?.[0]?.text).toContain('"contextScope":"selection"'); expect(turnStart.params?.input?.[0]?.text).toContain(citationA.text);
    const threadStart = p.writes.map(w => JSON.parse(w) as { method?: string; params?: { ephemeral?: boolean } }).find(m => m.method === 'thread/start')!;
    expect(threadStart.params?.ephemeral).toBe(false);
  });
  it('streams coalesced deltas, corrects with the completed item and finishes with one completed event', async () => {
    const { c, p, events, explain } = await signedIn(); await c.send(explain(1)); await flush();
    stream(p, 'thread-1', 'turn-1', 'item-1', '先验'); stream(p, 'thread-1', 'turn-1', 'item-1', '是'); await tick(10);
    const deltas = events.filter(e => e.type === 'delta'); expect(deltas.length).toBeGreaterThanOrEqual(1);
    expect(deltas.map(e => (e as { text: string }).text).join('')).toBe('先验是');
    const snapshot = await c.get(explain(1).conversationId); expect(snapshot.lastSeq).toBe(events.at(-1)!.seq);
    expect(snapshot.messages[1]).toMatchObject({ role: 'assistant', text: '先验是', status: 'streaming' });
    complete(p, 'thread-1', 'turn-1', 'item-1', '先验是对参数的初始信念。'); await flush();
    const types = events.map(e => e.type); expect(types.at(-2)).toBe('messageCompleted'); expect(types.at(-1)).toBe('completed'); expect(types.filter(t => t === 'completed')).toHaveLength(1);
    const done = await c.get(explain(1).conversationId);
    expect(done.messages[1]).toMatchObject({ text: '先验是对参数的初始信念。', status: 'completed', phase: 'final' }); expect(done.activeRequestId).toBeNull();
    expect(events.every((e, i) => i === 0 || e.seq > events[i - 1]!.seq)).toBe(true); expect(done.lastSeq).toBe(events.at(-1)!.seq);
    expect(await c.request(done.id, requestId(1))).toMatchObject({ state: 'completed' });
  });
  it('replays an identical request, rejects reused IDs with different content and refuses parallel requests in one conversation', async () => {
    const { c, p, explain } = await signedIn(); await c.send(explain(1)); await flush();
    expect(await c.send(explain(1))).toEqual({ requestId: requestId(1), state: 'running', replay: true });
    await expect(c.send(explain(1, { question: 'changed', action: 'ask' }))).rejects.toMatchObject({ code: 'REQUEST_CONFLICT' });
    await expect(c.send(explain(2))).rejects.toMatchObject({ code: 'BUSY' });
    expect(methods(p).filter(m => m === 'turn/start')).toHaveLength(1);
  });
  it('follow-ups reuse the same thread and settings changes apply to the next turn only', async () => {
    const { c, p, explain } = await signedIn(); await c.send(explain(1)); await flush(); complete(p, 'thread-1', 'turn-1', 'item-1', '答'); await flush();
    await c.send(explain(2, { action: 'ask', question: '第二步为什么成立？', citations: [], settings: { ...settings, effort: 'medium', serviceTier: null } })); await flush();
    expect(methods(p).filter(m => m === 'thread/start')).toHaveLength(1); expect(methods(p).filter(m => m === 'turn/start')).toHaveLength(2);
    const second = p.writes.map(w => JSON.parse(w) as { method?: string; params?: { threadId?: string; serviceTier?: unknown } }).filter(m => m.method === 'turn/start')[1]!;
    expect(second.params?.threadId).toBe('thread-1'); expect(second.params?.serviceTier).toBeNull();
    const conversation = await c.get(explain(1).conversationId); expect(conversation.settings.serviceTier).toBeNull(); expect(conversation.messages[0]?.settings).toEqual(settings);
  });
  it('validates settings against the catalog and citations against the attachment', async () => {
    const { c, p, explain } = await signedIn();
    await expect(c.send(explain(1, { settings: { ...settings, model: 'other-model' } }))).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
    await expect(c.send(explain(2, { settings: { ...settings, effort: 'ultra' } }))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(c.send(explain(3, { citations: [citationB] }))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(c.send(explain(4, { citations: [] }))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(methods(p)).not.toContain('thread/start');
  });
  it('cancels before dispatch without any upstream call and interrupts a running turn until the terminal event confirms it', async () => {
    const { c, p, events, explain, handlers } = await signedIn();
    handlers.set('thread/start', () => undefined); // never answers: cancellation must not depend on the thread
    const first = c.send(explain(1)); await first; await c.cancel(explain(1).conversationId, requestId(1)); await flush();
    expect(events.at(-1)?.type).toBe('cancelled'); expect(methods(p)).not.toContain('turn/start');
    const other = await signedIn(); await other.c.send(other.explain(1)); await flush();
    stream(other.p, 'thread-1', 'turn-1', 'item-1', 'part'); await tick(10);
    expect(await other.c.cancel(other.explain(1).conversationId, requestId(1))).toMatchObject({ state: 'running' });
    expect(methods(other.p)).toContain('turn/interrupt');
    other.p.emit({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { ...turn, status: 'interrupted', items: [] } } }); await flush();
    expect(other.events.at(-1)).toMatchObject({ type: 'cancelled', messageId: expect.any(String) as string });
    const done = await other.c.get(other.explain(1).conversationId); expect(done.messages[1]).toMatchObject({ text: 'part', status: 'cancelled' }); expect(done.activeRequestId).toBeNull();
  });
  it('reports a typed upstream refusal without copying its free text', async () => {
    const { c, p, events, storage, explain } = await signedIn(); await c.send(explain(1)); await flush();
    p.emit({ method: 'error', params: { threadId: 'thread-1', turnId: 'turn-1', willRetry: true, error: { message: 'transient', codexErrorInfo: null } } });
    p.emit({ method: 'error', params: { threadId: 'thread-1', turnId: 'turn-1', willRetry: false, error: { message: "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage", codexErrorInfo: 'usageLimitExceeded', additionalDetails: null } } });
    p.emit({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { ...turn, status: 'failed', error: { message: 'private', codexErrorInfo: 'usageLimitExceeded' } } } }); await flush();
    expect(events.filter(e => e.type === 'failed')).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: 'failed', code: 'RATE_LIMITED', message: expect.stringContaining('usage limit') as string });
    expect(storage.writes.join('')).not.toMatch(/chatgpt\.com|private/);
    expect(await c.request(explain(1).conversationId, requestId(1))).toMatchObject({ state: 'failed' });
  });
  it('fails closed on a thread policy mismatch naming the field and never submits a turn', async () => {
    const { c, p, events, explain, handlers } = await signedIn(); handlers.set('thread/start', () => ({ ...threadResponse, approvalPolicy: 'on-request' }));
    await c.send(explain(1)); await flush();
    expect(events.at(-1)).toMatchObject({ type: 'failed', code: 'READER_POLICY_UNAVAILABLE', message: expect.stringContaining('approval policy') as string });
    expect(methods(p)).not.toContain('turn/start');
  });
  it('routes concurrent generations to their own conversations', async () => {
    const { c, p, events, explain } = await signedIn(); const b = await c.current(paperB, 'Supplement B');
    await c.send(explain(1)); await flush();
    await c.send({ requestId: requestId(2), conversationId: b.id, action: 'explain', question: '', citations: [citationB], settings, mode: 'agent' }); await flush();
    stream(p, 'thread-1', 'turn-1', 'a1', 'answer for A'); stream(p, 'thread-2', 'turn-2', 'b1', 'answer for B'); await tick(10);
    const a = await c.get(explain(1).conversationId); const bb = await c.get(b.id);
    expect(a.messages.map(m => m.text)).toEqual(['', 'answer for A']); expect(bb.messages.map(m => m.text)).toEqual(['', 'answer for B']);
    expect(events.filter(e => e.type === 'delta').map(e => e.conversationId)).toEqual([a.id, b.id]);
  });
  it('marks in-flight requests uncertain on connection loss, isolates that conversation after reopening and allows a new conversation', async () => {
    const { c, p, storage, events, explain } = await signedIn(); await c.send(explain(1)); await flush(); p.end(); await flush();
    expect(events.at(-1)?.type).toBe('uncertain'); expect(c.snapshot().runtime).toBe('error');
    const reopened = await signedIn(undefined, storage);
    const conversation = await reopened.c.current(paperA, 'Synthetic Paper A'); expect(conversation.id).toBe(explain(1).conversationId);
    expect(await reopened.c.request(conversation.id, requestId(1))).toMatchObject({ state: 'uncertain' });
    await expect(reopened.c.send({ ...explain(2), conversationId: conversation.id })).rejects.toMatchObject({ code: 'BUSY' });
    const fresh = await reopened.c.newConversation(paperA, 'Synthetic Paper A'); expect(fresh.id).not.toBe(conversation.id);
    expect((await reopened.c.current(paperA, 'Synthetic Paper A')).id).toBe(fresh.id);
    expect(methods(reopened.p)).not.toContain('turn/start');
  });
  it('a restart with an active request left on disk restores it as uncertain without resending', async () => {
    const { c, p, storage, explain } = await signedIn(); await c.send(explain(1)); await flush();
    expect(methods(p).filter(m => m === 'turn/start')).toHaveLength(1);
    const reopened = await signedIn(undefined, storage); // the first client is still "running" but never persisted a terminal state
    const conversation = await reopened.c.get(explain(1).conversationId);
    expect(conversation.activeRequestId).toBeNull(); expect(await reopened.c.request(conversation.id, requestId(1))).toMatchObject({ state: 'uncertain' });
    expect(methods(reopened.p)).not.toContain('turn/start');
  });
  it('resumes a persisted thread in a new process and fails clearly when resume is refused', async () => {
    const { c, p, storage, explain } = await signedIn(); await c.send(explain(1)); await flush(); complete(p, 'thread-1', 'turn-1', 'i1', '答'); await flush(); await c.close();
    const reopened = await signedIn(undefined, storage);
    await reopened.c.send({ ...explain(2), action: 'ask', question: '继续', citations: [] }); await flush();
    expect(methods(reopened.p)).toContain('thread/resume'); expect(methods(reopened.p)).not.toContain('thread/start');
    const resume = reopened.p.writes.map(w => JSON.parse(w) as { method?: string; params?: { threadId?: string } }).find(m => m.method === 'thread/resume')!;
    expect(resume.params?.threadId).toBe('thread-1'); expect(methods(reopened.p).filter(m => m === 'turn/start')).toHaveLength(1);
    complete(reopened.p, 'thread-1', 'turn-1', 'i2', '好'); await flush(); await reopened.c.close();
    const third = await signedIn(s => s.handlers.set('thread/resume', () => { throw new Error('not found'); }), storage);
    third.p.onWrite = m => { if (typeof m.method === 'string' && 'id' in m) { if (m.method === 'thread/resume') third.p.emit({ id: m.id, error: { code: -32000, message: 'private thread path' } }); else { const r = third.handlers.get(m.method)?.((m.params ?? {}) as Record<string, unknown>, m.id); if (r !== undefined) third.p.emit({ id: m.id, result: r }); } } };
    await third.c.send({ ...explain(3), action: 'ask', question: '再来', citations: [] }); await flush();
    expect(third.events.at(-1)).toMatchObject({ type: 'failed', code: 'HISTORY_UNAVAILABLE' }); expect(methods(third.p)).not.toContain('turn/start');
    expect(JSON.stringify(third.events)).not.toContain('private thread path');
  });
  it('rejects unsupported items and server approval requests, failing the affected request and stopping the runtime', async () => {
    const { c, p, events, explain } = await signedIn(); await c.send(explain(1)); await flush();
    p.emit({ method: 'item/started', params: { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'plan', id: 'plan-1', text: 'outline' } } }); await flush();
    expect(events.at(-1)?.type).toBe('accepted');
    p.emit({ method: 'item/started', params: { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'imageView', id: 'tool-1', path: '/private' } } }); await flush();
    expect(events.at(-1)).toMatchObject({ type: 'failed', code: 'UNSUPPORTED_INTERACTION' }); expect(p.terminated).toBe(true);
    const other = await signedIn(); await other.c.send(other.explain(1)); await flush();
    other.p.emit({ id: 'approval-1', method: 'item/commandExecution/requestApproval', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'tool-1' } }); await flush();
    expect(other.p.writes.map(w => JSON.parse(w) as unknown)).toContainEqual({ id: 'approval-1', result: { decision: 'decline' } });
    expect(other.events.at(-1)).toMatchObject({ type: 'failed', code: 'UNSUPPORTED_INTERACTION' }); expect(other.c.snapshot().runtime).toBe('error');
  });
  it('a failed accept write records nothing and submits nothing', async () => {
    const { c, p, storage, explain } = await signedIn(); storage.fail = true;
    await expect(c.send(explain(1))).rejects.toMatchObject({ code: 'INTERNAL_ERROR' }); storage.fail = false;
    expect(methods(p)).not.toContain('thread/start'); await expect(c.request(explain(1).conversationId, requestId(1))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await c.get(explain(1).conversationId)).messages).toHaveLength(0);
  });
  it('a completed turn without any answer text is a failure, not an empty answer', async () => {
    const { c, p, events, explain } = await signedIn(); await c.send(explain(1)); await flush();
    p.emit({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { ...turn, status: 'completed', items: [] } } }); await flush();
    expect(events.at(-1)).toMatchObject({ type: 'failed', code: 'INTERNAL_ERROR' });
  });
  it('closing the runtime settles active requests as uncertain and a late transport error changes nothing', async () => {
    const { c, p, events, explain } = await signedIn(); await c.send(explain(1)); await flush();
    await c.close(); expect(events.at(-1)?.type).toBe('uncertain'); expect(c.snapshot().runtime).toBe('stopped'); expect(p.terminated).toBe(true);
  });
  it('shareable diagnostics omit paper text, citations, paths and account identifiers', async () => {
    const { c, events, explain } = await signedIn();
    await c.send(explain(1)); await flush();
    expect(events.at(-1)?.type).toBe('accepted');
    const report = await c.diagnostics(explain(1).conversationId);
    expect(report).toMatchObject({
      pluginVersion: '0.1.0',
      runtimeVersion: '0.156.1',
      errorCode: null,
      requestCount: 1,
      storageLocation: 'Zotero profile/zotero-chatgpt/v1/records',
    });
    expect(report.states.accepted ?? report.states.dispatching ?? report.states.running).toBe(1);
    const text = JSON.stringify(report);
    expect(text).not.toContain(citationA.text);
    expect(text).not.toContain(paperA.attachmentKey);
    expect(text).not.toContain('/isolated');
    expect(text).not.toMatch(/private@example|token|secret/i);
  });
  it('shareable diagnostics report the last failed request code without the failure message', async () => {
    const { c, p, events, explain } = await signedIn(); await c.send(explain(1)); await flush();
    p.emit({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { ...turn, status: 'completed', items: [] } } }); await flush();
    expect(events.at(-1)).toMatchObject({ type: 'failed', code: 'INTERNAL_ERROR' });
    const report = await c.diagnostics(explain(1).conversationId);
    expect(report.errorCode).toBe('INTERNAL_ERROR');
    expect(report.states.failed).toBe(1);
    expect(JSON.stringify(report)).not.toContain('completed without an answer');
  });
  it('exposes honest accept, first-text and settle times without claiming completion early', async () => {
    const s = server(); const storage = new MemoryStorage(); let current = '2026-09-09T08:00:00.000Z';
    const c = await createReaderClient(s.p, storage, { codexVersion: '0.156.1', cwd: '/isolated', uuid, loginTimeoutMs: 1000, deltaFlushMs: 1, now: () => current }); clients.push(c);
    await c.refreshAccount();
    const conversation = await c.current(paperA, 'Scheduled timing');
    const input: SendInput = { requestId: requestId(801), conversationId: conversation.id, action: 'explain', question: '', citations: [citationA], settings, mode: 'agent' };
    await c.send(input); await flush();
    const running = (await c.get(conversation.id)).requestTiming?.find(timing => timing.requestId === input.requestId);
    expect(running).toEqual({ requestId: input.requestId, acceptedAt: '2026-09-09T08:00:00.000Z', firstTextAt: null, settledAt: null });
    current = '2026-09-09T08:00:04.000Z';
    stream(s.p, 'thread-1', 'turn-1', 'item-1', 'Partial answer'); await tick(10);
    const streaming = (await c.get(conversation.id)).requestTiming?.find(timing => timing.requestId === input.requestId);
    expect(streaming?.firstTextAt).toBe('2026-09-09T08:00:04.000Z');
    expect(streaming?.settledAt).toBeNull();
    current = '2026-09-09T08:00:09.000Z';
    complete(s.p, 'thread-1', 'turn-1', 'item-1', 'Final answer'); await flush();
    const settled = (await c.get(conversation.id)).requestTiming?.find(timing => timing.requestId === input.requestId);
    expect(settled?.settledAt).toBe('2026-09-09T08:00:09.000Z');
    const saved = JSON.parse(new TextDecoder().decode(storage.files.get(`conversations/${conversation.id}.json`))) as { requests: Array<{ firstTokenAt?: string }> };
    expect(saved.requests[0]?.firstTokenAt).toBe('2026-09-09T08:00:04.000Z');
    // A single completed item with no streamed deltas is still first visible text, not a missing value.
    current = '2026-09-09T08:01:00.000Z';
    const oneShotInput: SendInput = { requestId: requestId(802), conversationId: conversation.id, action: 'ask', question: 'Follow-up?', citations: [citationA], settings, mode: 'agent' };
    await c.send(oneShotInput); await flush();
    current = '2026-09-09T08:01:03.000Z';
    complete(s.p, 'thread-1', 'turn-2', 'item-2', 'One-shot answer'); await flush();
    const oneShot = (await c.get(conversation.id)).requestTiming?.find(timing => timing.requestId === oneShotInput.requestId);
    expect(oneShot?.firstTextAt).toBe('2026-09-09T08:01:03.000Z');
    expect(oneShot?.settledAt).toBe('2026-09-09T08:01:03.000Z');
  });

  it('records reasoning output as turn liveness and pings progress at most once per second, never as answer text', async () => {
    const s = server(); const storage = new MemoryStorage(); let current = '2026-09-09T08:00:00.000Z';
    const c = await createReaderClient(s.p, storage, { codexVersion: '0.156.1', cwd: '/isolated', uuid, loginTimeoutMs: 1000, deltaFlushMs: 1, now: () => current }); clients.push(c);
    const events: ReaderEvent[] = []; c.subscribe(e => events.push(e));
    await c.refreshAccount();
    const conversation = await c.current(paperA, 'Reasoning liveness');
    const input: SendInput = { requestId: requestId(810), conversationId: conversation.id, action: 'ask', question: '这本书是讲什么的', citations: [], settings, mode: 'agent' };
    await c.send(input); await tick();
    const timing = async () => (await c.get(conversation.id)).requestTiming?.find(entry => entry.requestId === input.requestId);
    const pings = () => events.filter(event => event.type === 'progress');
    const reasoning = (delta: string) => s.p.emit({ method: 'item/reasoning/textDelta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'reasoning-1', contentIndex: 0, delta } });

    // Nothing has been heard from the model yet: an absent mark, not a fabricated zero.
    expect(await timing()).toMatchObject({ firstTextAt: null, settledAt: null });
    expect((await timing())?.lastActivityAt).toBeUndefined();

    // Reasoning output is not answer text, but it proves the turn is genuinely still working.
    current = '2026-09-09T08:00:01.000Z'; reasoning('考虑这本书的主题'); await tick(20);
    expect((await timing())?.lastActivityAt).toBe('2026-09-09T08:00:01.000Z');
    expect(pings()).toHaveLength(1);
    expect(pings()[0]).toMatchObject({ type: 'progress', requestId: input.requestId, at: '2026-09-09T08:00:01.000Z' });
    // The view applies events only when `event.seq` is newer than its snapshot; a ping that reused or
    // preceded the accepted seq would be silently dropped and the liveness plumbing would do nothing.
    expect(pings()[0]!.seq).toBeGreaterThan(events.find(event => event.type === 'accepted')!.seq);
    expect((await c.get(conversation.id)).messages.every(message => message.role === 'user')).toBe(true);

    // Reasoning deltas arrive far faster than one per second; the mark advances, the ping does not.
    current = '2026-09-09T08:00:01.400Z'; reasoning('继续推理'); await tick(20);
    expect((await timing())?.lastActivityAt).toBe('2026-09-09T08:00:01.400Z');
    expect(pings()).toHaveLength(1);

    current = '2026-09-09T08:00:02.000Z'; reasoning('再看一遍'); await tick(20);
    expect(pings()).toHaveLength(2);
    expect(pings()[1]?.at).toBe('2026-09-09T08:00:02.000Z');

    // A reasoning *item* stays harmless: it never becomes an assistant message and does not re-ping.
    s.p.emit({ method: 'item/started', params: { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'reasoning', id: 'reasoning-1' } } }); await tick(20);
    expect(pings()).toHaveLength(2);
    expect((await c.get(conversation.id)).messages.every(message => message.role === 'user')).toBe(true);

    // Usage reports count as liveness too, and this path already commits, so the mark is durable.
    current = '2026-09-09T08:00:05.000Z';
    const usage = { inputTokens: 100, cachedInputTokens: 0, outputTokens: 5, reasoningOutputTokens: 4, totalTokens: 105 };
    s.p.emit({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread-1', turnId: 'turn-1', tokenUsage: { last: usage, total: usage, modelContextWindow: 121600 } } }); await tick(20);
    expect((await timing())?.lastActivityAt).toBe('2026-09-09T08:00:05.000Z');
    const saved = JSON.parse(new TextDecoder().decode(storage.files.get(`conversations/${conversation.id}.json`))) as { requests: Array<{ lastEventAt?: string }> };
    expect(saved.requests[0]?.lastEventAt).toBe('2026-09-09T08:00:05.000Z');
  });

  it('throttles progress per run, so a second request pings immediately instead of inheriting the window', async () => {
    const s = server(); const storage = new MemoryStorage(); let current = '2026-09-09T08:00:00.000Z';
    const c = await createReaderClient(s.p, storage, { codexVersion: '0.156.1', cwd: '/isolated', uuid, loginTimeoutMs: 1000, deltaFlushMs: 1, now: () => current }); clients.push(c);
    const events: ReaderEvent[] = []; c.subscribe(e => events.push(e));
    await c.refreshAccount();
    const conversation = await c.current(paperA, 'Per-run throttle');
    const send = async (n: number): Promise<SendInput> => { const input: SendInput = { requestId: requestId(n), conversationId: conversation.id, action: 'ask', question: `Question ${n}`, citations: [], settings, mode: 'agent' }; await c.send(input); await tick(); return input; };
    const reasoning = (turnId: string) => s.p.emit({ method: 'item/reasoning/textDelta', params: { threadId: 'thread-1', turnId, itemId: 'reasoning-1', contentIndex: 0, delta: 'think' } });

    await send(820);
    current = '2026-09-09T08:00:01.000Z'; reasoning('turn-1'); await tick(20);
    expect(events.filter(event => event.type === 'progress')).toHaveLength(1);
    complete(s.p, 'thread-1', 'turn-1', 'item-1', 'First answer'); await tick(20);

    const second = await send(821);
    current = '2026-09-09T08:00:01.100Z'; reasoning('turn-2'); await tick(20);
    const pings = events.filter(event => event.type === 'progress');
    expect(pings).toHaveLength(2);
    expect(pings[1]).toMatchObject({ requestId: second.requestId, at: '2026-09-09T08:00:01.100Z' });
  });
});
