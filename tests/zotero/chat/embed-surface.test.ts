import { Window as HappyWindow } from 'happy-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { acquireChatSurface, CHAT_APP_URL, CHAT_EMBED_ATTR, CHAT_EMBED_CONTAINER_ATTR, createChatEmbedSurface, type ChatEmbedSurface } from '../../../packages/zotero/src/chat/embed.ts';
import { OFFICIAL_CHAT_BRIDGE_EVENT } from '../../../packages/zotero/src/chat/official-chat-actor.ts';

const XUL = 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul';
const reload = vi.fn();
/** Where the surface parks while the sidebar is not showing it; off-screen at a real size. */
const PARKED_LEFT = '-20000px';

interface Rect { left: number; top: number; width: number; height: number }

/**
 * A XUL main window only as far as this module is concerned: a document that can create XUL
 * elements, with the navigation members a `<browser>` carries. The module asks for no privileged
 * service — the application is loaded by naming it in `src`.
 */
function chromeWindow(): { win: Window; doc: Document } {
  const win = new HappyWindow({ url: 'chrome://zotero/content/zoteroPane.xhtml' });
  const doc = win.document as unknown as Document & { createXULElement?(tag: string): Element };
  doc.createXULElement = (tag: string) => {
    // happy-dom has no XUL element interfaces, so the browser is an HTML element carrying the
    // browser's own members. What this module actually depends on from Gecko is exactly those
    // members plus `style`, which is why the substitution is enough for the arithmetic here.
    const node = doc.createElement('div') as unknown as Element & { currentURI: unknown; webProgress: unknown; contentTitle: unknown; webNavigation: unknown };
    if (tag === 'browser') {
      node.currentURI = null;
      node.webProgress = { isLoadingDocument: true };
      node.contentTitle = '';
      node.webNavigation = { reload };
    }
    return node;
  };
  // happy-dom's Window is a structural subset of the DOM one; the module only uses document,
  // innerWidth/innerHeight and the timer pair.
  return { win: win as unknown as Window, doc };
}

function place(element: Element, rect: Rect): Element {
  element.getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => ({}) });
  return element;
}

function element(doc: Document, rect: Rect): Element {
  const node = place(doc.createElementNS(XUL, 'vbox'), rect);
  doc.documentElement.append(node);
  return node;
}

/** The dock's own elements: the slot the surface covers, and the frame whose document holds it. */
function sidebar(doc: Document): { slot: Element; frame: Element } {
  return {
    slot: element(doc, { left: 10, top: 20, width: 300, height: 500 }),
    frame: element(doc, { left: 100, top: 50, width: 900, height: 700 }),
  };
}

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('caps retained paper surfaces and evicts only the oldest actor-proven idle one', () => {
  const pool = new Map<string, ChatEmbedSurface>();
  const stub = (idle: boolean) => ({ evictable: () => idle, destroy: vi.fn() }) as unknown as ChatEmbedSurface;
  const firstDestroy = vi.fn(); const first = { evictable: () => true, destroy: firstDestroy } as unknown as ChatEmbedSurface;
  pool.set('a', first); pool.set('b', stub(false)); pool.set('c', stub(false)); pool.set('d', stub(false));
  const fifth = stub(false);
  expect(acquireChatSurface(pool, 'e', () => fifth)).toBe(fifth);
  expect(pool.has('a')).toBe(false); expect(firstDestroy).toHaveBeenCalledTimes(1); expect(pool.size).toBe(4);

  const protectedPool = new Map<string, ChatEmbedSurface>([['a', stub(false)], ['b', stub(false)], ['c', stub(false)], ['d', stub(false)]]);
  const create = vi.fn(() => stub(false));
  expect(acquireChatSurface(protectedPool, 'e', create)).toBeNull();
  expect(create).not.toHaveBeenCalled(); expect(protectedPool.size).toBe(4);
});

it('creates a parked browser with the attribute set Zotero\'s own remote surfaces use, and names the application in src', () => {
  const { win, doc } = chromeWindow();
  const surface = createChatEmbedSurface(win);
  const browser = doc.querySelector(`[${CHAT_EMBED_ATTR}]`)!;
  const container = doc.querySelector(`[${CHAT_EMBED_CONTAINER_ATTR}]`) as HTMLElement;
  expect(browser).toBeTruthy();
  expect(container).toBeTruthy();
  expect(container.contains(browser)).toBe(true);
  expect(browser.getAttribute('type')).toBe('content');
  expect(browser.getAttribute('maychangeremoteness')).toBe('true');
  expect(browser.getAttribute('remote')).toBe('false');
  expect(browser.getAttribute('data-zchatgpt-embed-state')).toBe('loading');
  // The document loads while the surface is parked: the session and the open conversation belong to
  // it, and the dock not being open is not a reason to unload them.
  expect(browser.getAttribute('src')).toBe(CHAT_APP_URL);
  expect(container.style.left).toBe(PARKED_LEFT);
  expect(container.style.width).toBe('480px');
  expect(browser.hasAttribute('data-zchatgpt-embed-painted')).toBe(false);
  surface.destroy();
});

it('paints the box over the slot rect mapped through the frame whose document the slot lives in', () => {
  const { win, doc } = chromeWindow();
  const surface = createChatEmbedSurface(win);
  const browser = doc.querySelector(`[${CHAT_EMBED_ATTR}]`) as HTMLElement;
  const container = doc.querySelector(`[${CHAT_EMBED_CONTAINER_ATTR}]`) as HTMLElement;
  const { slot, frame } = sidebar(doc);
  surface.show(slot, frame);
  expect(container.style.left).toBe('110px');
  expect(container.style.top).toBe('70px');
  expect(container.style.width).toBe('300px');
  expect(container.style.height).toBe('500px');
  // The browser fills the box, and the paint marker names the rectangle the host can read back.
  expect(browser.style.width).toBe('100%');
  expect(browser.getAttribute('data-zchatgpt-embed-painted')).toBe('300x500');
  // Painting never navigates: src is set once, at construction.
  expect(browser.getAttribute('src')).toBe(CHAT_APP_URL);
  surface.destroy();
});

it('does not paint over a slot or frame that measures nothing', () => {
  const { win, doc } = chromeWindow();
  const surface = createChatEmbedSurface(win);
  const container = doc.querySelector(`[${CHAT_EMBED_CONTAINER_ATTR}]`) as HTMLElement;
  const { slot, frame } = sidebar(doc);
  // The dock is still laying out, which is the state the reader is in for the first frame.
  place(slot, { left: 10, top: 20, width: 0, height: 0 });
  surface.show(slot, frame);
  expect(container.style.left).toBe(PARKED_LEFT);
  expect(container.style.width).toBe('480px');
  // Zotero hides a tab it is not showing, and a hidden frame measures zero; the surface must not keep
  // floating over whatever the reader is actually looking at.
  place(slot, { left: 10, top: 20, width: 300, height: 500 });
  place(frame, { left: 0, top: 0, width: 0, height: 0 });
  surface.sync();
  expect(container.style.left).toBe(PARKED_LEFT);
  surface.destroy();
});

it('stops the paint poll when the surface is hidden and starts a fresh one when it is shown again', () => {
  const { win, doc } = chromeWindow();
  const startPoll = vi.spyOn(win, 'setInterval');
  const stopPoll = vi.spyOn(win, 'clearInterval');
  const surface = createChatEmbedSurface(win);
  const { slot, frame } = sidebar(doc);
  surface.show(slot, frame);
  expect(startPoll).toHaveBeenCalledTimes(1);
  const handle = startPoll.mock.results[0]!.value as number | undefined;
  // Repainting an already-shown surface must not stack a second 500 ms poll on the same window.
  surface.show(slot, frame);
  expect(startPoll).toHaveBeenCalledTimes(1);
  // Switching to Agent, or closing the dock, hides the surface. A parked surface must stop waking
  // the window up instead of polling for the rest of the session.
  surface.hide();
  expect(stopPoll).toHaveBeenCalledWith(handle);
  surface.show(slot, frame);
  expect(startPoll).toHaveBeenCalledTimes(2);
  surface.destroy();
  expect(stopPoll).toHaveBeenCalledTimes(2);
});

it('parks the box, keeping the session, when the slot is hidden or the dock unmounts', () => {
  const { win, doc } = chromeWindow();
  const surface = createChatEmbedSurface(win);
  const browser = doc.querySelector(`[${CHAT_EMBED_ATTR}]`) as HTMLElement;
  const container = doc.querySelector(`[${CHAT_EMBED_CONTAINER_ATTR}]`) as HTMLElement;
  const { slot, frame } = sidebar(doc);
  surface.show(slot, frame);
  expect(container.style.width).toBe('300px');
  // Hiding is painting-only: the application keeps its size, its document and its session.
  surface.hide();
  expect(container.style.left).toBe(PARKED_LEFT);
  expect(container.style.width).toBe('300px');
  expect(browser.getAttribute('data-zchatgpt-embed-painted')).toBe('');
  expect(container.isConnected).toBe(true);
  expect(browser.getAttribute('src')).toBe(CHAT_APP_URL);
  surface.destroy();
  expect(container.isConnected).toBe(false);
});

it('reloads the application through the browser\'s own navigation without discarding the surface', () => {
  const { win, doc } = chromeWindow();
  const surface = createChatEmbedSurface(win);
  const browser = doc.querySelector(`[${CHAT_EMBED_ATTR}]`) as HTMLElement;
  surface.reload();
  expect(reload).toHaveBeenCalledTimes(1);
  expect(browser.getAttribute('data-zchatgpt-embed-state')).toBe('loading');
  expect(surface.snapshot().loaded).toBe(false);
  expect(browser.isConnected).toBe(true);
  surface.destroy();
});

it('prepares one frozen context only for the bound official-page submission', async () => {
  const { win, doc } = chromeWindow();
  const surface = createChatEmbedSurface(win);
  const browser = doc.querySelector(`[${CHAT_EMBED_ATTR}]`) as unknown as HTMLElement & { currentURI: { spec: string } };
  browser.currentURI = { spec: CHAT_APP_URL };
  surface.bindContext('paper-a:revision-1', question => Promise.resolve({
    status: 'ready', paperContext: 'Title: A\n\nAbstract:\nfrozen abstract', selection: 'frozen selection',
    coverage: { kind: 'bibliography' }, question,
  }));
  let response: unknown;
  const Event = (doc.defaultView as unknown as { CustomEvent: typeof CustomEvent }).CustomEvent;
  browser.dispatchEvent(new Event(OFFICIAL_CHAT_BRIDGE_EVENT, {
    detail: { kind: 'prepare', binding: browser.getAttribute('data-zchatgpt-embed-binding'), transaction: 'transaction-a', question: 'Why?', respond: (value: unknown) => { response = value; } },
  }));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(response).toMatchObject({ status: 'prepared' });
  expect((response as { text: string }).text).toContain('frozen abstract');
  expect((response as { text: string }).text).not.toContain('[page');
  expect((response as { text: string }).text).toContain('frozen selection');
  expect((response as { text: string }).text).toContain('Why?');
  surface.destroy();
});

it('invalidates an awaited PDF snapshot when the bound reader changes', async () => {
  const { win, doc } = chromeWindow();
  const surface = createChatEmbedSurface(win);
  const browser = doc.querySelector(`[${CHAT_EMBED_ATTR}]`) as unknown as HTMLElement & { currentURI: { spec: string } };
  browser.currentURI = { spec: CHAT_APP_URL };
  let finish!: (value: { status: 'ready'; paperContext: string; selection: null; coverage: { kind: 'bibliography' } }) => void;
  surface.bindContext('paper-a:revision-1', () => new Promise(resolve => { finish = resolve; }));
  let response: unknown;
  const Event = (doc.defaultView as unknown as { CustomEvent: typeof CustomEvent }).CustomEvent;
  browser.dispatchEvent(new Event(OFFICIAL_CHAT_BRIDGE_EVENT, {
    detail: { kind: 'prepare', binding: browser.getAttribute('data-zchatgpt-embed-binding'), transaction: 'transaction-b', question: 'Question A', respond: (value: unknown) => { response = value; } },
  }));
  surface.bindContext('paper-b:revision-1', () => Promise.resolve({ status: 'ready', paperContext: 'Title: Paper B', selection: null, coverage: { kind: 'bibliography' } }));
  finish({ status: 'ready', paperContext: 'Title: Paper A', selection: null, coverage: { kind: 'bibliography' } });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(response).toMatchObject({ status: 'blocked', reason: 'context-changed' });
  surface.destroy();
});

it('sends only bounded stage and submit commands to the actor of the official document', async () => {
  const { win, doc } = chromeWindow();
  const sendQuery = vi.fn((name: string) => Promise.resolve({ status: name === 'probe' ? 'ready' : 'staged' }));
  const surface = createChatEmbedSurface(win);
  const browser = doc.querySelector(`[${CHAT_EMBED_ATTR}]`) as unknown as HTMLElement & {
    currentURI: { spec: string };
    browsingContext: { currentWindowGlobal: { getActor(name: string): { sendQuery(name: string, data: unknown): Promise<unknown> } } };
  };
  browser.currentURI = { spec: CHAT_APP_URL };
  browser.browsingContext = { currentWindowGlobal: { getActor: () => ({ sendQuery }) } };
  await surface.stage('Selection text');
  await surface.submitQuestion('Explain this selection.');
  expect(sendQuery).toHaveBeenNthCalledWith(1, 'stage', { text: 'Selection text' });
  expect(sendQuery).toHaveBeenNthCalledWith(2, 'submitQuestion', { question: 'Explain this selection.' });
  browser.currentURI = { spec: 'https://example.invalid/' };
  await expect(surface.stage('must not cross origin')).resolves.toEqual({ status: 'blocked', reason: 'context-changed' });
  expect(sendQuery).toHaveBeenCalledTimes(2);
  surface.destroy();
});

it('allows ChatGPT same-document conversation routing but rejects a replacement WindowGlobal', async () => {
  const { win, doc } = chromeWindow();
  const surface = createChatEmbedSurface(win);
  const globalA = { getActor: () => ({ sendQuery: () => Promise.resolve({ status: 'accepted' }) }) };
  const browser = doc.querySelector(`[${CHAT_EMBED_ATTR}]`) as unknown as HTMLElement & {
    currentURI: { spec: string };
    browsingContext: { currentWindowGlobal: unknown };
  };
  browser.currentURI = { spec: CHAT_APP_URL };
  browser.browsingContext = { currentWindowGlobal: globalA };
  const accepted = surface.submitQuestion('question');
  browser.currentURI = { spec: 'https://chatgpt.com/c/new-conversation' };
  await expect(accepted).resolves.toEqual({ status: 'accepted' });
  const pending = surface.submitQuestion('next');
  browser.browsingContext.currentWindowGlobal = { getActor: globalA.getActor };
  await expect(pending).resolves.toEqual({ status: 'blocked', reason: 'context-changed' });
  surface.destroy();
});

it('ignores a late accepted marker after the reader binding changes', async () => {
  const { win, doc } = chromeWindow();
  const surface = createChatEmbedSurface(win);
  const browser = doc.querySelector(`[${CHAT_EMBED_ATTR}]`) as unknown as HTMLElement & { currentURI: { spec: string } };
  browser.currentURI = { spec: CHAT_APP_URL };
  surface.bindContext('paper-a', () => Promise.resolve({ status: 'ready', paperContext: 'Title: A', selection: null, coverage: { kind: 'bibliography' } }));
  let prepared: { marker: string } | null = null;
  const Event = (doc.defaultView as unknown as { CustomEvent: typeof CustomEvent }).CustomEvent;
  browser.dispatchEvent(new Event(OFFICIAL_CHAT_BRIDGE_EVENT, {
    detail: { kind: 'prepare', binding: browser.getAttribute('data-zchatgpt-embed-binding'), transaction: 'transaction-c', question: 'A?', respond: (value: unknown) => { prepared = value as { marker: string }; } },
  }));
  await new Promise(resolve => setTimeout(resolve, 0));
  const marker = prepared!.marker;
  surface.bindContext('paper-b', () => Promise.resolve({ status: 'ready', paperContext: 'Title: B', selection: null, coverage: { kind: 'bibliography' } }));
  browser.dispatchEvent(new Event(OFFICIAL_CHAT_BRIDGE_EVENT, {
    detail: { kind: 'status', binding: browser.getAttribute('data-zchatgpt-embed-binding'), status: 'accepted', marker },
  }));
  expect(browser.getAttribute('data-zchatgpt-bridge-status')).toBe('idle');
  surface.destroy();
});

it('records a canonical official conversation URL for the bound paper without query data', () => {
  const { win, doc } = chromeWindow();
  const surface = createChatEmbedSurface(win);
  const browser = doc.querySelector(`[${CHAT_EMBED_ATTR}]`) as unknown as HTMLElement & { currentURI: { spec: string } };
  const remembered = vi.fn();
  surface.bindConversation('paper-a', null, remembered);
  browser.currentURI = { spec: 'https://chatgpt.com/c/12345678-abcd?temporary=value#fragment' };
  surface.sync();
  expect(remembered).toHaveBeenCalledWith('https://chatgpt.com/c/12345678-abcd');
  surface.destroy();
});

it('restores a saved web conversation only when the same WindowGlobal is idle', async () => {
  const { win, doc } = chromeWindow();
  const surface = createChatEmbedSurface(win);
  const probe = vi.fn(() => Promise.resolve({ status: 'ready' }));
  const global = { getActor: () => ({ sendQuery: probe }) };
  const browser = doc.querySelector(`[${CHAT_EMBED_ATTR}]`) as unknown as HTMLElement & {
    currentURI: { spec: string };
    browsingContext: { currentWindowGlobal: unknown };
  };
  browser.currentURI = { spec: CHAT_APP_URL };
  browser.browsingContext = { currentWindowGlobal: global };
  surface.bindConversation('paper-a', 'https://chatgpt.com/c/12345678-abcd', vi.fn());
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(browser.getAttribute('src')).toBe('https://chatgpt.com/c/12345678-abcd');

  browser.setAttribute('src', CHAT_APP_URL);
  probe.mockResolvedValueOnce({ status: 'generating' });
  surface.bindConversation('paper-b', 'https://chatgpt.com/c/87654321-dcba', vi.fn());
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(browser.getAttribute('src')).toBe(CHAT_APP_URL);
  surface.destroy();
});

it('restores a saved web conversation from an empty supported composer before its send button exists', async () => {
  const { win, doc } = chromeWindow();
  const surface = createChatEmbedSurface(win);
  const probe = vi.fn(() => Promise.resolve({ status: 'composer-ready' }));
  const browser = doc.querySelector(`[${CHAT_EMBED_ATTR}]`) as unknown as HTMLElement & {
    currentURI: { spec: string };
    browsingContext: { currentWindowGlobal: unknown };
  };
  browser.currentURI = { spec: CHAT_APP_URL };
  browser.browsingContext = { currentWindowGlobal: { getActor: () => ({ sendQuery: probe }) } };

  surface.bindConversation('paper-a', 'https://chatgpt.com/c/12345678-abcd', vi.fn());
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(probe).toHaveBeenCalledWith('probe');
  expect(browser.getAttribute('src')).toBe('https://chatgpt.com/c/12345678-abcd');
  surface.destroy();
});

it('blocks composer preparation and parent submission while a saved conversation restore is pending', async () => {
  const { win, doc } = chromeWindow();
  const provider = vi.fn(() => Promise.resolve({
    status: 'ready' as const,
    paperContext: 'must not be frozen on the old page',
    selection: null,
    coverage: { kind: 'bibliography' as const },
  }));
  const sendQuery = vi.fn((name: string) => Promise.resolve(name === 'probe' ? { status: 'draft' } : { status: 'accepted' }));
  const surface = createChatEmbedSurface(win);
  const browser = doc.querySelector(`[${CHAT_EMBED_ATTR}]`) as unknown as HTMLElement & {
    currentURI: { spec: string };
    browsingContext: { currentWindowGlobal: unknown };
  };
  browser.currentURI = { spec: CHAT_APP_URL };
  browser.browsingContext = { currentWindowGlobal: { getActor: () => ({ sendQuery }) } };
  surface.bindContext('paper-a', provider);
  surface.bindConversation('paper-a', 'https://chatgpt.com/c/12345678-abcd', vi.fn());
  await new Promise(resolve => setTimeout(resolve, 0));

  await expect(surface.submitQuestion('must not reach the old page')).resolves.toEqual({ status: 'blocked', reason: 'context-changed' });
  const Event = (doc.defaultView as unknown as { CustomEvent: typeof CustomEvent }).CustomEvent;
  let response: unknown = null;
  browser.dispatchEvent(new Event(OFFICIAL_CHAT_BRIDGE_EVENT, {
    detail: {
      kind: 'prepare',
      binding: browser.getAttribute('data-zchatgpt-embed-binding'),
      transaction: 'restore-pending',
      question: 'keyboard submit on old page',
      respond: (value: unknown) => { response = value; },
    },
  }));
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(response).toEqual({ status: 'blocked', reason: 'context-changed', marker: 'restore-pending' });
  expect(provider).not.toHaveBeenCalled();
  expect(sendQuery.mock.calls.filter(([name]) => name !== 'probe')).toEqual([]);
  expect(browser.getAttribute('src')).toBe(CHAT_APP_URL);
  surface.destroy();
});

it('keeps a login-only official page interactive while saved conversation restore remains pending', async () => {
  const { win, doc } = chromeWindow();
  const sendQuery = vi.fn((name: string) => Promise.resolve({ status: name === 'probe' ? 'composer-missing' : 'unexpected-command' }));
  const surface = createChatEmbedSurface(win);
  const browser = doc.querySelector(`[${CHAT_EMBED_ATTR}]`) as unknown as HTMLElement & {
    currentURI: { spec: string };
    browsingContext: { currentWindowGlobal: unknown };
  };
  browser.currentURI = { spec: CHAT_APP_URL };
  browser.browsingContext = { currentWindowGlobal: { getActor: () => ({ sendQuery }) } };
  surface.bindConversation('paper-a', 'https://chatgpt.com/c/12345678-abcd', vi.fn());
  const { slot, frame } = sidebar(doc); surface.show(slot, frame);
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(browser.style.pointerEvents).toBe('auto');
  expect(browser.getAttribute('data-zchatgpt-bridge-ready')).toBe('composer-missing');
  expect(browser.getAttribute('src')).toBe(CHAT_APP_URL);
  await expect(surface.submitQuestion('must remain unavailable')).resolves.toEqual({ status: 'blocked', reason: 'context-changed' });
  expect(sendQuery.mock.calls.filter(([name]) => name !== 'probe')).toEqual([]);
  surface.hide(); expect(surface.evictable()).toBe(false);
  surface.destroy();
});

it('fails closed when the official page has an unknown editor and opens only recognized or login-only pages', async () => {
  const { win, doc } = chromeWindow();
  let status = 'unsupported-composer';
  const browserActor = { sendQuery: () => Promise.resolve({ status }) };
  const surface = createChatEmbedSurface(win);
  const browser = doc.querySelector(`[${CHAT_EMBED_ATTR}]`) as unknown as HTMLElement & {
    currentURI: { spec: string };
    browsingContext: { currentWindowGlobal: unknown };
  };
  browser.currentURI = { spec: CHAT_APP_URL };
  browser.browsingContext = { currentWindowGlobal: { getActor: () => browserActor } };
  const { slot, frame } = sidebar(doc);
  surface.show(slot, frame);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(browser.style.pointerEvents).toBe('none');
  expect(browser.getAttribute('data-zchatgpt-bridge-ready')).toBe('unsupported-composer');

  status = 'ready';
  browser.browsingContext.currentWindowGlobal = { getActor: () => browserActor };
  surface.show(slot, frame);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(browser.style.pointerEvents).toBe('auto');
  expect(browser.getAttribute('data-zchatgpt-bridge-ready')).toBe('ready');
  surface.destroy();
});

it('keeps actor readiness messages separate from clipboard-action results', () => {
  const { win, doc } = chromeWindow();
  const surface = createChatEmbedSurface(win);
  const browser = doc.querySelector(`[${CHAT_EMBED_ATTR}]`) as unknown as HTMLElement & { currentURI: { spec: string } };
  browser.currentURI = { spec: CHAT_APP_URL };
  const host = doc.createElement('section'); host.dataset.zchatgptEmbed = '';
  const bridge = doc.createElement('span'); bridge.dataset.zchatgptBridgeStatusLine = ''; bridge.hidden = true;
  const clipboard = doc.createElement('span'); clipboard.dataset.zchatgptShellFeedback = ''; clipboard.textContent = 'Paper details copied';
  const slot = place(doc.createElement('div'), { left: 10, top: 20, width: 300, height: 500 });
  host.append(bridge, clipboard, slot); doc.documentElement.append(host);
  surface.show(slot, null);
  const Event = (doc.defaultView as unknown as { CustomEvent: typeof CustomEvent }).CustomEvent;
  browser.dispatchEvent(new Event(OFFICIAL_CHAT_BRIDGE_EVENT, {
    detail: { kind: 'readiness', binding: browser.getAttribute('data-zchatgpt-embed-binding'), status: 'unsupported-send' },
  }));
  expect(bridge.hidden).toBe(false);
  expect(bridge.textContent).toContain('send control is unsupported');
  expect(clipboard.textContent).toBe('Paper details copied');
  surface.destroy();
});

it.each([
  ['OpenAI', 'https://auth.openai.com/log-in'],
  ['Apple', 'https://appleid.apple.com/auth/authorize'],
  ['Google', 'https://accounts.google.com/v3/signin/identifier'],
])('keeps %s authorization interactive without exposing the PDF bridge, then restores Chat', async (_provider, authURL) => {
  const { win, doc } = chromeWindow();
  const sendQuery = vi.fn((name: string) => Promise.resolve({ status: name === 'stage' ? 'staged' : 'ready' }));
  const prepare = vi.fn(() => Promise.resolve({ status: 'allow' as const }));
  const surface = createChatEmbedSurface(win);
  try {
    surface.bindContext('paper-a', prepare);
    const browser = doc.querySelector(`[${CHAT_EMBED_ATTR}]`) as unknown as HTMLElement & {
      currentURI: { spec: string };
      browsingContext: { currentWindowGlobal: unknown };
    };
    browser.currentURI = { spec: CHAT_APP_URL };
    browser.browsingContext = { currentWindowGlobal: { getActor: () => ({ sendQuery }) } };
    const { slot, frame } = sidebar(doc); surface.show(slot, frame);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(browser.style.pointerEvents).toBe('auto');

    sendQuery.mockClear();
    const srcBeforeAuth = browser.getAttribute('src');
    browser.currentURI = { spec: authURL };
    // Even if a host exposes an actor here, no bridge command may reach the auth origin.
    browser.browsingContext.currentWindowGlobal = { getActor: () => ({ sendQuery }) };
    await new Promise(resolve => setTimeout(resolve, 550));
    expect(browser.style.pointerEvents).toBe('auto');
    expect(browser.getAttribute('data-zchatgpt-bridge-ready')).toBe('auth-navigation');
    await expect(surface.stage('synthetic selection')).resolves.toEqual({ status: 'blocked', reason: 'context-changed' });
    await expect(surface.submitQuestion('must stay disabled during auth')).resolves.toEqual({ status: 'blocked', reason: 'context-changed' });
    const respond = vi.fn();
    const Event = (doc.defaultView as unknown as { CustomEvent: typeof CustomEvent }).CustomEvent;
    browser.dispatchEvent(new Event(OFFICIAL_CHAT_BRIDGE_EVENT, {
      detail: { kind: 'prepare', binding: browser.getAttribute('data-zchatgpt-embed-binding'), question: 'synthetic question', transaction: 'auth-test', respond },
    }));
    expect(prepare).not.toHaveBeenCalled();
    expect(respond).not.toHaveBeenCalled();
    surface.bindConversation('paper-a', 'https://chatgpt.com/c/12345678-abcd', vi.fn());
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(browser.getAttribute('src')).toBe(srcBeforeAuth);
    expect(sendQuery).not.toHaveBeenCalled();

    browser.currentURI = { spec: 'https://chatgpt.com/c/12345678-abcd' };
    browser.browsingContext.currentWindowGlobal = { getActor: () => ({ sendQuery }) };
    await new Promise(resolve => setTimeout(resolve, 550));
    expect(browser.style.pointerEvents).toBe('auto');
    expect(browser.getAttribute('data-zchatgpt-bridge-ready')).toBe('ready');
    await expect(surface.stage('synthetic selection')).resolves.toEqual({ status: 'staged' });
    expect(sendQuery).toHaveBeenCalledWith('stage', { text: 'synthetic selection' });
  } finally { surface.destroy(); }
});

it.each([
  'https://accounts.google.com.example.org/signin',
  'https://example.org/?next=https://accounts.google.com',
  'https://sub.accounts.google.com/signin',
  'http://accounts.google.com/signin',
  'https://accounts.google.com:444/signin',
  'https://test@accounts.google.com/signin',
])('does not grant authentication interaction or bridge access to %s', async authURL => {
  const { win, doc } = chromeWindow();
  const sendQuery = vi.fn(() => Promise.resolve({ status: 'ready' }));
  const surface = createChatEmbedSurface(win);
  try {
    const browser = doc.querySelector(`[${CHAT_EMBED_ATTR}]`) as unknown as HTMLElement & {
      currentURI: { spec: string };
      browsingContext: { currentWindowGlobal: unknown };
    };
    browser.currentURI = { spec: CHAT_APP_URL };
    browser.browsingContext = { currentWindowGlobal: { getActor: () => ({ sendQuery }) } };
    const { slot, frame } = sidebar(doc); surface.show(slot, frame);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(browser.style.pointerEvents).toBe('auto');
    sendQuery.mockClear();
    browser.currentURI = { spec: authURL };
    browser.browsingContext.currentWindowGlobal = { getActor: () => ({ sendQuery }) };
    await new Promise(resolve => setTimeout(resolve, 550));
    expect(browser.style.pointerEvents).toBe('none');
    expect(browser.getAttribute('data-zchatgpt-bridge-ready')).toBe('checking');
    await expect(surface.stage('synthetic selection')).resolves.toEqual({ status: 'blocked', reason: 'context-changed' });
    await expect(surface.submitQuestion('synthetic question')).resolves.toEqual({ status: 'blocked', reason: 'context-changed' });
    expect(sendQuery).not.toHaveBeenCalled();
  } finally { surface.destroy(); }
});
