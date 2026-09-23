import { expect, it } from 'vitest';
import { ReadingCoordinator } from '../../packages/core/src/context/coordinator.ts';
import { createReaderClient } from '../../packages/core/src/index.ts';
import type { ContextPlan } from '../../packages/core/src/context/planner.ts';
import { buildContextBudget } from '../../packages/core/src/codex/model-capabilities.ts';
import { ReaderError, type Conversation, type DocumentContext, type ReaderEvent, type RequestState, type SendInput } from '../../packages/contracts/src/index.ts';
import type { ReaderClient } from '../../packages/contracts/src/runtime.ts';
import { MemoryStorage, flush } from './doubles.ts';
import { imageA, paperA, paperB, settings } from '../contracts/factories.ts';
import { model as catalogModel, server as appServer } from './fixtures.ts';

const uuid = (n: number) => `12345678-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture(window = 20000) {
  let nextId = 100; let seq = 0; let listeners = new Set<(event: ReaderEvent) => void>();
  const clock = { now: () => '2026-09-12T10:00:00.000Z', uuid: () => uuid(++nextId) };
  const storage = new MemoryStorage(); const receipts = new Map<string, RequestState>(); const sent: SendInput[] = []; const cancelled: string[] = []; const enqueued: SendInput[] = []; const waiting: SendInput[] = []; const released: string[] = [];
  const conversation: Conversation = { id: uuid(1), paper: paperA, title: 'Synthetic source', settings, activeRequestId: null, messages: [], lastSeq: 0, createdAt: clock.now(), updatedAt: clock.now() };
  const document: DocumentContext = { id: uuid(2), paper: paperA, revision: { fingerprint: 'synthetic', size: 1024, modifiedAt: 1 }, parserVersion: 'synthetic', totalPages: 2, pages: [0, 1].map(pageIndex => ({ pageIndex, pageLabel: pageIndex === 0 ? 'iv' : '1', text: `Raw source page ${pageIndex}.`, status: 'text' })) };
  const input: SendInput = { requestId: uuid(3), conversationId: conversation.id, action: 'ask', question: 'Compare all definitions and conclusions.', citations: [], settings, mode: 'agent', document, paper: { title: 'Synthetic source', authors: ['Author'] } };
  const plan: ContextPlan = { mode: 'multi-pass', documents: document.pages.map((page, index) => ({ ...document, id: uuid(10 + index), sourceId: document.id, pages: [page] })), coverage: { totalPages: 2, selectedPages: [0, 1], reason: 'All authorized pages, in two synthetic passes.' }, budget: buildContextBudget({ modelId: 'gpt-5.4', reportedWindow: window, historyTokens: 0, instructionBytes: 500, workflowBytes: 0, imageCount: 0, questionBytes: 100, outputReserve: 1000 }) };
  input.settings = { model: 'gpt-5.4', effort: 'high', serviceTier: 'priority' }; conversation.settings = input.settings;
  let onSend: ((input: SendInput) => Promise<void>) | null = null;
  const absent = () => Promise.reject(new Error('This reader operation is outside the coordinator contract'));
  const emit = (requestId: string, type: 'completed' | 'failed' | 'cancelled' | 'uncertain' | 'messageCompleted') => {
    const common = { seq: ++seq, conversationId: conversation.id, requestId, at: clock.now() };
    const event: ReaderEvent = type === 'completed' ? { ...common, type, messageId: `answer-${requestId}`, finalText: 'Notification text is not trusted as the stored summary.' }
      : type === 'messageCompleted' ? { ...common, type, messageId: `answer-${requestId}`, finalText: 'Not a terminal turn', phase: 'final' }
      : type === 'failed' ? { ...common, type, code: 'RATE_LIMITED', message: 'Synthetic refusal' }
      : type === 'cancelled' ? { ...common, type, messageId: null }
      : { ...common, type, message: 'Synthetic uncertainty' };
    for (const listener of listeners) listener(event);
  };
  const activate = (value: SendInput) => {
    sent.push(structuredClone(value)); receipts.set(value.requestId, 'running'); conversation.activeRequestId = value.requestId;
    conversation.queuedRequestIds = (conversation.queuedRequestIds ?? []).filter(id => id !== value.requestId);
    if (value.batch) conversation.activeBatchId = value.batch.id;
  };
  const drain = () => {
    if (conversation.activeRequestId || [...receipts.values()].includes('uncertain')) return;
    const index = waiting.findIndex(value => !conversation.activeBatchId || value.batch?.id === conversation.activeBatchId);
    if (index >= 0) activate(waiting.splice(index, 1)[0]!);
  };
  const accept = async (value: SendInput, queue: boolean) => {
    if (receipts.has(value.requestId)) throw new Error('Coordinator resent a previously submitted request');
    if (onSend) await onSend(value);
    conversation.messages.push({ id: `user-${value.requestId}`, requestId: value.requestId, role: 'user', phase: null, settings: structuredClone(value.settings), text: value.question, citations: value.citations, status: 'completed', ...(value.batch ? { batch: structuredClone(value.batch) } : {}) });
    if (queue) enqueued.push(structuredClone(value));
    if (queue && (conversation.activeRequestId || (conversation.activeBatchId && value.batch?.id !== conversation.activeBatchId))) {
      waiting.push(structuredClone(value)); receipts.set(value.requestId, 'accepted'); conversation.queuedRequestIds = [...(conversation.queuedRequestIds ?? []), value.requestId];
      return { requestId: value.requestId, state: 'accepted' as const, replay: false };
    }
    activate(value); return { requestId: value.requestId, state: 'running' as const, replay: false };
  };
  const makeClient = (): ReaderClient => ({
    snapshot: () => ({ revision: 1, runtime: 'ready', account: { state: 'signedIn' }, login: null, models: [], error: null }),
    observe: () => () => undefined, refreshAccount: absent, startLogin: absent, cancelLogin: absent, current: absent, peekCurrent: absent, newConversation: absent, list: absent, select: absent, deleteConversation: absent, diagnostics: absent, close: absent,
    get: id => id === conversation.id ? Promise.resolve(structuredClone(conversation)) : Promise.reject(new ReaderError('NOT_FOUND', 'Unknown conversation')),
    request: (_id, requestId) => { const state = receipts.get(requestId); return state ? Promise.resolve({ requestId, state, replay: false }) : Promise.reject(new ReaderError('NOT_FOUND', 'Unknown request')); },
    send: value => accept(value, false), enqueue: value => accept(value, true),
    cancel: (_id, requestId) => {
      cancelled.push(requestId); const index = waiting.findIndex(value => value.requestId === requestId);
      if (index >= 0) { waiting.splice(index, 1); conversation.queuedRequestIds = (conversation.queuedRequestIds ?? []).filter(id => id !== requestId); receipts.set(requestId, 'cancelled'); }
      return Promise.resolve({ requestId, state: receipts.get(requestId) ?? 'cancelled', replay: false });
    },
    releaseBatch: (_id, batchId) => {
      if (conversation.activeRequestId || [...receipts.values()].includes('uncertain')) return Promise.reject(new ReaderError('BUSY', 'Unconfirmed active request'));
      if (conversation.activeBatchId === batchId) { delete conversation.activeBatchId; released.push(batchId); drain(); }
      return Promise.resolve();
    },
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  });
  const client = makeClient();
  const finish = (requestId: string, text = 'Actual synthetic summary.', state: RequestState = 'completed', notify = true) => {
    receipts.set(requestId, state); if (conversation.activeRequestId === requestId) conversation.activeRequestId = null;
    const sentInput = sent.find(value => value.requestId === requestId);
    if (sentInput?.batch && state !== 'uncertain' && (state !== 'completed' || sentInput.batch.phase === 'reduce')) delete conversation.activeBatchId;
    if (state === 'completed' && text) conversation.messages.push({ id: `answer-${requestId}`, requestId, role: 'assistant', phase: 'final', settings: structuredClone(input.settings), text, citations: [], status: 'completed' });
    if (notify && (state === 'completed' || state === 'failed' || state === 'cancelled' || state === 'uncertain')) emit(requestId, state);
    if (state !== 'uncertain') drain();
  };
  return { clock, storage, receipts, sent, cancelled, enqueued, released, conversation, document, input, plan, client, emit, finish, listenerCount: () => listeners.size, onSend: (callback: (input: SendInput) => Promise<void>) => { onSend = callback; }, restart: () => { listeners = new Set(); return makeClient(); } };
}
async function settle() { for (let i = 0; i < 8; i++) { await flush(); await new Promise(resolve => setTimeout(resolve, 0)); } }

it('reserves all request ids and records submitting intent before the first reader send', async () => {
  const f = fixture(); const coordinator = new ReadingCoordinator(f.client, f.storage, f.clock); let reserved = false;
  f.onSend(async value => {
    const raw = await f.storage.read(`reading/${f.input.requestId}.json`); const saved = JSON.parse(new TextDecoder().decode(raw!)) as { steps: Array<{ requestId: string; status: string }> };
    reserved = saved.steps.length === 3 && new Set(saved.steps.map(step => step.requestId)).size === 3 && saved.steps.find(step => step.requestId === value.requestId)?.status === 'submitting';
  });
  const job = await coordinator.start(f.input, f.plan); await settle();
  expect(reserved).toBe(true); expect(f.sent).toHaveLength(1); expect(job.id).toBe(f.input.requestId);
  expect(f.storage.writes.filter(text => text.includes('Raw source page 0.'))).toHaveLength(1);
});

it('refuses to create a reading job from a Chat-mode request', async () => {
  const f = fixture(); const coordinator = new ReadingCoordinator(f.client, f.storage, f.clock);
  const chat = { ...f.input, mode: 'chat' as const };
  await expect(coordinator.start(chat, f.plan)).rejects.toMatchObject({ code: 'UNSUPPORTED_INTERACTION' });
  // An absent mode is Chat too, and neither attempt reserved a step or touched the reader.
  const { mode: _mode, ...unfrozen } = f.input; void _mode;
  await expect(coordinator.start(unfrozen, f.plan)).rejects.toMatchObject({ code: 'UNSUPPORTED_INTERACTION' });
  expect(f.sent).toHaveLength(0);
  expect(f.storage.files.size).toBe(0);
});

it('waits for real terminal state and reduces only actual persisted summaries in the same conversation', async () => {
  const f = fixture(); f.input.contextReport = { mode: 'full', capacity: 20000, provenance: 'runtime-reported', reservedTokens: 5600, textBudgetTokens: 14400, selectedPages: [0, 1], totalPages: 2, reason: 'Original preparation scope' };
  const coordinator = new ReadingCoordinator(f.client, f.storage, f.clock); const job = await coordinator.start(f.input, f.plan); await settle();
  expect(f.sent[0]?.contextReport?.selectedPages).toEqual([0]);
  f.emit(f.sent[0]!.requestId, 'messageCompleted'); await settle(); expect(f.sent).toHaveLength(1);
  f.finish(f.sent[0]!.requestId, 'Summary one, page iv.'); await settle(); expect(f.sent).toHaveLength(2);
  f.finish(f.sent[1]!.requestId, 'Summary two, page 1.'); await settle(); expect(f.sent).toHaveLength(3);
  const reduce = f.sent[2]!;
  expect(reduce.question).toBe(f.input.question); expect(reduce.document).toBeUndefined(); expect(reduce.images).toBeUndefined(); expect(reduce.references?.length ?? 0).toBe(0);
  expect(reduce.contextReport?.selectedPages).toEqual([]);
  expect(reduce.batch).toMatchObject({ phase: 'reduce', summaries: [{ index: 0, pages: [0], text: 'Summary one, page iv.', paper: paperA }, { index: 1, pages: [1], text: 'Summary two, page 1.', paper: paperA }] });
  for (const sent of f.sent) { expect(sent.conversationId).toBe(f.conversation.id); expect(sent.settings).toEqual(f.input.settings); }
  f.finish(reduce.requestId, 'Final synthetic synthesis.'); await settle();
  expect(await coordinator.get(job.id)).toMatchObject({ status: 'completed', steps: [{ status: 'completed' }, { status: 'completed' }, { status: 'completed', result: { text: 'Final synthetic synthesis.' } }] });
});

it('cancels the current request and waits for confirmation before claiming cancellation', async () => {
  const f = fixture(); const coordinator = new ReadingCoordinator(f.client, f.storage, f.clock); const job = await coordinator.start(f.input, f.plan); await settle();
  await coordinator.cancel(job.id); expect((await coordinator.get(job.id)).status).toBe('cancelling'); expect(f.cancelled).toContain(f.sent[0]!.requestId);
  f.finish(f.sent[0]!.requestId, '', 'cancelled'); await settle();
  expect((await coordinator.get(job.id)).status).toBe('cancelled'); expect(f.sent).toHaveLength(1);
});

it('reconciles a completed pass after restart without resending it', async () => {
  const f = fixture(); const first = new ReadingCoordinator(f.client, f.storage, f.clock); const job = await first.start(f.input, f.plan); await settle();
  f.finish(f.sent[0]!.requestId, 'Recovered actual summary.', 'completed', false);
  const restored = new ReadingCoordinator(f.restart(), f.storage, f.clock);
  await restored.reconcile(job.id); await settle();
  expect(f.sent).toHaveLength(2); expect(f.sent[1]?.requestId).not.toBe(f.sent[0]?.requestId);
  expect((await restored.get(job.id)).steps[0]?.result?.text).toBe('Recovered actual summary.');
});

it('does not resend a dispatched request whose recorded state cannot be found after restart', async () => {
  const f = fixture(); const first = new ReadingCoordinator(f.client, f.storage, f.clock); const job = await first.start(f.input, f.plan); await settle();
  f.receipts.clear(); f.conversation.activeRequestId = null;
  const restored = new ReadingCoordinator(f.restart(), f.storage, f.clock);
  await restored.reconcile(job.id); await settle();
  expect((await restored.get(job.id)).status).toBe('uncertain'); expect(f.sent).toHaveLength(1);
});

it.each(['failed', 'uncertain'] as const)('stops on a %s pass and never automatically retries it', async state => {
  const f = fixture(); const coordinator = new ReadingCoordinator(f.client, f.storage, f.clock); const job = await coordinator.start(f.input, f.plan); await settle();
  f.finish(f.sent[0]!.requestId, '', state); await settle(); await coordinator.reconcile(job.id); await settle();
  expect((await coordinator.get(job.id)).status).toBe(state); expect(f.sent).toHaveLength(1);
});

it('does not invent a summary when completion has no stored assistant answer', async () => {
  const f = fixture(); const coordinator = new ReadingCoordinator(f.client, f.storage, f.clock); const job = await coordinator.start(f.input, f.plan); await settle();
  f.finish(f.sent[0]!.requestId, ''); await settle();
  expect((await coordinator.get(job.id)).status).toBe('failed'); expect(f.sent).toHaveLength(1);
});

it('pauses instead of truncating a summary that cannot fit the final reduction budget', async () => {
  const f = fixture(4000); const coordinator = new ReadingCoordinator(f.client, f.storage, f.clock); const job = await coordinator.start(f.input, f.plan); await settle();
  const large = 'Unabridged actual result. '.repeat(1000);
  f.finish(f.sent[0]!.requestId, large); await settle(); f.finish(f.sent[1]!.requestId, 'Second summary.'); await settle();
  const paused = await coordinator.get(job.id); expect(paused.status).toBe('paused'); expect(paused.steps[0]?.result?.text).toBe(large); expect(f.sent).toHaveLength(2);
});

it('routes referenced-article chunks only into their matching reference and distinguishes provenance', async () => {
  const f = fixture(); const other: DocumentContext = { ...f.document, id: uuid(20), paper: paperB, pages: [{ ...f.document.pages[0]!, text: 'Other article source.' }] };
  f.input.references = [{ id: 'article-b', kind: 'article', label: 'Source B', paper: paperB, identity: { title: 'Source B', authors: [] }, capturedAt: f.clock.now(), document: other }];
  f.plan.documents = [f.plan.documents[0]!, { ...other, id: uuid(21), sourceId: other.id }];
  const coordinator = new ReadingCoordinator(f.client, f.storage, f.clock); await coordinator.start(f.input, f.plan); await settle();
  expect(f.sent[0]?.document?.paper).toEqual(paperA); expect(f.sent[0]?.references?.[0]?.document).toBeUndefined();
  f.finish(f.sent[0]!.requestId, 'Source A summary.'); await settle();
  expect(f.sent[1]?.document).toBeUndefined(); expect(f.sent[1]?.references?.[0]?.document?.paper).toEqual(paperB);
  f.finish(f.sent[1]!.requestId, 'Source B summary.'); await settle();
  expect(f.sent[2]?.batch?.summaries?.[1]).toMatchObject({ paper: paperB, title: 'Source B' });
});

it('makes duplicate starts idempotent and rejects changed input under an existing id', async () => {
  const f = fixture(); const coordinator = new ReadingCoordinator(f.client, f.storage, f.clock);
  const [first, second] = await Promise.all([coordinator.start(f.input, f.plan), coordinator.start(f.input, f.plan)]); await settle();
  expect(first.id).toBe(second.id); expect(f.sent).toHaveLength(1);
  await expect(coordinator.start({ ...f.input, question: 'Different request' }, f.plan)).rejects.toThrow();
});

it('does not start a reader request if writing the durable submitting marker fails', async () => {
  const f = fixture(); const original = f.storage.writeAtomic.bind(f.storage);
  f.storage.writeAtomic = (path, bytes) => new TextDecoder().decode(bytes).includes('"status":"submitting"') ? Promise.reject(new Error('Synthetic write failure')) : original(path, bytes);
  const coordinator = new ReadingCoordinator(f.client, f.storage, f.clock); const job = await coordinator.start(f.input, f.plan); await settle();
  expect(f.sent).toHaveLength(0); expect(await coordinator.get(job.id)).toMatchObject({ status: 'uncertain', persistence: 'unconfirmed' });
});

it('continues after view unsubscribe but rejects corrupt persisted schema without rewriting it', async () => {
  const f = fixture(); const coordinator = new ReadingCoordinator(f.client, f.storage, f.clock); const unsubscribe = coordinator.subscribe(() => undefined);
  const job = await coordinator.start(f.input, f.plan); await settle(); unsubscribe();
  f.finish(f.sent[0]!.requestId, 'Still running without the view.'); await settle(); expect(f.sent).toHaveLength(2);
  const path = `reading/${job.id}.json`; const corrupt = new TextEncoder().encode('{"schemaVersion":99}'); f.storage.files.set(path, corrupt);
  await expect(coordinator.get(job.id)).rejects.toThrow(); expect(f.storage.files.get(path)).toEqual(corrupt);
});

it('uses one direct request for a plan that already fits', async () => {
  const f = fixture(); f.plan = { ...f.plan, mode: 'full', documents: [f.document] };
  const coordinator = new ReadingCoordinator(f.client, f.storage, f.clock); const job = await coordinator.start(f.input, f.plan); await settle();
  expect(f.sent[0]?.batch).toBeUndefined(); f.finish(f.sent[0]!.requestId, 'A direct answer.'); await settle();
  expect((await coordinator.get(job.id)).status).toBe('completed'); expect(f.sent).toHaveLength(1);
});

it('retains explicitly supplied article context on a direct request instead of applying map isolation', async () => {
  const f = fixture(); const other: DocumentContext = { ...f.document, id: uuid(20), paper: paperB };
  f.input.references = [{ id: 'article-b', kind: 'article', label: 'B', paper: paperB, capturedAt: f.clock.now(), document: other }];
  const plan: ContextPlan = { ...f.plan, mode: 'full', documents: [f.document] };
  await new ReadingCoordinator(f.client, f.storage, f.clock).start(f.input, plan); await settle();
  expect(f.sent[0]?.references?.[0]?.document).toEqual(other);
});

it('detects modified persisted summaries and impossible out-of-order progress', async () => {
  const f = fixture(); const coordinator = new ReadingCoordinator(f.client, f.storage, f.clock); const job = await coordinator.start(f.input, f.plan); await settle();
  f.finish(f.sent[0]!.requestId, 'Original completed summary.'); await settle();
  const path = `reading/${job.id}.json`; const raw = f.storage.files.get(path)!;
  const saved = JSON.parse(new TextDecoder().decode(raw)) as { steps: Array<{ status: string; result?: { text: string } }> };
  saved.steps[0]!.result!.text = 'Changed after persistence';
  f.storage.files.set(path, new TextEncoder().encode(JSON.stringify(saved)));
  await expect(coordinator.get(job.id)).rejects.toThrow();
  const outOfOrder = JSON.parse(new TextDecoder().decode(raw)) as { steps: Array<{ status: string }> };
  outOfOrder.steps[2]!.status = 'running'; f.storage.files.set(path, new TextEncoder().encode(JSON.stringify(outOfOrder)));
  await expect(coordinator.get(job.id)).rejects.toThrow(); expect(f.sent).toHaveLength(2);
});

it('checks the request transport limit before marking a too-large reduction as submitted', async () => {
  const f = fixture(500000); const coordinator = new ReadingCoordinator(f.client, f.storage, f.clock); const job = await coordinator.start(f.input, f.plan); await settle();
  f.finish(f.sent[0]!.requestId, 'x'.repeat(140 * 1024)); await settle(); f.finish(f.sent[1]!.requestId, 'Second actual summary.'); await settle();
  expect(await coordinator.get(job.id)).toMatchObject({ status: 'paused', steps: [{ status: 'completed' }, { status: 'completed' }, { status: 'reserved' }] });
  expect(f.sent).toHaveLength(2);
});

it('does not replace a different version of an article when routing an unfragmented reference source', async () => {
  const f = fixture(); const other: DocumentContext = { ...f.document, id: uuid(20), paper: paperB };
  const later = { ...other, id: uuid(30), revision: { ...other.revision, modifiedAt: 2 } };
  f.input.references = [other, later].map((document, index) => ({ id: `article-${index}`, kind: 'article', label: `Version ${index}`, paper: paperB, capturedAt: f.clock.now(), document }));
  f.plan.documents = [f.plan.documents[0]!, other];
  await new ReadingCoordinator(f.client, f.storage, f.clock).start(f.input, f.plan); await settle();
  f.finish(f.sent[0]!.requestId, 'Current source result.'); await settle();
  expect(f.sent[1]?.references?.[0]?.document).toEqual(other);
  expect(f.sent[1]?.references?.[1]?.document).toBeUndefined();
});

it('durably queues one reading job behind an existing request and starts only after its real terminal state', async () => {
  const f = fixture(); const prior = uuid(90); f.receipts.set(prior, 'running'); f.conversation.activeRequestId = prior;
  const coordinator = new ReadingCoordinator(f.client, f.storage, f.clock);
  const job = await coordinator.enqueue(f.input, f.plan); await settle();
  expect(await coordinator.get(job.id)).toMatchObject({ status: 'queued', waitingForRequestId: prior, steps: [{ status: 'queued' }, { status: 'reserved' }, { status: 'reserved' }] });
  expect(f.enqueued.map(input => input.requestId)).toEqual([f.input.requestId]); expect(f.conversation.queuedRequestIds).toEqual([f.input.requestId]);
  expect(f.sent).toHaveLength(0); f.emit(prior, 'messageCompleted'); await settle(); expect(f.sent).toHaveLength(0);
  await expect(coordinator.enqueue({ ...f.input, requestId: uuid(4) }, f.plan)).rejects.toMatchObject({ code: 'BUSY' });
  f.finish(prior, 'Previous real response.'); await settle(); expect(f.sent).toHaveLength(1);
});

it('cancels a reserved queued reading job without cancelling the preceding request', async () => {
  const f = fixture(); const prior = uuid(90); f.receipts.set(prior, 'running'); f.conversation.activeRequestId = prior;
  const coordinator = new ReadingCoordinator(f.client, f.storage, f.clock); const job = await coordinator.enqueue(f.input, f.plan); await settle();
  expect((await coordinator.cancel(job.id)).status).toBe('cancelled'); expect(f.cancelled).toEqual([f.input.requestId]); expect(f.sent).toHaveLength(0);
  f.finish(prior); await settle(); expect(f.sent).toHaveLength(0);
});

it('does not start queued reading when the preceding request becomes uncertain even if activeRequestId clears', async () => {
  const f = fixture(); const prior = uuid(90); f.receipts.set(prior, 'running'); f.conversation.activeRequestId = prior;
  const coordinator = new ReadingCoordinator(f.client, f.storage, f.clock); const job = await coordinator.enqueue(f.input, f.plan); await settle();
  f.finish(prior, '', 'uncertain'); await settle(); await coordinator.reconcile(job.id);
  expect(await coordinator.get(job.id)).toMatchObject({ status: 'paused', error: { code: 'precedingUncertain' } }); expect(f.sent).toHaveLength(0);
});

it('restores a queued job only after explicit reconciliation by the replacement coordinator', async () => {
  const f = fixture(); const prior = uuid(90); f.receipts.set(prior, 'running'); f.conversation.activeRequestId = prior;
  const old = new ReadingCoordinator(f.client, f.storage, f.clock); const job = await old.enqueue(f.input, f.plan); await settle();
  await old.dispose(); f.finish(prior); await settle(); expect(f.sent).toHaveLength(1);
  const restored = new ReadingCoordinator(f.restart(), f.storage, f.clock);
  expect(await restored.list()).toHaveLength(1); expect((await restored.get(job.id)).status).toBe('queued'); expect(f.sent).toHaveLength(1);
  f.finish(f.sent[0]!.requestId, 'Core accepted work completed while detached.'); await settle(); expect(f.sent).toHaveLength(1);
  await restored.reconcile(job.id); await settle(); expect(f.sent).toHaveLength(2);
});

it('disposes runtime subscriptions and cannot dispatch the next pass after disposal', async () => {
  const f = fixture(); const old = new ReadingCoordinator(f.client, f.storage, f.clock); const job = await old.start(f.input, f.plan); await settle();
  expect(f.listenerCount()).toBe(1); await old.dispose(); expect(f.listenerCount()).toBe(0);
  f.finish(f.sent[0]!.requestId, 'Completed while the old coordinator was disposed.'); await settle(); expect(f.sent).toHaveLength(1);
  await expect(old.reconcile(job.id)).rejects.toMatchObject({ code: 'RUNTIME_UNAVAILABLE' });
  const restored = new ReadingCoordinator(f.restart(), f.storage, f.clock); await restored.reconcile(job.id); await settle(); expect(f.sent).toHaveLength(2);
});

it('waits for in-flight writes during disposal and does not send after a blocked submitting write', async () => {
  const f = fixture(); const write = f.storage.writeAtomic.bind(f.storage); let release!: () => void;
  f.storage.writeAtomic = (path, bytes) => new TextDecoder().decode(bytes).includes('"status":"submitting"') ? new Promise<void>(resolve => { release = () => { void write(path, bytes).then(resolve); }; }) : write(path, bytes);
  const coordinator = new ReadingCoordinator(f.client, f.storage, f.clock); await coordinator.start(f.input, f.plan); await settle();
  let disposed = false; const stopped = coordinator.dispose().then(() => { disposed = true; }); await flush(); expect(disposed).toBe(false);
  release(); await stopped; await settle(); expect(f.sent).toHaveLength(0); expect(f.listenerCount()).toBe(0);
});

it('reads persisted jobs offline while every operation requiring a reader connection fails explicitly', async () => {
  const f = fixture(); const live = new ReadingCoordinator(f.client, f.storage, f.clock); const job = await live.start(f.input, f.plan); await settle(); await live.dispose();
  const offline = new ReadingCoordinator(null, f.storage, f.clock);
  expect((await offline.get(job.id)).id).toBe(job.id); expect(await offline.list()).toHaveLength(1);
  await expect(offline.reconcile(job.id)).rejects.toMatchObject({ code: 'RUNTIME_UNAVAILABLE' });
  await expect(offline.cancel(job.id)).rejects.toMatchObject({ code: 'RUNTIME_UNAVAILABLE' });
  await expect(offline.enqueue({ ...f.input, requestId: uuid(4) }, f.plan)).rejects.toMatchObject({ code: 'RUNTIME_UNAVAILABLE' });
  expect(f.sent).toHaveLength(1);
});

it('rejects enqueue on a connection without durable core queue support', async () => {
  const f = fixture(); delete f.client.enqueue;
  await expect(new ReadingCoordinator(f.client, f.storage, f.clock).enqueue(f.input, f.plan)).rejects.toMatchObject({ code: 'UNSUPPORTED_INTERACTION' });
  expect(f.sent).toHaveLength(0); expect(f.storage.writes).toHaveLength(0);
});

it.each(['direct', 'reduce'] as const)('recovers a real images-only %s result without fabricating caption text', async phase => {
  const f = fixture(); const plan: ContextPlan = phase === 'direct' ? { ...f.plan, mode: 'full', documents: [f.document] } : f.plan;
  const old = new ReadingCoordinator(f.client, f.storage, f.clock); const job = await old.start(f.input, plan); await settle();
  if (phase === 'reduce') { f.finish(f.sent[0]!.requestId, 'First actual summary.'); await settle(); f.finish(f.sent[1]!.requestId, 'Second actual summary.'); await settle(); }
  const final = f.sent.at(-1)!; await old.dispose();
  f.conversation.messages.push({ id: 'stored-image-answer', requestId: final.requestId, role: 'assistant', phase: 'final', settings: f.input.settings, text: '', citations: [], status: 'completed', generatedImages: [{ ...imageA, origin: { kind: 'generated', model: f.input.settings.model } }] });
  f.finish(final.requestId, '', 'completed', false);
  const restored = new ReadingCoordinator(f.restart(), f.storage, f.clock); const recovered = await restored.reconcile(job.id);
  expect(recovered.status).toBe('completed'); expect(recovered.steps.at(-1)?.result).toMatchObject({ text: '', messageIds: ['stored-image-answer'], generatedImageIds: [imageA.id] });
  expect(f.sent).toHaveLength(phase === 'direct' ? 1 : 3);
});

it('does not accept an images-only map as a textual source summary', async () => {
  const f = fixture(); const coordinator = new ReadingCoordinator(f.client, f.storage, f.clock); const job = await coordinator.start(f.input, f.plan); await settle();
  f.conversation.messages.push({ id: 'unexpected-map-image', requestId: f.sent[0]!.requestId, role: 'assistant', phase: 'final', settings: f.input.settings, text: '', citations: [], status: 'completed', generatedImages: [imageA] });
  f.finish(f.sent[0]!.requestId, ''); await settle();
  expect((await coordinator.get(job.id)).status).toBe('failed'); expect(f.sent).toHaveLength(1);
});

it('does not report cancelled until a held batch is safely released', async () => {
  const f = fixture(20000); const coordinator = new ReadingCoordinator(f.client, f.storage, f.clock); const job = await coordinator.start(f.input, f.plan); await settle();
  f.finish(f.sent[0]!.requestId, 'x'.repeat(12000)); await settle(); f.finish(f.sent[1]!.requestId, 'y'.repeat(12000)); await settle();
  expect((await coordinator.get(job.id)).status).toBe('paused'); expect(f.conversation.activeBatchId).toBe(job.id);
  const release = f.client.releaseBatch!.bind(f.client); f.client.releaseBatch = () => Promise.reject(new ReaderError('BUSY', 'Synthetic release refusal'));
  expect(await coordinator.cancel(job.id)).toMatchObject({ status: 'paused', error: { code: 'batchRelease' } }); expect(f.conversation.activeBatchId).toBe(job.id);
  f.client.releaseBatch = release; expect((await coordinator.cancel(job.id)).status).toBe('cancelled'); expect(f.conversation.activeBatchId).toBeUndefined();
});

it('releases a paused two-pass core batch on cancellation and starts the ordinary core queue', async () => {
  const f = fixture(20000); const server = appServer();
  const client = await createReaderClient(server.p, f.storage, { codexVersion: '0.156.1', cwd: '/isolated', uuid: f.clock.uuid, now: f.clock.now, pluginVersion: '0.4.0-batch-regression' });
  const coordinator = new ReadingCoordinator(client, f.storage, f.clock);
  const selected = { model: catalogModel.model, effort: catalogModel.defaultReasoningEffort, serviceTier: 'priority' };
  try {
    await client.refreshAccount(); const conversation = await client.current(paperA, 'Synthetic batch', selected);
    const input = { ...f.input, conversationId: conversation.id, settings: selected }; const job = await coordinator.start(input, f.plan); await settle();
    const turns = () => server.p.writes.map(line => JSON.parse(line) as { method?: string; params?: { threadId?: string } }).filter(item => item.method === 'turn/start');
    const complete = (index: number) => {
      const item = { type: 'agentMessage', id: `summary-${index}`, phase: 'final', text: String(index).repeat(12000) };
      server.p.emit({ method: 'turn/completed', params: { threadId: turns()[index - 1]!.params!.threadId, turn: { id: `turn-${index}`, status: 'completed', items: [item] } } });
    };
    complete(1); await settle(); complete(2); await settle();
    expect((await coordinator.get(job.id)).status).toBe('paused'); expect((await client.get(conversation.id)).activeBatchId).toBe(job.id);
    const ordinary = { requestId: f.clock.uuid(), conversationId: conversation.id, action: 'ask' as const, question: 'An ordinary queued follow-up.', citations: [], settings: selected, mode: 'agent' as const };
    expect((await client.enqueue!(ordinary)).state).toBe('accepted'); expect(turns()).toHaveLength(2);
    expect((await coordinator.cancel(job.id)).status).toBe('cancelled'); await settle();
    expect((await client.get(conversation.id)).activeBatchId).toBeUndefined(); expect((await client.request(conversation.id, ordinary.requestId)).state).toBe('running'); expect(turns()).toHaveLength(3);
  } finally { await coordinator.dispose(); await client.close(); }
});
