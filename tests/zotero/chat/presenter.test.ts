/* eslint-disable @typescript-eslint/unbound-method -- assertions inspect injected spies without invoking them. */
import { describe, expect, it, vi } from 'vitest';
import { ConversationPresenter, type PresenterState } from '../../../packages/zotero/src/chat/presenter.ts';
import type { ReaderClient, RuntimeSnapshot } from '../../../packages/contracts/src/runtime.ts';
import { ReaderError, SHAREABLE_STORAGE_LOCATION, paperId, type Conversation, type MessageStatus, type PaperIdentity, type ReaderEvent, type SendInput, type ShareableDiagnostics } from '../../../packages/contracts/src/index.ts';
import { citationA, citationB, imageA, paperA, settings as baseSettings } from '../../contracts/factories.ts';
import { estimateRequestBudget } from '../../../packages/core/src/codex/model-capabilities.ts';
import { defaultSettings } from '../../../packages/core/src/workspace/skills.ts';
import { presenterContext } from '../presenter-context.ts';
import { documentA } from '../../contracts/document-fixture.ts';
import type { ClipboardImageRead } from '../../../packages/zotero/src/chat/pick-images.ts';
import type { ReaderWorkspace, WorkspaceSettings } from '../../../packages/contracts/src/workspace.ts';
const model = { id: 'gpt-6-sol', displayName: 'GPT-6 Sol', isDefault: true, supportedReasoningEfforts: [{ id: 'medium', description: '' }, { id: 'high', description: '' }], defaultReasoningEffort: 'medium', serviceTiers: [{ id: 'priority', name: 'Priority', description: '' }, { id: 'flex', name: 'Flex', description: '' }], defaultServiceTier: 'priority' };
const other = { id: 'gpt-6-luna', displayName: 'GPT-6 Luna', isDefault: false, supportedReasoningEfforts: [{ id: 'low', description: '' }], defaultReasoningEffort: 'low', serviceTiers: [] as Array<{ id: string; name: string; description: string }>, defaultServiceTier: null };
const settings = { ...baseSettings, model: 'gpt-6-sol' };
function fixture(options: { signedIn?: boolean; clipboard?: () => Promise<ClipboardImageRead>; workspaceSettings?: WorkspaceSettings; initialMessages?: Conversation['messages'] } = {}) {
  let runtime: RuntimeSnapshot = { revision: 0, runtime: 'ready', account: { state: options.signedIn === false ? 'signedOut' : 'signedIn' }, login: null, models: options.signedIn === false ? [] : [model], error: null };
  const observers = new Set<(s: RuntimeSnapshot) => void>(); const listeners = new Set<(e: ReaderEvent) => void>();
  let conversation: Conversation = { id: '2e4a6c8e-0b1d-4f3a-a5c7-9e1b3d5f7a90', paper: paperA, title: 'Synthetic Paper A', settings, activeRequestId: null, messages: options.initialMessages ?? [], lastSeq: 0, createdAt: 'now', updatedAt: 'now' };
  const conversations: Conversation[] = [];
  /**
   * One authoritative object per chat id, the way the real service keeps them: a chat the presenter
   * re-reads after an event must be the chat the event changed, not an earlier copy of it.
   */
  const remember = (next: Conversation): Conversation => {
    const index = conversations.findIndex(entry => entry.id === next.id);
    if (index >= 0) conversations[index] = next; else conversations.push(next);
    if (conversation.id === next.id) conversation = next;
    return next;
  };
  remember(conversation);
  const sent: SendInput[] = []; const cancelled: string[] = []; let seq = 0;
  const client: ReaderClient = {
    snapshot: () => structuredClone(runtime), observe: l => { observers.add(l); l(structuredClone(runtime)); return () => { observers.delete(l); }; },
    refreshAccount: async () => {}, startLogin: vi.fn(() => Promise.resolve({ loginId: 'login-1', authorizationUrl: 'https://auth.openai.com/authorize?x=1' })), cancelLogin: async () => {},
    current: vi.fn(() => Promise.resolve(structuredClone(conversation))), peekCurrent: vi.fn(() => Promise.resolve(structuredClone(conversation))), newConversation: vi.fn(() => {
      conversation = remember({ ...conversation, id: `aaaaaaaa-0000-4000-8000-${String(conversations.length + 1).padStart(12, '0')}`, messages: [], lastSeq: 0, activeRequestId: null, queuedRequestIds: [] });
      return Promise.resolve(structuredClone(conversation));
    }),
    list: () => Promise.resolve(conversations.map(c => structuredClone(c))),
    select: vi.fn((_paper, id: string) => {
      const found = conversations.find(entry => entry.id === id);
      if (!found) return Promise.reject(new ReaderError('NOT_FOUND', 'Unknown conversation'));
      conversation = found;
      return Promise.resolve(structuredClone(found));
    }),
    get: vi.fn((id: string) => {
      const found = conversations.find(entry => entry.id === id);
      if (!found) return Promise.reject(new ReaderError('NOT_FOUND', 'Unknown conversation'));
      return Promise.resolve(structuredClone(found));
    }),
    send: vi.fn((input: SendInput) => {
      sent.push(input);
      const target = conversations.find(entry => entry.id === input.conversationId) ?? conversation;
      // The store records the frozen mode with the user message; the presenter reads it back to
      // decide whether a completed answer's annotation plans are an Agent action.
      const user = { id: `u-${sent.length}`, requestId: input.requestId, role: 'user' as const, phase: null, settings: input.settings, text: input.question, citations: input.citations, status: 'completed' as const, ...(input.mode ? { mode: input.mode } : {}) };
      conversation = remember({ ...target, settings: input.settings, activeRequestId: input.requestId, messages: [...target.messages, user], lastSeq: ++seq });
      return Promise.resolve({ requestId: input.requestId, state: 'accepted' as const, replay: false });
    }),
    request: (_c, requestId) => {
      const message = conversation.messages.find(entry => entry.requestId === requestId);
      const state = message?.status === 'uncertain' ? 'uncertain' as const : message?.status === 'completed' ? 'completed' as const : 'running' as const;
      return Promise.resolve({ requestId, state, replay: false });
    }, cancel: vi.fn((_c: string, requestId: string) => { cancelled.push(requestId); return Promise.resolve({ requestId, state: 'running' as const, replay: false }); }),
    deleteConversation: vi.fn((_paper, id: string) => {
      const index = conversations.findIndex(entry => entry.id === id);
      if (index < 0) return Promise.reject(new ReaderError('NOT_FOUND', 'Unknown conversation'));
      conversations.splice(index, 1);
      if (conversation.id !== id) return Promise.resolve(structuredClone(conversation));
      // Like the real service: the remaining current chat, or null when the attachment has none left.
      const next = conversations[0];
      if (next) conversation = next;
      return Promise.resolve(next ? structuredClone(next) : null);
    }),
    diagnostics: vi.fn((): Promise<ShareableDiagnostics> => Promise.resolve({
      pluginVersion: '0.3.0-alpha.1', runtimeVersion: '0.144.1', errorCode: null, requestCount: 0, states: {},
      storageLocation: SHAREABLE_STORAGE_LOCATION,
    })),
    subscribe: l => { listeners.add(l); return () => { listeners.delete(l); }; }, close: async () => {},
    reconnect: vi.fn(() => Promise.resolve()),
  };
  const states: PresenterState[] = [];
  const workspace: ReaderWorkspace | undefined = options.workspaceSettings ? {
    settings: () => Promise.resolve(structuredClone(options.workspaceSettings!)), saveSettings: async () => {},
    saveSkill: skill => Promise.resolve(skill), importSkill: () => Promise.reject(new Error('unused')), deleteSkill: () => Promise.resolve(),
    saveDraft: () => Promise.resolve(), readDraft: () => Promise.resolve(null), deleteDraft: () => Promise.resolve(), history: () => Promise.resolve([]),
    readConversation: () => Promise.reject(new Error('unused')), currentConversation: () => Promise.resolve(null),
    snapshotChat: () => Promise.reject(new Error('unused')),
  } : undefined;
  const services = { client: vi.fn(() => Promise.resolve(client)), ensureAgent: vi.fn(() => Promise.resolve()), chatUnavailableReason: vi.fn<() => string | null>(() => null), openAuthorization: vi.fn(), uuid: (() => { let n = 0; return () => `9a1c3e5f-7b2d-4c6e-8f0a-${String(++n).padStart(12, '0')}`; })(), now: () => '2026-09-09T08:00:00.000Z', ...(options.clipboard ? { readClipboardImage: options.clipboard } : {}), ...(workspace ? { getWorkspace: () => Promise.resolve(workspace) } : {}) };
  const presenter = new ConversationPresenter(presenterContext(paperA, 'Synthetic Paper A'), services);
  const unbind = presenter.bind(state => states.push(state));
  type Pending = ReaderEvent extends infer E ? E extends ReaderEvent ? Omit<E, 'seq' | 'conversationId' | 'at'> : never : never;
  // `forId` targets a specific chat: a background answer belongs to the chat that asked for it, even
  // when another chat is the one on screen. The fixture keeps one authoritative object per id so a
  // later `select`/`get` of that chat returns what the event changed.
  const emit = (event: Pending, forId?: string) => {
    const id = forId ?? conversation.id;
    const full: ReaderEvent = { ...event, seq: ++seq, conversationId: id, at: 'now' };
    const patch = { lastSeq: seq, ...(['completed', 'cancelled', 'failed', 'uncertain'].includes(event.type) ? { activeRequestId: null } : {}) };
    const target = conversation.id === id ? conversation : conversations.find(entry => entry.id === id);
    if (target) { Object.assign(target, patch); store(target, event); }
    for (const l of listeners) l(full);
  };
  /**
   * The service stores what it announces: a chat read back after an event — because the owner switched
   * to it — comes back holding that event's text and status. Mirroring that here keeps the fixture
   * honest about what `select`/`get` answer once a chat has been in the background.
   */
  const store = (target: Conversation, event: Pending): void => {
    const messageId = 'messageId' in event && typeof event.messageId === 'string' ? event.messageId : null;
    if (event.type === 'delta' || event.type === 'messageCompleted') {
      let message = messageId ? target.messages.find(entry => entry.id === messageId) : undefined;
      if (!message) { message = { id: messageId ?? `m-${seq}`, requestId: event.requestId, role: 'assistant', phase: null, settings: target.settings, text: '', citations: [], status: 'streaming' }; target.messages.push(message); }
      if (event.type === 'delta') message.text += event.text;
      else { message.text = event.finalText; message.phase = event.phase; message.status = 'completed'; }
      return;
    }
    const settled: MessageStatus | null = event.type === 'completed' ? 'completed' : event.type === 'cancelled' || event.type === 'failed' || event.type === 'uncertain' ? event.type : null;
    if (settled) for (const entry of target.messages) if (entry.requestId === event.requestId && entry.role === 'assistant' && (entry.status === 'streaming' || entry.status === 'pending')) entry.status = settled;
  };
  const setRuntime = (patch: Partial<RuntimeSnapshot>) => { runtime = { ...runtime, ...patch, revision: runtime.revision + 1 }; for (const o of observers) o(structuredClone(runtime)); };
  return { presenter, states, sent, cancelled, client, services, emit, setRuntime, listeners, unbind, last: () => states.at(-1)!, conversation: () => conversation, setConversation: (c: Conversation) => { remember(c); } };
}
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 5));
/** New chat is only a tab until its first question is sent: this opens the tab and creates the record. */
async function startChat(f: ReturnType<typeof fixture>, question: string): Promise<string> {
  await f.presenter.newConversation();
  expect(f.last().conversation).toBeNull();
  f.presenter.setQuestion(question); await f.presenter.send();
  return f.last().conversation!.id;
}
describe('conversation presenter', () => {
  it('keeps an explicit Agent click made while the stored current chat is still loading', async () => {
    const f = fixture(); let resolve!: (conversation: Conversation) => void;
    const delayed = new Promise<Conversation>(done => { resolve = done; });
    vi.mocked(f.client.peekCurrent).mockImplementation(() => delayed);
    const activating = f.presenter.activate(); await vi.waitFor(() => expect(f.client.peekCurrent).toHaveBeenCalled());
    expect(f.presenter.snapshot().conversation).toBeNull(); expect(f.presenter.snapshot().mode).toBe('chat');
    f.presenter.setMode('agent'); resolve(structuredClone(f.conversation())); await activating;
    expect(f.presenter.snapshot().conversation?.id).toBe(f.conversation().id);
    expect(f.presenter.snapshot().mode).toBe('agent');
  });

  it('keeps the last mode click made while another saved conversation is being selected', async () => {
    const f = fixture(); await f.presenter.activate();
    const second = { ...f.conversation(), id: 'bbbbbbbb-0000-4000-8000-000000000099', title: 'Second saved chat' };
    f.setConversation(second); let resolve!: (conversation: Conversation) => void;
    const delayed = new Promise<Conversation>(done => { resolve = done; });
    vi.mocked(f.client.select).mockReturnValueOnce(delayed);
    const opening = f.presenter.openConversation(second.id); await vi.waitFor(() => expect(f.client.select).toHaveBeenCalledWith(paperA, second.id));
    f.presenter.setMode('agent'); resolve(structuredClone(second)); await opening;
    expect(f.presenter.snapshot().conversation?.id).toBe(second.id); expect(f.presenter.snapshot().mode).toBe('agent');
  });

  it('keeps two views of the same attachment consistent when either view closes', async () => {
    const f = fixture(); await f.presenter.activate();
    let first = ''; let second = '';
    const unbindFirst = f.presenter.bind(s => { first = s.draft.question; });
    const unbindSecond = f.presenter.bind(s => { second = s.draft.question; });
    f.presenter.setQuestion('Both windows'); expect(first).toBe('Both windows'); expect(second).toBe('Both windows');
    unbindFirst(); f.presenter.setQuestion('Second window'); expect(second).toBe('Second window'); expect(first).toBe('Both windows'); unbindSecond();
  });
  it('retry reconnects the shared client and keeps applying its events', async () => {
    const f = fixture(); await f.presenter.activate(); await f.presenter.explain(citationA); const requestId = f.sent[0]!.requestId;
    await f.presenter.retry();
    // Retry is an Agent action on the shared client: it reconnects that client instead of replacing it.
    expect(f.client.reconnect).toHaveBeenCalledTimes(1);
    expect(f.services.client).toHaveBeenCalledTimes(1);
    f.emit({ type: 'delta', requestId, messageId: 'a1', text: '重连' });
    expect(f.last().conversation?.messages.at(-1)?.text).toBe('重连');
  });
  it('keeps propagating state and never throws when one bound view fails', async () => {
    const f = fixture(); await f.presenter.activate();
    let seen = ''; let calls = 0;
    f.presenter.bind(() => { if (++calls > 1) throw new Error('/private/library/file.pdf'); });
    f.presenter.bind(s => { seen = s.draft.question; });
    expect(() => f.presenter.setQuestion('仍然更新')).not.toThrow();
    expect(seen).toBe('仍然更新');
  });
  it('advances request timing from core events and freezes it on a terminal event', async () => {
    const f = fixture();
    const requestId = '11111111-1111-4111-8111-111111111111';
    f.setConversation({ ...f.conversation(), activeRequestId: requestId, requestTiming: [{ requestId, acceptedAt: '2026-09-13T00:00:00.000Z', firstTextAt: null, settledAt: null }] });
    await f.presenter.activate();
    expect(f.last().conversation?.requestTiming?.[0]).toMatchObject({ firstTextAt: null, settledAt: null });
    f.emit({ type: 'delta', requestId, messageId: 'a1', text: '重连' });
    expect(f.last().conversation?.requestTiming?.[0]?.firstTextAt).toBe('now');
    f.emit({ type: 'completed', requestId, messageId: 'a1', finalText: '重连' });
    expect(f.last().conversation?.requestTiming?.[0]?.settledAt).toBe('now');
    // Re-delivered events keep the earliest stamps, so a settled request cannot start ticking again.
    f.emit({ type: 'delta', requestId, messageId: 'a1', text: ' and more' });
    expect(f.last().conversation?.requestTiming?.[0]).toMatchObject({ firstTextAt: 'now', settledAt: 'now' });
  });
  it('freezes the question, settings and conversation while PDF preparation is pending, and keeps newer input', async () => {
    const f = fixture(); let resolve!: (value: typeof documentA) => void;
    const prepare = () => new Promise<typeof documentA>(r => { resolve = r; });
    const presenter = new ConversationPresenter(presenterContext(paperA, 'Synthetic Paper A'), { ...f.services, document: { prepare, validate: async () => {}, readEnabled: () => true, writeEnabled: () => {} } });
    await presenter.activate(); presenter.setQuestion('Explain x');
    const pending = presenter.send(); await settle();
    expect(f.sent).toHaveLength(0); expect(presenter.snapshot().generating).toBe(true);
    presenter.setQuestion('Next question'); presenter.setSettings({ ...settings, effort: 'high' });
    resolve(documentA); await pending;
    expect(f.sent[0]).toMatchObject({ question: 'Explain x', settings, document: documentA });
    expect(presenter.snapshot().draft.question).toBe('Next question');
  });
  it('cancels PDF preparation without sending and preserves the question', async () => {
    const f = fixture();
    const presenter = new ConversationPresenter(presenterContext(paperA, 'A'), { ...f.services, document: {
      prepare: signal => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Preparation cancelled.')), { once: true })),
      validate: async () => {}, readEnabled: () => true, writeEnabled: () => {},
    } });
    await presenter.activate(); presenter.setQuestion('Keep this');
    const pending = presenter.send(); await settle(); await presenter.cancel(); await pending;
    expect(f.sent).toHaveLength(0); expect(presenter.snapshot().draft.question).toBe('Keep this');
    expect(presenter.snapshot().message).toMatch(/cancelled/iu);
  });
  it('prepares the current PDF locally on activation without creating a model request', async () => {
    const f = fixture();
    const prepare = vi.fn(() => Promise.resolve(documentA)); const validate = vi.fn(async () => {});
    const presenter = new ConversationPresenter(presenterContext(paperA, 'A'), { ...f.services, document: { prepare, validate, readEnabled: () => true, writeEnabled: () => {} } });
    await presenter.activate();
    await vi.waitFor(() => expect(presenter.snapshot().document.phase).toBe('ready'));
    expect(prepare).toHaveBeenCalledTimes(1); expect(validate).toHaveBeenCalledTimes(1);
    expect(presenter.snapshot().document.prepared).toEqual(documentA);
    expect(f.sent).toHaveLength(0);
  });
  it('does not start the local PDF read for a host-hosted Chat surface, and starts it on Agent', async () => {
    const f = fixture();
    const prepare = vi.fn(() => Promise.resolve(documentA)); const validate = vi.fn(async () => {});
    const presenter = new ConversationPresenter(presenterContext(paperA, 'A'), {
      ...f.services, chatHostedExternally: true,
      document: { prepare, validate, readEnabled: () => true, writeEnabled: () => {} },
    });
    await presenter.activate();
    // Chat mode is the hosted ChatGPT application: it sends nothing from this presenter, so the PDF
    // read that only a native Chat request needs is not started for a surface that is not rendered.
    expect(prepare).not.toHaveBeenCalled();
    expect(presenter.snapshot().document.phase).toBe('idle');
    presenter.setMode('agent');
    await vi.waitFor(() => expect(presenter.snapshot().document.phase).toBe('ready'));
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(f.sent).toHaveLength(0);
  });
  it('exports compact paper context for hosted Chat without preparing PDF pages or starting a request', async () => {
    const f = fixture();
    const prepare = vi.fn(() => Promise.resolve(documentA)); const validate = vi.fn(async () => {});
    const identity: PaperIdentity = {
      title: 'Synthetic Paper A', authors: ['Ada Lovelace'], itemType: 'journalArticle',
      publicationTitle: 'Journal of Synthetic Results', year: '2024', doi: '10.1000/synthetic',
      abstractNote: 'A stored abstract.',
    };
    const presenter = new ConversationPresenter(presenterContext(paperA, 'Synthetic Paper A', identity), {
      ...f.services, chatHostedExternally: true,
      document: { prepare, validate, readEnabled: () => true, writeEnabled: () => {} },
    });
    await presenter.activate();
    const brief = await presenter.exportDocumentBrief();
    expect(brief).toMatchObject({ ok: true, pages: 0, totalPages: 0, truncated: false });
    if (!brief.ok) throw new Error('expected a brief');
    expect(brief.text).toContain('Title: Synthetic Paper A');
    expect(brief.text).toContain('Abstract:\nA stored abstract.');
    expect(brief.text).not.toContain('Definition: x denotes the hidden state.');
    // Chat context comes from frozen bibliography fields and does not prepare a PDF read.
    expect(prepare).not.toHaveBeenCalled();
    expect(f.sent).toHaveLength(0);
  });
  it('reports missing bibliography instead of promising an empty brief', async () => {
    const f = fixture();
    const empty = { ...documentA, pages: documentA.pages.map(page => ({ ...page, text: '', status: 'empty' as const })) };
    const presenter = new ConversationPresenter(presenterContext(paperA, 'A'), {
      ...f.services, document: { prepare: () => Promise.resolve(empty), validate: async () => {}, readEnabled: () => true, writeEnabled: () => {} },
    });
    await presenter.activate();
    expect(await presenter.exportDocumentBrief()).toEqual({ ok: false, reason: 'no-text' });
    const disabled = new ConversationPresenter(presenterContext(paperA, 'A'), {
      ...f.services, document: { prepare: () => Promise.resolve(documentA), validate: async () => {}, readEnabled: () => false, writeEnabled: () => {} },
    });
    await disabled.activate();
    expect(await disabled.exportDocumentBrief()).toEqual({ ok: false, reason: 'no-text' });
  });
  it('reports a failed metadata read without touching the PDF', async () => {
    const f = fixture();
    const prepare = vi.fn(() => Promise.reject(new Error('The PDF could not be read.')));
    const presenter = new ConversationPresenter(presenterContext(paperA, 'A'), {
      ...f.services,
      readPaperIdentity: () => Promise.reject(new Error('The item could not be read.')),
      document: { prepare, validate: async () => {}, readEnabled: () => true, writeEnabled: () => {} },
    });
    await presenter.activate();
    const readsAfterActivate = prepare.mock.calls.length;
    expect(await presenter.exportDocumentBrief()).toEqual({ ok: false, reason: 'failed' });
    expect(prepare).toHaveBeenCalledTimes(readsAfterActivate);
    expect(f.sent).toHaveLength(0);
  });
  it('copies the paper bibliography without reading the PDF, and reads it by the frozen scope', async () => {
    const f = fixture();
    const prepare = vi.fn(() => Promise.resolve(documentA)); const validate = vi.fn(async () => {});
    const seen: string[] = [];
    const identity: PaperIdentity = {
      title: 'Synthetic Paper A', authors: ['Ada Lovelace'], itemType: 'journalArticle',
      publicationTitle: 'Journal of Synthetic Results', year: '2024', doi: 'https://doi.org/10.1000/synthetic',
      abstractNote: 'A stored abstract.',
    };
    const presenter = new ConversationPresenter(presenterContext(paperA, 'Synthetic Paper A'), {
      ...f.services, chatHostedExternally: true,
      document: { prepare, validate, readEnabled: () => true, writeEnabled: () => {} },
      readPaperIdentity: readScope => { seen.push(paperId(readScope)); return Promise.resolve(identity); },
    });
    await presenter.activate();
    const context = await presenter.exportPaperContext();
    expect(context).toMatchObject({ ok: true, hasAbstract: true });
    if (!context.ok) throw new Error('expected paper context');
    expect(context.text).toBe([
      'Title: Synthetic Paper A',
      'Authors: Ada Lovelace',
      'Publication: Journal of Synthetic Results',
      'Year: 2024',
      'DOI: 10.1000/synthetic',
      '',
      'Abstract:',
      'A stored abstract.',
    ].join('\n'));
    // The manual copy never reads the PDF: that is the automatic send's own path.
    expect(prepare).not.toHaveBeenCalled();
    expect(validate).not.toHaveBeenCalled();
    expect(seen).toEqual([paperId(paperA)]);
    expect(f.sent).toHaveLength(0);
  });
  it('refuses a bare PDF and reports an unreadable metadata read instead of copying a placeholder', async () => {
    const f = fixture();
    const bare = new ConversationPresenter(presenterContext(paperA, 'scan-0001.pdf'), { ...f.services, chatHostedExternally: true });
    await bare.activate();
    expect(await bare.exportPaperContext()).toEqual({ ok: false, reason: 'no-info' });
    const failing = new ConversationPresenter(presenterContext(paperA, 'Synthetic Paper A'), {
      ...f.services, chatHostedExternally: true,
      readPaperIdentity: () => Promise.reject(new Error('the item could not be read')),
    });
    await failing.activate();
    expect(await failing.exportPaperContext()).toEqual({ ok: false, reason: 'failed' });
  });
  it('keeps the frozen identity when the item is gone and never borrows another paper', async () => {
    const f = fixture();
    const frozen: PaperIdentity = { title: 'Frozen Paper', authors: ['Ada Lovelace'], itemType: 'journalArticle', publicationTitle: 'Frozen Journal' };
    const presenter = new ConversationPresenter(presenterContext(paperA, 'Frozen Paper', frozen), {
      ...f.services, chatHostedExternally: true,
      readPaperIdentity: () => Promise.resolve(null),
    });
    await presenter.activate();
    const context = await presenter.exportPaperContext();
    expect(context).toMatchObject({ ok: true });
    if (!context.ok) throw new Error('expected paper context');
    expect(context.text).toContain('Title: Frozen Paper');
    expect(context.text).toContain('Publication: Frozen Journal');
  });
  it('plans a send against the one core request-budget authority when no port is injected (R5)', async () => {
    const f = fixture();
    const presenter = new ConversationPresenter(presenterContext(paperA, 'A'), { ...f.services, document: { prepare: () => Promise.resolve(documentA), validate: async () => {}, readEnabled: () => true, writeEnabled: () => {} } });
    await presenter.activate(); presenter.setQuestion('What does x denote?'); await presenter.send();
    const request = f.sent[0]!;
    // The report the send carries must be the core estimate for that same request, not a second formula.
    // `planInput` estimates before adding its resulting report to the request, so remove that
    // generated metadata before independently checking the same core authority.
    const budgetRequest = { ...request }; delete budgetRequest.contextReport;
    const expected = estimateRequestBudget({ request: budgetRequest, messages: [] });
    expect(presenter.snapshot().contextReport).toMatchObject({ capacity: expected.capacity, provenance: expected.provenance, reservedTokens: expected.reservations.total, textBudgetTokens: expected.textBudgetTokens });
    expect(presenter.snapshot().contextReport?.reason).toContain('conservative estimate');
  });
  it('keeps PDF failures visible and never sends a bibliographic-only substitute', async () => {
    const f = fixture(); const presenter = new ConversationPresenter(presenterContext(paperA, 'A'), { ...f.services, document: {
      prepare: () => Promise.reject(new Error('PDF unavailable.')), validate: async () => {}, readEnabled: () => true, writeEnabled: () => {},
    } });
    await presenter.activate(); presenter.setQuestion('Keep this'); await presenter.send();
    expect(f.sent).toHaveLength(0); expect(presenter.snapshot().draft.question).toBe('Keep this'); expect(presenter.snapshot().message).toContain('PDF unavailable');
  });
  it('surfaces a failed background local read where the composer shows errors', async () => {
    // No panel renders document preparation any more, so a background failure that only set
    // `document.phase` was invisible: the owner saw nothing and could not tell why nothing was read.
    const f = fixture(); const presenter = new ConversationPresenter(presenterContext(paperA, 'A'), { ...f.services, document: {
      prepare: () => Promise.reject(new ReaderError('INVALID_REQUEST', 'The current PDF did not finish loading in time to read it locally. Wait for it to load or reopen it; your question is kept.')),
      validate: async () => {}, readEnabled: () => true, writeEnabled: () => {},
    } });
    await presenter.activate();
    await vi.waitFor(() => expect(presenter.snapshot().message).toMatch(/did not finish loading in time/iu));
    expect(presenter.snapshot().document.phase).toBe('error');
    expect(presenter.snapshot().message).not.toMatch(/changed/iu);
  });
  it('does not announce a background preparation the user cancelled by opting out', async () => {
    const f = fixture(); const presenter = new ConversationPresenter(presenterContext(paperA, 'A'), { ...f.services, document: {
      prepare: signal => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('PDF preparation cancelled. Your question is kept.')), { once: true })),
      validate: async () => {}, readEnabled: () => true, writeEnabled: () => {},
    } });
    await presenter.activate(); await settle();
    presenter.setDocumentEnabled(false); await settle();
    expect(presenter.snapshot().message).toBeNull();
    expect(presenter.snapshot().document.enabled).toBe(false);
  });
  it('honors automatic-context opt-out changed by another view before sending', async () => {
    const f = fixture(); let enabled = true;
    const presenter = new ConversationPresenter(presenterContext(paperA, 'A'), { ...f.services, document: {
      prepare: () => Promise.resolve(documentA), validate: async () => {}, readEnabled: () => enabled, writeEnabled: value => { enabled = value; },
    } });
    await presenter.activate(); enabled = false; presenter.setQuestion('Explicit selection only'); await presenter.send();
    expect(f.sent).toHaveLength(1); expect(f.sent[0]?.document).toBeUndefined();
  });
  it('new conversation starts with an empty draft and restores the old draft when selected again', async () => {
    const f = fixture(); await f.presenter.activate();
    const original = f.conversation().id;
    f.presenter.setQuestion('Original draft'); f.presenter.addCitation(citationA);
    await f.presenter.newConversation();
    expect(f.last().draft.question).toBe('');
    expect(f.last().draft.citations).toEqual([]);
    await f.presenter.openConversation(original);
    expect(f.last().draft.question).toBe('Original draft');
    expect(f.last().draft.citations).toEqual([citationA]);
  });
  it('closes the current chat without deleting it and starts a fresh chat on the next send', async () => {
    const f = fixture(); await f.presenter.activate();
    const original = f.last().conversation!.id;
    f.presenter.setQuestion('Kept draft'); f.presenter.addCitation(citationA);
    f.presenter.closeConversation();
    // Nothing is removed or confirmed: the chat stays in the list and on the client.
    expect(f.last().conversation).toBeNull();
    expect(f.client.deleteConversation).not.toHaveBeenCalled();
    expect(f.last().conversations.map(c => c.id)).toContain(original);
    // The pane is at the unbound empty draft, and the next request starts a fresh chat instead of
    // silently re-adopting the one that was closed.
    expect(f.last().draft.question).toBe('');
    expect(f.last().draft.citations).toEqual([]);
    f.presenter.setQuestion('Fresh question'); await f.presenter.send();
    expect(f.client.newConversation).toHaveBeenCalledTimes(1);
    expect(f.last().conversation?.id).not.toBe(original);
    expect(f.sent[0]?.conversationId).toBe(f.last().conversation!.id);
    // The closed chat reappears with its own draft when picked again.
    await f.presenter.openConversation(original);
    expect(f.last().conversation?.id).toBe(original);
    expect(f.last().draft.question).toBe('Kept draft');
    expect(f.last().draft.citations).toEqual([citationA]);
  });
  it('activates the attachment conversation and renders history without sending anything', async () => {
    const f = fixture(); f.setConversation({ ...f.conversation(), messages: [{ id: 'm1', requestId: 'r0', role: 'assistant', phase: 'final', settings, text: '旧回答', citations: [], status: 'completed' }], lastSeq: 4 });
    await f.presenter.activate();
    expect(f.last().conversation?.messages[0]?.text).toBe('旧回答'); expect(f.sent).toHaveLength(0); expect(f.client.peekCurrent).toHaveBeenCalledTimes(1);
    // Opening the dock adopts the stored chat but never creates one.
    expect(f.client.current).not.toHaveBeenCalled(); expect(f.client.newConversation).not.toHaveBeenCalled();
    expect(f.last().draft.settings).toEqual(settings);
  });
  it('Ask only adds a deduplicated removable citation to the draft; sending creates one ask request and clears the draft', async () => {
    const f = fixture(); await f.presenter.activate();
    f.presenter.addCitation(citationA); f.presenter.addCitation({ ...citationA }); f.presenter.addCitation({ ...citationA, id: '7d6f2a10-5c1e-4b7a-9e3f-2f9c1a8b4d99', text: '另一段' });
    expect(f.last().draft.citations).toHaveLength(2); expect(f.sent).toHaveLength(0);
    f.presenter.removeCitation('7d6f2a10-5c1e-4b7a-9e3f-2f9c1a8b4d99'); expect(f.last().draft.citations).toHaveLength(1);
    f.presenter.setQuestion('   '); await f.presenter.send(); expect(f.sent).toHaveLength(0); expect(f.last().message).toBeTruthy();
    f.presenter.setQuestion('这里的先验指什么？'); await f.presenter.send();
    expect(f.sent).toHaveLength(1); expect(f.sent[0]).toMatchObject({ action: 'ask', question: '这里的先验指什么？', citations: [citationA], settings, conversationId: f.conversation().id });
    expect(f.last().draft.question).toBe(''); expect(f.last().draft.citations).toHaveLength(0);
    expect(f.last().conversation?.messages.at(-1)).toMatchObject({ role: 'user', text: '这里的先验指什么？' });
  });
  it('keeps pending images on the draft and sends them as an ask image part', async () => {
    const f = fixture(); await f.presenter.activate();
    f.presenter.addImage(imageA);
    f.presenter.addImage({ ...imageA });
    expect(f.last().draft.images).toHaveLength(1);
    f.presenter.removeImage(imageA.id);
    expect(f.last().draft.images).toHaveLength(0);
    f.presenter.addImage(imageA);
    f.presenter.setQuestion('图里的符号是什么？');
    await f.presenter.send();
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]).toMatchObject({ action: 'ask', question: '图里的符号是什么？', images: [imageA] });
    expect(f.last().draft.images).toHaveLength(0);
    expect(f.last().draft.question).toBe('');
  });
  it('More details submits exactly one explain request with the default question and keeps the draft', async () => {
    const f = fixture(); await f.presenter.activate(); f.presenter.setQuestion('草稿中的问题'); f.presenter.addCitation(citationB);
    await Promise.all([f.presenter.explain(citationA), f.presenter.explain(citationA)]);
    expect(f.sent).toHaveLength(1); expect(f.sent[0]).toMatchObject({ action: 'explain', citations: [citationA] });
    expect(f.sent[0]!.question).toBe('tell me more about this');
    expect(f.sent[0]!.question).not.toMatch(/请用中文解释/u);
    expect(f.last().draft.question).toBe('草稿中的问题'); expect(f.last().draft.citations).toEqual([citationB]);
  });
  it('a direct More details call in Chat mode never starts or borrows the Agent runtime', async () => {
    const f = fixture(); f.services.chatUnavailableReason.mockReturnValue('Hosted Chat owns this action.');
    await f.presenter.activate();
    await f.presenter.explain(citationA);
    expect(f.presenter.snapshot().mode).toBe('chat');
    expect(f.sent).toHaveLength(0);
    expect(f.services.ensureAgent).not.toHaveBeenCalled();
    expect(f.last().message).toBe('Hosted Chat owns this action.');
  });
  it('attaches bibliographic paper identity on ask even without a citation', async () => {
    const f = fixture(); await f.presenter.activate();
    f.presenter.setQuestion('这篇在讲什么方向？');
    await f.presenter.send();
    expect(f.sent[0]).toMatchObject({
      action: 'ask', question: '这篇在讲什么方向？', citations: [],
      paper: { title: 'Synthetic Paper A' },
    });
    expect(f.sent[0]!.paper?.title).toBeTruthy();
  });
  it('deletes a completed conversation and falls back without issuing a cancellation', async () => {
    const f = fixture(); await f.presenter.activate();
    const firstId = f.last().conversation!.id;
    // The first chat holds a completed turn, so New chat has to create a second one.
    f.presenter.setQuestion('第一问'); await f.presenter.send();
    f.emit({ type: 'messageCompleted', requestId: f.sent[0]!.requestId, messageId: 'reply-one', finalText: 'done', phase: 'final' });
    f.emit({ type: 'completed', requestId: f.sent[0]!.requestId, messageId: 'reply-one', finalText: 'done' });
    await f.presenter.newConversation();
    // The New chat tab is not a record yet; the first question creates it.
    expect(f.last().conversation).toBeNull(); expect(f.client.newConversation).not.toHaveBeenCalled();
    f.presenter.setQuestion('第二问'); await f.presenter.send();
    const secondId = f.last().conversation!.id;
    expect(secondId).not.toBe(firstId); expect(f.client.newConversation).toHaveBeenCalledTimes(1);
    expect(f.last().generating).toBe(true);
    f.emit({ type: 'completed', requestId: f.sent[1]!.requestId, messageId: 'reply', finalText: 'done' });
    await f.presenter.deleteConversation(secondId);
    expect(f.client.deleteConversation).toHaveBeenCalledWith(paperA, secondId);
    expect(f.cancelled).toEqual([]);
    expect(f.last().conversation?.id).toBe(firstId);
    expect(f.last().conversations.map(c => c.id)).not.toContain(secondId);
  });
  it('applies streamed events after the snapshot by seq, ignores other conversations and shows terminal states', async () => {
    const f = fixture(); await f.presenter.activate(); await f.presenter.explain(citationA); const requestId = f.sent[0]!.requestId;
    f.emit({ type: 'delta', requestId, messageId: 'a1', text: '先验' }); f.emit({ type: 'delta', requestId, messageId: 'a1', text: '是' });
    for (const l of f.listeners) l({ type: 'delta', requestId, messageId: 'zzz', text: 'B 的内容', seq: 99, conversationId: 'other-conversation', at: 'now' });
    expect(f.last().conversation?.messages.at(-1)).toMatchObject({ id: 'a1', role: 'assistant', text: '先验是', status: 'streaming' });
    expect(JSON.stringify(f.last().conversation)).not.toContain('B 的内容');
    f.emit({ type: 'messageCompleted', requestId, messageId: 'a1', finalText: '先验是初始信念。', phase: 'final' });
    f.emit({ type: 'completed', requestId, messageId: 'a1', finalText: '先验是初始信念。' });
    expect(f.last().conversation?.messages.at(-1)).toMatchObject({ text: '先验是初始信念。', status: 'completed', phase: 'final' }); expect(f.last().conversation?.activeRequestId).toBeNull(); expect(f.last().generating).toBe(false);
    await f.presenter.explain(citationA); const second = f.sent[1]!.requestId;
    f.emit({ type: 'failed', requestId: second, code: 'RATE_LIMITED', message: 'The ChatGPT usage limit for this account has been reached.' });
    expect(f.last().message).toContain('usage limit'); expect(f.last().generating).toBe(false);
  });
  it('rebinding a view replays from a fresh snapshot without duplicating increments', async () => {
    const f = fixture(); await f.presenter.activate(); await f.presenter.explain(citationA); const requestId = f.sent[0]!.requestId;
    f.emit({ type: 'delta', requestId, messageId: 'a1', text: '第一段' });
    f.unbind();
    // While no view is bound the service keeps generating and its snapshot advances.
    f.setConversation({ ...f.conversation(), messages: f.conversation().messages.map(m => m.id === 'a1' ? { ...m, text: '第一段第二段' } : m) });
    const states: PresenterState[] = []; f.presenter.bind(s => states.push(s)); await settle();
    f.emit({ type: 'delta', requestId, messageId: 'a1', text: '第三段' });
    expect(states.at(-1)?.conversation?.messages.at(-1)?.text).toBe('第一段第二段第三段');
    expect(states.at(-1)?.draft).toBeTruthy();
  });
  it('while remount waits for get(), only events newer than that snapshot are applied', async () => {
    const f = fixture(); await f.presenter.activate(); await f.presenter.explain(citationA); const requestId = f.sent[0]!.requestId;
    const snapshotLastSeq = 7;
    const snapshot = {
      ...f.conversation(), lastSeq: snapshotLastSeq,
      messages: [...f.conversation().messages, { id: 'a1', requestId, role: 'assistant' as const, phase: null, settings, text: '已在快照', citations: [], status: 'streaming' as const }],
    };
    let resolveGet!: (value: Conversation) => void;
    const pendingGet = new Promise<Conversation>(resolve => { resolveGet = resolve; });
    (f.client.get as ReturnType<typeof vi.fn>).mockReturnValueOnce(pendingGet);
    f.unbind();
    const states: PresenterState[] = []; f.presenter.bind(s => states.push(s));
    await Promise.resolve();
    for (const listener of f.listeners) {
      listener({ type: 'delta', requestId, messageId: 'a1', text: '重复', seq: snapshotLastSeq, conversationId: snapshot.id, at: 'now' });
      listener({ type: 'delta', requestId, messageId: 'a1', text: '新增量', seq: snapshotLastSeq + 1, conversationId: snapshot.id, at: 'now' });
    }
    resolveGet(structuredClone(snapshot));
    await settle();
    expect(states.at(-1)?.conversation?.messages.at(-1)?.text).toBe('已在快照新增量');
    expect(states.at(-1)?.conversation?.lastSeq).toBe(snapshotLastSeq + 1);
  });
  it('stop asks the service to cancel the active request and only the terminal event ends the generating state', async () => {
    const f = fixture(); await f.presenter.activate(); await f.presenter.explain(citationA); expect(f.last().generating).toBe(true);
    await f.presenter.cancel(); expect(f.cancelled).toEqual([f.sent[0]!.requestId]); expect(f.last().generating).toBe(true);
    f.emit({ type: 'cancelled', requestId: f.sent[0]!.requestId, messageId: null }); expect(f.last().generating).toBe(false);
  });
  it('when signed out, More details keeps the citation, opens the official login and resumes that single explain after login', async () => {
    const f = fixture({ signedIn: false }); await f.presenter.activate();
    // Local restore is Codex-independent: the stored chat is shown before any sign-in.
    expect(f.last().conversation).not.toBeNull(); expect(f.client.current).not.toHaveBeenCalled();
    f.presenter.setMode('agent');
    await f.presenter.explain(citationA);
    expect(f.sent).toHaveLength(0); expect(f.services.openAuthorization).toHaveBeenCalledWith('https://auth.openai.com/authorize?x=1'); expect(f.last().pendingExplain?.id).toBe(citationA.id);
    f.setRuntime({ account: { state: 'signedIn', displayLabel: 'ChatGPT' }, models: [model] }); await settle();
    f.setRuntime({ revision: 99 }); await settle();
    expect(f.sent).toHaveLength(1); expect(f.sent[0]).toMatchObject({ action: 'explain', citations: [citationA] }); expect(f.last().pendingExplain).toBeNull();
  });
  it('does not resume a pending Agent explanation after that presenter switches to Chat', async () => {
    const f = fixture({ signedIn: false }); await f.presenter.activate(); f.presenter.setMode('agent');
    await f.presenter.explain(citationA); expect(f.last().pendingExplain?.id).toBe(citationA.id);
    f.presenter.setMode('chat');
    expect(f.last().pendingExplain).toBeNull(); expect(f.last().draft.citations).toEqual([citationA]);
    const second = new ConversationPresenter(presenterContext(paperA, 'Synthetic Paper A'), f.services); await second.activate(); second.setMode('agent');
    f.setRuntime({ account: { state: 'signedIn', displayLabel: 'ChatGPT' }, models: [model] }); await settle();
    expect(f.sent).toHaveLength(0); expect(f.presenter.snapshot().mode).toBe('chat'); expect(f.presenter.snapshot().draft.citations).toEqual([citationA]);
    second.dispose();
  });
  it('Ask while signed out stores the citation and waits for the user even after login', async () => {
    const f = fixture({ signedIn: false }); await f.presenter.activate(); f.presenter.addCitation(citationA);
    f.setRuntime({ account: { state: 'signedIn', displayLabel: 'ChatGPT' }, models: [model] }); await settle();
    expect(f.sent).toHaveLength(0); expect(f.last().draft.citations).toEqual([citationA]); expect(f.last().conversation).not.toBeNull();
  });
  it('surfaces business errors from send without losing the draft and lets the user start a new conversation', async () => {
    const f = fixture(); await f.presenter.activate();
    (f.client.send as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new ReaderError('BUSY', 'An earlier request in this conversation could not be confirmed; start a new conversation to continue.'));
    f.presenter.addCitation(citationA); f.presenter.setQuestion('问题'); await f.presenter.send();
    expect(f.last().message).toContain('new conversation'); expect(f.last().draft.question).toBe('问题'); expect(f.last().draft.citations).toEqual([citationA]);
    const original = f.last().conversation!.id;
    await f.presenter.newConversation(); expect(f.client.newConversation).not.toHaveBeenCalled(); expect(f.last().conversation).toBeNull(); expect(f.last().draft.citations).toEqual([]);
    f.presenter.setQuestion('新问题'); await f.presenter.send();
    expect(f.client.newConversation).toHaveBeenCalledTimes(1); expect(f.last().conversation?.id).toBe('aaaaaaaa-0000-4000-8000-000000000002');
    await f.presenter.openConversation(original); expect(f.last().draft.citations).toEqual([citationA]); expect(f.last().draft.question).toBe('问题');
  });
  it('reports a runtime start failure and allows a deliberate retry', async () => {
    const f = fixture(); f.services.client.mockRejectedValueOnce(new Error('Unable to prepare the bundled Codex runtime'));
    await f.presenter.activate(); expect(f.last().connection).toBe('error'); expect(f.last().message).toContain('Unable to prepare');
    await f.presenter.retry(); expect(f.last().connection).toBe('ready'); expect(f.last().conversation).not.toBeNull();
  });
  it('unbinding stops rendering but the presenter keeps its draft for the next view', async () => {
    const f = fixture(); await f.presenter.activate(); f.presenter.addCitation(citationA); const count = f.states.length;
    f.unbind(); f.presenter.setQuestion('later'); expect(f.states).toHaveLength(count);
    const states: PresenterState[] = []; f.presenter.bind(s => states.push(s)); expect(states[0]?.draft.question).toBe('later'); expect(states[0]?.draft.citations).toEqual([citationA]);
  });
  it('setSettings only changes the unsent draft; More details and Ask send that combo, not conversation.settings', async () => {
    const f = fixture(); await f.presenter.activate();
    f.setRuntime({ models: [model, other] });
    f.presenter.setSettings({ model: 'gpt-6-luna', serviceTier: 'priority', effort: 'medium' });
    expect(f.last().draft.settings).toEqual({ model: 'gpt-6-luna', serviceTier: null, effort: 'low' });
    expect(f.last().conversation?.settings).toEqual(settings); expect(f.sent).toHaveLength(0);
    await f.presenter.explain(citationA);
    expect(f.sent[0]?.settings).toEqual({ model: 'gpt-6-luna', serviceTier: null, effort: 'low' });
    expect(f.last().conversation?.messages[0]?.settings).toEqual({ model: 'gpt-6-luna', serviceTier: null, effort: 'low' });
  });
  it('constrains active composer and Agent sends to Preferences while keeping legacy message settings readable', async () => {
    const workspaceSettings: WorkspaceSettings = {
      ...defaultSettings(), allowedModels: [{ id: 'gpt-6-luna', name: 'GPT-6 Luna' }],
    };
    const legacySettings = { ...settings, model: 'gpt-5.6-sol' };
    const f = fixture({ workspaceSettings, initialMessages: [{ id: 'legacy-user', requestId: 'legacy-request', role: 'user', phase: null, settings: legacySettings, text: 'Previously saved with old model', citations: [], status: 'completed' }] }); await f.presenter.activate();
    f.setRuntime({ models: [model, other] });
    f.presenter.setSettings({ model: 'gpt-6-sol', serviceTier: 'flex', effort: 'high' });
    expect(f.last().draft.settings).toEqual({ model: 'gpt-6-luna', serviceTier: null, effort: 'low' });
    expect(f.last().conversation?.settings).toEqual(settings);
    f.presenter.setMode('agent');
    f.presenter.setQuestion('Use the selected model'); await f.presenter.send();
    expect(f.sent[0]?.settings).toEqual({ model: 'gpt-6-luna', serviceTier: null, effort: 'low' });
    expect(f.last().conversation?.messages[0]?.settings).toEqual(legacySettings);
    expect(f.last().conversation?.messages.at(-1)?.settings).toEqual({ model: 'gpt-6-luna', serviceTier: null, effort: 'low' });
  });
  it('refreshes the live model allowlist and unsent draft while preserving an in-flight model snapshot', async () => {
    const initial: WorkspaceSettings = { ...defaultSettings(), allowedModels: [{ id: 'gpt-6-sol', name: 'GPT-6 Sol' }] };
    const f = fixture({ workspaceSettings: initial }); let resolve!: (value: typeof documentA) => void;
    const prepare = () => new Promise<typeof documentA>(done => { resolve = done; });
    const presenter = new ConversationPresenter(presenterContext(paperA, 'Synthetic Paper A'), {
      ...f.services,
      document: { prepare, validate: async () => {}, readEnabled: () => true, writeEnabled: () => {} },
    });
    await presenter.activate();
    f.setRuntime({ models: [model, other] });
    presenter.setMode('agent'); presenter.setQuestion('Keep the request frozen');
    const sending = presenter.send(); await settle();
    expect(presenter.snapshot().generating).toBe(true);

    const updated: WorkspaceSettings = { ...initial, allowedModels: [{ id: 'gpt-6-luna', name: 'GPT-6 Luna' }] };
    presenter.refreshWorkspaceSettings(updated);
    expect(presenter.snapshot().workspace?.allowedModels).toEqual(updated.allowedModels);
    expect(presenter.snapshot().draft.settings?.model).toBe('gpt-6-luna');

    resolve(documentA); await sending;
    expect(f.sent[0]?.settings.model).toBe('gpt-6-sol');
    expect(presenter.snapshot().draft.settings?.model).toBe('gpt-6-luna');
  });
  it('changing controls while generating leaves the in-flight snapshot alone and applies only to the next send', async () => {
    const f = fixture(); await f.presenter.activate();
    f.setRuntime({ models: [model, other] });
    f.presenter.setQuestion('第一问'); await f.presenter.send();
    const frozen = f.last().conversation!.messages[0]!.settings;
    expect(frozen).toEqual(settings); expect(f.last().generating).toBe(true);
    f.presenter.setSettings({ model: 'gpt-6-sol', serviceTier: 'flex', effort: 'high' });
    expect(f.last().conversation?.messages[0]?.settings).toEqual(frozen);
    expect(f.last().draft.settings).toEqual({ model: 'gpt-6-sol', serviceTier: 'flex', effort: 'high' });
    f.emit({ type: 'completed', requestId: f.sent[0]!.requestId, messageId: 'a1', finalText: '答' });
    f.presenter.setQuestion('追问'); await f.presenter.send();
    expect(f.sent[1]?.settings).toEqual({ model: 'gpt-6-sol', serviceTier: 'flex', effort: 'high' });
    expect(f.last().conversation?.messages[0]?.settings).toEqual(frozen);
    expect(f.client.newConversation).not.toHaveBeenCalled();
  });
  it('shows that an unreconciled conversation stays isolated until the user starts a new one', async () => {
    const f = fixture();
    const originalId = f.conversation().id;
    f.setConversation({
      ...f.conversation(),
      messages: [
        { id: 'u1', requestId: 'r-old', role: 'user', phase: null, settings, text: '解释这段', citations: [citationA], status: 'completed' },
        { id: 'a1', requestId: 'r-old', role: 'assistant', phase: null, settings, text: '', citations: [], status: 'uncertain' },
      ],
    });
    await f.presenter.activate();
    expect(f.last().message).toContain('new conversation');
    expect(f.last().generating).toBe(false);
    expect(f.last().conversation?.id).toBe(originalId);
    await f.presenter.newConversation();
    expect(f.last().conversation).toBeNull();
    expect(f.last().message).toBeNull();
    // The isolated chat is left behind by sending from the New chat tab, which creates the new record.
    f.presenter.setQuestion('新问题'); await f.presenter.send();
    expect(f.last().conversation?.id).not.toBe(originalId);
    expect(f.client.newConversation).toHaveBeenCalledTimes(1);
    await f.presenter.openConversation(originalId);
    expect(f.last().conversation?.id).toBe(originalId);
    expect(f.last().message).toContain('new conversation');
  });
  it('lists this attachment’s conversations and restores an independent draft when switching', async () => {
    const f = fixture(); await f.presenter.activate();
    const firstId = f.last().conversation!.id;
    f.presenter.addCitation(citationA); f.presenter.setQuestion('关于先验');
    await f.presenter.newConversation();
    expect(f.last().conversation).toBeNull();
    expect(f.last().draft.question).toBe('');
    expect(f.last().conversations.map(c => c.id)).toEqual([firstId]);
    f.presenter.setQuestion('第二个对话'); await f.presenter.send();
    const secondId = f.last().conversation!.id;
    expect(secondId).not.toBe(firstId);
    expect(f.last().conversations.map(c => c.id)).toEqual([firstId, secondId]);
    f.presenter.setQuestion('新对话的问题'); f.presenter.removeCitation(citationA.id);
    await f.presenter.openConversation(firstId);
    expect(f.last().conversation?.id).toBe(firstId);
    expect(f.last().draft.question).toBe('关于先验');
    expect(f.last().draft.citations).toEqual([citationA]);
    await f.presenter.openConversation(secondId);
    expect(f.last().conversation?.id).toBe(secondId);
    expect(f.last().draft.question).toBe('新对话的问题');
    expect(f.last().draft.citations).toEqual([]);
  });
  it('keeps the chat on screen open when a new chat starts and applies a background answer to the chat that asked', async () => {
    const f = fixture(); await f.presenter.activate();
    const firstId = f.last().conversation!.id;
    f.presenter.setQuestion('第一问'); await f.presenter.send();
    const requestId = f.sent[0]!.requestId;
    await f.presenter.newConversation();
    // The New chat tab keeps the first chat open beside it while it is still only a tab.
    expect(f.last().conversation).toBeNull();
    expect(f.last().openConversations.map(c => c.id)).toEqual([firstId]);
    f.presenter.setQuestion('第二问'); await f.presenter.send();
    const secondId = f.last().conversation!.id;
    expect(secondId).not.toBe(firstId);
    // Starting a chat no longer replaces what is on screen: both chats are open, the new one active.
    expect(f.last().openConversations.map(c => c.id)).toEqual([firstId, secondId]);
    expect(f.last().conversation?.id).toBe(secondId);
    expect(f.last().openConversations.find(c => c.id === firstId)?.messages.map(message => message.text)).toEqual(['第一问']);
    // The first chat's answer arrives while the second chat is on screen. It must reach the chat that
    // asked for it, and must never be appended to the transcript on screen.
    f.emit({ type: 'messageCompleted', requestId, messageId: 'reply-one', finalText: '第一答', phase: 'final' }, firstId);
    f.emit({ type: 'completed', requestId, messageId: 'reply-one', finalText: '第一答' }, firstId);
    expect(f.last().conversation?.id).toBe(secondId);
    expect(f.last().conversation?.messages.map(message => message.text)).toEqual(['第二问']);
    expect(f.last().openConversations.find(c => c.id === firstId)?.messages.map(message => message.text)).toEqual(['第一问', '第一答']);
    // Switching to it shows the answer that arrived in the background, and the streamed text is gone
    // from the chat that was on screen.
    await f.presenter.openConversation(firstId);
    expect(f.last().conversation?.id).toBe(firstId);
    expect(f.last().conversation?.messages.map(message => message.text)).toEqual(['第一问', '第一答']);
    expect(f.last().openConversations.map(c => c.id)).toEqual([firstId, secondId]);
  });
  it('remembers each open chat’s reading anchor when switching tabs', async () => {
    const f = fixture(); await f.presenter.activate();
    const firstId = f.last().conversation!.id;
    f.presenter.setScrollTop(320);
    const secondId = await startChat(f, '第二问');
    f.presenter.setScrollTop(40);
    expect(f.last().scrollTop).toBe(40);
    await f.presenter.openConversation(firstId);
    expect(f.last().conversation?.id).toBe(firstId);
    expect(f.last().scrollTop).toBe(320);
    await f.presenter.openConversation(secondId);
    expect(f.last().scrollTop).toBe(40);
  });
  it('closing one open chat falls back to another open chat instead of blanking the reader', async () => {
    const f = fixture(); await f.presenter.activate();
    const firstId = f.last().conversation!.id;
    f.presenter.setQuestion('保留的草稿'); f.presenter.addCitation(citationA);
    const secondId = await startChat(f, '第二问');
    f.presenter.setQuestion('第二个对话');
    // Closing the active chat leaves the reader on the other open chat, with that chat's own draft.
    expect(f.presenter.closePane(secondId)).toBe(false);
    expect(f.last().conversation?.id).toBe(firstId);
    expect(f.last().openConversations.map(c => c.id)).toEqual([firstId]);
    expect(f.last().draft.question).toBe('保留的草稿');
    expect(f.last().draft.citations).toEqual([citationA]);
    // Switching back restores the closed chat's draft: closing a pane neither deleted nor rewrote it.
    await f.presenter.openConversation(secondId);
    expect(f.last().draft.question).toBe('第二个对话');
    expect(f.client.deleteConversation).not.toHaveBeenCalled();
  });
  it('closing the last open chat keeps the reader in its new-chat state', async () => {
    const f = fixture(); await f.presenter.activate();
    const firstId = f.last().conversation!.id;
    const secondId = await startChat(f, '第二问');
    expect(f.presenter.closePane(secondId)).toBe(false);
    expect(f.presenter.closeConversation()).toBe(false);
    expect(f.last().conversation).toBeNull();
    expect(f.last().openConversations).toEqual([]);
    expect(f.last().draft.question).toBe('');
    // The stored pointer is not re-adopted; the chats stay listed and openable.
    expect(f.last().conversations.map(c => c.id)).toEqual([firstId, secondId]);
    // Closing the New chat tab with nothing else open is a no-op; with another tab open it returns there.
    expect(f.presenter.closeConversation()).toBe(false);
    await f.presenter.openConversation(firstId);
    await f.presenter.newConversation();
    expect(f.last().conversation).toBeNull(); expect(f.last().openConversations.map(c => c.id)).toEqual([firstId]);
    expect(f.presenter.closeConversation()).toBe(false);
    expect(f.last().conversation?.id).toBe(firstId);
    expect(f.last().newChatOpen).toBe(false);
  });
  it('normalizes a blank or reversed page range instead of preparing an impossible slice', async () => {
    const f = fixture(); await f.presenter.activate();
    expect(f.last().document.range).toBeNull();
    f.presenter.setDocumentRange(5, 2);
    expect(f.last().document.range).toEqual([2, 5]);
    f.presenter.setDocumentRange(Number(''), Number(''));
    expect(f.last().document.range).toBeNull();
    f.presenter.setDocumentRange(3, null);
    expect(f.last().document.range).toEqual([3, 3]);
    f.presenter.setDocumentRange(1.7, 4.2);
    expect(f.last().document.range).toEqual([1, 4]);
  });
  it('New chat is a tab, not a record: nothing is created until the first question is sent', async () => {
    const f = fixture(); await f.presenter.activate();
    const firstId = f.last().conversation!.id;
    f.presenter.setQuestion('第一个草稿');
    await f.presenter.newConversation();
    // Pressing `+` opens the New chat tab with the unbound draft; the first chat stays open beside it.
    expect(f.client.newConversation).not.toHaveBeenCalled();
    expect(f.last().conversation).toBeNull();
    expect(f.last().newChatOpen).toBe(true);
    expect(f.last().openConversations.map(c => c.id)).toEqual([firstId]);
    expect(f.last().draft.question).toBe('');
    // Repeated presses are a no-op, and typing in the tab still creates nothing.
    f.presenter.setQuestion('新问题');
    await f.presenter.newConversation();
    expect(f.client.newConversation).not.toHaveBeenCalled();
    expect(f.last().draft.question).toBe('新问题');
    // Leaving the tab keeps it in the strip and keeps its draft as the unbound draft.
    await f.presenter.openConversation(firstId);
    expect(f.last().conversation?.id).toBe(firstId);
    expect(f.last().newChatOpen).toBe(true);
    expect(f.last().draft.question).toBe('第一个草稿');
    await f.presenter.newConversation();
    expect(f.last().draft.question).toBe('新问题');
    // Sending is what creates the record, and the chat that asked becomes the active tab.
    await f.presenter.send();
    expect(f.client.newConversation).toHaveBeenCalledTimes(1);
    const secondId = f.last().conversation!.id;
    expect(secondId).not.toBe(firstId);
    expect(f.sent[0]?.conversationId).toBe(secondId);
    expect(f.last().openConversations.map(c => c.id)).toEqual([firstId, secondId]);
    expect(f.last().conversations.map(c => c.id)).toEqual([firstId, secondId]);
    expect(f.last().newChatOpen).toBe(false);
  });
  it('removes leftover empty records on open so history only counts chats the owner can see', async () => {
    const f = fixture();
    // Two stored records with nothing in them beside the adopted one: an older build created them on open.
    f.setConversation({ ...f.conversation(), id: 'cccccccc-0000-4000-8000-000000000001', title: 'Synthetic Paper A', messages: [] });
    f.setConversation({ ...f.conversation(), id: 'cccccccc-0000-4000-8000-000000000002', title: 'Synthetic Paper A', messages: [{ id: 'm1', requestId: 'r0', role: 'user', phase: null, settings, text: '有内容', citations: [], status: 'completed' }] });
    await f.presenter.activate();
    const adopted = f.last().conversation!.id;
    // The empty record that is not on screen is gone; the chat with a message and the adopted chat stay.
    expect(f.client.deleteConversation).toHaveBeenCalledTimes(1);
    expect(f.client.deleteConversation).toHaveBeenCalledWith(paperA, 'cccccccc-0000-4000-8000-000000000001');
    expect(f.last().conversations.map(c => c.id).sort()).toEqual([adopted, 'cccccccc-0000-4000-8000-000000000002'].sort());
  });
  it('starts a fresh chat instead of re-adopting the chat that was just closed', async () => {
    const f = fixture(); await f.presenter.activate();
    const closedId = f.last().conversation!.id;
    f.presenter.closeConversation();
    expect(f.last().conversation).toBeNull();
    f.presenter.setQuestion('新问题'); await f.presenter.send();
    expect(f.client.newConversation).toHaveBeenCalledTimes(1);
    expect(f.client.current).not.toHaveBeenCalled();
    expect(f.last().conversation?.id).not.toBe(closedId);
  });
  it('copyDiagnostics serializes whitelist fields and never includes citation text', async () => {
    const f = fixture();
    const report: ShareableDiagnostics = {
      pluginVersion: '0.3.0-alpha.1',
      runtimeVersion: '0.144.1',
      errorCode: 'RATE_LIMITED' as const,
      requestCount: 2,
      states: { completed: 1, uncertain: 1 },
      storageLocation: SHAREABLE_STORAGE_LOCATION,
    };
    f.client.diagnostics = vi.fn(() => Promise.resolve(report));
    f.setConversation({
      ...f.conversation(),
      messages: [{ id: 'm1', requestId: 'r1', role: 'user', phase: null, settings, text: citationA.text, citations: [citationA], status: 'completed' }],
    });
    await f.presenter.activate();
    const text = await f.presenter.copyDiagnostics();
    expect(JSON.parse(text!)).toEqual(report);
    expect(text).not.toContain(citationA.text);
    expect(text).not.toMatch(/\/Users|token|private@/i);
    expect(f.last().message).toContain('do not include paper text');
    expect(f.client.diagnostics).toHaveBeenCalledWith(f.conversation().id);
  });
});

describe('clipboard paste', () => {
  it('reads pasted images from the privileged clipboard when the host provides one', async () => {
    const f = fixture({ clipboard: () => Promise.resolve({ images: [imageA] }) });
    await f.presenter.activate();
    expect(await f.presenter.clipboardImage()).toEqual({ images: [imageA] });
    expect(f.presenter.snapshot().draft.images).toEqual([]);
  });
  it('answers with no image instead of inventing one when the reader realm has no pasteboard', async () => {
    const f = fixture();
    await f.presenter.activate();
    // No image and no refusal: an empty pasteboard must never raise a complaint of its own.
    expect(await f.presenter.clipboardImage()).toEqual({ images: [] });
    expect(f.presenter.snapshot().draft.images).toEqual([]);
  });
  it('carries the reason an image the pasteboard really had was not attached', async () => {
    const f = fixture({ clipboard: () => Promise.resolve({ images: [], refused: 'too-large' }) });
    await f.presenter.activate();
    expect(await f.presenter.clipboardImage()).toEqual({ images: [], refused: 'too-large' });
  });
});
