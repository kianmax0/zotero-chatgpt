import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Window } from 'happy-dom';
import { expect, it, vi } from 'vitest';
import { ConversationPresenter } from '../../../packages/zotero/src/chat/presenter.ts';
import type { DocumentServices } from '../../../packages/zotero/src/reader/context.ts';
import { documentA } from '../../contracts/document-fixture.ts';
import { groupHistory, historyGroup, HISTORY_BUCKETS, mountChatView, renderReaderShell, conversationSource } from '../../../packages/zotero/src/chat/view.ts';
import { UNLOCATED_SOURCE_TEXT } from '../../../packages/zotero/src/chat/source-links.ts';
import { messageTimeLabel } from '../../../packages/zotero/src/chat/message-time.ts';
import { workspaceDraft } from '../../../packages/zotero/src/chat/draft.ts';
import type { SourceOpenOutcome } from '../../../packages/zotero/src/reader/source-highlight.ts';
import type { ClipboardImageRead } from '../../../packages/zotero/src/chat/pick-images.ts';
import type { ModelOption, ReaderClient, RuntimeSnapshot } from '../../../packages/contracts/src/runtime.ts';
import { SHAREABLE_STORAGE_LOCATION, ReaderError, type Citation, type Conversation, type DocumentRevision, type PaperIdentity, type PaperScope, type ReaderEvent, type SendInput, type SendReceipt } from '../../../packages/contracts/src/index.ts';
import type { HistoryEntry, ReaderWorkspace } from '../../../packages/contracts/src/workspace.ts';
import { defaultSettings } from '../../../packages/core/src/workspace/skills.ts';
import type { ContextBudget } from '../../../packages/core/src/codex/model-capabilities.ts';
import { documentSummary } from '../../../packages/contracts/src/document.ts';
import { citationA, imageA, paperA, paperB, settings as baseSettings, TINY_PNG_DATA_URL } from '../../contracts/factories.ts';
import { presenterContext } from '../presenter-context.ts';

const settings = { ...baseSettings, model: 'gpt-6-sol' };

const model: ModelOption = {
  id: 'gpt-6-sol', displayName: 'GPT-6 Sol', isDefault: true,
  supportedReasoningEfforts: [
    { id: 'low', description: '' }, { id: 'medium', description: '' },
    { id: 'high', description: '' }, { id: 'xhigh', description: '' },
  ],
  defaultReasoningEffort: 'medium',
  serviceTiers: [{ id: 'priority', name: 'Priority', description: '' }, { id: 'flex', name: 'Flex', description: '' }],
  defaultServiceTier: 'priority',
  inputModalities: ['text', 'image'],
};

function documentOf(): Document {
  return new Window({ url: 'https://zchatgpt.test/' }).document as unknown as Document;
}

async function mountReadyChat(options: {
  messages?: Conversation['messages'];
  draftCitations?: typeof citationA[];
  draftImages?: typeof imageA[];
  conversations?: Conversation[];
  noCurrent?: boolean;
  runtimeModels?: ModelOption[];
  textScale?: { value: number };
  readerZoom?: { factor: number; ins: number; outs: number; resets: number };
  sent?: SendInput[];
  uuid?: () => string;
  document?: DocumentServices;
  openDocumentPage?: (document: { paper: PaperScope; revision: DocumentRevision }, pageIndex: number, quote?: string | null) => Promise<SourceOpenOutcome | void>;
  openCitation?: (citation: Citation) => Promise<void>;
  copyText?: (text: string) => void;
  openLink?: (url: string) => void;
  explainFigure?: (question: string) => Promise<void>;
  usage?: Conversation['usage'];
  requestTiming?: Conversation['requestTiming'];
  activeRequestId?: string | null;
  captureTimers?: boolean;
  rename?: (id: string, title: string) => Promise<Conversation>;
  cancel?: (conversationId: string, requestId: string) => Promise<SendReceipt>;
  clipboardImages?: () => Promise<ClipboardImageRead>;
  workspace?: ReaderWorkspace;
  closeDock?: () => void;
  contextBudget?: (input: SendInput, conversation: Conversation) => ContextBudget;
  rateLimits?: RuntimeSnapshot['rateLimits'];
  deleteConversation?: ReaderClient['deleteConversation'];
  identity?: PaperIdentity;
} = {}) {
  let conversation: Conversation = {
    id: '2e4a6c8e-0b1d-4f3a-a5c7-9e1b3d5f7a90', paper: paperA, title: 'Synthetic Paper A', settings,
    activeRequestId: options.activeRequestId ?? null,
    messages: options.messages ?? [{
      id: 'm1', requestId: 'r1', role: 'user', phase: null, settings, text: 'What does this mean?',
      citations: [citationA], status: 'completed',
    }],
    lastSeq: 0, createdAt: '2026-09-10T08:00:00.000Z', updatedAt: '2026-09-10T08:00:00.000Z',
    ...(options.usage ? { usage: options.usage } : {}),
    ...(options.requestTiming ? { requestTiming: options.requestTiming } : {}),
  };
  const runtime: RuntimeSnapshot = {
    revision: 0, runtime: 'ready', account: { state: 'signedIn' }, login: null,
    models: options.runtimeModels ?? [model], error: null,
    ...(options.rateLimits ? { rateLimits: options.rateLimits } : {}),
  };
  const listed = options.conversations ?? [conversation];
  if (!listed.some(entry => entry.id === conversation.id)) listed.unshift(conversation);
  let onRuntime: (snapshot: RuntimeSnapshot) => void = () => undefined;
  let onEvent: (event: ReaderEvent) => void = () => undefined;
  const client: ReaderClient = {
    snapshot: () => structuredClone(runtime), observe: l => { onRuntime = l; l(structuredClone(runtime)); return () => undefined; },
    refreshAccount: async () => {}, startLogin: () => Promise.reject(new Error()), cancelLogin: async () => {},
    current: () => Promise.resolve(structuredClone(conversation)),
    peekCurrent: () => Promise.resolve(options.noCurrent ? null : structuredClone(conversation)),
    newConversation: () => {
      conversation = {
        ...conversation, id: 'aaaaaaaa-0000-4000-8000-000000000002', messages: [], lastSeq: 0,
        createdAt: '2026-09-10T09:00:00.000Z', updatedAt: '2026-09-10T09:00:00.000Z', activeRequestId: null,
      };
      listed.push(conversation);
      return Promise.resolve(structuredClone(conversation));
    },
    list: () => Promise.resolve(listed.map(entry => structuredClone(entry))),
    select: (_paper, id) => {
      const found = listed.find(entry => entry.id === id);
      if (!found) return Promise.reject(new Error('missing conversation'));
      conversation = found;
      return Promise.resolve(structuredClone(found));
    },
    get: id => {
      const found = id === undefined ? conversation : listed.find(entry => entry.id === id);
      if (!found) return Promise.reject(new Error('missing conversation'));
      return Promise.resolve(structuredClone(found));
    },
    send: input => {
      options.sent?.push(input);
      conversation = {
        ...conversation, settings: input.settings, activeRequestId: input.requestId,
        messages: [...conversation.messages, {
          id: `u-${conversation.messages.length + 1}`, requestId: input.requestId, role: 'user',
          phase: null, settings: input.settings, text: input.question, citations: input.citations,
          status: 'completed', ...(input.images ? { images: input.images } : {}), ...(input.mode ? { mode: input.mode } : {}),
        }],
        lastSeq: conversation.lastSeq + 1,
      };
      // Keep the listed copy in step: the presenter re-reads a conversation through `get`/`list`, so a
      // listed entry that lags behind would silently discard the accepted request.
      const listedIndex = listed.findIndex(entry => entry.id === conversation.id);
      if (listedIndex >= 0) listed[listedIndex] = conversation; else listed.push(conversation);
      return Promise.resolve({ requestId: input.requestId, state: 'accepted' as const, replay: false });
    },
    request: () => Promise.resolve({ requestId: 'r1', state: 'completed', replay: false }),
    cancel: options.cancel ?? (() => Promise.reject(new Error())),
    renameConversation: options.rename ?? ((id, title) => {
      const index = listed.findIndex(entry => entry.id === id);
      if (index < 0) return Promise.reject(new Error('missing conversation'));
      const renamed = { ...listed[index]!, title, titleCustomized: true };
      listed[index] = renamed;
      if (conversation.id === id) conversation = renamed;
      return Promise.resolve(structuredClone(renamed));
    }),
    deleteConversation: options.deleteConversation ?? ((_paper, id) => {
      const index = listed.findIndex(entry => entry.id === id);
      if (index < 0) return Promise.reject(new Error('missing conversation'));
      listed.splice(index, 1);
      if (conversation.id === id) {
        conversation = listed[0] ?? {
          ...conversation, id: 'bbbbbbbb-0000-4000-8000-000000000003', messages: [], lastSeq: 0, activeRequestId: null,
        };
        if (!listed.some(entry => entry.id === conversation.id)) listed.push(conversation);
      }
      return Promise.resolve(structuredClone(conversation));
    }),
    diagnostics: vi.fn(() => Promise.resolve({
      pluginVersion: '0.3.0-alpha.1', runtimeVersion: '0.144.1', errorCode: null, requestCount: 0, states: {},
      storageLocation: SHAREABLE_STORAGE_LOCATION,
    })),
    subscribe: listener => { onEvent = listener; return () => undefined; }, close: async () => {},
  };
  const presenter = new ConversationPresenter(presenterContext(paperA, 'Synthetic Paper A', options.identity), {
    client: () => Promise.resolve(client), ensureAgent: () => Promise.resolve(), chatUnavailableReason: () => null, openAuthorization: () => undefined,
    uuid: options.uuid ?? (() => '9a1c3e5f-7b2d-4c6e-8f0a-1b3d5f7a9c0e'), now: () => 'now',
    ...(options.document ? { document: options.document } : {}),
    ...(options.clipboardImages ? { readClipboardImage: options.clipboardImages } : {}),
    ...(options.workspace ? { getWorkspace: () => Promise.resolve(options.workspace!) } : {}),
    ...(options.contextBudget ? { contextBudget: options.contextBudget } : {}),
  });
  if (options.draftCitations) {
    for (const citation of options.draftCitations) presenter.addCitation(citation);
  }
  if (options.draftImages) {
    for (const image of options.draftImages) presenter.addImage(image);
  }
  await presenter.activate();
  const doc = documentOf();
  const body = doc.createElement('div');
  doc.body.append(body);
  const root = renderReaderShell(body, { title: 'Synthetic Paper A', key: paperA.attachmentKey, libraryID: paperA.libraryId });
  const scale = options.textScale ?? { value: 1 };
  const timers = options.captureTimers ? captureIntervalTimers(doc.defaultView as unknown as ViewWindow) : null;
  const teardown = mountChatView(root, presenter, {
    ...(options.closeDock ? { closeDock: options.closeDock } : {}),
    openCitation: options.openCitation ?? (() => Promise.resolve()),
    readTextScale: () => scale.value,
    uuid: options.uuid ?? (() => imageA.id),
    ...(options.copyText ? { copyText: options.copyText } : {}),
    ...(options.openDocumentPage ? { openDocumentPage: options.openDocumentPage } : {}),
    ...(options.openLink ? { openLink: options.openLink } : {}),
    ...(options.explainFigure ? { explainFigure: options.explainFigure } : {}),
    ...(options.readerZoom ? {
      readerZoom: {
        zoomIn: () => { options.readerZoom!.ins += 1; options.readerZoom!.factor = Math.round((options.readerZoom!.factor + 0.25) * 100) / 100; },
        zoomOut: () => { options.readerZoom!.outs += 1; options.readerZoom!.factor = Math.max(0.5, Math.round((options.readerZoom!.factor - 0.25) * 100) / 100); },
        zoomReset: () => { options.readerZoom!.resets += 1; options.readerZoom!.factor = 1; },
        readZoom: () => options.readerZoom!.factor,
      },
    } : {}),
  });
  await Promise.resolve();
  return { root, presenter, scale, client, teardown, timers, emit: (event: ReaderEvent) => onEvent(event), updateRuntime: (patch: Partial<RuntimeSnapshot>) => { Object.assign(runtime, patch); onRuntime(structuredClone(runtime)); } };
}

const assistantMessage = (text: string): Conversation['messages'][number] => ({
  id: 'a1', requestId: 'r1', role: 'assistant', phase: 'final', settings, citations: [], status: 'completed', text,
});
/** A stored chat the prune-empty path must keep: no messages would look like an old leftover. */
const keptUser = (id: string): Conversation['messages'][number] => ({
  id, requestId: `r-${id}`, role: 'user', phase: null, settings, text: 'kept', citations: [], status: 'completed',
});

function applySidebarStyles(root: HTMLElement): CSSStyleDeclaration {
  const doc = root.ownerDocument;
  const style = doc.createElement('style');
  style.textContent = readFileSync(resolve(import.meta.dirname, '../../../packages/zotero/assets/sidebar.css'), 'utf8');
  doc.head.append(style);
  return doc.defaultView!.getComputedStyle(root);
}

/**
 * The view schedules its elapsed-time ticker on the happy-dom window, whose timers are bound to
 * `globalThis` when happy-dom loads, so vitest fake timers cannot drive them. Spy on the concrete
 * window instance instead: capture the callbacks and invoke them after moving `Date.now`.
 */
type ViewWindow = {
  setInterval: (handler: () => void, delay?: number) => number;
  clearInterval: (id: number) => void;
};
function captureIntervalTimers(view: ViewWindow) {
  const callbacks = new Map<number, () => void>();
  let next = 0;
  const set = vi.spyOn(view, 'setInterval').mockImplementation(handler => {
    const id = ++next;
    callbacks.set(id, handler);
    return id;
  });
  const clear = vi.spyOn(view, 'clearInterval').mockImplementation(id => { callbacks.delete(id); });
  return { callbacks, restore: () => { clear.mockRestore(); set.mockRestore(); } };
}

it('uses an in-pane sidebar without impersonating the reader toolbar or adding a close control', () => {
  const doc = documentOf();
  const body = doc.createElement('div');
  const root = renderReaderShell(body, { title: 'Synthetic Paper A', key: 'PDFONE01', libraryID: 1 });
  expect(root.className).toMatch(/zchatgpt-sidebar/u);
  expect(root.classList.contains('zchatgpt-paper')).toBe(true);
  expect(root.dataset.attachmentKey).toBe('PDFONE01');
  expect(root.dataset.libraryId).toBe('1');
  expect(root.style.getPropertyValue('--zchatgpt-reader-toolbar-height')).toBe('');
  expect(root.querySelector('header')).toBeNull();
  expect(root.textContent).not.toMatch(/^\s*Codex\s/u);
  expect(root.querySelector('[aria-label="Close Codex sidebar"]')).toBeNull();
  expect(root.querySelector('h2')).toBeNull();
});

it('keeps attachment identity on the root but puts paper context outside the message list', async () => {
  const { root } = await mountReadyChat();
  expect(root.dataset.attachmentKey).toBe(paperA.attachmentKey);
  expect(root.dataset.libraryId).toBe(String(paperA.libraryId));
  const thread = root.querySelector('[data-zchatgpt-messages]')!;
  expect(thread.textContent).not.toContain('Library 1');
  expect(thread.textContent).not.toContain('Attachment PDFONE01');
  expect(thread.querySelectorAll('[data-zchatgpt-citation]')).toHaveLength(1);
  expect(thread.textContent).not.toContain(citationA.title);
  const chrome = root.querySelector('.zchatgpt-chrome');
  const title = root.querySelector('[data-zchatgpt-current-title]');
  expect(chrome?.contains(title)).toBe(true);
  expect(thread.contains(title)).toBe(false);
  expect(title?.textContent).toBe('Synthetic Paper A');
  expect(title?.getAttribute('title')).toBe('Synthetic Paper A');
  expect(title?.textContent).not.toContain(`Library ${paperA.libraryId}`);
  const back = root.querySelector('[data-zchatgpt-action="open-citation"]');
  expect(back?.getAttribute('aria-label')).toBe('Return to source');
  expect(back?.textContent?.trim()).toBe('');
});

it('reads the paper metadata in the background without writing a card on screen', async () => {
  const identity: PaperIdentity = {
    title: 'Synthetic Paper A', authors: ['Ada Lovelace', 'Alan Turing'], year: '2026', doi: '10.1000/xyz',
    itemType: 'journalArticle', publicationTitle: 'Nature', volume: '4', pages: '1-9',
    abstractNote: 'x'.repeat(2500),
  };
  const { root } = await mountReadyChat({ identity });
  // The owner asked for the metadata to be read in the background and not written out on screen, so
  // neither the card, its heading nor any of its field labels are rendered for a richly described
  // paper. What the reader read still travels with the request; that is asserted separately in
  // "sends every field the reader read in the paper identity instead of a four-field subset".
  expect(root.querySelector('[data-zchatgpt-bibliography]')).toBeNull();
  expect(root.querySelector('[data-zchatgpt-bibliography-key]')).toBeNull();
  expect(root.textContent).not.toMatch(/About this paper|Journal abbrev\.|Abstract/u);
  expect(root.textContent).not.toContain('Nature');

  // A bare PDF renders no such surface either: the removal is the element's, not the data's.
  const bare = await mountReadyChat();
  expect(bare.root.querySelector('[data-zchatgpt-bibliography]')).toBeNull();
  expect(bare.root.textContent).not.toContain('About this paper');
});

/**
 * The one-line answer the details panel shows for the next send, opened from the toolbar's More
 * menu. The summary is not a permanent header row any more, so a test reads it where the owner does.
 */
function nextSendSummary(root: HTMLElement): string {
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="more-actions"]')?.click();
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="open-paper-details"]')?.click();
  return root.querySelector<HTMLElement>('[data-zchatgpt-context-summary]')?.textContent ?? '';
}

it('keeps the common header to one row and moves the context summary into the details', async () => {
  const { root } = await mountReadyChat();
  const chrome = root.querySelector<HTMLElement>('[data-zchatgpt-shell-bar]')!;
  // One toolbar row, and no permanent second row: the old context line, its empty wrapper and the
  // legacy action strip are gone from the default structure, not merely collapsed.
  expect(root.querySelectorAll('[data-zchatgpt-shell-bar]')).toHaveLength(1);
  expect(root.querySelector('[data-zchatgpt-shell-context]')).toBeNull();
  expect(root.querySelector('[data-zchatgpt-document-status]')).toBeNull();
  expect(root.querySelector('[data-zchatgpt-context-line]')).toBeNull();
  expect(root.querySelector('[data-zchatgpt-embed-bar]')).toBeNull();
  expect(root.querySelector('[data-zchatgpt-embed-actions]')).toBeNull();
  // The mode switch, both paper actions and the navigation all live in that one row.
  for (const action of ['mode-chat', 'mode-agent', 'new-conversation', 'history', 'more-actions']) {
    expect(chrome.querySelector(`[data-zchatgpt-action="${action}"]`), action).not.toBeNull();
  }
});

it('shows PDF page coverage for Agent after the local read completes', async () => {
  const { root, presenter } = await mountReadyChat({
    document: { prepare: () => Promise.resolve(documentA), validate: async () => {}, readEnabled: () => true, writeEnabled: () => {} },
  });
  presenter.setMode('agent');
  await vi.waitFor(() => expect(presenter.snapshot().document.prepared).not.toBeNull());
  expect(nextSendSummary(root)).toBe('Current PDF · all 2 pages read locally');
});

it('reports reading in progress instead of leaving the owner with no evidence at all', async () => {
  const { root, presenter } = await mountReadyChat({
    document: { prepare: () => new Promise(() => {}), validate: async () => {}, readEnabled: () => true, writeEnabled: () => {} },
  });
  presenter.setMode('agent');
  await vi.waitFor(() => expect(presenter.snapshot().document.phase).toBe('preparing'));
  expect(nextSendSummary(root)).toBe('Preparing current PDF text…');
});

it('claims only the pages that really carried text when part of the PDF is scanned', async () => {
  const partial = { ...documentA, pages: [
    { ...documentA.pages[0]! },
    { pageIndex: 1, pageLabel: 'ii', text: '', status: 'empty' as const },
  ] };
  const { root, presenter } = await mountReadyChat({
    document: { prepare: () => Promise.resolve(partial), validate: async () => {}, readEnabled: () => true, writeEnabled: () => {} },
  });
  presenter.setMode('agent');
  await vi.waitFor(() => expect(presenter.snapshot().document.prepared).not.toBeNull());
  expect(nextSendSummary(root)).toBe('Current PDF · excerpts from 1 of 2 pages');
});

it('states that automatic paper context is off in Chat instead of describing PDF pages', async () => {
  const { root } = await mountReadyChat({
    document: { prepare: () => Promise.resolve(documentA), validate: async () => {}, readEnabled: () => false, writeEnabled: () => {} },
  });
  // UI-03: the summary must answer what the next send carries; an off switch is a real scope fact,
  // not a blank line, so the owner can tell nothing from this PDF will be attached.
  expect(nextSendSummary(root)).toBe('Automatic paper context is off');
});

it('shows metadata and abstract as the next Chat context without claiming local PDF pages', async () => {
  const { root, presenter } = await mountReadyChat({
    document: { prepare: () => Promise.resolve(documentA), validate: async () => {}, readEnabled: () => true, writeEnabled: () => {} },
  });
  expect(presenter.snapshot().mode).toBe('chat');
  expect(nextSendSummary(root)).toBe('Paper details and stored abstract will be included when available · no PDF body text');
});

it('sends every field the reader read in the paper identity instead of a four-field subset', async () => {
  const sent: SendInput[] = [];
  const identity: PaperIdentity = {
    title: 'Synthetic Paper A', authors: ['Ada Lovelace'], year: '2026', doi: '10.1000/xyz',
    itemType: 'journalArticle', publicationTitle: 'Nature', journalAbbreviation: 'Nat.', volume: '4', issue: '2',
    pages: '1-9', publisher: 'Synthetic Press', language: 'en', tags: ['genomics'], editors: ['Grace Hopper'],
  };
  const { root } = await mountReadyChat({ messages: [], sent, identity });
  const input = root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')!;
  input.value = 'What does this mean?';
  input.dispatchEvent(new root.ownerDocument.defaultView!.Event('input', { bubbles: true }));
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="send"]')!.click();
  await vi.waitFor(() => expect(sent).toHaveLength(1));
  // The identity the model sees is the same object the reader froze, so a `hashVersion: 2` replay of
  // the stored copy hashes identically instead of silently dropping a field.
  expect(sent[0]!.paper).toEqual(identity);
});

it('keeps pending citations in the composer, not in the transcript', async () => {
  const { root } = await mountReadyChat({ messages: [], draftCitations: [citationA] });
  expect(root.querySelectorAll('[data-zchatgpt-messages] [data-zchatgpt-citation]')).toHaveLength(0);
  expect(root.querySelectorAll('[data-zchatgpt-draft-citations] [data-zchatgpt-citation]')).toHaveLength(1);
  const remove = root.querySelector('[data-zchatgpt-draft-citations] [data-zchatgpt-action="remove-citation"]');
  expect(remove?.getAttribute('aria-label')).toBe('Remove');
  expect(remove?.textContent?.trim()).toBe('');
});
it('shows persisted source selections and generated image outputs with a usable preview', async () => {
  const generated = { ...imageA, origin: { kind: 'generated' as const, model: settings.model } };
  const { root } = await mountReadyChat({ messages: [
    { id: 'source', requestId: 'r1', role: 'user', phase: null, settings, text: 'Explain', citations: [citationA], status: 'completed', images: [imageA] },
    { id: 'image-output', requestId: 'r1', role: 'assistant', phase: 'final', settings, text: 'A generated explanation', citations: [], status: 'completed', generatedImages: [generated] },
  ] });
  expect(root.querySelector('[data-zchatgpt-message="source"] [data-zchatgpt-citation]')).not.toBeNull();
  expect(root.querySelectorAll('[data-zchatgpt-message] [data-zchatgpt-image]')).toHaveLength(2);
  const preview = root.querySelector<HTMLButtonElement>('[data-zchatgpt-message="image-output"] [data-zchatgpt-action="preview-image"]')!;
  preview.click();
  expect(root.querySelector('[data-zchatgpt-image-preview]')?.hasAttribute('hidden')).toBe(false);
});
it('opens a cited answer page through the frozen document navigation and leaves external links to openLink', async () => {
  const openDocumentPage = vi.fn(() => Promise.resolve());
  const openLink = vi.fn();
  const { root } = await mountReadyChat({
    messages: [
      { id: 'u1', requestId: 'r1', role: 'user', phase: null, settings, text: 'What is defined?', citations: [citationA], status: 'completed', document: documentSummary(documentA) },
      { id: 'a1', requestId: 'r1', role: 'assistant', phase: 'final', settings, citations: [], status: 'completed',
        text: `Definition [page](https://zchatgpt.invalid/source/${documentA.id}/1) and [external](https://example.com/paper).` },
    ],
    openDocumentPage, openLink,
  });
  const text = root.querySelector<HTMLElement>('[data-zchatgpt-message="a1"] [data-zchatgpt-text]')!;
  const [cited, external] = [...text.querySelectorAll<HTMLAnchorElement>('a')];
  expect(cited?.hasAttribute('href')).toBe(false);
  expect(cited?.textContent).toBe('p. ii');
  expect(cited?.dataset.zchatgptSource).toBe(documentA.id);
  expect(cited?.dataset.zchatgptPage).toBe('1');
  cited?.dispatchEvent(new root.ownerDocument.defaultView!.MouseEvent('click', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(openDocumentPage).toHaveBeenCalledWith({ paper: documentA.paper, revision: documentA.revision }, 1, null));
  expect(openLink).not.toHaveBeenCalled();
  external?.dispatchEvent(new root.ownerDocument.defaultView!.MouseEvent('click', { bubbles: true, cancelable: true }));
  expect(openLink).toHaveBeenCalledWith('https://example.com/paper');
});

it('resolves a citation into a persisted referenced document with that reference paper scope', async () => {
  const referenced = { ...documentSummary(documentA), id: 'bbbbbbbb-0000-4000-8000-000000000002' };
  const openDocumentPage = vi.fn(() => Promise.resolve());
  const { root } = await mountReadyChat({
    messages: [
      { id: 'u1', requestId: 'r1', role: 'user', phase: null, settings, text: 'Compare the supplement.', citations: [], status: 'completed',
        references: [{ id: 'ref-1', kind: 'article', label: 'Supplement', paper: paperB, capturedAt: 'now' }],
        referenceDocuments: [{ referenceId: 'ref-1', document: referenced }] },
      { id: 'a1', requestId: 'r1', role: 'assistant', phase: 'final', settings, citations: [], status: 'completed',
        text: `See [page](https://zchatgpt.invalid/source/${referenced.id}/0).` },
    ],
    openDocumentPage,
  });
  const anchor = root.querySelector<HTMLAnchorElement>('[data-zchatgpt-message="a1"] [data-zchatgpt-text] a')!;
  expect(anchor.textContent).toBe('p. i');
  anchor.dispatchEvent(new root.ownerDocument.defaultView!.MouseEvent('click', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(openDocumentPage).toHaveBeenCalledWith({ paper: paperB, revision: documentA.revision }, 0, null));
});

it('carries the verbatim link title quote into the frozen page open and reports an honest miss', async () => {
  const openDocumentPage = vi.fn((): Promise<SourceOpenOutcome> => Promise.resolve('unlocated'));
  const { root } = await mountReadyChat({
    messages: [
      { id: 'u1', requestId: 'r1', role: 'user', phase: null, settings, text: 'What is defined?', citations: [citationA], status: 'completed', document: documentSummary(documentA) },
      { id: 'a1', requestId: 'r1', role: 'assistant', phase: 'final', settings, citations: [], status: 'completed',
        text: `Definition [page](https://zchatgpt.invalid/source/${documentA.id}/1 "the   exact   words")` },
    ],
    openDocumentPage,
  });
  const anchor = root.querySelector<HTMLAnchorElement>('[data-zchatgpt-message="a1"] [data-zchatgpt-text] a')!;
  anchor.dispatchEvent(new root.ownerDocument.defaultView!.MouseEvent('click', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(openDocumentPage).toHaveBeenCalledWith({ paper: documentA.paper, revision: documentA.revision }, 1, 'the exact words'));
  // The host reported the passage could not be located: the claim is traced but nothing is fabricated.
  await vi.waitFor(() => expect(root.querySelector('[data-zchatgpt-message="a1"] [data-zchatgpt-text] [role="status"]')?.textContent).toBe(UNLOCATED_SOURCE_TEXT));
});

it('degrades an unresolvable answer citation without launching it externally', async () => {
  const openLink = vi.fn();
  const { root } = await mountReadyChat({
    messages: [
      { id: 'u1', requestId: 'r1', role: 'user', phase: null, settings, text: 'Q', citations: [citationA], status: 'completed', document: documentSummary(documentA) },
      { id: 'a1', requestId: 'r1', role: 'assistant', phase: 'final', settings, citations: [], status: 'completed',
        text: '[page](https://zchatgpt.invalid/source/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/0)' },
    ],
    openLink,
  });
  const text = root.querySelector<HTMLElement>('[data-zchatgpt-message="a1"] [data-zchatgpt-text]')!;
  const anchor = text.querySelector<HTMLAnchorElement>('a')!;
  expect(anchor.hasAttribute('href')).toBe(false);
  expect(anchor.getAttribute('aria-disabled')).toBe('true');
  expect(text.textContent).toContain('This source is not available in this answer.');
  const event = new root.ownerDocument.defaultView!.MouseEvent('click', { bubbles: true, cancelable: true });
  anchor.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(openLink).not.toHaveBeenCalled();
});

it('surfaces a constant failure when the frozen source cannot be opened, without launching it', async () => {
  const openDocumentPage = vi.fn(() => Promise.reject(new Error('/private/library/file.pdf')));
  const openLink = vi.fn();
  const { root } = await mountReadyChat({
    messages: [
      { id: 'u1', requestId: 'r1', role: 'user', phase: null, settings, text: 'Q', citations: [citationA], status: 'completed', document: documentSummary(documentA) },
      { id: 'a1', requestId: 'r1', role: 'assistant', phase: 'final', settings, citations: [], status: 'completed',
        text: `[page](https://zchatgpt.invalid/source/${documentA.id}/0)` },
    ],
    openDocumentPage, openLink,
  });
  const text = root.querySelector<HTMLElement>('[data-zchatgpt-message="a1"] [data-zchatgpt-text]')!;
  text.querySelector<HTMLAnchorElement>('a')!.dispatchEvent(new root.ownerDocument.defaultView!.MouseEvent('click', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(text.querySelector('[role="status"]')?.textContent).toBe('The source could not be opened. Reopen the PDF and try again.'));
  expect(text.textContent).not.toContain('/private');
  expect(openLink).not.toHaveBeenCalled();
});

it('reports a failed view action in a dedicated slot without leaking the raw error', async () => {
  const { root, presenter } = await mountReadyChat();
  vi.spyOn(presenter, 'cancelQueuedRequest').mockRejectedValue(new Error('/private/library/file.pdf'));
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="cancel-queued"]')!.click();
  const viewError = root.querySelector<HTMLElement>('[data-zchatgpt-view-error]')!;
  await vi.waitFor(() => expect(viewError.hidden).toBe(false));
  expect(viewError.textContent).toBe('This action could not be completed.');
  expect(root.textContent).not.toContain('/private');
  expect(root.querySelector<HTMLElement>('[role="alert"]:not([data-zchatgpt-view-error])')?.hidden).toBe(true);
});

it('reports a rejected citation open without clobbering the presenter message slot', async () => {
  const openCitation = vi.fn(() => Promise.reject(new Error('/private/library/file.pdf')));
  const { root } = await mountReadyChat({ draftCitations: [citationA], openCitation });
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-context-source] [data-zchatgpt-action="open-citation"]')!.click();
  await vi.waitFor(() => expect(openCitation).toHaveBeenCalled());
  const viewError = root.querySelector<HTMLElement>('[data-zchatgpt-view-error]')!;
  await vi.waitFor(() => expect(viewError.textContent).toBe('The source could not be opened.'));
  expect(root.textContent).not.toContain('/private');
});

it('routes a rejected draft-citation open through the same dedicated slot', async () => {  const openCitation = vi.fn(() => Promise.reject(new Error('/private/library/file.pdf')));
  const { root } = await mountReadyChat({ draftCitations: [citationA], openCitation });
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-citation] [data-zchatgpt-action="open-citation"]')!.click();
  const viewError = root.querySelector<HTMLElement>('[data-zchatgpt-view-error]')!;
  await vi.waitFor(() => expect(viewError.textContent).toBe('The source could not be opened.'));
  expect(root.textContent).not.toContain('/private');
});

it('announces status through the dedicated live region instead of the whole transcript', async () => {
  const { root } = await mountReadyChat();
  expect(root.querySelector('[data-zchatgpt-messages]')?.hasAttribute('aria-live')).toBe(false);
  expect(root.querySelector('.zchatgpt-status-line')?.getAttribute('role')).toBe('status');
});

it('offers a discoverable copy control for an answer and confirms the copy', async () => {
  const copyText = vi.fn();
  const { root } = await mountReadyChat({ messages: [assistantMessage('先验是初始信念。')], copyText });
  const copy = root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="copy-answer"]')!;
  expect(copy.hidden).toBe(false);
  expect(copy.dataset.zchatgptCopied).toBeUndefined();
  copy.click();
  expect(copyText).toHaveBeenCalledWith('先验是初始信念。');
  expect(copy.dataset.zchatgptCopied).toBe('true');
  expect(copy.getAttribute('aria-label')).toBe('Copied');
});

it('offers a copy control for every fenced code block', async () => {
  const copyText = vi.fn();
  const { root } = await mountReadyChat({ messages: [assistantMessage('See:\n\n```ts\nconst x = 1;\n```\n')], copyText });
  const text = root.querySelector<HTMLElement>('[data-zchatgpt-message="a1"] [data-zchatgpt-text]')!;
  const wrapper = text.querySelector<HTMLElement>('.zchatgpt-code-block');
  expect(wrapper?.parentElement).toBe(text);
  const copy = wrapper!.querySelector<HTMLButtonElement>('[data-zchatgpt-action="copy-code"]')!;
  copy.click();
  expect(copyText).toHaveBeenCalledWith('const x = 1;\n');
  expect(copy.dataset.zchatgptCopied).toBe('true');
});

it('gives every markdown table its own local scroll container', async () => {
  const { root } = await mountReadyChat({ messages: [assistantMessage('| a | b |\n| - | - |\n| 1 | 2 |\n')] });
  const text = root.querySelector<HTMLElement>('[data-zchatgpt-message="a1"] [data-zchatgpt-text]')!;
  const wrapper = text.querySelector<HTMLElement>('.zchatgpt-table-block');
  expect(wrapper?.parentElement).toBe(text);
  expect(wrapper?.firstElementChild?.tagName).toBe('TABLE');
});

it('draws a complete solid ring while the context is unknown, never a percentage or empty placeholder', async () => {
  const { root } = await mountReadyChat();
  const ring = root.querySelector<HTMLElement>('[data-zchatgpt-context-usage]')!;
  // The composer holds no token text at all: the ring is the whole indicator.
  expect(ring.className).toBe('zchatgpt-context-ring');
  expect(ring.textContent).toBe('');
  expect(ring.dataset.zchatgptContextState).toBe('unknown');
  expect(ring.getAttribute('role')).toBe('status');
  expect(ring.title).toContain('unknown');
  expect(ring.getAttribute('aria-label')).toBe(ring.title);
  // 'none' leaves one unbroken stroke, so the unknown ring is solid rather than an empty arc.
  expect(ring.querySelector('.zchatgpt-context-ring-fill')!.getAttribute('stroke-dasharray')).toBe('none');
});

it('uses the pinned fallback window when a usage report omits one', async () => {
  const { root } = await mountReadyChat({
    usage: {
      model: 'gpt-6-sol', contextWindow: null,
      last: { inputTokens: 12300, cachedInputTokens: 0, outputTokens: 300, reasoningOutputTokens: 0, totalTokens: 12600 },
      total: { inputTokens: 12300, cachedInputTokens: 0, outputTokens: 300, reasoningOutputTokens: 0, totalTokens: 12600 },
    },
  });
  const ring = root.querySelector<HTMLElement>('[data-zchatgpt-context-usage]')!;
  expect(ring.dataset.zchatgptContextState).toBe('pinned-catalog');
  expect(ring.getAttribute('aria-label')).toContain('12,300');
  expect(ring.getAttribute('aria-label')).toContain('272,000');
  expect(ring.getAttribute('aria-label')).toContain('bundled catalog estimate');
  expect(ring.getAttribute('aria-label')).not.toContain('%');
  expect(ring.querySelector('.zchatgpt-context-ring-fill')!.getAttribute('stroke-dasharray')).not.toBe('none');
});

it('fills the ring from the last runtime report and keeps the numbers in the tooltip only', async () => {
  const { root } = await mountReadyChat({
    usage: {
      model: 'gpt-6-sol', contextWindow: 128000,
      last: { inputTokens: 12345, cachedInputTokens: 0, outputTokens: 300, reasoningOutputTokens: 0, totalTokens: 12645 },
      total: { inputTokens: 12345, cachedInputTokens: 0, outputTokens: 300, reasoningOutputTokens: 0, totalTokens: 12645 },
    },
  });
  const ring = root.querySelector<HTMLElement>('[data-zchatgpt-context-usage]')!;
  expect(ring.dataset.zchatgptContextState).toBe('runtime-reported');
  expect(ring.textContent).toBe('');
  expect(ring.getAttribute('aria-label')).toContain('12,345');
  expect(ring.getAttribute('aria-label')).toContain('128,000');
  expect(ring.getAttribute('aria-label')).toContain('not remaining context.');
  const filled = ring.querySelector('.zchatgpt-context-ring-fill')!.getAttribute('stroke-dasharray')!.split(' ').map(Number);
  expect(filled[1]).toBeCloseTo(50.27, 2);
  expect(filled[0]! / filled[1]!).toBeCloseTo(12345 / 128000, 4);
});

it('shows the concrete context report on the ring, only after a request and only on hover or focus', async () => {
  const sent: SendInput[] = [];
  const { root, presenter } = await mountReadyChat({
    messages: [], sent,
    document: { prepare: () => Promise.resolve(documentA), validate: async () => {}, readEnabled: () => true, writeEnabled: () => {} },
  });
  const ring = root.querySelector<HTMLElement>('[data-zchatgpt-context-usage]')!;
  const details = root.querySelector<HTMLElement>('.zchatgpt-context-details')!;
  // Before any request the ring stays in its neutral unknown state and invents no coverage.
  expect(details.hidden).toBe(true);
  expect(details.textContent).toBe('');
  expect(ring.getAttribute('aria-describedby')).toBeNull();
  expect(ring.title).not.toBe('');
  expect(ring.tabIndex).toBe(0);
  presenter.setQuestion('What does this paper claim?');
  await presenter.send();
  await vi.waitFor(() => expect(presenter.snapshot().contextReport).not.toBeNull());
  expect(sent).toHaveLength(1);
  // The report is described but stays closed until the reader asks for it.
  expect(details.hidden).toBe(true);
  expect(ring.getAttribute('aria-describedby')).toBe(details.id);
  expect(details.getAttribute('role')).toBe('tooltip');
  expect(details.textContent).toContain('Whole source');
  expect(details.textContent).toContain('2 of 2 pages');
  expect(details.textContent).toContain('Model window 272,000 tokens (bundled catalog estimate)');
  expect(details.textContent).toMatch(/Text allowance [0-9,]+ tokens/u);
  expect(details.textContent).toContain('All authorized source pages fit within the conservative estimate');
  expect(details.textContent).not.toContain('Model window unknown');
  // The native title would double up with the disclosure on hover, so it is cleared while one exists.
  expect(ring.title).toBe('');
  // Keyboard first: focus opens the same disclosure a pointer gets.
  ring.focus();
  expect(details.hidden).toBe(false);
  ring.blur();
  expect(details.hidden).toBe(true);
  const view = root.ownerDocument.defaultView!;
  ring.dispatchEvent(new view.Event('mouseenter'));
  expect(details.hidden).toBe(false);
  ring.dispatchEvent(new view.Event('mouseleave'));
  expect(details.hidden).toBe(true);
  // A new chat clears the report rather than leaving the last request's coverage on screen.
  await presenter.newConversation();
  expect(presenter.snapshot().contextReport).toBeNull();
  expect(details.hidden).toBe(true);
  expect(details.textContent).toBe('');
});

it('names the supplied page set and the excluded pages on the ring for a focused send', async () => {
  const long = { ...structuredClone(documentA), pages: [
    { ...documentA.pages[0]!, text: 'Definition: x denotes the hidden state.\n\n'.repeat(80) },
    { ...documentA.pages[1]!, text: 'A source paragraph about many other things.\n\n'.repeat(80) },
  ] };
  const { root, presenter } = await mountReadyChat({
    messages: [],
    document: { prepare: () => Promise.resolve(long), validate: async () => {}, readEnabled: () => true, writeEnabled: () => {} },
    contextBudget: () => ({ capacity: 100000, provenance: 'runtime-reported', accuracy: 'estimate', textBudgetTokens: 1500, reservations: { history: 0, instructions: 1000, workflow: 1000, images: 0, question: 100, output: 1000, safety: 1000, total: 4100 }, overBudget: false, assumptions: ['synthetic test budget'] }),
  });
  presenter.setQuestion('What is the definition of x?');
  await presenter.send();
  await vi.waitFor(() => expect(presenter.snapshot().contextReport?.mode).toBe('focused'));
  const details = root.querySelector<HTMLElement>('.zchatgpt-context-details')!;
  expect(details.textContent).toContain('Question-focused selection');
  // The report's own counts, and the concrete page indexes it selected, are visible rather than implied.
  expect(details.textContent).toContain('1 of 2 pages');
  expect(details.textContent).toContain('Page numbers 1');
  // The reason is the planner's, so the pages it left out are named instead of merely implied.
  expect(details.textContent).toContain('Excluded pages: ii');
  expect(details.textContent).toContain('other authorized pages were not included');
});

it('keeps the ring coverage disclosure after a UI-language switch', async () => {
  let language: 'en' | 'zh' = 'en';
  const base = historyWorkspace([]);
  const workspace: ReaderWorkspace = {
    ...base,
    settings: () => Promise.resolve({ ...defaultSettings(), uiLanguage: language }),
    saveSettings: value => { language = value.uiLanguage; return Promise.resolve(); },
  };
  const { root, presenter } = await mountReadyChat({
    messages: [], workspace,
    document: { prepare: () => Promise.resolve(documentA), validate: async () => {}, readEnabled: () => true, writeEnabled: () => {} },
  });
  presenter.setQuestion('What does this paper claim?');
  await presenter.send();
  await vi.waitFor(() => expect(presenter.snapshot().contextReport).not.toBeNull());
  const details = root.querySelector<HTMLElement>('.zchatgpt-context-details')!;
  const ring = root.querySelector<HTMLElement>('[data-zchatgpt-context-usage]')!;
  expect(details.textContent).toContain('2 of 2 pages');
  await presenter.saveAppearance({ uiLanguage: 'zh' });
  await vi.waitFor(() => expect(presenter.snapshot().workspace?.uiLanguage).toBe('zh'));
  // The disclosure survives the switch in place: it is not torn down, emptied or rebuilt from scratch.
  expect(root.querySelector<HTMLElement>('.zchatgpt-context-details')).toBe(details);
  // The disclosure's own copy actually switches, not just the ring's accessible name: labels render
  // in the new language and the value templates translate their phrasing while carrying the counts
  // through verbatim.
  expect(details.textContent).toContain('上次请求提供的上下文');
  expect(details.textContent).toContain('模式');
  expect(details.textContent).toContain('整份来源');
  expect(details.textContent).toContain('已提供页数');
  expect(details.textContent).toContain('2 / 2 页');
  expect(details.textContent).toContain('模型窗口');
  expect(details.textContent).toContain('272,000 词元（内置目录估算）');
  expect(details.textContent).toContain('文本配额');
  expect(details.textContent).toMatch(/文本配额 [0-9,]+ 词元/u);
  expect(details.textContent).toContain('已提供与未提供的内容');
  // The planner's recorded explanation stays verbatim, while the pinned catalog estimate replaces
  // the old no-capacity disclosure for this model.
  expect(details.textContent).toContain('All authorized source pages fit within the conservative estimate');
  expect(details.textContent).not.toContain('已经提取');
  // The ring's own accessible name translates too, which is the existing affordance-level proof.
  expect(ring.getAttribute('aria-label')).toMatch(/当前上下文未知/u);
  // Switching back restores the English source rather than leaving the translated copy stuck.
  await presenter.saveAppearance({ uiLanguage: 'en' });
  await vi.waitFor(() => expect(presenter.snapshot().workspace?.uiLanguage).toBe('en'));
  expect(details.textContent).toContain('Context supplied to the last request');
  expect(details.textContent).toContain('2 of 2 pages');
  expect(details.textContent).not.toContain('上次请求提供的上下文');
});

it('closes the dock once and stays a safe no-op for a repeat close or with no chat open', async () => {
  const closeDock = vi.fn();
  const { root, presenter, teardown } = await mountReadyChat({ messages: [], closeDock });
  const closeCurrent = root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="close-conversation"]')!;
  closeCurrent.click();
  expect(presenter.snapshot().conversation).toBeNull();
  expect(closeDock).toHaveBeenCalledTimes(1);
  // A second close finds no open chat: no second collapse, no throw, and the `+` stays available.
  closeCurrent.click();
  expect(closeDock).toHaveBeenCalledTimes(1);
  expect(presenter.closeConversation()).toBe(false);
  expect(closeDock).toHaveBeenCalledTimes(1);
  // A close arriving after the view is torn down is still a no-op rather than a crash.
  teardown();
  expect(presenter.closeConversation()).toBe(false);
  expect(closeDock).toHaveBeenCalledTimes(1);
});

it('counts the wait in whole seconds and refreshes it on each tick', async () => {
  const base = Date.parse('2026-09-13T00:00:00.000Z');
  const now = vi.spyOn(Date, 'now').mockReturnValue(base);
  const requestId = '11111111-1111-4111-8111-111111111111';
  try {
    const { root, timers } = await mountReadyChat({
      captureTimers: true, messages: [], activeRequestId: requestId,
      requestTiming: [{ requestId, acceptedAt: new Date(base - 3000).toISOString(), firstTextAt: null, settledAt: null }],
    });
    const timer = root.querySelector<HTMLElement>('[data-zchatgpt-request-timing]')!;
    const text = root.querySelector<HTMLElement>('[data-zchatgpt-request-timing-text]')!;
    expect(timer.hidden).toBe(false);
    expect(timer.querySelector('svg')).toBeTruthy();
    expect(text.textContent).toBe('Waiting 3s');
    expect(timers!.callbacks.size).toBe(1);
    now.mockReturnValue(base + 2000);
    for (const tick of timers!.callbacks.values()) tick();
    expect(text.textContent).toBe('Waiting 5s');
  } finally { vi.restoreAllMocks(); }
});

it('freezes the wait at the first delivered text instead of counting the stream', async () => {
  const base = Date.parse('2026-09-13T00:00:00.000Z');
  const now = vi.spyOn(Date, 'now').mockReturnValue(base);
  const requestId = '22222222-2222-4222-8222-222222222222';
  try {
    const { root, emit, timers } = await mountReadyChat({
      captureTimers: true, messages: [], activeRequestId: requestId,
      requestTiming: [{ requestId, acceptedAt: new Date(base - 4000).toISOString(), firstTextAt: null, settledAt: null }],
    });
    const text = root.querySelector<HTMLElement>('[data-zchatgpt-request-timing-text]')!;
    expect(text.textContent).toBe('Waiting 4s');
    emit({ seq: 1, conversationId: '2e4a6c8e-0b1d-4f3a-a5c7-9e1b3d5f7a90', requestId, at: new Date(base - 1000).toISOString(), type: 'delta', messageId: 'a1', text: '答' });
    expect(text.textContent).toBe('Waiting 3s');
    now.mockReturnValue(base + 30000);
    for (const tick of timers!.callbacks.values()) tick();
    expect(text.textContent).toBe('Waiting 3s');
  } finally { vi.restoreAllMocks(); }
});

it('reports the settled answer duration once and stops ticking', async () => {
  const base = Date.parse('2026-09-13T00:00:00.000Z');
  const now = vi.spyOn(Date, 'now').mockReturnValue(base);
  const requestId = '33333333-3333-4333-8333-333333333333';
  try {
    const { root, emit, timers } = await mountReadyChat({
      captureTimers: true, messages: [], activeRequestId: requestId,
      requestTiming: [{ requestId, acceptedAt: new Date(base - 40000).toISOString(), firstTextAt: null, settledAt: null }],
    });
    const text = root.querySelector<HTMLElement>('[data-zchatgpt-request-timing-text]')!;
    expect(text.textContent).toBe('Waiting 40s');
    emit({ seq: 1, conversationId: '2e4a6c8e-0b1d-4f3a-a5c7-9e1b3d5f7a90', requestId, at: new Date(base - 37000).toISOString(), type: 'delta', messageId: 'a1', text: '答' });
    emit({ seq: 2, conversationId: '2e4a6c8e-0b1d-4f3a-a5c7-9e1b3d5f7a90', requestId, at: new Date(base - 10000).toISOString(), type: 'completed', messageId: 'a1', finalText: '答' });
    expect(text.textContent).toBe('Answered in 30s');
    expect(timers!.callbacks.size).toBe(0);
    now.mockReturnValue(base + 90000);
    for (const tick of [...timers!.callbacks.values()]) tick();
    expect(text.textContent).toBe('Answered in 30s');
  } finally { vi.restoreAllMocks(); }
});

it('clears the elapsed-time interval on teardown so the view leaks no timer', async () => {
  const base = Date.parse('2026-09-13T00:00:00.000Z');
  const requestId = '44444444-4444-4444-8444-444444444444';
  try {
    const { teardown, timers } = await mountReadyChat({
      captureTimers: true, messages: [], activeRequestId: requestId,
      requestTiming: [{ requestId, acceptedAt: new Date(base - 1000).toISOString(), firstTextAt: null, settledAt: null }],
    });
    expect(timers!.callbacks.size).toBe(1);
    teardown();
    expect(timers!.callbacks.size).toBe(0);
  } finally { vi.restoreAllMocks(); }
});

it('shows an explicit unknown instead of a fabricated duration when timing is missing', async () => {
  const { root } = await mountReadyChat({ messages: [], activeRequestId: '55555555-5555-4555-8555-555555555555' });
  const timer = root.querySelector<HTMLElement>('[data-zchatgpt-request-timing]')!;
  const text = root.querySelector<HTMLElement>('[data-zchatgpt-request-timing-text]')!;
  expect(timer.hidden).toBe(false);
  expect(text.textContent).toBe('Elapsed time unavailable');
  expect(text.textContent).not.toMatch(/\d/u);
});

it('hides the elapsed-time indicator when no request timing exists at all', async () => {
  const { root } = await mountReadyChat({ messages: [] });
  expect(root.querySelector<HTMLElement>('[data-zchatgpt-request-timing]')!.hidden).toBe(true);
});

it('keeps a request that is reasoning without text visibly alive instead of dead', async () => {
  const base = Date.parse('2026-09-13T00:00:00.000Z');
  vi.spyOn(Date, 'now').mockReturnValue(base);
  const requestId = '66666666-6666-4666-8666-666666666666';
  try {
    const { root } = await mountReadyChat({
      messages: [{ id: 'm1', requestId, role: 'user', phase: null, settings, text: 'What does this claim?', citations: [], status: 'completed' }],
      activeRequestId: requestId,
      requestTiming: [{ requestId, acceptedAt: new Date(base - 45000).toISOString(), firstTextAt: null, settledAt: null }],
    });    // A long reasoning phase delivers no text at all, so the transcript itself stays empty: the live
    // wait and a usable stop control are the only honest signs that work is happening.
    expect(root.querySelector<HTMLElement>('[data-zchatgpt-request-timing]')!.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('[data-zchatgpt-request-timing-text]')!.textContent).toBe('Waiting 45s');
    expect(root.textContent).toContain('Responding…');
    const stop = root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="stop"]')!;
    expect(stop.hidden).toBe(false);
    expect(stop.getAttribute('aria-label')).toBe('Stop');
    expect(root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="send"]')!.hidden).toBe(true);
  } finally { vi.restoreAllMocks(); }
});

it('keeps the offline composer editable while preventing model submission', async () => {
  const f = await mountReadyChat(); f.updateRuntime({ runtime: 'error', error: 'Connection ended' });
  expect(f.root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')?.disabled).toBe(false);
  expect(f.root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="send"]')?.disabled).toBe(true);
});

it('does not show copy-diagnostics in the default sidebar', async () => {
  const { root } = await mountReadyChat();
  expect(root.querySelector('[data-zchatgpt-action="copy-diagnostics"]')).toBeNull();
  expect(root.textContent).not.toContain('复制诊断');
  expect(root.textContent).not.toContain('Copy diagnostics');
});

it('opens a custom model popover instead of three always-visible selects', async () => {
  const { root } = await mountReadyChat();
  const picker = root.querySelector('[data-zchatgpt-picker]');
  const menu = root.querySelector('[data-zchatgpt-picker-menu]');
  expect(picker).toBeTruthy();
  expect(picker?.getAttribute('aria-expanded')).toBe('false');
  expect(menu?.hasAttribute('hidden')).toBe(true);
  expect(root.querySelectorAll('[data-zchatgpt-picker-menu] select')).toHaveLength(0);
  expect(root.querySelectorAll('[data-zchatgpt-composer] > select, .zchatgpt-settings > select')).toHaveLength(0);
  (picker as HTMLButtonElement).click();
  expect(picker?.getAttribute('aria-expanded')).toBe('true');
  expect(menu?.hasAttribute('hidden')).toBe(false);
  expect(menu?.querySelector('[data-zchatgpt-picker-section="effort"]')?.textContent).toMatch(/Effort/u);
  expect(menu?.querySelector('[data-zchatgpt-setting="effort"][data-zchatgpt-value="low"]')?.textContent).toMatch(/Low/u);
  expect(menu?.querySelector('[data-zchatgpt-setting="effort"][data-zchatgpt-value="xhigh"]')?.textContent).toMatch(/Extra High/u);
  expect(menu?.querySelector('[data-zchatgpt-setting="effort"][data-zchatgpt-value="medium"]')?.getAttribute('aria-checked')).toBe('true');
  const fast = menu?.querySelector('[data-zchatgpt-setting="speed"]');
  expect(fast?.getAttribute('role')).toBe('switch');
  expect(fast?.getAttribute('aria-label')).toMatch(/Fast/u);
  expect(menu?.querySelector('[data-zchatgpt-picker-section="model"]')?.textContent).toMatch(/Model/u);
  expect(menu?.querySelectorAll('[data-zchatgpt-setting="model"]').length).toBeGreaterThan(0);
  expect(root.querySelectorAll('[data-zchatgpt-picker-menu] select')).toHaveLength(0);
});

it('renders and selects only the models allowed by current Preferences', async () => {
  const luna: ModelOption = { ...model, id: 'gpt-6-luna', displayName: 'GPT-6 Luna', isDefault: false };
  const base = historyWorkspace([]);
  const workspace: ReaderWorkspace = {
    ...base,
    settings: () => Promise.resolve({ ...defaultSettings(), allowedModels: [{ id: 'gpt-6-luna', name: 'GPT-6 Luna' }] }),
  };
  const { root, presenter } = await mountReadyChat({ messages: [], workspace, runtimeModels: [model, luna] });
  const picker = root.querySelector<HTMLButtonElement>('[data-zchatgpt-picker]')!;
  picker.click();
  const options = [...root.querySelectorAll<HTMLButtonElement>('[data-zchatgpt-setting="model"]')];
  expect(options.map(option => option.dataset.zchatgptValue)).toEqual(['gpt-6-luna']);
  expect(options[0]?.getAttribute('aria-checked')).toBe('true');
  expect(picker.textContent).toContain('GPT-6 Luna');
  options[0]!.click();
  expect(presenter.snapshot().draft.settings?.model).toBe('gpt-6-luna');
});

it('defaults visible sidebar copy to English', async () => {
  const { root } = await mountReadyChat({ messages: [] });
  expect(root.querySelector('[data-zchatgpt-action="new-conversation"]')?.getAttribute('aria-label')).toMatch(/New chat/u);
  expect(root.querySelector('[data-zchatgpt-action="history"]')?.getAttribute('aria-label')).toMatch(/Chat history/u);
  expect(root.querySelector('[data-zchatgpt-history]')?.getAttribute('aria-label')).toBe('Chat history');
  expect(root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')?.placeholder).toBe('Ask a question…');
  const send = root.querySelector('[data-zchatgpt-action="send"]');
  // An empty composer disables send and the control names the reason instead of a bare grey arrow.
  expect(send?.getAttribute('aria-label')).toBe('Enter a question to send.');
  expect(send?.textContent?.trim()).toBe('');
  expect(root.textContent).not.toMatch(/Preview|preview|development preview/u);
  expect(root.textContent).not.toMatch(/对话历史|新对话|输入问题|发送|复制诊断|返回原文|开发预览/u);
});

it('keeps an attachment fallback title available in compact chrome without a hero title', async () => {
  const conversation: Conversation = {
    id: '2e4a6c8e-0b1d-4f3a-a5c7-9e1b3d5f7a90', paper: paperA, title: 'PDF', settings,
    activeRequestId: null, messages: [], lastSeq: 0, createdAt: 'now', updatedAt: 'now',
  };
  const runtime: RuntimeSnapshot = {
    revision: 0, runtime: 'ready', account: { state: 'signedIn' }, login: null, models: [model], error: null,
  };
  const client: ReaderClient = {
    snapshot: () => structuredClone(runtime), observe: l => { l(structuredClone(runtime)); return () => undefined; },
    refreshAccount: async () => {}, startLogin: () => Promise.reject(new Error()), cancelLogin: async () => {},
    current: () => Promise.resolve(structuredClone(conversation)), peekCurrent: () => Promise.resolve(structuredClone(conversation)), newConversation: () => Promise.reject(new Error()),
    list: () => Promise.resolve([structuredClone(conversation)]), select: () => Promise.reject(new Error()),
    get: () => Promise.resolve(structuredClone(conversation)), send: () => Promise.reject(new Error()),
    request: () => Promise.resolve({ requestId: 'r1', state: 'completed', replay: false }),
    cancel: () => Promise.reject(new Error()),
    deleteConversation: () => Promise.reject(new Error()),
    diagnostics: vi.fn(() => Promise.resolve({
      pluginVersion: '0.3.0-alpha.1', runtimeVersion: '0.144.1', errorCode: null, requestCount: 0, states: {},
      storageLocation: SHAREABLE_STORAGE_LOCATION,
    })),
    subscribe: () => () => undefined, close: async () => {},
  };
  const presenter = new ConversationPresenter(presenterContext(paperA, 'PDF'), {
    client: () => Promise.resolve(client), ensureAgent: () => Promise.resolve(), chatUnavailableReason: () => null, openAuthorization: () => undefined, uuid: () => 'id', now: () => 'now',
  });
  await presenter.activate();
  const doc = documentOf();
  const body = doc.createElement('div');
  const root = renderReaderShell(body, { title: 'PDF', key: paperA.attachmentKey, libraryID: paperA.libraryId });
  mountChatView(root, presenter);
  const title = root.querySelector('[data-zchatgpt-current-title]');
  expect(title?.textContent).toBe('PDF');
  expect(title?.getAttribute('title')).toBe('PDF');
  expect(root.querySelector('h1, h2')).toBeNull();
});

it('shows the New chat tab at first paint without creating a chat', async () => {
  const title = 'ZCHATGPT current-PDF synthetic context and native interaction test';
  const runtime: RuntimeSnapshot = {
    revision: 0, runtime: 'ready', account: { state: 'signedOut' }, login: null, models: [model], error: null,
  };
  const created: string[] = [];
  const client: ReaderClient = {
    snapshot: () => structuredClone(runtime), observe: l => { l(structuredClone(runtime)); return () => undefined; },
    refreshAccount: async () => {}, startLogin: () => Promise.reject(new Error()), cancelLogin: async () => {},
    current: () => Promise.reject(new Error('must not persist on open')),
    peekCurrent: () => Promise.resolve(null),
    newConversation: () => { created.push('new'); return Promise.reject(new Error('must not persist on open')); },
    list: () => Promise.resolve([]), select: () => Promise.reject(new Error()),
    get: () => Promise.reject(new Error()), send: () => Promise.reject(new Error()),
    request: () => Promise.resolve({ requestId: 'r1', state: 'completed', replay: false }),
    cancel: () => Promise.reject(new Error()),
    deleteConversation: () => Promise.resolve(null),
    diagnostics: vi.fn(() => Promise.resolve({
      pluginVersion: '0.3.0-alpha.1', runtimeVersion: '0.144.1', errorCode: null, requestCount: 0, states: {},
      storageLocation: SHAREABLE_STORAGE_LOCATION,
    })),
    subscribe: () => () => undefined, close: async () => {},
  };
  const presenter = new ConversationPresenter(presenterContext(paperA, title), {
    client: () => Promise.resolve(client), ensureAgent: () => Promise.resolve(), chatUnavailableReason: () => null, openAuthorization: () => undefined, uuid: () => 'id', now: () => 'now',
  });
  const doc = documentOf();
  const body = doc.createElement('div');
  const root = renderReaderShell(body, { title, key: paperA.attachmentKey, libraryID: paperA.libraryId });
  mountChatView(root, presenter);
  // Host `new-chat-tab-before-or-with-connection` fires as soon as the composer exists, before restore.
  expect(root.querySelector('[data-zchatgpt-input]')).toBeTruthy();
  expect(presenter.snapshot().conversation).toBeNull();
  // The unsent tab is the New chat copy; paper identity is never carried by a tab label.
  const tab = root.querySelector<HTMLElement>('[data-zchatgpt-current-title]');
  expect(tab?.dataset.zchatgptConversationId).toBe('new-chat');
  expect(tab?.textContent).toBe('New chat');
  expect(tab?.getAttribute('title')).toBe('New chat');
  expect(tab?.querySelector('[data-zchatgpt-pane-label]')?.classList.contains('zchatgpt-pane-tab-new')).toBe(true);
  await presenter.activate();
  expect(presenter.snapshot().conversation).toBeNull();
  expect(created).toEqual([]);
  expect(root.querySelector('[data-zchatgpt-current-title]')?.textContent).toBe('New chat');
});

it('keeps title, New chat, and history inside the sidebar pane below the native toolbar', async () => {
  const { root } = await mountReadyChat({ messages: [] });
  const chrome = root.querySelector('.zchatgpt-chrome');
  const historyButton = root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="history"]');
  const panel = root.querySelector<HTMLElement>('[data-zchatgpt-history]');
  const fresh = root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="new-conversation"]');
  const title = root.querySelector('[data-zchatgpt-current-title]');
  expect(root.contains(chrome)).toBe(true);
  expect(chrome?.contains(historyButton)).toBe(true);
  expect(chrome?.contains(fresh)).toBe(true);
  expect(chrome?.contains(title)).toBe(true);
  expect(root.style.getPropertyValue('--zchatgpt-reader-toolbar-height')).toBe('');
  expect(historyButton?.hidden).toBe(false);
  expect(fresh?.hidden).toBe(false);
  expect(fresh?.getAttribute('aria-label')).toMatch(/New chat/u);
  expect(fresh?.textContent?.trim()).toBe('');
  expect(chrome?.textContent).not.toMatch(/New chat/u);
  expect(panel?.tagName).not.toBe('SELECT');
  expect(root.querySelectorAll('[data-zchatgpt-picker-menu] select')).toHaveLength(0);
  expect(panel?.hasAttribute('hidden')).toBe(true);
  historyButton?.click();
  expect(panel?.hasAttribute('hidden')).toBe(false);
  expect(panel?.querySelector('[data-zchatgpt-history-search]')).toBeTruthy();
});

it('renders an empty transcript as plain, scrollable space with no mark and a working composer', async () => {
  const { root, presenter } = await mountReadyChat({ messages: [] });
  applySidebarStyles(root);
  const transcript = root.querySelector<HTMLElement>('.zchatgpt-transcript')!;
  const messages = root.querySelector<HTMLElement>('[data-zchatgpt-messages]')!;
  // The empty state carries no logo, icon or placeholder box: it is just empty.
  expect(root.querySelector('[data-zchatgpt-empty]')).toBeNull();
  expect(transcript.querySelectorAll('svg')).toHaveLength(0);
  expect(root.textContent).not.toMatch(/Select text in the PDF|ask a question\./iu);
  // The Agent empty state is mounted but hidden while Chat is the selected mode; it carries no
  // '@ chats' or '/ skills' legacy hints.
  expect(root.querySelector<HTMLElement>('[data-zchatgpt-agent-empty]')?.hidden).toBe(true);
  expect(root.textContent).not.toMatch(/@ chats|\/ skills/iu);
  // The transcript keeps its layout and scroll container.
  const styles = (node: HTMLElement) => root.ownerDocument.defaultView!.getComputedStyle(node);
  expect(styles(transcript).display).toBe('flex');
  expect(styles(messages).overflow).toBe('auto');
  Object.defineProperty(messages, 'scrollHeight', { configurable: true, value: 1000 });
  Object.defineProperty(messages, 'clientHeight', { configurable: true, value: 200 });
  messages.scrollTop = 500;
  messages.dispatchEvent(new root.ownerDocument.defaultView!.Event('scroll'));
  expect(presenter.snapshot().scrollTop).toBe(500);
  // The composer still works from the empty state.
  const input = root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')!;
  expect(input.placeholder).toBe('Ask a question…');
  expect(input.disabled).toBe(false);
  expect(root.querySelector('[data-zchatgpt-action="send"]')).not.toBeNull();
});

it('leaves the automatic-PDF preference to Zotero Preferences and off the chat surface', async () => {
  const sent: SendInput[] = [];
  const prepare = vi.fn(() => Promise.resolve(documentA));
  const { root, presenter } = await mountReadyChat({ messages: [], sent, document: { prepare, validate: async () => {}, readEnabled: () => true, writeEnabled: () => {} } });
  // The More menu is gone: the chrome carries no three-dot trigger, no menu node and no glyph.
  expect(root.querySelector('[data-zchatgpt-action="settings"]')).toBeNull();
  expect(root.querySelector('[data-zchatgpt-settings-menu]')).toBeNull();
  expect(root.querySelector('.zchatgpt-conversation-actions, .zchatgpt-settings-content')).toBeNull();
  expect([...root.querySelectorAll('.zchatgpt-chrome button')].map(node => node.getAttribute('aria-label'))).not.toContain('More');
  // The sidebar owns no preference or appearance control: the pane writes the same pref.
  expect(root.querySelector('[data-zchatgpt-automatic-pdf]')).toBeNull();
  expect(root.querySelectorAll('[data-zchatgpt-pref]')).toHaveLength(0);
  expect(root.querySelectorAll('[data-zchatgpt-picker-menu] input, [data-zchatgpt-picker-menu] select')).toHaveLength(0);
  expect(sent).toHaveLength(0);
  // The reader still applies the stored opt-out to background preparation, with no panel to show it.
  await vi.waitFor(() => expect(prepare).toHaveBeenCalled());
  await vi.waitFor(() => expect(presenter.snapshot().document.phase).toBe('ready'));
  expect(root.querySelector('[data-zchatgpt-document-context]')).toBeNull();
  expect(sent).toHaveLength(0);
});

it('keeps account usage reachable in the model picker after the More menu is gone', async () => {
  const rateLimits = [{ label: 'Codex', usedPercent: 42, resetsAt: 1893456000, windowMinutes: 300 }];
  const { root } = await mountReadyChat({ messages: [], rateLimits });
  const picker = root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="picker"]')!;
  picker.click();
  const menu = root.querySelector<HTMLElement>('[data-zchatgpt-picker-menu]')!;
  expect(menu.hidden).toBe(false);
  const account = menu.querySelector<HTMLElement>('[data-zchatgpt-picker-section="account"]')!;
  expect(account.querySelector('.zchatgpt-picker-heading')?.textContent).toBe('Account usage');
  // The figures are the runtime's own report and are rendered verbatim, never as a menu row.
  expect(account.querySelector('[data-zchatgpt-account-usage]')?.textContent).toContain('Codex: 42% used');
  expect(account.querySelector('button')).toBeNull();
  // The section is not a chat setting: closing and reopening the picker keeps it non-interactive.
  picker.click();
  expect(menu.hidden).toBe(true);
  picker.click();
  expect(menu.querySelector('[data-zchatgpt-picker-section="account"]')).not.toBeNull();
});

it('keeps the whole PDF-context cluster off the chat surface while reading stays a background act', async () => {
  const partial = { ...documentA, pages: [documentA.pages[0]!, { ...documentA.pages[1]!, text: '', status: 'empty' as const }] };
  const prepare = vi.fn(() => Promise.resolve(partial)); const sent: SendInput[] = [];
  const { root, presenter } = await mountReadyChat({ messages: [], sent, document: { prepare, validate: async () => {}, readEnabled: () => true, writeEnabled: () => {} } });
  await vi.waitFor(() => expect(presenter.snapshot().document.phase).toBe('ready'));
  // Every piece of the old cluster is gone: the panel, its summary hook, the consent block, the
  // page-range inputs and both buttons, and the scope/context-window prose.
  expect(root.querySelector('[data-zchatgpt-document-context]')).toBeNull();
  expect(root.querySelector('[data-zchatgpt-context-summary]')).toBeNull();
  expect(root.querySelector('.zchatgpt-document-panel')).toBeNull();
  expect(root.querySelector('.zchatgpt-context-range')).toBeNull();
  expect(root.querySelector('[aria-label="First PDF page"]')).toBeNull();
  expect(root.querySelector('[aria-label="Last PDF page"]')).toBeNull();
  expect([...root.querySelectorAll('button')].map(node => node.textContent)).not.toContain('Use pages');
  expect([...root.querySelectorAll('button')].map(node => node.textContent)).not.toContain('Whole PDF');
  expect(root.textContent).not.toMatch(/Model context window|not sent to Codex|Only this PDF is in scope/u);
  // The context-usage ring the owner asked to keep still renders in the composer row.
  expect(root.querySelector('[data-zchatgpt-context-usage]')).not.toBeNull();
  // The two survivors are bare siblings in the chat, not panel contents: the consent line stays
  // hidden until a request actually needs it, and the page indicator is no longer wrapped by any
  // removed container.
  const disclosure = root.querySelector<HTMLElement>('[data-zchatgpt-context-disclosure]')!;
  expect(disclosure.hasAttribute('hidden')).toBe(true);
  expect(disclosure.closest('.zchatgpt-document-panel')).toBeNull();
  expect(root.querySelector<HTMLElement>('[data-zchatgpt-context-source]')?.closest('.zchatgpt-document-panel')).toBeNull();
  // Reading the current PDF is still a local background act: it prepared without sending anything.
  expect(prepare).toHaveBeenCalled();
  expect(sent).toHaveLength(0);
});

it('prepares the current PDF locally in the background with no panel and no model request', async () => {
  const prepare = vi.fn(() => Promise.resolve(documentA)); const sent: SendInput[] = [];
  const { root, presenter } = await mountReadyChat({ messages: [], sent, document: { prepare, validate: async () => {}, readEnabled: () => true, writeEnabled: () => {} } });
  // Opening the sidebar prepares the PDF locally with no click and no model request.
  await vi.waitFor(() => expect(prepare).toHaveBeenCalled());
  await vi.waitFor(() => expect(presenter.snapshot().document.phase).toBe('ready'));
  expect(sent).toHaveLength(0);
  // Nothing about that preparation is rendered: not even a collapsed summary line survives.
  expect(root.querySelector('[data-zchatgpt-document-context]')).toBeNull();
  expect(root.querySelector('[data-zchatgpt-context-summary]')).toBeNull();
});

it('keeps the one-time PDF send consent reachable without the removed panel', async () => {
  const sent: SendInput[] = [];
  const { root, presenter } = await mountReadyChat({ messages: [], sent, document: { prepare: () => Promise.resolve(documentA), validate: async () => {}, readEnabled: () => true, writeEnabled: () => {}, needsDisclosure: () => true } });
  const disclosure = root.querySelector<HTMLElement>('[data-zchatgpt-context-disclosure]')!;
  expect(disclosure.hasAttribute('hidden')).toBe(true);
  // Native explain belongs to Agent; hosted Chat selection actions use the official page actor.
  // With automatic PDF text on, Agent still needs the surviving one-time consent line.
  presenter.setMode('agent');
  await presenter.explain(citationA);
  expect(disclosure.hasAttribute('hidden')).toBe(false);
  const action = disclosure.querySelector<HTMLButtonElement>('[data-zchatgpt-action="acknowledge-context"]')!;
  expect(action.hidden).toBe(false);
  // Acknowledging re-runs the pending explain, so the request is not silently dropped.
  action.click();
  await vi.waitFor(() => expect(sent).toHaveLength(1));
  expect(presenter.snapshot().document.disclosure).toBe(false);
  await vi.waitFor(() => expect(disclosure.hasAttribute('hidden')).toBe(true));
});

it('surfaces the honest text-not-ready refusal now that no panel reports coverage', async () => {
  const unreadable = { ...documentA, pages: documentA.pages.map(page => ({ ...page, text: '', status: 'empty' as const })) };
  const sent: SendInput[] = [];
  const { root, presenter } = await mountReadyChat({ messages: [], sent, document: { prepare: () => Promise.resolve(unreadable), validate: async () => {}, readEnabled: () => true, writeEnabled: () => {} } });
  await vi.waitFor(() => expect(presenter.snapshot().document.phase).toBe('ready'));
  // The panel that used to report "N/M pages with text" and "Text is not silently truncated" is gone,
  // so the request boundary itself has to stay honest: a document with no readable text must be
  // refused out loud rather than sent as an empty context.
  expect(root.querySelector('[data-zchatgpt-document-context]')).toBeNull();
  const alert = root.querySelector<HTMLElement>('[role="alert"]:not([data-zchatgpt-view-error])')!;
  expect(alert.hidden).toBe(true);
  presenter.setQuestion('What does this paper claim?');
  await presenter.send();
  await vi.waitFor(() => expect(alert.hidden).toBe(false));
  expect(alert.textContent).toMatch(/No extractable text/iu);
  // The refusal names no control that no longer exists: the page-range picker is gone.
  expect(alert.textContent).not.toMatch(/range/iu);
  expect(sent).toHaveLength(0);
});

it('shows a failed local PDF read in the composer alert, not only in document state', async () => {
  // The removed panel was the only surface that rendered preparation state. A background read that
  // fails must still reach the composer's coded-error alert, or the owner sees nothing at all.
  const { root } = await mountReadyChat({ document: {
    prepare: () => Promise.reject(new ReaderError('INVALID_REQUEST', 'The current PDF did not finish loading in time to read it locally. Wait for it to load or reopen it; your question is kept.')),
    validate: async () => {}, readEnabled: () => true, writeEnabled: () => {},
  } });
  const alert = root.querySelector<HTMLElement>('[role="alert"]:not([data-zchatgpt-view-error])')!;
  await vi.waitFor(() => expect(alert.hidden).toBe(false));
  expect(alert.getAttribute('role')).toBe('alert');
  expect(alert.textContent).toMatch(/did not finish loading in time/iu);
  // The three local failures stay distinct: this one is neither a revision change nor empty text.
  expect(alert.textContent).not.toMatch(/changed|extractable/iu);
});

it('renders the Codex-like body: no labelled author header, actions in an icon-only strip', async () => {
  const { root } = await mountReadyChat({
    messages: [
      { id: 'u1', requestId: 'r1', role: 'user', phase: null, settings, text: 'What does this mean?', citations: [], status: 'completed' },
      { id: 'a1', requestId: 'r1', role: 'assistant', phase: 'final', settings, text: 'It is a definition.', citations: [], status: 'completed' },
    ],
  });
  // The labelled author row is gone: alignment and the body carry the role instead.
  expect(root.querySelector('.zchatgpt-message-header, .zchatgpt-message-author')).toBeNull();
  const assistant = root.querySelector<HTMLElement>('[data-zchatgpt-message="a1"]')!;
  const body = assistant.querySelector<HTMLElement>(':scope > .zchatgpt-message-body')!;
  expect(body).not.toBeNull();
  expect(body.querySelector('[data-zchatgpt-text]')?.textContent).toContain('definition');
  // The copy control stays icon-only and accessible, inside the action strip anchored to the body.
  const actions = body.querySelector<HTMLElement>(':scope > .zchatgpt-message-actions')!;
  const copy = actions.querySelector<HTMLButtonElement>('[data-zchatgpt-action="copy-answer"]')!;
  expect(copy.getAttribute('aria-label')).toBe('Copy');
  // The only text is the visually-hidden feedback label, so the chip reads as an icon.
  expect(copy.textContent?.trim()).toBe('Copy');
  expect(copy.querySelector('[data-zchatgpt-copy-label]')?.textContent).toBe('Copy');
  expect(copy.querySelector('svg')).not.toBeNull();
  // The user bubble uses the same body wrapper, and its branch action lives in the strip too.
  const user = root.querySelector<HTMLElement>('[data-zchatgpt-message="u1"]')!;
  expect(user.querySelector('.zchatgpt-message-header, .zchatgpt-message-author')).toBeNull();
  expect(user.querySelector('.zchatgpt-message-body [data-zchatgpt-action="branch-message"]')).not.toBeNull();
});

it('renders centered timestamp dividers only from recorded request timings', async () => {
  const dayOne = '2026-08-30T02:00:00.000Z';
  const dayTwo = '2026-08-31T02:00:00.000Z';
  const timing = (requestId: string, acceptedAt: string) => ({ requestId, acceptedAt, firstTextAt: null, settledAt: null });
  const { root } = await mountReadyChat({
    requestTiming: [timing('r1', dayOne), timing('r2', dayTwo)],
    messages: [
      { id: 'u1', requestId: 'r1', role: 'user', phase: null, settings, text: 'First', citations: [], status: 'completed' },
      { id: 'a1', requestId: 'r1', role: 'assistant', phase: 'final', settings, text: 'One', citations: [], status: 'completed' },
      { id: 'u2', requestId: 'r9', role: 'user', phase: null, settings, text: 'No timing recorded', citations: [], status: 'completed' },
      { id: 'u3', requestId: 'r2', role: 'user', phase: null, settings, text: 'Second day', citations: [], status: 'completed' },
    ],
  });
  const dividers = [...root.querySelectorAll<HTMLElement>('[data-zchatgpt-message-time]')];
  // One divider per calendar day, and none for the message whose request has no timing.
  expect(dividers).toHaveLength(2);
  expect(dividers[0]!.textContent).toBe(messageTimeLabel(dayOne, Date.now(), 'en'));
  expect(dividers[1]!.textContent).toBe(messageTimeLabel(dayTwo, Date.now(), 'en'));
  expect(dividers[0]!.nextElementSibling?.getAttribute('data-zchatgpt-message')).toBe('u1');
  expect(dividers[1]!.nextElementSibling?.getAttribute('data-zchatgpt-message')).toBe('u3');
  // A transcript with no recorded request timing renders no divider rather than a fabricated time.
  const none = await mountReadyChat({ messages: [{ id: 'u1', requestId: 'r1', role: 'user', phase: null, settings, text: 'Untimed', citations: [], status: 'completed' }] });
  expect(none.root.querySelectorAll('[data-zchatgpt-message-time]')).toHaveLength(0);
});

it('returns the stopped question, citations and images to the composer', async () => {
  const cancelled: string[] = [];
  const { root, presenter } = await mountReadyChat({
    messages: [],
    cancel: (_conversationId, requestId) => {
      cancelled.push(requestId);
      return Promise.resolve({ requestId, state: 'cancelled' as const, replay: false });
    },
  });
  presenter.addCitation(citationA);
  presenter.addImage(imageA);
  presenter.setQuestion('What does this mean?');
  await presenter.send();
  await vi.waitFor(() => expect(presenter.snapshot().conversation?.activeRequestId).toBeTruthy());
  // Sending consumes the draft as before; the transcript owns the question now.
  expect(presenter.snapshot().draft.question).toBe('');
  await presenter.cancel();
  expect(cancelled).toHaveLength(1);
  // Stop hands the whole question back, including its citations and images, so it can be edited.
  const restored = presenter.snapshot().draft;
  expect(restored.question).toBe('What does this mean?');
  expect(restored.citations.map(citation => citation.id)).toEqual([citationA.id]);
  expect(restored.images.map(image => image.id)).toEqual([imageA.id]);
  expect(root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')!.value).toBe('What does this mean?');
  // A newer draft typed after sending is never clobbered by a second Stop.
  presenter.setQuestion('Newer question');
  await presenter.cancel();
  expect(presenter.snapshot().draft.question).toBe('Newer question');
});

it('degrades a legacy per-chat research profile to the global preferences, visibly', async () => {
  const legacyProfileId = 'legacy-profile-id';
  const legacyDraft = { ...workspaceDraft({ settings: null, paper: paperA, question: 'Legacy question', citations: [], images: [] }), profileId: legacyProfileId };
  const base = historyWorkspace([]);
  const workspace: ReaderWorkspace = {
    ...base,
    // A draft persisted by an older build that still had a per-chat profile control.
    readDraft: () => Promise.resolve({ schemaVersion: 1, paper: paperA, conversationId: null, draft: legacyDraft, scrollTop: 0, pageRange: null, updatedAt: 'now' }),
  };
  const sent: SendInput[] = [];
  const { root, presenter } = await mountReadyChat({ messages: [], sent, workspace });
  await vi.waitFor(() => expect(presenter.snapshot().draft.profileId).toBe(legacyProfileId));
  // The profile the draft points at no longer exists and there is no per-chat control left to clear it.
  expect(presenter.snapshot().workspace?.profiles.some(profile => profile.id === legacyProfileId) ?? false).toBe(false);
  await presenter.send();
  await vi.waitFor(() => expect(sent).toHaveLength(1));
  // The global preferences are authoritative: the dead reference is not applied, and the send happens.
  expect(sent[0]!.workflow?.profileId).toBeNull();
  const alert = root.querySelector<HTMLElement>('[role="alert"]:not([data-zchatgpt-view-error])')!;
  await vi.waitFor(() => expect(alert.hidden).toBe(false));
  expect(alert.textContent).toBe('The saved research profile is no longer available; global preferences apply.');
});

it('keeps the composer in document flow as its references grow, without reserving a fixed transcript height', async () => {
  const { root, presenter } = await mountReadyChat({ messages: [] });
  applySidebarStyles(root);
  const draft = root.querySelector<HTMLElement>('.zchatgpt-draft')!;
  const transcript = root.querySelector<HTMLElement>('.zchatgpt-transcript')!;
  const messages = root.querySelector<HTMLElement>('[data-zchatgpt-messages]')!;
  const styles = (node: HTMLElement) => root.ownerDocument.defaultView!.getComputedStyle(node);
  expect(['absolute', 'fixed']).not.toContain(styles(draft).position);
  expect(draft.previousElementSibling).toBe(transcript);
  expect(styles(messages).paddingBottom).toBe('12px');
  presenter.addCitation(citationA);
  presenter.addImage(imageA);
  expect(draft.querySelectorAll('[data-zchatgpt-citation], [data-zchatgpt-draft-image]')).toHaveLength(2);
  expect(['absolute', 'fixed']).not.toContain(styles(draft).position);
  expect(root.querySelector('[data-zchatgpt-action="attach"]')).toBeNull();
});

it('offers a per-chat Chat / Agent selector that freezes the mode onto the next request', async () => {
  const sent: SendInput[] = [];
  const { root, presenter } = await mountReadyChat({ messages: [], sent });
  const group = root.querySelector<HTMLElement>('[data-zchatgpt-mode-switch]')!;
  const chat = root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="mode-chat"]')!;
  const agent = root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="mode-agent"]')!;
  expect(group.getAttribute('role')).toBe('group');
  expect(group.getAttribute('aria-label')).toBe('Mode');
  // The options carry the segmented-control class, not the generic button skin: the pressed fill and
  // the compact pill are both `.zchatgpt-mode-option[...]`, so a wrong class leaves the selected mode
  // invisible and the control looking like two plain buttons.
  expect(chat.classList.contains('zchatgpt-mode-option')).toBe(true);
  expect(agent.classList.contains('zchatgpt-mode-option')).toBe(true);
  expect(chat.classList.contains('zchatgpt-button')).toBe(false);
  // Chat is the default (D3), and the pressed state is presenter state, not the button's own opinion.
  expect(chat.getAttribute('aria-pressed')).toBe('true');
  expect(agent.getAttribute('aria-pressed')).toBe('false');
  const conversationId = presenter.snapshot().conversation!.id;
  agent.click();
  expect(presenter.snapshot().mode).toBe('agent');
  expect(agent.getAttribute('aria-pressed')).toBe('true');
  expect(chat.getAttribute('aria-pressed')).toBe('false');
  const input = root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')!;
  input.value = 'Explain the method';
  input.dispatchEvent(new root.ownerDocument.defaultView!.Event('input', { bubbles: true }));
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="send"]')!.click();
  await vi.waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0]!.mode).toBe('agent');
  // Switching back after the send does not rewrite the accepted request, and the same conversation
  // continues: the mode changed, the session/context did not.
  chat.click();
  expect(presenter.snapshot().mode).toBe('chat');
  expect(sent).toHaveLength(1); expect(sent[0]!.mode).toBe('agent');
  expect(presenter.snapshot().conversation?.id).toBe(conversationId);
  // A New chat inherits the mode on screen and keeps its own selection through the first send.
  await presenter.newConversation();
  expect(presenter.snapshot().mode).toBe('chat');
  agent.click();
  expect(presenter.snapshot().mode).toBe('agent');
  await presenter.openConversation(conversationId);
  expect(presenter.snapshot().mode).toBe('chat');
});

it('keeps the composer as one card: textarea, footer chip, and circular arrow send', async () => {
  const { root } = await mountReadyChat({ messages: [] });
  const composer = root.querySelector('[data-zchatgpt-composer]');
  const draft = root.querySelector('.zchatgpt-draft');
  const input = root.querySelector('[data-zchatgpt-input]');
  const send = root.querySelector('[data-zchatgpt-action="send"]');
  const picker = root.querySelector('[data-zchatgpt-picker]');
  const bar = root.querySelector('.zchatgpt-composer-bar');
  expect(draft && input && draft.contains(input)).toBe(true);
  expect(composer && send && composer.contains(send)).toBe(true);
  expect(composer && picker && composer.contains(picker)).toBe(true);
  expect(bar && picker && bar.contains(picker)).toBe(true);
  expect(bar && send && bar.contains(send)).toBe(true);
  expect(draft && composer && draft.contains(composer)).toBe(true);
  expect(picker?.textContent).toMatch(/GPT-6 Sol/u);
  expect(send?.classList.contains('zchatgpt-send')).toBe(true);
  expect(root.querySelector('.zchatgpt-footnote')).toBeNull();
  expect(root.getAttribute('aria-label')).toBe('Codex');
  expect(root.querySelectorAll('[data-zchatgpt-picker-menu] select')).toHaveLength(0);
});

it('uses icon-only New chat and history-row action-menu controls with accessible names', async () => {
  const { root } = await mountReadyChat({
    messages: [
      { id: 'm1', requestId: 'r1', role: 'user', phase: null, settings, text: 'What does this mean?', citations: [citationA], status: 'completed' },
      { id: 'm2', requestId: 'r1', role: 'assistant', phase: 'final', settings, text: 'It is a definition.', citations: [], status: 'completed' },
    ],
  });
  const fresh = root.querySelector('[data-zchatgpt-action="new-conversation"]');
  expect(fresh?.getAttribute('aria-label')).toMatch(/New chat/u);
  expect(fresh?.textContent?.trim()).toBe('');
  const copy = root.querySelector('[data-zchatgpt-action="copy-answer"]');
  expect(copy?.getAttribute('aria-label')).toBe('Copy');
  // Copy is a labelled chip now: the visible "Copy" text is the discoverability affordance.
  expect(copy?.querySelector('[data-zchatgpt-copy-label]')?.textContent).toBe('Copy');
  // History deletion is an ellipsis menu with an explicit delete row, not a permanent cross.
  const rowMenu = root.querySelector<HTMLButtonElement>('[data-zchatgpt-history] [data-zchatgpt-action="history-row-menu"]');
  expect(rowMenu).not.toBeNull();
  expect(rowMenu?.getAttribute('aria-label')).toBe('Conversation actions');
  expect(rowMenu?.getAttribute('aria-haspopup')).toBe('dialog');
  expect(rowMenu?.getAttribute('aria-expanded')).toBe('false');
  expect(rowMenu?.textContent?.trim()).toBe('');
  expect(rowMenu?.querySelector('svg path')?.getAttribute('d')).toMatch(/^M3\.25 8/u);
  expect(root.querySelector('[data-zchatgpt-history] [data-zchatgpt-action="delete-conversation"]')).toBeNull();
});

it('closes the current chat from the selected tab cross without confirming, deleting, or losing the chat', async () => {
  const first: Conversation = {
    id: '2e4a6c8e-0b1d-4f3a-a5c7-9e1b3d5f7a90', paper: paperA, title: 'Synthetic Paper A', settings,
    activeRequestId: null, messages: [keptUser('k1')], lastSeq: 0,
    createdAt: '2026-09-10T08:00:00.000Z', updatedAt: '2026-09-10T08:00:00.000Z',
  };
  const second: Conversation = {
    ...first, id: 'aaaaaaaa-0000-4000-8000-000000000002', messages: [keptUser('k2')],
    createdAt: '2026-09-10T09:00:00.000Z', updatedAt: '2026-09-10T09:00:00.000Z',
  };
  const { root, presenter, client } = await mountReadyChat({ messages: [], conversations: [first, second] });
  const remove = vi.spyOn(client, 'deleteConversation');
  const chrome = root.querySelector('.zchatgpt-chrome')!;
  // The selected tab owns the title and the close cross.
  const pill = chrome.querySelector<HTMLElement>('[data-zchatgpt-pane-tab][aria-selected="true"]')!;
  const close = pill.querySelector<HTMLButtonElement>('[data-zchatgpt-action="close-conversation"]')!;
  expect(pill.contains(chrome.querySelector('[data-zchatgpt-current-title]'))).toBe(true);
  // The accessible name says close, not delete; the glyph stays the calm cross.
  expect(close.getAttribute('aria-label')).toBe('Close chat');
  expect(close.textContent?.trim()).toBe('');
  expect(close.querySelector('svg path')?.getAttribute('d')).toBe('M4 4l8 8M12 4l-8 8');
  // The destructive action is gone from the chrome and there is no More menu to hide it in.
  expect(chrome.querySelector('[data-zchatgpt-action="delete-current-conversation"]')).toBeNull();
  expect(root.querySelector('[data-zchatgpt-settings-menu]')).toBeNull();
  expect(chrome.querySelector('[data-zchatgpt-action="delete-conversation"]')).toBeNull();
  // Renaming moved onto the chat's own title: the title button is the rename control, and it is
  // the only place that offers it now that the More menu is gone.
  const rename = chrome.querySelector<HTMLButtonElement>('[data-zchatgpt-current-title]')!;
  expect(rename.dataset.zchatgptAction).toBe('rename-conversation');
  expect(rename.getAttribute('aria-label')).toContain('Synthetic Paper A');
  expect(chrome.querySelector('[data-zchatgpt-action="rename-conversation"]:not([data-zchatgpt-current-title])')).toBeNull();
  // Switch to the second chat, then close it: no prompt, no delete, no data loss.
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="history"]')!.click();
  root.querySelector<HTMLButtonElement>(`[data-zchatgpt-history] button[data-zchatgpt-conversation-id="${second.id}"]`)!.click();
  await vi.waitFor(() => expect(presenter.snapshot().conversation?.id).toBe(second.id));
  close.click();
  expect(remove).not.toHaveBeenCalled();
  // The chat that was already open stays open, so closing this pane lands the reader on that chat —
  // not on an empty pane — and the closed chat is only closed: still listed, never deleted.
  expect(presenter.snapshot().conversation?.id).toBe(first.id);
  expect(presenter.snapshot().openConversations.map(entry => entry.id)).toEqual([first.id]);
  expect(presenter.snapshot().conversations.map(entry => entry.id)).toContain(second.id);
  // The pane still belongs to a chat: the selected tab and its cross are both back on screen.
  expect(chrome.querySelector('[data-zchatgpt-pane-tab][aria-selected="true"]')).not.toBeNull();
  expect(chrome.querySelector<HTMLButtonElement>('[data-zchatgpt-action="close-conversation"]')!.hidden).toBe(false);
  // The chat is still listed in history and re-opening it restores it.
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="history"]')!.click();
  const row = root.querySelector<HTMLButtonElement>(`[data-zchatgpt-history] button[data-zchatgpt-conversation-id="${second.id}"]`);
  expect(row).not.toBeNull();
  row!.click();
  await vi.waitFor(() => expect(presenter.snapshot().conversation?.id).toBe(second.id));
  expect(remove).not.toHaveBeenCalled();
});

/** One stored chat with the given messages, for the two-column tests. */
function chatWith(id: string, title: string, messages: Conversation['messages']): Conversation {
  return {
    id, paper: paperA, title, settings, activeRequestId: null, messages, lastSeq: 0,
    createdAt: '2026-09-10T08:00:00.000Z', updatedAt: '2026-09-10T08:00:00.000Z',
  };
}

/**
 * Two chats open, the second being edited. Other open chats stay as tabs; the dock never splits.
 */
async function mountTwoOpenChats() {
  const other = chatWith('aaaaaaaa-0000-4000-8000-00000000000f', 'The other chat', [
    { id: 'o1', requestId: 'r9', role: 'user', phase: null, settings, text: '第二个问题', citations: [], status: 'completed' },
    { id: 'o2', requestId: 'r9', role: 'assistant', phase: 'final', settings, text: '第二个回答', citations: [], status: 'completed' },
  ]);
  const mounted = await mountReadyChat({
    messages: [
      { id: 'u1', requestId: 'r1', role: 'user', phase: null, settings, text: 'What is defined?', citations: [citationA], status: 'completed', document: documentSummary(documentA) },
      { id: 'a1', requestId: 'r1', role: 'assistant', phase: 'final', settings, citations: [], status: 'completed',
        text: `Definition [page](https://zchatgpt.invalid/source/${documentA.id}/1) and [external](https://example.com/paper).` },
    ],
    conversations: [other],
  });
  const firstId = mounted.presenter.snapshot().openConversations[0]!.id;
  await mounted.presenter.openConversation(other.id);
  return {
    ...mounted, firstId, otherId: other.id,
    activeMessages: mounted.root.querySelector<HTMLElement>('[data-zchatgpt-messages]')!,
  };
}

/**
 * The owner's side-by-side request, seen from the dock: starting a chat keeps the one on screen
 * open as its own tab, and New chat is an unbound tab until the first question is sent.
 */
it('keeps the open chats as a pane strip and switches back to a chat with its own draft', async () => {
  const { root, presenter } = await mountReadyChat({ messages: [] });
  const first = presenter.snapshot().conversation!.id;
  const strip = () => root.querySelector<HTMLElement>('[data-zchatgpt-panes]')!;
  const tabs = () => [...strip().querySelectorAll<HTMLElement>('[data-zchatgpt-pane-tab]')];
  expect(strip().hidden).toBe(false);
  expect(tabs().map(tab => tab.dataset.zchatgptConversationId)).toEqual([first]);
  presenter.setQuestion('第一问');
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="new-conversation"]')!.click();
  await vi.waitFor(() => expect(tabs().map(tab => tab.dataset.zchatgptConversationId)).toEqual([first, 'new-chat']));
  expect(presenter.snapshot().conversation).toBeNull();
  expect(strip().hidden).toBe(false);
  expect(tabs()[0]!.textContent).toBe('Synthetic Paper A');
  expect(tabs()[1]!.textContent).toBe('New chat');
  expect(tabs().map(tab => tab.getAttribute('aria-selected'))).toEqual(['false', 'true']);
  expect(root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')!.value).toBe('');
  // One click brings the first chat back, with its own draft: nothing was replaced or lost. The
  // strip keeps the chip node it already had, so the click target is still the one that was pressed.
  tabs()[0]!.click();
  await vi.waitFor(() => expect(presenter.snapshot().conversation?.id).toBe(first));
  expect(root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')!.value).toBe('第一问');
  expect(tabs().map(tab => tab.getAttribute('aria-selected'))).toEqual(['true', 'false']);
  expect(root.querySelector('[data-zchatgpt-current-title]')!.textContent).toBe('Synthetic Paper A');
  // The New chat tab stayed in the strip; clicking it returns the unbound draft.
  tabs()[1]!.click();
  await vi.waitFor(() => expect(presenter.snapshot().conversation).toBeNull());
  expect(root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')!.value).toBe('');
  expect(tabs().map(tab => tab.getAttribute('aria-selected'))).toEqual(['false', 'true']);
});

it('reaches every open chat from the arrow keys and keeps one chip in the tab order', async () => {
  const { root, presenter } = await mountReadyChat({ messages: [] });
  const first = presenter.snapshot().conversation!.id;
  await presenter.newConversation();
  const strip = root.querySelector<HTMLElement>('[data-zchatgpt-panes]')!;
  const tabs = () => [...strip.querySelectorAll<HTMLElement>('[data-zchatgpt-pane-tab]')];
  // Roving tabindex: only the chat on screen is a stop for Tab; the arrows reach the others.
  expect(tabs().map(tab => tab.tabIndex)).toEqual(tabs().map(tab => (tab.getAttribute('aria-selected') === 'true' ? 0 : -1)));
  expect(tabs()[0]!.tabIndex).toBe(-1);
  const win = root.ownerDocument.defaultView!;
  tabs()[1]!.focus();
  tabs()[1]!.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  expect(root.ownerDocument.activeElement).toBe(tabs()[0]);
  tabs()[0]!.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  expect(root.ownerDocument.activeElement).toBe(tabs()[1]);
  // Moving the focus is not a switch: the chat on screen only changes when a chip is activated.
  expect(presenter.snapshot().conversation?.id).not.toBe(first);
  expect(root.querySelector('[data-zchatgpt-current-title]')!.textContent).toBe('New chat');
});

it('drops the chip of a closed chat and keeps the remaining tab on screen', async () => {
  const { root, presenter } = await mountReadyChat({ messages: [] });
  const first = presenter.snapshot().conversation!.id;
  presenter.setQuestion('第一问');
  await presenter.newConversation();
  const strip = root.querySelector<HTMLElement>('[data-zchatgpt-panes]')!;
  const tabs = () => [...strip.querySelectorAll<HTMLElement>('[data-zchatgpt-pane-tab]')];
  expect(tabs()).toHaveLength(2);
  // Closing the New chat tab from the selected-tab cross leaves the other open chat on screen.
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="close-conversation"]')!.click();
  await vi.waitFor(() => expect(presenter.snapshot().conversation?.id).toBe(first));
  expect(tabs().map(tab => tab.dataset.zchatgptConversationId)).toEqual([first]);
  expect(strip.hidden).toBe(false);
  // Closed, not deleted: the first chat is still listed for this attachment.
  expect(presenter.snapshot().conversations.map(entry => entry.id)).toContain(tabs()[0]!.dataset.zchatgptConversationId);
  expect(root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')!.value).toBe('第一问');
});

/**
 * Cursor Agent is tabs, not two transcripts. A wide dock still shows one chat; the others stay tabs.
 */
it('never lays out a second transcript beside the chat being edited', async () => {
  const { root, presenter, firstId, otherId, activeMessages } = await mountTwoOpenChats();
  expect(presenter.snapshot().conversation?.id).toBe(otherId);
  expect(presenter.snapshot().openConversations.map(chat => chat.id)).toEqual([firstId, otherId]);
  expect(root.querySelector('[data-zchatgpt-pane-preview]')).toBeNull();
  expect(root.querySelectorAll('[data-zchatgpt-messages]')).toHaveLength(1);
  expect(root.querySelectorAll('[data-zchatgpt-composer]')).toHaveLength(1);
  const tabs = [...root.querySelectorAll<HTMLElement>('[data-zchatgpt-pane-tab]')];
  expect(tabs.map(tab => tab.dataset.zchatgptConversationId)).toEqual([firstId, otherId]);
  expect(root.querySelector<HTMLElement>('[data-zchatgpt-panes]')!.hidden).toBe(false);
  expect(activeMessages.textContent).toContain('第二个回答');
  expect(activeMessages.textContent).not.toContain('Definition');
  tabs[0]!.click();
  await vi.waitFor(() => expect(presenter.snapshot().conversation?.id).toBe(firstId));
  expect(root.querySelectorAll('[data-zchatgpt-composer]')).toHaveLength(1);
  expect(root.querySelector('[data-zchatgpt-messages]')!.textContent).toContain('Definition');
  expect(root.querySelector('[data-zchatgpt-messages]')!.textContent).not.toContain('第二个回答');
});

it('never moves focus out of the composer while the owner is typing, even when the other chat answers', async () => {
  const { root, presenter, firstId, emit, activeMessages } = await mountTwoOpenChats();
  const win = root.ownerDocument.defaultView!;
  const input = root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')!;
  input.focus();
  input.value = '正在输入';
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  const event = { conversationId: firstId, requestId: 'r1', at: '2026-09-12T00:00:00.000Z' };
  emit({ ...event, seq: 1, type: 'delta', messageId: 'a2', text: '背景回答' });
  expect(presenter.snapshot().openConversations.find(chat => chat.id === firstId)?.messages.some(message => message.text.includes('背景回答'))).toBe(true);
  expect(activeMessages.textContent).not.toContain('背景回答');
  expect(root.ownerDocument.activeElement).toBe(input);
  expect(input.value).toBe('正在输入');
  expect(presenter.snapshot().conversation?.id).not.toBe(firstId);
  input.dispatchEvent(new win.Event('compositionstart', { bubbles: true }));
  input.value = '正在输入し';
  emit({ ...event, seq: 2, type: 'delta', messageId: 'a2', text: '继续' });
  expect(presenter.snapshot().openConversations.find(chat => chat.id === firstId)?.messages.some(message => message.text.includes('继续'))).toBe(true);
  expect(input.value).toBe('正在输入し');
  expect(root.ownerDocument.activeElement).toBe(input);
});

it('keeps the closed chat’s draft and starts a fresh chat from the empty state on the next send', async () => {
  const { root, presenter } = await mountReadyChat({ messages: [] });
  const closed = presenter.snapshot().conversation!.id;
  const input = root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')!;
  const type = (value: string) => { input.value = value; input.dispatchEvent(new root.ownerDocument.defaultView!.Event('input', { bubbles: true })); };
  type('Draft kept for the closed chat');
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="close-conversation"]')!.click();
  expect(presenter.snapshot().conversation).toBeNull();
  // The empty state still carries a working composer.
  expect(input.disabled).toBe(false);
  expect(root.querySelector('[data-zchatgpt-action="send"]')).not.toBeNull();
  type('Fresh question');
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="send"]')!.click();
  await vi.waitFor(() => expect(presenter.snapshot().conversation?.id).not.toBe(closed));
  // The closed chat keeps its own draft and is still restorable from history.
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="history"]')!.click();
  root.querySelector<HTMLButtonElement>(`[data-zchatgpt-history] button[data-zchatgpt-conversation-id="${closed}"]`)!.click();
  await vi.waitFor(() => expect(presenter.snapshot().conversation?.id).toBe(closed));
  expect(root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')!.value).toBe('Draft kept for the closed chat');
});

/**
 * Two regressions the owner reported together. Closing the current chat used to hide the `+` as
 * well, so the empty state had no way to start again. And the owner chose that closing the last
 * chat for the PDF should collapse the whole dock through the reader's own close path, but must not
 * collapse it while any other chat for that attachment remains.
 */
it('keeps the New chat control available in the empty state after closing the current chat', async () => {
  const { root, presenter } = await mountReadyChat({ messages: [] });
  const fresh = root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="new-conversation"]')!;
  expect(fresh.hidden).toBe(false);
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="close-conversation"]')!.click();
  expect(presenter.snapshot().conversation).toBeNull();
  // Observable DOM state, not a stylesheet claim: the control is present and interactive, and it
  // still starts a chat from the empty state.
  expect(fresh.hidden).toBe(false);
  expect(fresh.disabled).toBe(false);
  expect(fresh.getAttribute('aria-label')).toMatch(/New chat/u);
  // Already on the New chat tab: pressing + again is a no-op, and the unbound tab stays selected.
  fresh.click();
  expect(presenter.snapshot().conversation).toBeNull();
  expect(root.querySelector('[data-zchatgpt-pane-tab][data-zchatgpt-conversation-id="new-chat"][aria-selected="true"]')).not.toBeNull();
});

it('collapses the dock when closing the last chat for the attachment', async () => {
  const closeDock = vi.fn();
  const { root, presenter } = await mountReadyChat({ messages: [], closeDock });
  const fresh = root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="new-conversation"]')!;
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="close-conversation"]')!.click();
  expect(presenter.snapshot().conversation).toBeNull();
  // Nothing is left to list for this attachment, so the reader's own close path runs exactly once.
  expect(closeDock).toHaveBeenCalledTimes(1);
  expect(presenter.closeConversation()).toBe(false);
  expect(closeDock).toHaveBeenCalledTimes(1);
  expect(fresh.hidden).toBe(false);
});

it('does not collapse the dock while other chats for the attachment remain', async () => {
  const first: Conversation = {
    id: '2e4a6c8e-0b1d-4f3a-a5c7-9e1b3d5f7a90', paper: paperA, title: 'Synthetic Paper A', settings,
    activeRequestId: null, messages: [keptUser('k1')], lastSeq: 0,
    createdAt: '2026-09-10T08:00:00.000Z', updatedAt: '2026-09-10T08:00:00.000Z',
  };
  const second: Conversation = {
    ...first, id: 'aaaaaaaa-0000-4000-8000-000000000002', messages: [keptUser('k2')],
    createdAt: '2026-09-10T09:00:00.000Z', updatedAt: '2026-09-10T09:00:00.000Z',
  };
  const closeDock = vi.fn();
  const { root, presenter } = await mountReadyChat({ messages: [], conversations: [first, second], closeDock });
  const fresh = root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="new-conversation"]')!;
  const closeCurrent = () => root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="close-conversation"]')!.click();
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="history"]')!.click();
  root.querySelector<HTMLButtonElement>(`[data-zchatgpt-history] button[data-zchatgpt-conversation-id="${second.id}"]`)!.click();
  await vi.waitFor(() => expect(presenter.snapshot().conversation?.id).toBe(second.id));
  closeCurrent();
  // Closing a chat that is not the last open one leaves the reader on the other open chat.
  expect(presenter.snapshot().conversation?.id).toBe(first.id);
  expect(presenter.snapshot().openConversations.map(entry => entry.id)).toEqual([first.id]);
  expect(closeDock).not.toHaveBeenCalled();
  expect(fresh.hidden).toBe(false);
  // Closing the first chat now is closing the last open pane: the reader returns to its empty state,
  // and the dock still must not collapse because the chat closed above is a history entry here.
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="history"]')!.click();
  root.querySelector<HTMLButtonElement>(`[data-zchatgpt-history] button[data-zchatgpt-conversation-id="${first.id}"]`)!.click();
  await vi.waitFor(() => expect(presenter.snapshot().conversation?.id).toBe(first.id));
  closeCurrent();
  expect(presenter.snapshot().conversation).toBeNull();
  expect(closeDock).not.toHaveBeenCalled();
  expect(fresh.hidden).toBe(false);
});

it('keeps the dock open for a legacy archived record now that it is an ordinary chat', async () => {
  const first: Conversation = {
    id: '2e4a6c8e-0b1d-4f3a-a5c7-9e1b3d5f7a90', paper: paperA, title: 'Synthetic Paper A', settings,
    activeRequestId: null, messages: [keptUser('k1')], lastSeq: 0,
    createdAt: '2026-09-10T08:00:00.000Z', updatedAt: '2026-09-10T08:00:00.000Z',
  };
  const archived: Conversation = {
    ...first, id: 'aaaaaaaa-0000-4000-8000-000000000002', archivedAt: '2026-09-12T09:00:00.000Z',
    messages: [keptUser('k2')],
    createdAt: '2026-09-10T09:00:00.000Z', updatedAt: '2026-09-12T09:00:00.000Z',
  };
  const closeDock = vi.fn();
  const { root, presenter } = await mountReadyChat({ messages: [], conversations: [first, archived], closeDock });
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="close-conversation"]')!.click();
  expect(presenter.snapshot().conversation).toBeNull();
  // The record carries archivedAt but the sidebar has no archive surface: it is an ordinary chat the
  // owner can still open, so it is a reason to keep the dock open.
  expect(closeDock).not.toHaveBeenCalled();
});

it('hides the More details prompt in the transcript while keeping the citation', async () => {
  const { root } = await mountReadyChat({
    messages: [{
      id: 'm1', requestId: 'r1', role: 'user', phase: null, settings,
      text: 'tell me more about this', citations: [citationA], status: 'completed', action: 'explain',
    }],
  });
  const user = root.querySelector('[data-zchatgpt-message][data-role="user"]');
  expect(user?.textContent).not.toContain('tell me more about this');
  expect(user?.textContent).not.toMatch(/请用中文解释/u);
  expect(root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')?.value).not.toContain('tell me more about this');
  expect(root.querySelector('[data-zchatgpt-action="open-citation"]')).toBeTruthy();
});

it('lists history in a grouped panel by paper title and disambiguates a second chat', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-10T12:00:00.000Z'));
  try {
  const first: Conversation = {
    id: '2e4a6c8e-0b1d-4f3a-a5c7-9e1b3d5f7a90', paper: paperA, title: 'Synthetic Paper A', settings,
    activeRequestId: null, messages: [{ id: 'm1', requestId: 'r1', role: 'user', phase: null, settings, text: 'What does this mean?', citations: [citationA], status: 'completed' }],
    lastSeq: 0, createdAt: '2026-09-10T08:00:00.000Z', updatedAt: '2026-09-10T08:00:00.000Z',
  };
  const second: Conversation = {
    ...first, id: 'aaaaaaaa-0000-4000-8000-000000000002', messages: [], createdAt: '2026-09-10T09:00:00.000Z', updatedAt: '2026-09-10T09:00:00.000Z',
  };
  const runtime: RuntimeSnapshot = {
    revision: 0, runtime: 'ready', account: { state: 'signedIn' }, login: null, models: [model], error: null,
  };
  const client: ReaderClient = {
    snapshot: () => structuredClone(runtime), observe: l => { l(structuredClone(runtime)); return () => undefined; },
    refreshAccount: async () => {}, startLogin: () => Promise.reject(new Error()), cancelLogin: async () => {},
    current: () => Promise.resolve(structuredClone(second)), peekCurrent: () => Promise.resolve(structuredClone(second)), newConversation: () => Promise.reject(new Error()),
    list: () => Promise.resolve([structuredClone(first), structuredClone(second)]), select: () => Promise.reject(new Error()),
    get: () => Promise.resolve(structuredClone(second)), send: () => Promise.reject(new Error()),
    request: () => Promise.resolve({ requestId: 'r1', state: 'completed', replay: false }),
    cancel: () => Promise.reject(new Error()),
    deleteConversation: () => Promise.reject(new Error()),
    diagnostics: vi.fn(() => Promise.resolve({
      pluginVersion: '0.3.0-alpha.1', runtimeVersion: '0.144.1', errorCode: null, requestCount: 0, states: {},
      storageLocation: SHAREABLE_STORAGE_LOCATION,
    })),
    subscribe: () => () => undefined, close: async () => {},
  };
  const presenter = new ConversationPresenter(presenterContext(paperA, 'Synthetic Paper A'), {
    client: () => Promise.resolve(client), ensureAgent: () => Promise.resolve(), chatUnavailableReason: () => null, openAuthorization: () => undefined, uuid: () => 'id', now: () => 'now',
  });
  await presenter.activate();
  const doc = documentOf();
  const body = doc.createElement('div');
  const root = renderReaderShell(body, { title: 'Synthetic Paper A', key: paperA.attachmentKey, libraryID: paperA.libraryId });
  mountChatView(root, presenter);
  const panel = root.querySelector('[data-zchatgpt-history]');
  expect(panel?.querySelector('select')).toBeNull();
  expect(panel?.querySelector('[data-zchatgpt-history-search]')).toBeTruthy();
  expect(panel?.textContent).toMatch(/Today/u);
  const labels = [...root.querySelectorAll('[data-zchatgpt-history] .zchatgpt-history-item[data-zchatgpt-conversation-id]')].map(node => node.textContent?.trim());
  expect(labels.join('\n')).not.toMatch(/Untitled|What does this mean/u);
  expect(labels.some(label => label?.includes('Synthetic Paper A'))).toBe(true);
  expect(labels.filter(label => label?.includes('Synthetic Paper A')).length).toBe(2);
  expect(labels.some(label => /Synthetic Paper A · 2|Synthetic Paper A · 09:00/u.test(label ?? ''))).toBe(true);
  expect(root.querySelector('[data-zchatgpt-history] [data-zchatgpt-action="history-row-menu"]')).toBeTruthy();
  expect(root.querySelector('[data-zchatgpt-action="pin-conversation"]')).toBeNull();
  } finally { now.mockRestore(); }
});

function agedConversation(id: string, title: string, updatedAt: string, overrides: Partial<Conversation> = {}): Conversation {
  return {
    id, paper: paperA, title, settings, activeRequestId: null,
    messages: [{ id: `${id}-m1`, requestId: `${id}-r1`, role: 'user', phase: null, settings, text: 'A recorded question.', citations: [], status: 'completed' }],
    lastSeq: 1, createdAt: updatedAt, updatedAt, ...overrides,
  };
}

function historyEntry(index: number, overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  const hour = String(index).padStart(2, '0');
  return {
    id: `aaaaaaaa-0000-4000-8000-${String(index + 50).padStart(12, '0')}`,
    paper: paperA,
    title: `Workspace chat ${index}`,
    identity: { title: 'Workspace Paper Title', authors: [] },
    createdAt: `2026-09-10T${hour}:00:00.000Z`,
    updatedAt: `2026-09-10T${hour}:00:00.000Z`,
    messageCount: 2, preview: `Workspace preview ${index}`, hasDraft: false, activeRequestId: null,
    ...overrides,
  };
}

function historyWorkspace(entries: HistoryEntry[]): ReaderWorkspace {
  return {
    settings: () => Promise.resolve(defaultSettings()),
    saveSettings: () => Promise.resolve(),
    saveSkill: () => Promise.reject(new ReaderError('UNSUPPORTED_INTERACTION', 'Not used in this test.')),
    importSkill: () => Promise.reject(new ReaderError('UNSUPPORTED_INTERACTION', 'Not used in this test.')),
    deleteSkill: () => Promise.resolve(),
    saveDraft: () => Promise.resolve(),
    readDraft: () => Promise.resolve(null),
    deleteDraft: () => Promise.resolve(),
    history: (query, scope) => Promise.resolve(entries
      .filter(entry => (scope?.archived ? !!entry.archivedAt : !entry.archivedAt))
      .filter(entry => (query ? entry.title.includes(query) : true))),
    readConversation: () => Promise.reject(new ReaderError('NOT_FOUND', 'Not used in this test.')),
    currentConversation: () => Promise.resolve(null),
    snapshotChat: () => Promise.reject(new ReaderError('UNSUPPORTED_INTERACTION', 'Not used in this test.')),
  };
}

it('groups workspace history entries single-line and keeps the PDF title and preview accessible', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 8, 10, 12, 0, 0, 0).getTime());
  try {
    const entry = (index: number, days: number, overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
      id: `aaaaaaaa-0000-4000-8000-${String(index + 40).padStart(12, '0')}`,
      paper: paperA,
      title: `Workspace chat ${index}`,
      identity: { title: 'Workspace Paper Title', authors: [] },
      createdAt: new Date(2026, 8, 10 - days, 8, 0, 0, 0).toISOString(),
      updatedAt: new Date(2026, 8, 10 - days, 9, 0, 0, 0).toISOString(),
      messageCount: 2, preview: 'Workspace preview text', hasDraft: false, activeRequestId: null,
      ...overrides,
    });
    const history = [
      entry(0, 0, { messageCount: 0, preview: '' }),
      entry(1, 1),
      entry(2, 3),
      entry(3, 12),
      entry(4, 0, { activeRequestId: 'workspace-live' }),
    ];
    const { root } = await mountReadyChat({ workspace: historyWorkspace(history) });
    // This is the real runtime path: it must share the conversation path's buckets and row shape.
    expect([...root.querySelectorAll<HTMLElement>('[data-zchatgpt-history-group]')].map(node => node.dataset.zchatgptHistoryGroup))
      .toEqual(['Today', 'Yesterday', 'Previous 7 days', 'Older']);
    const items = [...root.querySelectorAll<HTMLButtonElement>('[data-zchatgpt-history] button.zchatgpt-history-item')];
    expect(items).toHaveLength(history.length);
    expect(items.every(item => item.querySelectorAll('.zchatgpt-history-title').length === 1 && !item.querySelector('.zchatgpt-history-preview'))).toBe(true);
    expect(root.querySelector('[data-zchatgpt-history-status="draft"]')).not.toBeNull();
    expect(root.querySelector('[data-zchatgpt-history-status="active"]')).not.toBeNull();
    expect(root.querySelector('[data-zchatgpt-history-status="done"]')).not.toBeNull();
    const done = items.find(item => item.querySelector('[data-zchatgpt-history-status="done"]'))!;
    expect(done.getAttribute('aria-label')).toContain('Workspace Paper Title');
    expect(done.getAttribute('aria-label')).toContain('Workspace preview text');
    // The workspace port reaches the same delete path: every row carries a labelled action menu,
    // and no archive mutation surface is invented.
    const menus = [...root.querySelectorAll<HTMLButtonElement>('[data-zchatgpt-history] [data-zchatgpt-action="history-row-menu"]')];
    expect(menus).toHaveLength(history.length);
    expect(menus.every(node => node.getAttribute('aria-label') === 'Conversation actions' && node.textContent?.trim() === '')).toBe(true);
    expect(root.querySelector('[data-zchatgpt-history] [data-zchatgpt-action="delete-conversation"]')).toBeNull();
    expect(root.querySelector('[data-zchatgpt-history] [data-zchatgpt-action="archive-conversation"]')).toBeNull();
    expect(root.querySelector('[data-zchatgpt-history] [data-zchatgpt-action="restore-conversation"]')).toBeNull();
    expect(root.querySelector('[data-zchatgpt-history] [data-zchatgpt-archived]')).toBeNull();
  } finally { clock.mockRestore(); }
});

it('deletes a workspace history row through its own menu and confirmation, keeping the open list, scroll and focus', async () => {
  const entries = [historyEntry(0), historyEntry(1)];
  const live: HistoryEntry[] = [...entries];
  const conversationFor = (entry: HistoryEntry): Conversation => ({
    id: entry.id, paper: entry.paper, title: entry.title, settings, activeRequestId: null,
    messages: [], lastSeq: 0, createdAt: entry.createdAt, updatedAt: entry.updatedAt,
  });
  const workspace: ReaderWorkspace = {
    ...historyWorkspace(live),
    readConversation: id => {
      const entry = live.find(candidate => candidate.id === id);
      return entry ? Promise.resolve(conversationFor(entry)) : Promise.reject(new ReaderError('NOT_FOUND', 'Missing.'));
    },
  };
  const remove: ReaderClient['deleteConversation'] = vi.fn((_paper, id) => {
    const index = live.findIndex(entry => entry.id === id);
    if (index < 0) return Promise.reject(new Error('missing workspace entry'));
    const [removed] = live.splice(index, 1);
    return Promise.resolve(conversationFor(removed!));
  });
  const { root } = await mountReadyChat({ workspace, deleteConversation: remove });
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="history"]')!.click();
  const panel = root.querySelector<HTMLElement>('[data-zchatgpt-history]')!;
  const list = panel.querySelector<HTMLElement>('.zchatgpt-history-list')!;
  const listIds = () => [...panel.querySelectorAll<HTMLButtonElement>('.zchatgpt-history-list button.zchatgpt-history-item[data-zchatgpt-conversation-id]')].map(node => node.dataset.zchatgptConversationId!);
  expect(listIds().sort()).toEqual([entries[0]!.id, entries[1]!.id].sort());
  // The owner is scrolled down and has a row's own menu trigger focused when they delete it.
  list.scrollTop = 48;
  const menu = panel.querySelector<HTMLButtonElement>(`[data-zchatgpt-action="history-row-menu"][data-zchatgpt-conversation-id="${entries[0]!.id}"]`)!;
  expect(menu).not.toBeNull();
  menu.focus();
  menu.click();
  expect(menu.getAttribute('aria-expanded')).toBe('true');
  const ask = panel.querySelector<HTMLButtonElement>('[data-zchatgpt-action="delete-conversation"]')!;
  expect(ask.textContent).toBe('Delete local conversation…');
  ask.click();
  // One confirmation stands between the owner and the removal, and it names the real scope.
  const confirm = panel.querySelector<HTMLButtonElement>('[data-zchatgpt-action="confirm-delete-conversation"]')!;
  expect(confirm).not.toBeNull();
  expect(panel.querySelector('.zchatgpt-history-menu-confirm')?.textContent).toMatch(/Delete this local conversation/u);
  // Nothing is removed until the confirmation is actually used.
  expect(remove).not.toHaveBeenCalled();
  confirm.click();
  await vi.waitFor(() => expect(listIds()).not.toContain(entries[0]!.id));
  expect(remove).toHaveBeenCalledWith(expect.anything(), entries[0]!.id);
  expect(listIds()).toEqual([entries[1]!.id]);
  // Removing a row does not throw the reader back to the top of the list, and focus stays inside
  // the panel instead of escaping to the page body.
  expect(list.scrollTop).toBe(48);
  expect(panel.contains(root.ownerDocument.activeElement)).toBe(true);
  expect(root.ownerDocument.activeElement).not.toBe(root.ownerDocument.body);
});

it('closes the history row menu on Escape and on an outside click, returning focus to its trigger', async () => {
  const entries = [historyEntry(0), historyEntry(1)];
  const { root } = await mountReadyChat({ workspace: historyWorkspace(entries) });
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="history"]')!.click();
  const panel = root.querySelector<HTMLElement>('[data-zchatgpt-history]')!;
  const list = panel.querySelector<HTMLElement>('.zchatgpt-history-list')!;
  const trigger = panel.querySelector<HTMLButtonElement>(`[data-zchatgpt-action="history-row-menu"][data-zchatgpt-conversation-id="${entries[0]!.id}"]`)!;
  const menu = root.querySelector<HTMLElement>('[data-zchatgpt-history-menu]')!;
  expect(menu.hidden).toBe(true);
  trigger.click();
  expect(menu.hidden).toBe(false);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  // Escape closes the menu and returns focus to the control that opened it, without closing the PDF
  // or touching the official page.
  menu.dispatchEvent(new root.ownerDocument.defaultView!.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(menu.hidden).toBe(true);
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(root.ownerDocument.activeElement).toBe(trigger);
  // The menu is an overlay inside the panel, so clicking the row underneath is an outside click.
  trigger.click();
  expect(menu.hidden).toBe(false);
  list.dispatchEvent(new root.ownerDocument.defaultView!.MouseEvent('click', { bubbles: true }));
  expect(menu.hidden).toBe(true);
  // Closing the whole panel from its trigger also takes the row menu with it.
  trigger.click();
  expect(menu.hidden).toBe(false);
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="history"]')!.click();
  expect(panel.hidden).toBe(true);
  expect(menu.hidden).toBe(true);
});

it('buckets history into Today, Yesterday, Previous 7 days and Older without losing a timestamp', () => {
  const now = new Date(2026, 8, 10, 12, 0, 0, 0).getTime();
  const at = (day: number, hour = 12, minute = 0) => new Date(2026, 8, day, hour, minute, 0, 0).toISOString();
  expect(HISTORY_BUCKETS).toEqual(['Today', 'Yesterday', 'Previous 7 days', 'Older']);
  // Just now, earlier today and a clock-skewed future stamp all stay in Today.
  expect(historyGroup(at(10, 11), now)).toBe('Today');
  expect(historyGroup(at(10, 0, 1), now)).toBe('Today');
  expect(historyGroup(at(11), now)).toBe('Today');
  expect(historyGroup(at(9, 23, 59), now)).toBe('Yesterday');
  expect(historyGroup(at(9, 0, 0), now)).toBe('Yesterday');
  expect(historyGroup(at(8), now)).toBe('Previous 7 days');
  expect(historyGroup(at(7), now)).toBe('Previous 7 days');
  expect(historyGroup(at(3, 0, 0), now)).toBe('Previous 7 days');
  expect(historyGroup(at(2, 23, 59), now)).toBe('Older');
  expect(historyGroup(at(1), now)).toBe('Older');
  expect(historyGroup('2000-01-01T00:00:00.000Z', now)).toBe('Older');
  expect(historyGroup('not-a-date', now)).toBe('Today');
  // Every timestamp lands in exactly one rendered bucket, including invalid and future ones.
  const stamps = Array.from({ length: 64 }, (_, index) => new Date(2026, 8, 10 - index, 12, 0, 0, 0).toISOString()).concat(['not-a-date', '2030-01-01T00:00:00.000Z']);
  const grouped = groupHistory(stamps, stamp => stamp, now);
  expect(grouped.flatMap(group => group.items)).toHaveLength(stamps.length);
  expect(grouped.every(group => HISTORY_BUCKETS.includes(group.bucket))).toBe(true);
});

it('renders every conversation exactly once across the four buckets and never invents an archive', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 8, 10, 12, 0, 0, 0).getTime());
  try {
    const ages = [0, 1, 2, 3, 7, 8, 10, 40, 400];
    const conversations = ages.map((days, index) => agedConversation(
      `aaaaaaaa-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
      `Chat ${index + 1}`,
      new Date(2026, 8, 10 - days, 9, 0, 0, 0).toISOString(),
      index === 0 ? { messages: [] } : {},
    ));
    const { root, presenter } = await mountReadyChat({ conversations });
    const expected = presenter.snapshot().conversations.map(entry => entry.id).sort();
    const rendered = [...root.querySelectorAll<HTMLButtonElement>('[data-zchatgpt-history] button.zchatgpt-history-item[data-zchatgpt-conversation-id]')].map(node => node.dataset.zchatgptConversationId!);
    expect(rendered.sort()).toEqual(expected);
    expect(new Set(rendered).size).toBe(rendered.length);
    const grouped = [...root.querySelectorAll<HTMLElement>('[data-zchatgpt-history-group]')].map(node => node.dataset.zchatgptHistoryGroup);
    expect(grouped).toEqual(['Today', 'Yesterday', 'Previous 7 days', 'Older']);
    // There is no archive concept in the sidebar any more: no section node is invented, no archive
    // action exists, and the word never appears.
    expect(root.querySelector('[data-zchatgpt-history] [data-zchatgpt-archived]')).toBeNull();
    expect(root.querySelector('[data-zchatgpt-history] [data-zchatgpt-action="archive-conversation"]')).toBeNull();
    expect(root.querySelector('[data-zchatgpt-history]')?.textContent).not.toMatch(/Archived|归档/u);
  } finally { clock.mockRestore(); }
});

it('renders single-line history rows with a per-status glyph and keeps the dropped second line accessible', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 8, 10, 12, 0, 0, 0).getTime());
  try {
    const done = agedConversation('aaaaaaaa-0000-4000-8000-000000000011', 'Finished chat', '2026-09-10T09:00:00.000Z', {
      paperIdentity: { title: 'Distinct PDF Title', authors: [] },
      messages: [{ id: 'm-done', requestId: 'r-done', role: 'assistant', phase: 'final', settings, text: 'A preview body that used to sit on a second line.', citations: [], status: 'completed' }],
    });
    const draft = agedConversation('2e4a6c8e-0b1d-4f3a-a5c7-9e1b3d5f7a90', 'Draft chat', '2026-09-10T09:05:00.000Z', { messages: [] });
    const active = agedConversation('aaaaaaaa-0000-4000-8000-000000000013', 'Active chat', '2026-09-10T09:10:00.000Z', { activeRequestId: 'live-request' });
    const { root } = await mountReadyChat({ messages: [], conversations: [draft, done, active] });
    const item = root.querySelector<HTMLButtonElement>(`[data-zchatgpt-history] button.zchatgpt-history-item[data-zchatgpt-conversation-id="${done.id}"]`)!;
    // The primary line is the title; the second line carries the paper and the last activity, never
    // the dropped preview text.
    expect(item.querySelectorAll('.zchatgpt-history-title')).toHaveLength(1);
    expect(item.querySelector('.zchatgpt-history-preview')).toBeNull();
    expect(item.querySelectorAll('small, br')).toHaveLength(0);
    expect(item.querySelector('.zchatgpt-history-title')?.textContent).toBe('Finished chat');
    const meta = item.querySelector('.zchatgpt-history-meta')!;
    expect(meta.textContent).toContain('Distinct PDF Title');
    expect(meta.textContent).not.toContain('A preview body that used to sit on a second line.');
    // The PDF title and preview survive for assistive tech and hover instead of being deleted.
    expect(item.getAttribute('aria-label')).toContain('Distinct PDF Title');
    expect(item.getAttribute('aria-label')).toContain('A preview body that used to sit on a second line.');
    expect(item.title).toBe(item.getAttribute('aria-label'));
    // A calm, distinct glyph per status; the active mark carries no animation.
    const status = (id: string) => root.querySelector<HTMLElement>(`[data-zchatgpt-history] button.zchatgpt-history-item[data-zchatgpt-conversation-id="${id}"] .zchatgpt-history-status`)!;
    expect(status(done.id).dataset.zchatgptHistoryStatus).toBe('done');
    expect(status(draft.id).dataset.zchatgptHistoryStatus).toBe('draft');
    expect(status(active.id).dataset.zchatgptHistoryStatus).toBe('active');
    const glyphs = [status(done.id), status(draft.id), status(active.id)].map(node => node.querySelector('svg path')?.getAttribute('d') ?? '');
    expect(glyphs.every(glyph => glyph.length > 0)).toBe(true);
    expect(new Set(glyphs).size).toBe(3);
    expect(status(active.id).getAttribute('data-zchatgpt-animated')).toBeNull();
  } finally { clock.mockRestore(); }
});

it('lists a workspace record carrying archivedAt as an ordinary chat in the one listing', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 8, 10, 12, 0, 0, 0).getTime());
  try {
    const active = [historyEntry(1), historyEntry(2)];
    const archived = historyEntry(3, { archivedAt: '2026-09-10T09:00:00.000Z' });
    const { root } = await mountReadyChat({ workspace: historyWorkspace([...active, archived]) });
    const panel = root.querySelector<HTMLElement>('[data-zchatgpt-history]')!;
    const ids = [...panel.querySelectorAll<HTMLButtonElement>('.zchatgpt-history-list button.zchatgpt-history-item[data-zchatgpt-conversation-id]')].map(node => node.dataset.zchatgptConversationId!);
    // One ordinary listing: the record with archivedAt appears exactly once, beside the others.
    expect(ids.sort()).toEqual([...active, archived].map(entry => entry.id).sort());
    expect(ids.filter(id => id === archived.id)).toHaveLength(1);
    // It keeps the live row shape and the status glyph.
    const item = panel.querySelector<HTMLElement>(`.zchatgpt-history-list button.zchatgpt-history-item[data-zchatgpt-conversation-id="${archived.id}"]`)!;
    const row = item.closest<HTMLElement>('.zchatgpt-history-row')!;
    expect(row.querySelectorAll('.zchatgpt-history-title')).toHaveLength(1);
    expect(row.querySelector('.zchatgpt-history-status')?.getAttribute('data-zchatgpt-history-status')).toBe('done');
    // No archive surface survives: no section, no toggle, no per-row action, not even the word.
    expect(panel.querySelector('[data-zchatgpt-archived]')).toBeNull();
    expect(panel.querySelector('[data-zchatgpt-action="toggle-archived"]')).toBeNull();
    expect(panel.querySelector('[data-zchatgpt-action="archive-conversation"]')).toBeNull();
    expect(panel.querySelector('[data-zchatgpt-action="restore-conversation"]')).toBeNull();
    expect(panel.textContent).not.toMatch(/Archived|归档/u);
  } finally { clock.mockRestore(); }
});

it('shows a host-list record carrying archivedAt as an ordinary row and deletes it through its menu', async () => {
  const first = agedConversation('aaaaaaaa-0000-4000-8000-000000000031', 'First chat', '2026-09-10T09:00:00.000Z');
  const second = agedConversation('aaaaaaaa-0000-4000-8000-000000000032', 'Second chat', '2026-09-10T09:01:00.000Z', { archivedAt: '2026-09-10T09:02:00.000Z' });
  const { root } = await mountReadyChat({ conversations: [first, second] });
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="history"]')!.click();
  const panel = root.querySelector<HTMLElement>('[data-zchatgpt-history]')!;
  const rowIds = () => [...panel.querySelectorAll<HTMLButtonElement>('.zchatgpt-history-list button.zchatgpt-history-item[data-zchatgpt-conversation-id]')].map(node => node.dataset.zchatgptConversationId!);
  // Both chats render in one list; the archivedAt record is not hidden, restyled or relocated.
  expect(rowIds()).toContain(first.id);
  expect(rowIds().filter(id => id === second.id)).toHaveLength(1);
  expect(panel.querySelector('[data-zchatgpt-archived]')).toBeNull();
  expect(panel.querySelector('[data-zchatgpt-action="archive-conversation"]')).toBeNull();
  expect(panel.querySelector('[data-zchatgpt-action="restore-conversation"]')).toBeNull();
  // The row's own menu reaches the same confirmed removal path; the menu itself never opens the chat.
  const menu = panel.querySelector<HTMLButtonElement>(`[data-zchatgpt-action="history-row-menu"][data-zchatgpt-conversation-id="${second.id}"]`)!;
  expect(menu).not.toBeNull();
  expect(menu.textContent?.trim()).toBe('');
  expect(menu.getAttribute('aria-label')).toBe('Conversation actions');
  menu.focus();
  menu.click();
  expect(panel.hidden).toBe(false);
  panel.querySelector<HTMLButtonElement>('[data-zchatgpt-action="delete-conversation"]')!.click();
  panel.querySelector<HTMLButtonElement>('[data-zchatgpt-action="confirm-delete-conversation"]')!.click();
  await vi.waitFor(() => expect(rowIds()).not.toContain(second.id));
  expect(rowIds()).toContain(first.id);
  // The row the owner acted on is gone, so focus falls back inside the still-open panel instead of
  // escaping to the page body.
  expect(panel.contains(root.ownerDocument.activeElement)).toBe(true);
  expect(root.ownerDocument.activeElement).not.toBe(root.ownerDocument.body);
});

it('finds a chat that only the archived store scope holds, in the one listing', async () => {
  const active = historyEntry(4, { title: 'Alpha notes' });
  const archived = historyEntry(5, { title: 'Beta notes', archivedAt: '2026-09-10T09:00:00.000Z' });
  const { root } = await mountReadyChat({ workspace: historyWorkspace([active, archived]) });
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="history"]')!.click();
  const panel = root.querySelector<HTMLElement>('[data-zchatgpt-history]')!;
  const search = panel.querySelector<HTMLInputElement>('[data-zchatgpt-history-search]')!;
  const listIds = () => [...panel.querySelectorAll<HTMLButtonElement>('.zchatgpt-history-list button.zchatgpt-history-item[data-zchatgpt-conversation-id]')].map(node => node.dataset.zchatgptConversationId!);
  expect(listIds().sort()).toEqual([active.id, archived.id].sort());
  search.value = 'Beta';
  search.dispatchEvent(new root.ownerDocument.defaultView!.Event('input', { bubbles: true }));
  // The only match lives in the archived store scope; losing it would be silent data loss.
  await vi.waitFor(() => expect(listIds()).toEqual([archived.id]));
  expect(panel.querySelector('[data-zchatgpt-archived]')).toBeNull();
  search.value = '';
  search.dispatchEvent(new root.ownerDocument.defaultView!.Event('input', { bubbles: true }));
  await vi.waitFor(() => expect(listIds().sort()).toEqual([active.id, archived.id].sort()));
});

it('filters a fallback record carrying archivedAt in the same single listing', async () => {
  const alpha = agedConversation('aaaaaaaa-0000-4000-8000-000000000041', 'Alpha notes', '2026-09-10T09:00:00.000Z');
  const beta = agedConversation('aaaaaaaa-0000-4000-8000-000000000042', 'Beta notes', '2026-09-10T09:01:00.000Z', { archivedAt: '2026-09-10T09:02:00.000Z' });
  const { root } = await mountReadyChat({ conversations: [alpha, beta] });
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="history"]')!.click();
  const panel = root.querySelector<HTMLElement>('[data-zchatgpt-history]')!;
  const search = panel.querySelector<HTMLInputElement>('[data-zchatgpt-history-search]')!;
  const visible = () => [...panel.querySelectorAll<HTMLElement>('.zchatgpt-history-list .zchatgpt-history-row')].filter(row => !row.hidden).map(row => row.querySelector<HTMLElement>('button.zchatgpt-history-item')!.dataset.zchatgptConversationId);
  expect(visible()).toContain(alpha.id);
  expect(visible()).toContain(beta.id);
  search.value = 'Beta';
  search.dispatchEvent(new root.ownerDocument.defaultView!.Event('input', { bubbles: true }));
  expect(visible()).toEqual([beta.id]);
  expect(panel.querySelector('[data-zchatgpt-archived]')).toBeNull();
  search.value = '';
  search.dispatchEvent(new root.ownerDocument.defaultView!.Event('input', { bubbles: true }));
  expect(visible()).toContain(alpha.id);
  expect(visible()).toContain(beta.id);
});

it('keeps history search filtering and keyboard navigation working in the single-line panel', async () => {
  const alpha = agedConversation('aaaaaaaa-0000-4000-8000-000000000021', 'Alpha notes', '2026-09-10T09:00:00.000Z');
  const beta = agedConversation('aaaaaaaa-0000-4000-8000-000000000022', 'Beta notes', '2026-09-10T09:01:00.000Z');
  const { root } = await mountReadyChat({ conversations: [alpha, beta] });
  const trigger = root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="history"]')!;
  const panel = root.querySelector<HTMLElement>('[data-zchatgpt-history]')!;
  const search = root.querySelector<HTMLInputElement>('[data-zchatgpt-history-search]')!;
  trigger.click();
  expect(panel.hidden).toBe(false);
  const view = root.ownerDocument.defaultView!;
  const rows = () => [...root.querySelectorAll<HTMLButtonElement>('[data-zchatgpt-history] button.zchatgpt-history-item')];
  search.focus();
  expect(root.ownerDocument.activeElement).toBe(search);
  // Home/End continue editing the search text instead of jumping the row cursor.
  for (const key of ['Home', 'End']) search.dispatchEvent(new view.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  expect(root.ownerDocument.activeElement).toBe(search);
  // ArrowDown from the search field moves into the first row.
  search.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  expect(root.ownerDocument.activeElement).toBe(rows()[0]);
  // Escape closes the panel and returns focus to its trigger.
  panel.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(panel.hidden).toBe(true);
  expect(root.ownerDocument.activeElement).toBe(trigger);
  // The local fallback filter hides non-matching rows and restores them when cleared.
  trigger.click();
  search.value = 'Beta';
  search.dispatchEvent(new view.Event('input', { bubbles: true }));
  const rowOf = (title: string) => rows().find(row => row.querySelector('.zchatgpt-history-title')?.textContent === title)?.closest('.zchatgpt-history-row');
  expect(rowOf('Alpha notes')?.hasAttribute('hidden')).toBe(true);
  expect(rowOf('Beta notes')?.hasAttribute('hidden')).toBe(false);
  search.value = '';
  search.dispatchEvent(new view.Event('input', { bubbles: true }));
  expect(rowOf('Alpha notes')?.hasAttribute('hidden')).toBe(false);
});

it('renames the open chat from its own title chip and closes the form on success', async () => {
  const { root, presenter } = await mountReadyChat();
  const rename = root.querySelector<HTMLButtonElement>('[data-zchatgpt-current-title]')!;
  const form = root.querySelector<HTMLElement>('.zchatgpt-rename-form')!;
  expect(form.hidden).toBe(true);
  expect(rename.getAttribute('aria-expanded')).toBe('false');
  rename.click();
  expect(form.hidden).toBe(false);
  expect(rename.getAttribute('aria-expanded')).toBe('true');
  // The field starts from the live title and owns the focus, so renaming is keyboard-reachable.
  const input = form.querySelector<HTMLInputElement>('input')!;
  expect(input.value).toBe('Synthetic Paper A');
  expect(root.ownerDocument.activeElement).toBe(input);
  input.value = '  先验讨论  ';
  form.querySelector<HTMLButtonElement>('[data-zchatgpt-action="save-conversation-name"]')!.click();
  await vi.waitFor(() => expect(form.hidden).toBe(true));
  expect(presenter.snapshot().conversation?.title).toBe('先验讨论');
  // Focus returns to the control that opened the popover instead of dropping to the document.
  expect(root.ownerDocument.activeElement).toBe(rename);
});

it('closes the rename popover on Escape and on an outside click without renaming', async () => {
  const { root, presenter } = await mountReadyChat();
  const rename = root.querySelector<HTMLButtonElement>('[data-zchatgpt-current-title]')!;
  const form = root.querySelector<HTMLElement>('.zchatgpt-rename-form')!;
  rename.click();
  const input = form.querySelector<HTMLInputElement>('input')!;
  input.value = 'Discarded';
  input.dispatchEvent(new root.ownerDocument.defaultView!.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(form.hidden).toBe(true);
  expect(root.ownerDocument.activeElement).toBe(rename);
  expect(presenter.snapshot().conversation?.title).toBe('Synthetic Paper A');
  // An outside click closes it too; the draft textarea is outside the popover.
  rename.click();
  expect(form.hidden).toBe(false);
  root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')!.click();
  expect(form.hidden).toBe(true);
  expect(presenter.snapshot().conversation?.title).toBe('Synthetic Paper A');
});

it('reports a failed rename in the view error slot and keeps the form open', async () => {
  const { root } = await mountReadyChat({ rename: () => Promise.reject(new Error('/Users/somebody/private/state.json missing')) });
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-current-title]')!.click();
  const form = root.querySelector<HTMLElement>('.zchatgpt-rename-form')!;
  form.querySelector<HTMLButtonElement>('[data-zchatgpt-action="save-conversation-name"]')!.click();
  const slot = root.querySelector<HTMLElement>('[data-zchatgpt-view-error]')!;
  await vi.waitFor(() => expect(slot.hidden).toBe(false));
  expect(slot.textContent).not.toContain('/Users/somebody');
  expect(form.hidden).toBe(false);
});


it('keeps the composer free of voice input and third-party chat branding', async () => {
  const { root } = await mountReadyChat();
  const composer = root.querySelector<HTMLElement>('[data-zchatgpt-composer]')!;
  const controls = [...composer.querySelectorAll('button')]
    .map(node => `${node.getAttribute('aria-label') ?? ''} ${node.getAttribute('title') ?? ''} ${node.textContent ?? ''}`).join('\n');
  expect(controls).not.toMatch(/voice|microphone|dictate|\bmic\b|ChatGPT/iu);
  expect(composer.querySelector('[data-zchatgpt-input]')?.getAttribute('placeholder')).toBe('Ask a question…');
});


it('keeps the transcript pinned when an answer image finishes loading', async () => {
  const generated = { ...imageA, origin: { kind: 'generated' as const, model: settings.model } };
  const { root } = await mountReadyChat({ messages: [
    { id: 'image-output', requestId: 'r1', role: 'assistant', phase: 'final', settings, text: 'A generated explanation', citations: [], status: 'completed', generatedImages: [generated] },
  ] });
  const transcript = root.querySelector<HTMLElement>('[data-zchatgpt-messages]')!;
  Object.defineProperty(transcript, 'scrollHeight', { get: () => 1000, configurable: true });
  Object.defineProperty(transcript, 'clientHeight', { get: () => 200, configurable: true });
  transcript.scrollTop = 900;
  transcript.scrollTop = 500;
  transcript.querySelector('img')!.dispatchEvent(new (root.ownerDocument.defaultView!.Event)('load'));
  expect(transcript.scrollTop).toBe(1000);
});

it('leaves the transcript alone when an image loads while the reader is scrolled away', async () => {
  const generated = { ...imageA, origin: { kind: 'generated' as const, model: settings.model } };
  const { root, presenter } = await mountReadyChat({ messages: [
    { id: 'image-output', requestId: 'r1', role: 'assistant', phase: 'final', settings, text: 'A generated explanation', citations: [], status: 'completed', generatedImages: [generated] },
  ] });
  const transcript = root.querySelector<HTMLElement>('[data-zchatgpt-messages]')!;
  Object.defineProperty(transcript, 'scrollHeight', { get: () => 1000, configurable: true });
  Object.defineProperty(transcript, 'clientHeight', { get: () => 200, configurable: true });
  transcript.scrollTop = 100;
  presenter.setQuestion('keep reading');
  transcript.querySelector('img')!.dispatchEvent(new (root.ownerDocument.defaultView!.Event)('load'));
  expect(transcript.scrollTop).toBe(100);
});

it('shows pending image thumbnails in the composer and can remove them', async () => {
  const { root, presenter } = await mountReadyChat({ messages: [], draftImages: [imageA] });
  const thumb = root.querySelector('[data-zchatgpt-draft-image]');
  expect(thumb?.querySelector('img')?.getAttribute('src')).toBe(imageA.dataUrl);
  expect(root.querySelector('[data-zchatgpt-action="remove-image"]')?.getAttribute('aria-label')).toMatch(/Remove/u);
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="remove-image"]')?.click();
  expect(presenter.snapshot().draft.images).toHaveLength(0);
  expect(root.querySelector('[data-zchatgpt-draft-image]')).toBeNull();
});

it('pastes a clipboard screenshot into the composer and includes it on send', async () => {
  const sent: SendInput[] = [];
  const { root, presenter } = await mountReadyChat({ messages: [], sent });
  const png = Uint8Array.from(atob(TINY_PNG_DATA_URL.split(',')[1]!), c => c.charCodeAt(0));
  const composer = root.querySelector('[data-zchatgpt-composer]')!;
  const view = root.ownerDocument.defaultView!;
  const file = new view.File([png], 'screenshot.png', { type: 'image/png' });
  const event = new view.Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', {
    value: {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
      files: [file],
    },
  });
  composer.dispatchEvent(event);
  await vi.waitFor(() => {
    expect(presenter.snapshot().draft.images).toHaveLength(1);
  });
  expect(presenter.snapshot().draft.images).toEqual([{
    id: imageA.id,
    name: 'screenshot.png',
    mime: 'image/png',
    dataUrl: TINY_PNG_DATA_URL,
  }]);
  expect(root.querySelector('[data-zchatgpt-draft-image] img')?.getAttribute('src')).toBe(TINY_PNG_DATA_URL);
  presenter.setQuestion('图里的符号是什么？');
  await presenter.send();
  expect(sent).toHaveLength(1);
  expect(sent[0]?.images).toEqual([{
    id: imageA.id,
    name: 'screenshot.png',
    mime: 'image/png',
    dataUrl: TINY_PNG_DATA_URL,
  }]);
});

it('pastes a screenshot from the reader chrome document only while the composer owns focus', async () => {
  const { root, presenter } = await mountReadyChat({ messages: [] });
  const png = Uint8Array.from(atob(TINY_PNG_DATA_URL.split(',')[1]!), c => c.charCodeAt(0));
  const view = root.ownerDocument.defaultView as unknown as Window & {
    Cc?: unknown;
    Ci?: unknown;
    Services?: unknown;
  };
  const transferable = {
    init() { /* unused */ },
    addDataFlavor() { /* unused */ },
    getTransferData(_flavor: string, data: { value?: unknown }) {
      data.value = { data: String.fromCharCode(...png) };
    },
  };
  view.Ci = { nsIClipboard: { kGlobalClipboard: 1 }, nsITransferable: {}, nsISupportsCString: {} };
  view.Cc = {
    '@mozilla.org/widget/transferable;1': { createInstance: () => transferable },
    '@mozilla.org/widget/clipboard;1': {
      getService: () => ({
        kGlobalClipboard: 1,
        hasDataMatchingFlavors: (list: string[]) => list.includes('image/png') || list.includes('public.png'),
        getData: () => undefined,
      }),
    },
  };
  view.Services = {
    clipboard: {
      kGlobalClipboard: 1,
      hasDataMatchingFlavors: (list: string[]) => list.includes('image/png') || list.includes('public.png'),
      getData: (trans: typeof transferable) => {
        trans.getTransferData = transferable.getTransferData.bind(transferable);
      },
    },
  };
  const event = new view.Event('paste', { bubbles: true, cancelable: true }) as unknown as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', {
    value: { items: [], files: [], types: [] },
  });
  root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')!.focus();
  root.ownerDocument.dispatchEvent(event);
  await vi.waitFor(() => {
    expect(presenter.snapshot().draft.images).toHaveLength(1);
  });
  expect(presenter.snapshot().draft.images[0]).toEqual({
    id: imageA.id,
    name: 'screenshot.png',
    mime: 'image/png',
    dataUrl: TINY_PNG_DATA_URL,
  });
  expect(root.querySelector('[data-zchatgpt-draft-image] img')?.getAttribute('src')).toBe(TINY_PNG_DATA_URL);
});

it('does not send on Enter while IME composition is active', async () => {
  const { root, presenter } = await mountReadyChat({ messages: [] });
  const send = vi.spyOn(presenter, 'send');
  const input = root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')!;
  const view = root.ownerDocument.defaultView!;
  input.dispatchEvent(new view.Event('compositionstart', { bubbles: true }));
  input.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  expect(send).not.toHaveBeenCalled();
});

it('surfaces the presenter’s own sentence for a coded view failure and keeps the constant otherwise', async () => {
  const { root } = await mountReadyChat({ messages: [] });
  const viewError = root.querySelector<HTMLElement>('[data-zchatgpt-view-error]')!;
  const plus = root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="composer-plus"]')!;
  plus.click();
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="pick-file"]')!.click();
  await vi.waitFor(() => expect(viewError.textContent).toBe('Attaching a file is unavailable.'));
  expect(viewError.hidden).toBe(false);
});

it('shows the constant sentence when a failed view action has no coded message', async () => {
  const { root } = await mountReadyChat({ messages: [], rename: () => Promise.reject(new Error('raw host detail')) });
  const viewError = root.querySelector<HTMLElement>('[data-zchatgpt-view-error]')!;
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-current-title]')!.click();
  const name = root.querySelector<HTMLInputElement>('.zchatgpt-rename-form input')!;
  name.value = 'Renamed';
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="save-conversation-name"]')!.click();
  await vi.waitFor(() => expect(viewError.hidden).toBe(false));
  expect(viewError.textContent).toBe('This action could not be completed.');
});

it('attaches a Cmd+V screenshot from the plugin clipboard when the reader paste carries no image', async () => {
  const reads = vi.fn(() => Promise.resolve({ images: [imageA] }));
  const { root, presenter } = await mountReadyChat({ messages: [], clipboardImages: reads });
  const input = root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')!;
  const view = root.ownerDocument.defaultView!;
  input.focus();
  // A reader can deliver Cmd+V to its own chrome: no DOM paste data reaches this realm at all.
  input.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'v', metaKey: true, bubbles: true, cancelable: true }));
  const event = new view.Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', { value: { items: [], files: [], types: [] } });
  input.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  await vi.waitFor(() => expect(presenter.snapshot().draft.images).toHaveLength(1));
  expect(reads).toHaveBeenCalledTimes(1);
  expect(root.querySelector('[data-zchatgpt-draft-image] img')?.getAttribute('src')).toBe(imageA.dataUrl);
});

it('never attaches the same Cmd+V screenshot twice when both clipboard routes see it', async () => {
  const reads = vi.fn(() => Promise.resolve({ images: [imageA] }));
  const { root, presenter } = await mountReadyChat({ messages: [], clipboardImages: reads });
  const input = root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')!;
  const view = root.ownerDocument.defaultView!;
  const png = Uint8Array.from(atob(TINY_PNG_DATA_URL.split(',')[1]!), c => c.charCodeAt(0));
  const file = new view.File([png], 'screenshot.png', { type: 'image/png' });
  input.focus();
  input.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'v', metaKey: true, bubbles: true, cancelable: true }));
  const event = new view.Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', { value: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }], files: [file] } });
  input.dispatchEvent(event);
  await vi.waitFor(() => expect(presenter.snapshot().draft.images).toHaveLength(1));
  await new Promise(resolve => setTimeout(resolve, 1));
  expect(presenter.snapshot().draft.images).toHaveLength(1);
  expect(reads).not.toHaveBeenCalled();
});

it('falls back to the plugin clipboard when the reader realm claims an image but yields no bytes', async () => {
  // Zotero's reader window can answer `hasDataMatchingFlavors` for an image without being able to
  // hand over usable bytes (a macOS screenshot pasteboard reports an image family the reader realm
  // cannot read). Claiming the gesture and then attaching nothing is exactly the "Cmd+V does
  // nothing" symptom, so the plugin realm must still be consulted.
  const reads = vi.fn(() => Promise.resolve({ images: [imageA] }));
  const { root, presenter } = await mountReadyChat({ messages: [], clipboardImages: reads });
  const input = root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')!;
  const view = root.ownerDocument.defaultView! as unknown as { Cc: unknown; Ci: unknown; Services: unknown; Event: typeof Event };
  const transferable = { flavors: [] as string[], init: () => undefined, addDataFlavor(flavor: string) { this.flavors.push(flavor); }, getTransferData() { throw new Error('flavor missing'); } };
  view.Cc = { '@mozilla.org/widget/transferable;1': { createInstance: () => transferable } };
  view.Ci = { nsITransferable: {}, nsIClipboard: {}, nsIInputStream: {}, nsIBinaryInputStream: {} };
  view.Services = { clipboard: { kGlobalClipboard: 1, hasDataMatchingFlavors: () => true, getData: () => undefined } };
  input.focus();
  const event = new view.Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', { value: { items: [], files: [], types: [] } });
  try {
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(presenter.snapshot().draft.images).toHaveLength(1));
  } finally {
    delete view.Cc; delete view.Ci; delete view.Services;
  }
});

it('continues to the plugin clipboard when the reader-window clipboard route throws', async () => {
  const reads = vi.fn(() => Promise.resolve({ images: [imageA] }));
  const { root, presenter } = await mountReadyChat({ messages: [], clipboardImages: reads });
  const input = root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')!;
  const view = root.ownerDocument.defaultView! as unknown as { Cc: unknown; Ci: unknown; Services: unknown; Event: typeof Event };
  view.Cc = { '@mozilla.org/widget/transferable;1': { createInstance: () => { throw new Error('nsIClipboard unavailable'); } } };
  view.Ci = { nsITransferable: {}, nsIClipboard: {} };
  view.Services = { clipboard: { kGlobalClipboard: 1, hasDataMatchingFlavors: () => { throw new Error('flavor probe failed'); }, getData: () => { throw new Error('getData failed'); } } };
  input.focus();
  const event = new view.Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', { value: { items: [], files: [], types: [] } });
  try {
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(presenter.snapshot().draft.images).toHaveLength(1));
    expect(reads).toHaveBeenCalledTimes(1);
    expect(root.querySelector<HTMLElement>('[data-zchatgpt-view-error]')!.hidden).toBe(true);
  } finally {
    delete view.Cc; delete view.Ci; delete view.Services;
  }
});

it('says why a pasted image was refused instead of leaving the draft empty and silent', async () => {
  // The pasteboard really carried an image this sidebar cannot attach. The owner must learn which
  // rule refused it: a paste that appears to do nothing is indistinguishable from a broken paste.
  const reads = vi.fn(() => Promise.resolve({ images: [], refused: 'too-large' as const }));
  const { root } = await mountReadyChat({ messages: [], clipboardImages: reads });
  const input = root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')!;
  const view = root.ownerDocument.defaultView!;
  input.focus();
  const event = new view.Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', { value: { items: [], files: [], types: [] } });
  input.dispatchEvent(event);
  const error = root.querySelector<HTMLElement>('[data-zchatgpt-view-error]')!;
  await vi.waitFor(() => expect(error.hidden).toBe(false));
  expect(error.textContent).toBe('That image is larger than the 2 MB limit, so it was not attached.');
  expect(root.querySelectorAll('[data-zchatgpt-draft-image]')).toHaveLength(0);
});

it('names an unsupported pasted image format when the DOM paste carries bytes it cannot attach', async () => {
  const { root } = await mountReadyChat({ messages: [] });
  const input = root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')!;
  const view = root.ownerDocument.defaultView!;
  const file = new view.File([new TextEncoder().encode('%PDF-1.7')], 'screenshot.png', { type: 'image/png' });
  input.focus();
  const event = new view.Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', { value: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }], files: [file] } });
  input.dispatchEvent(event);
  const error = root.querySelector<HTMLElement>('[data-zchatgpt-view-error]')!;
  await vi.waitFor(() => expect(error.hidden).toBe(false));
  expect(error.textContent).toBe('That image format cannot be attached. Use PNG, JPEG, GIF or WebP.');
  expect(root.querySelectorAll('[data-zchatgpt-draft-image]')).toHaveLength(0);
});

it('leaves a plain-text paste to the textarea and never reads the pasteboard image', async () => {
  const reads = vi.fn(() => Promise.resolve({ images: [imageA] }));
  const { root, presenter } = await mountReadyChat({ messages: [], clipboardImages: reads });
  const input = root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')!;
  const view = root.ownerDocument.defaultView!;
  const event = new view.Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', { value: { items: [], files: [], types: ['text/plain'] } });
  input.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  await Promise.resolve();
  expect(presenter.snapshot().draft.images).toHaveLength(0);
  expect(reads).not.toHaveBeenCalled();
});
it('keeps dock type at 1 when the open PDF zooms', async () => {
  const readerZoom = { factor: 1, ins: 0, outs: 0, resets: 0 };
  const { root } = await mountReadyChat({ messages: [], readerZoom });
  const input = root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')!;
  const view = root.ownerDocument.defaultView!;
  const zoom = (init: KeyboardEventInit) => input.dispatchEvent(new view.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  zoom({ key: '=', code: 'Equal', metaKey: true });
  expect(readerZoom.ins).toBe(1);
  expect(root.style.getPropertyValue('--zchatgpt-chat-text-scale')).toBe('1');
  zoom({ key: '-', code: 'Minus', metaKey: true });
  expect(readerZoom.outs).toBe(1);
  expect(root.style.getPropertyValue('--zchatgpt-chat-text-scale')).toBe('1');
  zoom({ key: '0', code: 'Digit0', metaKey: true });
  expect(readerZoom.resets).toBe(1);
  expect(root.style.getPropertyValue('--zchatgpt-chat-text-scale')).toBe('1');
});

it('shows one current title and keeps the chat switch reachable from history', async () => {
  const first: Conversation = {
    id: '2e4a6c8e-0b1d-4f3a-a5c7-9e1b3d5f7a90', paper: paperA, title: 'Synthetic Paper A', settings,
    activeRequestId: null, messages: [keptUser('k1')], lastSeq: 0,
    createdAt: '2026-09-10T08:00:00.000Z', updatedAt: '2026-09-10T08:00:00.000Z',
  };
  const second: Conversation = {
    ...first, id: 'aaaaaaaa-0000-4000-8000-000000000002', messages: [keptUser('k2')],
    createdAt: '2026-09-10T09:00:00.000Z', updatedAt: '2026-09-10T09:00:00.000Z',
  };
  const { root, presenter } = await mountReadyChat({ messages: [], conversations: [first, second] });
  const chrome = root.querySelector('.zchatgpt-chrome')!;
  expect(chrome.querySelectorAll('[data-zchatgpt-current-title]')).toHaveLength(1);
  expect(chrome.querySelector('[data-zchatgpt-current-title]')?.textContent).toBe('Synthetic Paper A');
  expect(chrome.querySelectorAll('[data-zchatgpt-pane-tab][aria-selected="true"]')).toHaveLength(1);
  expect(chrome.querySelector('[data-zchatgpt-action="delete-conversation"], [data-zchatgpt-action="delete-current-conversation"]')).toBeNull();
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="history"]')!.click();
  root.querySelector<HTMLButtonElement>(`[data-zchatgpt-history] button[data-zchatgpt-conversation-id="${second.id}"]`)!.click();
  await vi.waitFor(() => expect(presenter.snapshot().conversation?.id).toBe(second.id));
  expect(chrome.querySelector('[data-zchatgpt-current-title]')?.textContent).toBe('Synthetic Paper A · 2');
  expect(chrome.querySelectorAll('[data-zchatgpt-pane-tab][aria-selected="true"]')).toHaveLength(1);
});

it('keeps local history reachable when the account signs out and the runtime becomes unavailable', async () => {
  const { root, updateRuntime } = await mountReadyChat();
  updateRuntime({ account: { state: 'signedOut' }, models: [], runtime: 'error' });
  const history = root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="history"]')!;
  expect(history.hidden).toBe(false);
  expect(history.disabled).toBe(false);
  history.click();
  expect(root.querySelector<HTMLElement>('[data-zchatgpt-history]')!.hidden).toBe(false);
  expect(root.querySelector('[data-zchatgpt-history]')!.textContent).toContain('Synthetic Paper A');
});

it('preserves existing message nodes and a persistent unread indicator across unrelated updates', async () => {
  const { root, presenter, emit } = await mountReadyChat();
  const messages = root.querySelector<HTMLElement>('[data-zchatgpt-messages]')!;
  const originalMessage = messages.querySelector('[data-zchatgpt-message="m1"]')!;
  const originalText = originalMessage.querySelector('[data-zchatgpt-text]')!;
  Object.defineProperties(messages, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 200 } });
  messages.scrollTop = 100;
  const event = { conversationId: presenter.snapshot().conversation!.id, requestId: 'r2', messageId: 'm2', at: '2026-09-12T00:00:00Z' };
  emit({ ...event, seq: 1, type: 'delta', text: 'A new answer' });
  expect(messages.querySelector('[data-zchatgpt-message="m1"]')).toBe(originalMessage);
  expect(originalMessage.querySelector('[data-zchatgpt-text]')).toBe(originalText);
  expect(messages.scrollTop).toBe(100);
  const unread = root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="new-content"]')!;
  expect(unread.hidden).toBe(false);
  presenter.addImage(imageA);
  presenter.setSettings({ ...settings, effort: 'low' });
  expect(unread.hidden).toBe(false);
  expect(messages.scrollTop).toBe(100);
  unread.click();
  expect(unread.hidden).toBe(true);
  expect(messages.scrollTop).toBe(messages.scrollHeight);
  messages.scrollTop = 100;
  emit({ ...event, seq: 2, type: 'delta', text: ' with more detail' });
  expect(unread.hidden).toBe(false);
  messages.scrollTop = 800;
  messages.dispatchEvent(new root.ownerDocument.defaultView!.Event('scroll'));
  expect(unread.hidden).toBe(true);
});

it('does not intercept a screenshot pasted into another editor in the reader document', async () => {
  const { root, presenter } = await mountReadyChat({ messages: [] });
  const view = root.ownerDocument.defaultView!;
  const outside = root.ownerDocument.createElement('textarea');
  root.ownerDocument.body.append(outside); outside.focus();
  const png = Uint8Array.from(atob(TINY_PNG_DATA_URL.split(',')[1]!), c => c.charCodeAt(0));
  const file = new view.File([png], 'screenshot.png', { type: 'image/png' });
  const event = new view.Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', { value: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }], files: [file] } });
  outside.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  await Promise.resolve();
  expect(presenter.snapshot().draft.images).toHaveLength(0);
});

it('navigates model options with the keyboard, returns focus, and ignores Escape during IME composition', async () => {
  const { root, presenter } = await mountReadyChat({ messages: [] });
  const view = root.ownerDocument.defaultView!;
  const picker = root.querySelector<HTMLButtonElement>('[data-zchatgpt-picker]')!;
  const menu = root.querySelector<HTMLElement>('[data-zchatgpt-picker-menu]')!;
  const input = root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')!;
  const send = vi.spyOn(presenter, 'send');
  picker.focus();
  picker.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  expect(menu.hidden).toBe(false);
  expect(menu.contains(root.ownerDocument.activeElement)).toBe(true);
  const first = root.ownerDocument.activeElement;
  first!.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  expect(root.ownerDocument.activeElement).not.toBe(first);
  root.ownerDocument.activeElement!.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(menu.hidden).toBe(true);
  expect(root.ownerDocument.activeElement).toBe(picker);
  picker.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-setting="effort"][data-zchatgpt-value="low"]')!.click();
  expect(presenter.snapshot().draft.settings?.effort).toBe('low');
  // Choosing a value never closes the picker: effort, speed and model are set in one visit, and the
  // keyboard stays on the row that was just chosen.
  expect(menu.hidden).toBe(false);
  const chosen = root.querySelector<HTMLButtonElement>('[data-zchatgpt-setting="effort"][data-zchatgpt-value="low"]')!;
  expect(chosen.getAttribute('aria-checked')).toBe('true');
  expect(root.ownerDocument.activeElement).toBe(chosen);
  expect(send).not.toHaveBeenCalled();
  input.focus();
  input.dispatchEvent(new view.Event('compositionstart', { bubbles: true }));
  input.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(menu.hidden).toBe(false);
  input.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  expect(send).not.toHaveBeenCalled();
});

it('keeps the picker open while effort, speed and model are configured in one visit', async () => {
  const { root, presenter } = await mountReadyChat({ messages: [] });
  const picker = root.querySelector<HTMLButtonElement>('[data-zchatgpt-picker]')!;
  const menu = root.querySelector<HTMLElement>('[data-zchatgpt-picker-menu]')!;
  const view = root.ownerDocument.defaultView!;
  picker.click();
  expect(menu.hidden).toBe(false);
  const effort = root.querySelector<HTMLButtonElement>('[data-zchatgpt-setting="effort"][data-zchatgpt-value="high"]')!;
  effort.click();
  expect(presenter.snapshot().draft.settings?.effort).toBe('high');
  expect(menu.hidden).toBe(false);
  expect(root.ownerDocument.activeElement).toBe(root.querySelector('[data-zchatgpt-setting="effort"][data-zchatgpt-value="high"]'));
  const model = root.querySelector<HTMLButtonElement>('[data-zchatgpt-setting="model"][data-zchatgpt-value="gpt-6-sol"]')!;
  model.click();
  expect(presenter.snapshot().draft.settings?.model).toBe('gpt-6-sol');
  expect(menu.hidden).toBe(false);
  expect(root.ownerDocument.activeElement).toBe(root.querySelector('[data-zchatgpt-setting="model"][data-zchatgpt-value="gpt-6-sol"]'));
  // Only the picker button, an outside click or Escape leaves the menu.
  picker.click();
  expect(menu.hidden).toBe(true);
  picker.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  expect(menu.hidden).toBe(false);
  menu.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(menu.hidden).toBe(true);
  picker.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  root.ownerDocument.body.dispatchEvent(new view.MouseEvent('click', { bubbles: true }));
  expect(menu.hidden).toBe(true);
});

it('enables live Sol selection when a new Agent draft has no stored settings yet', async () => {
  const { root, presenter, updateRuntime } = await mountReadyChat({ messages: [], noCurrent: true, runtimeModels: [] });
  presenter.setMode('agent');
  updateRuntime({ revision: 1, models: [model], account: { state: 'signedIn' } });
  const picker = root.querySelector<HTMLButtonElement>('[data-zchatgpt-picker]')!;
  await vi.waitFor(() => expect(picker.dataset.summary).toContain('Sol'));
  expect(picker.disabled).toBe(false);
  picker.click();
  const option = await vi.waitFor(() => {
    const row = root.querySelector<HTMLButtonElement>('[data-zchatgpt-setting="model"][data-zchatgpt-value="gpt-6-sol"]');
    expect(row).not.toBeNull(); return row!;
  });
  expect(option.disabled).toBe(false);
  option.click();
  expect(presenter.snapshot().draft.settings?.model).toBe('gpt-6-sol');
});

it('closes the model popover on Escape and click outside', async () => {
  const { root } = await mountReadyChat({ messages: [] });
  const picker = root.querySelector<HTMLButtonElement>('[data-zchatgpt-picker]')!;
  const menu = root.querySelector<HTMLElement>('[data-zchatgpt-picker-menu]')!;
  const input = root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')!;
  const view = root.ownerDocument.defaultView!;
  picker.click();
  expect(menu.hidden).toBe(false);
  input.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(menu.hidden).toBe(true);
  picker.click();
  expect(menu.hidden).toBe(false);
  root.ownerDocument.body.dispatchEvent(new view.MouseEvent('click', { bubbles: true }));
  expect(menu.hidden).toBe(true);
});

it('keeps the plus at the composer start and puts the one mode switch in the shell bar', async () => {
  const { root } = await mountReadyChat();
  const leading = root.querySelector<HTMLElement>('[data-zchatgpt-composer-leading]')!;
  const controls = [...leading.querySelectorAll<HTMLButtonElement>('button')];
  // The plus is the only control at the composer's start now: the mode switch is not duplicated
  // here, it lives once in the shared shell bar.
  expect(controls.map(node => node.dataset.zchatgptAction)).toEqual(['composer-plus']);
  expect(root.querySelector('[data-zchatgpt-composer-leading] [data-zchatgpt-mode-switch]')).toBeNull();
  expect(root.querySelector('[data-zchatgpt-shell-bar] [data-zchatgpt-mode-switch]')).not.toBeNull();
  const plus = controls[0]!;
  expect(plus.dataset.zchatgptPlus).toBe('');
  expect(plus.getAttribute('aria-label')).toBe('Add images or context');
  expect(root.querySelector('[data-zchatgpt-action="capture-region"]')).toBeNull();
  expect(root.querySelector('.zchatgpt-attachment-menu, .zchatgpt-input-actions')).toBeNull();
  expect([...root.querySelectorAll('button')].filter(node => node.textContent?.trim() === '@')).toHaveLength(0);
});

it('groups the plus popover into titled sections with title and description rows', async () => {
  const { root } = await mountReadyChat({ messages: [] });
  const menu = root.querySelector<HTMLElement>('[data-zchatgpt-plus-menu]')!;
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="composer-plus"]')!.click();
  const groups = [...menu.querySelectorAll<HTMLElement>('.zchatgpt-plus-group')].filter(group => !group.hidden);
  expect(groups).toHaveLength(3);
  expect(groups[0]!.querySelector('.zchatgpt-plus-heading')?.textContent).toBe('Attach');
  expect(groups[1]!.querySelector('.zchatgpt-plus-heading')?.textContent).toBe('Reference');
  expect(groups[2]!.querySelector('.zchatgpt-plus-heading')?.textContent).toBe('Skill');
  const rows = [...menu.querySelectorAll<HTMLButtonElement>('.zchatgpt-plus-row')];
  expect(rows.map(row => row.dataset.zchatgptAction)).toEqual(['pick-file', 'composer-references', 'composer-skill']);
  for (const row of rows) {
    expect(row.tagName).toBe('BUTTON');
    const title = row.querySelector('.zchatgpt-plus-row-title')?.textContent ?? '';
    const description = row.querySelector('.zchatgpt-plus-row-description')?.textContent ?? '';
    expect(title.trim()).not.toBe('');
    expect(description.trim()).not.toBe('');
    // The accessible name is the title alone, never the concatenated row text.
    expect(row.getAttribute('aria-label')).toBe(title);
  }
  // Capturing one PDF page and capturing the selected region both left the popover: the page-number
  // field is gone with the first, and the second is now a direct composer control.
  expect(menu.querySelector('input[type="number"]')).toBeNull();
  expect(menu.querySelector('[data-zchatgpt-action="capture-page"]')).toBeNull();
  expect(menu.querySelector('[data-zchatgpt-action="capture-region"]')).toBeNull();
  expect(menu.textContent).not.toMatch(/Capture page|Capture selected region/u);
});

it('sends the explicit Figure command to the Reader Agent hook', async () => {
  const explainFigure = vi.fn(() => Promise.resolve());
  const { root } = await mountReadyChat({ messages: [], explainFigure });
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="composer-plus"]')!.click();
  const command = root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="explain-figure"]')!;
  expect(command.closest<HTMLElement>('.zchatgpt-plus-group')?.hidden).toBe(false);
  command.click();
  await vi.waitFor(() => expect(explainFigure).toHaveBeenCalledWith('Explain the selected Figure and mark the key visual components.'));
});

it('separates the reference and skill rows into their own titled groups', async () => {
  const { root } = await mountReadyChat({ messages: [], workspace: historyWorkspace([]) });
  const view = root.ownerDocument.defaultView!;
  const input = root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')!;
  const plus = root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="composer-plus"]')!;
  const menu = root.querySelector<HTMLElement>('[data-zchatgpt-plus-menu]')!;
  const reference = menu.querySelector<HTMLButtonElement>('[data-zchatgpt-action="composer-references"]')!;
  const skill = menu.querySelector<HTMLButtonElement>('[data-zchatgpt-action="composer-skill"]')!;
  expect(reference.querySelector('.zchatgpt-plus-row-title')?.textContent).toBe('Add references');
  expect(skill.querySelector('.zchatgpt-plus-row-title')?.textContent).toBe('Add a skill');
  // The reference row advertises no skills and the skill row advertises no references.
  expect(reference.textContent).not.toMatch(/skill/iu);
  expect(skill.textContent).not.toMatch(/reference/iu);
  const commandMenu = root.querySelector<HTMLElement>('.zchatgpt-command-menu')!;
  // Reference opens the '@' chooser, which is a reference-type chooser and says so.
  plus.click(); reference.click();
  await vi.waitFor(() => expect(commandMenu.dataset.zchatgptCommandKind).toBe('references'));
  expect(commandMenu.querySelector('.zchatgpt-command-heading')?.textContent).toBe('References');
  expect(menu.hidden).toBe(true);
  input.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(commandMenu.hidden).toBe(true);
  // Skill opens the '/' chooser: the skill scope, not a reference search.
  plus.click(); skill.click();
  await vi.waitFor(() => expect(commandMenu.dataset.zchatgptCommandKind).toBe('commands'));
  expect(commandMenu.querySelector('.zchatgpt-command-heading')?.textContent).toBe('Installed skills');
  expect(commandMenu.querySelector('[role="listbox"]')).not.toBeNull();
  expect(menu.hidden).toBe(true);
  // Neither shortcut rewrites the draft.
  expect(input.value).toBe('');
});

it('labels the plus popover as a dialog that matches the field and rows it contains', async () => {
  const { root } = await mountReadyChat({ messages: [] });
  const plus = root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="composer-plus"]')!;
  const menu = root.querySelector<HTMLElement>('[data-zchatgpt-plus-menu]')!;
  // `role="menu"` would be a lie: the popover holds plain action buttons and the page-number input.
  expect(menu.getAttribute('role')).toBe('dialog');
  expect(menu.getAttribute('aria-label')).toBe('Add images or context');
  expect(plus.getAttribute('aria-haspopup')).toBe('dialog');
  expect(plus.getAttribute('aria-controls')).toBe(menu.id);
  expect(plus.getAttribute('aria-expanded')).toBe('false');
  // The trigger stays named for assistive technology and reports the popover it controls.
  expect(plus.getAttribute('aria-label')).toBe('Add images or context');
  plus.click();
  expect(plus.getAttribute('aria-expanded')).toBe('true');
  expect(menu.hidden).toBe(false);
});

it('opens every attachment route from the plus menu and closes it after a choice', async () => {
  const { root, presenter } = await mountReadyChat({ messages: [] });
  const view = root.ownerDocument.defaultView!;
  const plus = root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="composer-plus"]')!;
  const menuSelector = '[data-zchatgpt-plus-menu]';
  const menu = root.querySelector<HTMLElement>(menuSelector)!;
  expect(menu.hidden).toBe(true);
  expect(plus.getAttribute('aria-expanded')).toBe('false');
  plus.click();
  expect(menu.hidden).toBe(false);
  expect(plus.getAttribute('aria-expanded')).toBe('true');
  const route = (action: string) => [...menu.querySelectorAll<HTMLButtonElement>('button')].find(node => node.dataset.zchatgptAction === action)!;

  plus.click();
  // Images are files: the attach-file row is the only local-file route.
  const attachFile = route('pick-file');
  expect(attachFile.title).toBe('Attach file…');
  expect(attachFile.getAttribute('aria-label')).toBe('Attach file…');
  expect(attachFile.textContent).toContain('Text or image from your computer');
  const attach = vi.spyOn(presenter, 'pickFile').mockResolvedValue(undefined);
  attachFile.click();
  await vi.waitFor(() => expect(attach).toHaveBeenCalledTimes(1));
  expect(menu.hidden).toBe(true);

  plus.click();
  // Capturing the selected region is no longer a route inside the popover: it is a direct composer
  // control, so the popover has no such row left to open.
  expect(route('capture-region')).toBeUndefined();

  plus.click();
  plus.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(menu.hidden).toBe(true);
  const input = root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')!;
  input.focus(); plus.click();
  expect(menu.hidden).toBe(false);
  root.ownerDocument.body.dispatchEvent(new view.MouseEvent('click', { bubbles: true }));
  expect(menu.hidden).toBe(true);
});

it('keeps the toolbar explanations described but never printed in the header row', async () => {
  const { root } = await mountReadyChat();
  const chrome = root.querySelector<HTMLElement>('[data-zchatgpt-shell-bar]')!;
  const paper = root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="copy-paper-context"]')!;
  const hint = root.querySelector<HTMLElement>(`#${paper.getAttribute('aria-describedby')}`)!;
  expect(hint.textContent).toBe('Copy title, authors, publication, year, DOI and abstract as text. Does not include PDF full text.');
  // The class documents the intent; the inline declarations are what make the row safe even when the
  // document still holds a stylesheet injected by an earlier add-on version.
  expect(hint.classList.contains('zchatgpt-visually-hidden')).toBe(true);
  expect(hint.style.position).toBe('absolute');
  expect(hint.style.width).toBe('1px');
  expect(hint.style.height).toBe('1px');
  expect(hint.style.overflow).toBe('hidden');
  expect(hint.style.getPropertyValue('clip-path')).toBe('inset(50%)');
  /**
   * The user-visible invariant, checked without the cascade: everything the header would actually
   * print. A node that hides itself absolutely contributes no text, so a missing stylesheet rule can
   * never make the explanation part of the single row.
   */
  const printed = (node: Element): string => [...node.childNodes].map(child => {
    if (child.nodeType === 3) return child.textContent ?? '';
    const element = child as HTMLElement;
    if (element.style.position === 'absolute' && element.style.getPropertyValue('clip-path') !== '') return '';
    return printed(element);
  }).join('');
  expect(printed(chrome)).not.toMatch(/Does not include PDF full text/u);
  expect(printed(chrome)).not.toMatch(/Paste it into ChatGPT/u);
  // The same holds for the second action, whose explanation is a sibling of this one.
  const file = root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="copy-pdf-file"]')!;
  const fileHint = root.querySelector<HTMLElement>(`#${file.getAttribute('aria-describedby')}`)!;
  expect(fileHint.style.getPropertyValue('clip-path')).toBe('inset(50%)');
  expect(fileHint.textContent).toBe('Copy the current PDF file to the clipboard. Paste it into ChatGPT to attach it.');
});

it('opens the paper context details from the More menu and returns focus on Escape', async () => {
  const { root } = await mountReadyChat({
    messages: [],
    document: { prepare: () => Promise.resolve(documentA), validate: async () => {}, readEnabled: () => true, writeEnabled: () => {} },
  });
  const more = root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="more-actions"]')!;
  const menu = root.querySelector<HTMLElement>('[data-zchatgpt-more-menu]')!;
  const panel = root.querySelector<HTMLElement>('[data-zchatgpt-context-panel]')!;
  expect(panel.hidden).toBe(true);
  more.click();
  expect(menu.hidden).toBe(false);
  expect(more.getAttribute('aria-expanded')).toBe('true');
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="open-paper-details"]')!.click();
  expect(panel.hidden).toBe(false);
  expect(menu.hidden).toBe(true);
  expect(panel.textContent).toContain('Context for the next message');
  expect(panel.textContent).toContain('Synthetic Paper A');
  // Chat describes the actual bibliography-only send scope and does not expose PDF page controls.
  expect(panel.textContent).toContain('Automatic paper details and abstract');
  expect(panel.textContent).toContain('PDF body text is excluded');
  expect(panel.querySelector('[data-zchatgpt-action="re-read-pdf"]')).toBeNull();
  expect(nextSendSummary(root)).toBe('Paper details and stored abstract will be included when available · no PDF body text');
  panel.dispatchEvent(new root.ownerDocument.defaultView!.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(panel.hidden).toBe(true);
  expect(root.ownerDocument.activeElement).toBe(more);
});

it('shows a compact paper-specific Agent empty state whose highlight entry prepares a draft', async () => {
  const sent: SendInput[] = [];
  const { root, presenter } = await mountReadyChat({ messages: [], sent });
  presenter.setMode('agent');
  await vi.waitFor(() => expect(root.querySelector<HTMLElement>('[data-zchatgpt-agent-empty]')?.hidden).toBe(false));
  const empty = root.querySelector<HTMLElement>('[data-zchatgpt-agent-empty]')!;
  expect(empty.textContent).toContain('Explain this paper');
  expect(empty.textContent).toContain('Explain a Figure');
  expect(empty.textContent).not.toContain('Get an article');
  expect(empty.textContent).not.toContain('Organize selected items');
  // Compact copy, not a hero: no oversized heading element, no logo.
  expect(empty.querySelectorAll('h1, h2')).toHaveLength(0);
  const highlight = empty.querySelector<HTMLButtonElement>('[data-zchatgpt-action="empty-highlight"]')!;
  expect(highlight).not.toBeNull();
  highlight.click();
  // The entry prepares an editable draft; it never sends, connects or writes.
  expect(sent).toHaveLength(0);
  expect(presenter.snapshot().draft.question).toMatch(/Highlight/u);
  await vi.waitFor(() => expect(root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')!.value).toMatch(/Highlight/u));
  // Once the draft exists the empty state steps out of the way.
  await vi.waitFor(() => expect(empty.hidden).toBe(true));
});

it('starts Figure region selection from the paper-specific Agent empty state', async () => {
  const explainFigure = vi.fn(() => Promise.resolve());
  const { root, presenter } = await mountReadyChat({ messages: [], explainFigure });
  presenter.setMode('agent');
  const empty = root.querySelector<HTMLElement>('[data-zchatgpt-agent-empty]')!;
  await vi.waitFor(() => expect(empty.hidden).toBe(false));
  empty.querySelector<HTMLButtonElement>('[data-zchatgpt-action="empty-figure"]')!.click();
  await vi.waitFor(() => expect(explainFigure).toHaveBeenCalledWith('Explain the selected Figure and mark its key visual components.'));
});

it('derives a provable history source and never promotes a legacy chat', () => {
  const messagesOf = (modes: Array<'chat' | 'agent'>) => ({ messages: modes.map(mode => ({ mode })) }) as unknown as Pick<Conversation, 'messages'>;
  expect(conversationSource(messagesOf([]))).toBeUndefined();
  expect(conversationSource(messagesOf(['agent', 'agent']))).toBe('Agent');
  // An old `mode: chat` record is the historic Codex read-only path, never an official web chat.
  expect(conversationSource(messagesOf(['chat']))).toBe('Legacy');
  expect(conversationSource(messagesOf(['chat', 'agent']))).toBe('Mixed');
});
