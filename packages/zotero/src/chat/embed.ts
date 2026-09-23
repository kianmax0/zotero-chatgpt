/**
 * Chat mode's surface is the real ChatGPT web application, not a reimplementation.
 *
 * Chat and Agent stay operationally separate: Agent runs the bundled Codex runtime behind the
 * `AgentExecutor`, while Chat hosts `chatgpt.com` itself so the conversation, streaming, history,
 * model picker, uploads and the account session all belong to the web app. Nothing here issues a
 * model request, reads a credential, or touches the Codex task/session lifecycle.
 *
 * Why a chrome `<browser>` and not an `iframe`: `chatgpt.com` refuses framing (X-Frame-Options /
 * CSP frame-ancestors) and busts out of frames, and a XUL element cannot be created inside the
 * reader's HTML document at all ("Component is not available"; the host probe in
 * `tests/host/embed-driver.js` records both). Zotero's own remote-page surfaces are chrome
 * `<browser>` elements created in a *XUL* document — the reader tab uses `src` and the viewer window
 * `Zotero.openInViewer()` uses `loadURI`. This module does the first of those, in the main window,
 * and paints the result over the sidebar region the dock reserves for it: the host probe records the
 * same URL loading through `src` while a `loadURI` against a freshly created browser is dropped.
 *
 * The page is never unloaded to hide it: `hide()` only stops painting, so switching Chat -> Agent
 * and back, or closing and reopening the sidebar, keeps the ChatGPT session and the open
 * conversation. The document is destroyed only when the window goes away.
 */

import { composeOfficialChatPrompt, isOfficialChatURL } from './official-chat.ts';
import { OFFICIAL_CHAT_ACTOR, OFFICIAL_CHAT_BRIDGE_EVENT } from './official-chat-actor.ts';
import { canonicalOfficialConversationURL } from './official-chat-history.ts';

/** Marks the chrome browser so host tests and diagnostics can address it without private state. */
export const CHAT_EMBED_ATTR = 'data-zchatgpt-embed-browser';
/** Marks the HTML box the browser is painted in; the box, not the browser, carries the geometry. */
export const CHAT_EMBED_CONTAINER_ATTR = 'data-zchatgpt-embed-container';
/** Per-surface transaction binding checked again after asynchronous PDF preparation. */
export const CHAT_EMBED_BINDING_ATTR = 'data-zchatgpt-embed-binding';
/** The application Chat mode hosts. No API key, no custom base URL, no token is involved. */
export const CHAT_APP_URL = 'https://chatgpt.com/';
// These exact HTTPS hosts may receive ordinary login clicks, never PDF context or actor commands.
// Google sign-in leaves auth.openai.com before returning to the official ChatGPT application.
const OFFICIAL_CHAT_AUTH_HOSTS = new Set(['auth.openai.com', 'appleid.apple.com', 'accounts.google.com']);
/** Free/stale-layout safety net while the surface is painted, in milliseconds. */
const SYNC_INTERVAL_MS = 500;
/**
 * Where the box sits while the sidebar is not showing it. The application is not unloaded then — the
 * session, the cookies and the open conversation are the whole point of hosting it — so the box is
 * kept off-screen at a real size rather than collapsed, which is what keeps its document live.
 */
const PARKED_LEFT = -20000;
const PARKED_WIDTH = 480;
const PARKED_HEIGHT = 720;

/** The subset of Zotero's XUL `<browser>` this module drives. */
interface ChromeBrowser extends Element {
  currentURI: { spec: string } | null;
  contentTitle: string;
  webProgress: { isLoadingDocument: boolean } | null;
  webNavigation?: { reload(flags: number): void } | null;
  browsingContext?: { currentWindowGlobal?: { getActor(name: string): { sendQuery(name: string, data?: unknown): Promise<unknown> } } | null } | null;
  reloadWithFlags?(flags: number): void;
  style: CSSStyleDeclaration;
  setAttribute(name: string, value: string): void;
}

export interface ChatEmbedSnapshot {
  /** The application document currently in the surface, or null before the first navigation. */
  url: string | null;
  /** True while the browser reports a document still loading. */
  loading: boolean;
  /** True once a document is present and settled; the page's own script wrote its title. */
  loaded: boolean;
}

export interface ChatEmbedSurface {
  /**
   * Paint the surface over `anchor`, an element inside the dock. `frame` is the chrome element that
   * hosts the document `anchor` lives in (the reader's own `<browser>`), because rects measured in
   * that document are relative to its viewport, not to the window this surface is painted in.
   */
  show(anchor: Element, frame: Element | null): void;
  /** Stop painting without unloading the page, keeping the session and the open conversation. */
  hide(): void;
  /** Re-measure and repaint; safe to call on any host layout or tab change. */
  sync(): void;
  /** Force a fresh navigation of the application document. */
  reload(): void;
  /** Bind the visible reader/PDF generation to future user-triggered official-composer sends. */
  bindContext(binding: string, prepare: OfficialChatContextProvider): void;
  /** Put a frozen Zotero selection in the official composer without sending it. */
  stage(text: string): Promise<OfficialChatCommandOutcome>;
  /** User-triggered More details: submit through the same official composer and context hook. */
  submitQuestion(question: string): Promise<OfficialChatCommandOutcome>;
  /** Persist and restore ChatGPT's own conversation URL separately for this paper binding. */
  bindConversation(binding: string, savedURL: string | null, remember: (url: string) => void): void;
  /** Cached actor-proven idle state for the bounded per-window surface pool. */
  evictable(): boolean;
  snapshot(): ChatEmbedSnapshot;
  destroy(): void;
}

export type OfficialChatContextResult = {
  status: 'ready';
  paperContext: string;
  selection: string | null;
  coverage: { kind: 'bibliography' };
} | { status: 'allow' } | { status: 'blocked'; reason: 'context-disabled' | 'context-empty' | 'context-failed' };

export type OfficialChatContextProvider = (question: string) => Promise<OfficialChatContextResult>;
export type OfficialChatCommandOutcome = { status: string; reason?: string };

export const MAX_HOSTED_CHAT_SURFACES_PER_WINDOW = 4;
/** LRU acquisition that only evicts a surface whose actor-proven state says no draft/work is live. */
export function acquireChatSurface(
  pool: Map<string, ChatEmbedSurface>,
  binding: string,
  create: () => ChatEmbedSurface,
  limit = MAX_HOSTED_CHAT_SURFACES_PER_WINDOW,
): ChatEmbedSurface | null {
  const existing = pool.get(binding);
  if (existing) { pool.delete(binding); pool.set(binding, existing); return existing; }
  if (pool.size >= limit) {
    const idle = [...pool].find(([, surface]) => surface.evictable());
    if (!idle) return null;
    idle[1].destroy(); pool.delete(idle[0]);
  }
  const surface = create(); pool.set(binding, surface); return surface;
}

interface Rect { left: number; top: number; width: number; height: number }

function xulDocument(doc: Document): { createXULElement(tag: string): Element } {
  const candidate = doc as unknown as { createXULElement?(tag: string): Element };
  if (typeof candidate.createXULElement !== 'function') throw new Error('The embedded Chat surface needs a XUL document.');
  return candidate as { createXULElement(tag: string): Element };
}

/** Border widths so a host element's content box, not its border box, is the origin. */
function contentOrigin(element: Element): { x: number; y: number } {
  const box = element as Element & { clientLeft?: number; clientTop?: number };
  return { x: box.clientLeft ?? 0, y: box.clientTop ?? 0 };
}

function rectOf(element: Element): Rect | null {
  let rect: DOMRect;
  try { rect = element.getBoundingClientRect(); } catch { return null; }
  if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return null;
  if (rect.width < 1 || rect.height < 1) return null;
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function isOfficialAuthNavigation(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && OFFICIAL_CHAT_AUTH_HOSTS.has(url.hostname)
      && !url.username && !url.password && (!url.port || url.port === '443');
  } catch {
    return false;
  }
}

/**
 * Create the Chat surface in `win`. Construction creates the browser, parks it off-screen at a real
 * size and starts the one navigation to the application; painting only moves the box.
 */
export function createChatEmbedSurface(win: Window, url: string = CHAT_APP_URL): ChatEmbedSurface {
  const doc = win.document;
  const browser = xulDocument(doc).createXULElement('browser') as ChromeBrowser;
  // The attribute set Zotero's own remote-page viewer carries; without it the document stays at
  // about:blank, which the host probe demonstrates for the same element without them.
  browser.setAttribute('type', 'content');
  browser.setAttribute('remote', 'false');
  browser.setAttribute('disableglobalhistory', 'true');
  browser.setAttribute('maychangeremoteness', 'true');
  browser.setAttribute('messagemanagergroup', 'zchatgpt');
  browser.setAttribute('class', 'zchatgpt-embed-browser');
  browser.setAttribute(CHAT_EMBED_ATTR, '');
  browser.setAttribute('data-zchatgpt-embed-state', 'idle');
  browser.setAttribute('aria-label', 'ChatGPT');
  const surfaceBinding = win.crypto.randomUUID();
  browser.setAttribute(CHAT_EMBED_BINDING_ATTR, surfaceBinding);
  browser.style.cssText = 'display:block;width:100%;height:100%;border:0;';
  // Fail closed until the actor confirms the current WindowGlobal has the supported official
  // composer. A login-only page (no editor at all) is opened after the probe; an unknown editor stays
  // gated so selector drift cannot send an unaugmented question.
  browser.style.pointerEvents = 'none';
  // The browser hangs off an HTML div rather than the window root: the main window is a XUL document,
  // and an HTML div is the box whose geometry CSS actually controls there — the host probe loads the
  // application in exactly this shape and not in a zero-sized or window-root one.
  const container = doc.createElement('div');
  container.setAttribute(CHAT_EMBED_CONTAINER_ATTR, '');
  container.style.cssText = `position:fixed;left:${PARKED_LEFT}px;top:0px;width:${PARKED_WIDTH}px;height:${PARKED_HEIGHT}px;overflow:hidden;border:0;margin:0;padding:0;z-index:2147483000;background:#fff;`;
  // `src` is the navigation Zotero's own reader tab uses, and it is set before the element is
  // connected so the document and the frame are created together. It is also why the application
  // loads while the surface is parked: the ChatGPT session, its cookies and its open conversation
  // belong to this document, and the dock being closed is not a reason to unload them.
  browser.setAttribute('data-zchatgpt-embed-state', 'loading');
  browser.setAttribute('src', url);
  container.append(browser);
  (doc.body ?? doc.documentElement).append(container);

  /** Navigate an already-loaded document again, preferring the browser's own reload. */
  const renavigate = (): void => {
    browser.setAttribute('data-zchatgpt-embed-state', 'loading');
    try {
      if (typeof browser.webNavigation?.reload === 'function') { browser.webNavigation.reload(0); return; }
      if (typeof browser.reloadWithFlags === 'function') { browser.reloadWithFlags(0); return; }
    } catch { /* the flags-based path is not available, so navigate from the URL below */ }
    browser.setAttribute('src', url);
  };

  let anchor: Element | null = null;
  let frame: Element | null = null;
  let painted: string | null = null;
  let destroyed = false;
  let timer: number | null = null;
  let resizeObserver: { disconnect(): void } | null = null;
  let contextBinding: string | null = null;
  let contextProvider: OfficialChatContextProvider | null = null;
  let contextGeneration = 0;
  let activeMarker: { marker: string; generation: number } | null = null;
  let conversationBinding: string | null = null;
  let rememberConversation: ((url: string) => void) | null = null;
  let rememberedURL: string | null = null;
  let conversationGeneration = 0;
  let pendingRestore: { generation: number; target: string; canonical: string | null; issued: boolean } | null = null;
  let restoreFlight = false;
  let restoreAfter = 0;
  let probedWindowGlobal: unknown = null;
  let bridgeProbeFlight = false;
  let bridgeProbeAfter = 0;
  let operations = 0;
  let bridgeIdle = false;
  // The size the application's own layout is given. It is the parked size until the dock paints, and
  // keeps the last painted size afterwards so hiding and showing does not resize the document.
  let box: { width: number; height: number } = { width: PARKED_WIDTH, height: PARKED_HEIGHT };

  const topDocument = win.document;

  /** Move the box out of the way without unloading it: a rendered box is what keeps it live. */
  function park(): void {
    container.style.left = `${PARKED_LEFT}px`;
    container.style.top = '0px';
    container.style.width = `${box.width}px`;
    container.style.height = `${box.height}px`;
  }

  /** Pin the surface to the anchor's live rect, or stop painting when that rect is gone. */
  const sync = (): void => {
    if (destroyed) return;
    trackConversation();
    if (!anchor || !anchor.isConnected) { retract(); return; }
    const anchorRect = rectOf(anchor);
    if (!anchorRect) { retract(); return; }
    let originX = 0;
    let originY = 0;
    if (frame) {
      const frameRect = rectOf(frame);
      if (!frameRect) { retract(); return; }
      const origin = contentOrigin(frame);
      originX = frameRect.left + origin.x;
      originY = frameRect.top + origin.y;
    }
    const next: Rect = {
      left: Math.round(originX + anchorRect.left),
      top: Math.round(originY + anchorRect.top),
      width: Math.round(anchorRect.width),
      height: Math.round(anchorRect.height),
    };
    // A dock that is not on the selected tab is hidden by Zotero, so its frame measures zero and the
    // surface must not keep floating over whatever the user is actually looking at.
    if (next.left >= win.innerWidth || next.top >= win.innerHeight) { retract(); return; }
    const key = `${next.left}:${next.top}:${next.width}:${next.height}`;
    if (key === painted) return;
    painted = key;
    box = { width: next.width, height: next.height };
    container.style.left = `${next.left}px`;
    container.style.top = `${next.top}px`;
    container.style.width = `${next.width}px`;
    container.style.height = `${next.height}px`;
    browser.setAttribute('data-zchatgpt-embed-painted', `${next.width}x${next.height}`);
  };

  /** Stop painting; the page and its session stay exactly as they are. */
  function retract(): void {
    if (painted === null) return;
    painted = null;
    browser.setAttribute('data-zchatgpt-embed-painted', '');
    park();
  }

  const observe = (): void => {
    resizeObserver?.disconnect();
    resizeObserver = null;
    const view = topDocument.defaultView as (Window & { ResizeObserver?: typeof ResizeObserver }) | null;
    const Observer = view?.ResizeObserver;
    if (typeof Observer !== 'function') return;
    const observer = new Observer(() => sync());
    const watched = new Set<Element>();
    if (anchor) watched.add(anchor);
    if (frame) watched.add(frame);
    for (const element of watched) observer.observe(element);
    resizeObserver = observer;
  };

  const tick = (): void => {
    if (destroyed) { stopTimer(); return; }
    sync();
    const loading = browser.webProgress?.isLoadingDocument ?? false;
    const current = browser.currentURI?.spec ?? null;
    const loaded = Boolean(current) && !loading && String(browser.contentTitle ?? '').length > 0;
    browser.setAttribute('data-zchatgpt-embed-state', loading ? 'loading' : loaded ? 'loaded' : 'idle');
    trackConversation();
    const windowGlobal = browser.browsingContext?.currentWindowGlobal ?? null;
    if (windowGlobal !== probedWindowGlobal) {
      probedWindowGlobal = windowGlobal;
      bridgeIdle = false;
      if (isOfficialAuthNavigation(browser.currentURI?.spec)) {
        // Authentication is ordinary remote-page interaction. The PDF bridge stays unavailable on
        // this origin, but the page itself must remain clickable for account and 2FA controls.
        browser.style.pointerEvents = 'auto';
        browser.setAttribute('data-zchatgpt-bridge-ready', 'auth-navigation');
        announce('Complete sign-in on the official account page. PDF context is disabled until ChatGPT returns.');
      } else {
        browser.style.pointerEvents = 'none';
        browser.setAttribute('data-zchatgpt-bridge-ready', 'checking');
      }
      bridgeProbeAfter = 0;
    }
    if (!isOfficialAuthNavigation(browser.currentURI?.spec) && Date.now() >= bridgeProbeAfter) void probeBridge();
    if (!isOfficialAuthNavigation(browser.currentURI?.spec) && pendingRestore && Date.now() >= restoreAfter) void tryRestoreConversation();
  };

  const stopTimer = (): void => { if (timer !== null) { win.clearInterval(timer); timer = null; } };

  const officialDocument = (): boolean => isOfficialChatURL(browser.currentURI?.spec ?? null);
  const announce = (message: string): void => {
    const host = anchor?.closest?.('[data-zchatgpt-embed]') ?? null;
    const status = host?.querySelector<HTMLElement>('[data-zchatgpt-bridge-status-line]') ?? null;
    if (!status) return;
    status.textContent = message; status.hidden = false;
  };
  const actor = (): { sendQuery(name: string, data?: unknown): Promise<unknown> } | null => {
    if (!officialDocument() || browser.getAttribute(CHAT_EMBED_BINDING_ATTR) !== surfaceBinding) return null;
    try { return browser.browsingContext?.currentWindowGlobal?.getActor(OFFICIAL_CHAT_ACTOR) ?? null; }
    catch { return null; }
  };

  const probeBridge = async (): Promise<void> => {
    if (bridgeProbeFlight) return;
    if (isOfficialAuthNavigation(browser.currentURI?.spec)) return;
    const target = actor();
    const windowGlobal = browser.browsingContext?.currentWindowGlobal ?? null;
    if (!target || !windowGlobal) { bridgeProbeAfter = Date.now() + 2000; return; }
    bridgeProbeFlight = true;
    try {
      const result = await target.sendQuery('probe').catch(() => null) as { status?: unknown } | null;
      if (browser.browsingContext?.currentWindowGlobal !== windowGlobal || !officialDocument()) return;
      const status = typeof result?.status === 'string' ? result.status : 'actor-unavailable';
      bridgeIdle = !pendingRestore && ['ready', 'composer-ready', 'composer-missing'].includes(status);
      if (bridgeIdle) activeMarker = null;
      // A page with no composer may expose only sign-in or challenge controls. Those ordinary page
      // controls stay clickable while the pending-restore guards below keep PDF/send commands off.
      const interactive = status === 'composer-missing'
        || (!pendingRestore && ['ready', 'composer-ready', 'draft', 'busy', 'generating'].includes(status));
      browser.style.pointerEvents = interactive ? 'auto' : 'none';
      browser.setAttribute('data-zchatgpt-bridge-ready', status);
      if (status === 'composer-missing') announce('Sign in to official ChatGPT. Automatic paper context will be included only after its supported composer is available.');
      else if (!interactive) announce('Automatic paper context is blocked because this ChatGPT page does not expose the supported composer. No question can be sent from this surface.');
      bridgeProbeAfter = Date.now() + (status === 'ready' ? 5000 : 2000);
    } finally {
      bridgeProbeFlight = false;
    }
  };

  const restoreReached = (restore: NonNullable<typeof pendingRestore>): boolean => {
    const current = browser.currentURI?.spec ?? null;
    return restore.canonical ? canonicalOfficialConversationURL(current) === restore.canonical : current === CHAT_APP_URL;
  };
  const trackConversation = (): void => {
    if (pendingRestore) {
      if (!restoreReached(pendingRestore)) return;
      rememberedURL = pendingRestore.canonical;
      pendingRestore = null;
    }
    const current = canonicalOfficialConversationURL(browser.currentURI?.spec ?? null);
    if (!current || !rememberConversation || current === rememberedURL) return;
    try { rememberConversation(current); rememberedURL = current; }
    catch { bridgeIdle = false; }
  };
  const tryRestoreConversation = async (): Promise<void> => {
    const restore = pendingRestore;
    if (!restore || restore.issued || restoreFlight || restore.generation !== conversationGeneration) return;
    if (isOfficialAuthNavigation(browser.currentURI?.spec)) { restoreAfter = Date.now() + 5000; return; }
    if (restoreReached(restore)) { trackConversation(); return; }
    const target = actor();
    const windowGlobal = browser.browsingContext?.currentWindowGlobal ?? null;
    if (!target || !windowGlobal) { restoreAfter = Date.now() + 5000; return; }
    restoreFlight = true;
    try {
      const probe = await target.sendQuery('probe').catch(() => null) as { status?: unknown } | null;
      if (pendingRestore !== restore || restore.generation !== conversationGeneration
          || browser.browsingContext?.currentWindowGlobal !== windowGlobal || !officialDocument()) return;
      // Busy covers local PDF preparation; generating covers an accepted turn whose answer is still
      // streaming. Neither may be navigated away by a reader switch.
      if (probe?.status !== 'ready' && probe?.status !== 'composer-ready') { restoreAfter = Date.now() + 5000; return; }
      restore.issued = true;
      browser.setAttribute('src', restore.target);
    } finally {
      restoreFlight = false;
    }
  };

  /** The parent actor dispatches only this local event on this exact browser element. */
  const onBridge = (event: Event): void => {
    if (event.target !== browser || !officialDocument() || browser.getAttribute(CHAT_EMBED_BINDING_ATTR) !== surfaceBinding) return;
    const detail = (event as CustomEvent).detail as Record<string, unknown> | null;
    if (!detail || detail.binding !== surfaceBinding) return;
    if (detail.kind === 'readiness') {
      const status = detail.status;
      if (status === 'ready' || status === 'composer-ready') {
        bridgeIdle = !pendingRestore;
        browser.style.pointerEvents = pendingRestore ? 'none' : 'auto';
        browser.setAttribute('data-zchatgpt-bridge-ready', pendingRestore ? 'restoring' : status);
      } else if (status === 'draft') {
        bridgeIdle = false;
        browser.style.pointerEvents = pendingRestore ? 'none' : 'auto';
        browser.setAttribute('data-zchatgpt-bridge-ready', pendingRestore ? 'restoring' : 'draft');
      } else if (status === 'unsupported-send') {
        bridgeIdle = false;
        browser.style.pointerEvents = 'none';
        browser.setAttribute('data-zchatgpt-bridge-ready', 'unsupported-send');
        announce('Automatic paper context is blocked because the official ChatGPT send control is unsupported. Your draft was kept and was not sent.');
      }
      return;
    }
    if (detail.kind === 'status') {
      const status = detail.status;
      if (typeof status === 'string' && ['accepted', 'accepted-without-context', 'not-accepted', 'composer-missing', 'submit-missing', 'context-blocked'].includes(status)) {
        // A late acknowledgement belongs to the PDF generation that prepared its marker. Switching
        // readers clears `activeMarker`, so paper A can never paint "attached" on paper B.
        if (typeof detail.marker === 'string' && activeMarker?.marker === detail.marker && activeMarker.generation === contextGeneration) {
          bridgeIdle = false;
          browser.setAttribute('data-zchatgpt-bridge-status', status);
          announce(status === 'accepted' ? 'ChatGPT accepted this message with bibliographic paper context and any explicit selection.'
            : status === 'accepted-without-context' ? 'ChatGPT accepted this message without automatic paper context; an explicit selection may still be included.'
            : status === 'not-accepted' ? 'ChatGPT did not confirm that this message was accepted. It was not sent again.'
            : status === 'context-blocked' ? 'The paper metadata could not be read. Your ChatGPT draft was kept and was not sent.'
            : 'The official ChatGPT composer is unavailable. Your draft was kept and was not sent.');
        }
      }
      return;
    }
    if (detail.kind !== 'prepare' || typeof detail.question !== 'string' || typeof detail.transaction !== 'string' || typeof detail.respond !== 'function') return;
    const respond = detail.respond as (value: unknown) => void;
    if (pendingRestore) { respond({ status: 'blocked', reason: 'context-changed', marker: detail.transaction }); return; }
    const question = detail.question;
    const generation = contextGeneration;
    const binding = contextBinding;
    const provider = contextProvider;
    if (!provider || !binding) { respond({ status: 'blocked', reason: 'context-changed' }); return; }
    const marker = detail.transaction;
    bridgeIdle = false;
    activeMarker = { marker, generation };
    browser.setAttribute('data-zchatgpt-bridge-status', 'preparing');
    announce('Preparing frozen paper metadata and any explicit selection. Nothing has been sent yet.');
    void provider(question).then(result => {
      if (generation !== contextGeneration || binding !== contextBinding || provider !== contextProvider
          || pendingRestore || !officialDocument() || browser.getAttribute(CHAT_EMBED_BINDING_ATTR) !== surfaceBinding) {
        respond({ status: 'blocked', reason: 'context-changed', marker }); return;
      }
      if (result.status === 'allow') { respond({ status: 'allow', marker }); return; }
      if (result.status === 'blocked') { respond({ ...result, marker }); return; }
      respond({ status: 'prepared', marker, hasAutomaticContext: Boolean(result.paperContext.trim()), text: composeOfficialChatPrompt({
        question, paperContext: result.paperContext, selection: result.selection,
        coverage: result.coverage, requestMarker: marker,
      }) });
    }).catch(() => { respond({ status: 'blocked', reason: 'context-failed', marker }); });
  };
  browser.addEventListener(OFFICIAL_CHAT_BRIDGE_EVENT, onBridge);

  const queryActor = async (name: 'stage' | 'submitQuestion', data: Record<string, string>): Promise<OfficialChatCommandOutcome> => {
    if (pendingRestore) return { status: 'blocked', reason: 'context-changed' };
    const target = actor();
    if (!target) return { status: 'blocked', reason: 'context-changed' };
    operations += 1; bridgeIdle = false;
    const windowGlobal = browser.browsingContext?.currentWindowGlobal ?? null;
    let result: unknown;
    try { result = await target.sendQuery(name, data).catch(() => ({ status: 'blocked', reason: 'context-failed' })); }
    finally { operations -= 1; }
    // ChatGPT's first accepted message changes `/` to `/c/<id>` in the same document. That is an
    // expected SPA route change; a replacement WindowGlobal is the navigation boundary to reject.
    if (windowGlobal === null || browser.browsingContext?.currentWindowGlobal !== windowGlobal
        || pendingRestore || !officialDocument() || browser.getAttribute(CHAT_EMBED_BINDING_ATTR) !== surfaceBinding) {
      return { status: 'blocked', reason: 'context-changed' };
    }
    if (!result || typeof result !== 'object' || typeof (result as Record<string, unknown>).status !== 'string') return { status: 'blocked', reason: 'context-failed' };
    const value = result as Record<string, unknown>;
    const outcome = { status: value.status as string, ...(typeof value.reason === 'string' ? { reason: value.reason } : {}) };
    if (name === 'stage' && outcome.status === 'staged') announce('The selection was inserted in the ChatGPT draft. It has not been sent.');
    return outcome;
  };

  const surface: ChatEmbedSurface = {
    show(nextAnchor, nextFrame) {
      if (destroyed) return;
      const changed = anchor !== nextAnchor || frame !== (nextFrame ?? null);
      anchor = nextAnchor;
      frame = nextFrame ?? null;
      if (changed) observe();
      sync();
      // The frame can be re-laid-out by anything (window resize, dock resize, tab switch, reader
      // toolbar rewrap) and two of those are not observable from this window, so a slow poll keeps
      // the surface on its anchor while it is painted. Hiding stops the poll and showing starts it
      // again, so a parked surface never keeps waking this window up.
      if (timer === null) timer = win.setInterval(tick, SYNC_INTERVAL_MS);
      void probeBridge();
    },
    hide() { anchor = null; frame = null; resizeObserver?.disconnect(); resizeObserver = null; retract(); stopTimer(); },
    sync,
    reload() { browser.style.pointerEvents = 'none'; probedWindowGlobal = null; bridgeProbeAfter = 0; renavigate(); },
    bindContext(binding, prepare) {
      if (contextBinding === binding && contextProvider === prepare) return;
      contextBinding = binding; contextProvider = prepare; contextGeneration += 1;
      activeMarker = null;
      browser.setAttribute('data-zchatgpt-bridge-status', 'idle');
      browser.setAttribute('data-zchatgpt-context-binding', binding);
    },
    stage(text) { return queryActor('stage', { text }); },
    submitQuestion(question) { return queryActor('submitQuestion', { question }); },
    bindConversation(binding, savedURL, remember) {
      if (conversationBinding === binding) { rememberConversation = remember; trackConversation(); if (pendingRestore) void tryRestoreConversation(); return; }
      trackConversation();
      conversationBinding = binding; rememberConversation = remember; conversationGeneration += 1;
      rememberedURL = canonicalOfficialConversationURL(savedURL);
      const current = canonicalOfficialConversationURL(browser.currentURI?.spec ?? null);
      const target = rememberedURL ?? CHAT_APP_URL;
      pendingRestore = (rememberedURL ? current !== rememberedURL : current !== null)
        ? { generation: conversationGeneration, target, canonical: rememberedURL, issued: false }
        : null;
      restoreAfter = 0;
      if (pendingRestore) {
        bridgeIdle = false;
        if (isOfficialAuthNavigation(browser.currentURI?.spec)) {
          browser.style.pointerEvents = 'auto';
          browser.setAttribute('data-zchatgpt-bridge-ready', 'auth-navigation');
        } else {
          browser.style.pointerEvents = 'none';
          browser.setAttribute('data-zchatgpt-bridge-ready', 'restoring');
          void tryRestoreConversation();
        }
      }
    },
    evictable() {
      trackConversation();
      return anchor === null && !pendingRestore && !restoreFlight && !bridgeProbeFlight
        && operations === 0 && bridgeIdle && activeMarker === null;
    },
    snapshot() {
      return {
        url: browser.currentURI?.spec ?? null,
        loading: browser.webProgress?.isLoadingDocument ?? false,
        loaded: browser.getAttribute('data-zchatgpt-embed-state') === 'loaded',
      };
    },
    destroy() {
      destroyed = true;
      trackConversation();
      contextGeneration += 1; contextBinding = null; contextProvider = null; activeMarker = null;
      conversationGeneration += 1; conversationBinding = null; rememberConversation = null; pendingRestore = null;
      browser.removeEventListener(OFFICIAL_CHAT_BRIDGE_EVENT, onBridge);
      surface.hide();
      stopTimer();
      container.remove();
    },
  };
  return surface;
}
