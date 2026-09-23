/* global JSWindowActorChild */

import {
  findChatGPTComposer,
  hasAcceptedRequestMarker,
  isChatGPTDocument,
  readChatGPTComposer,
  replaceChatGPTComposer,
} from './chatgpt-dom.mjs';

const SEND_SELECTOR = 'button[data-testid="send-button"]';
const STOP_SELECTOR = 'button[data-testid="stop-button"]';
const MAX_TEXT = 512_000;
const ACCEPT_TIMEOUT_MS = 20_000;
const POLL_MS = 100;
const SEND_READY_TIMEOUT_MS = 5_000;
/** How long one send click is given to be consumed by the page before the identical send is retried. */
const CONSUME_WINDOW_MS = 1_200;
const MOBILE_COMPOSER_ID = 'mobile-composer-prompt';

function inside(node, container) {
  return node === container || Boolean(node && container?.contains?.(node));
}

/**
 * The rich-text composer is re-rendered from the page's own editor state after `insertText`, and that
 * re-render rewrites block/line whitespace (in one observed host the newline between two blocks was
 * dropped entirely). Comparing the two readings exactly would therefore read the page's own
 * formatting as an owner edit. Only whitespace is ignored; any real character change still fails the
 * comparison, and the request marker is required separately.
 */
function sameRenderedText(left, right) {
  return String(left).replace(/\s+/gu, '') === String(right).replace(/\s+/gu, '');
}

function safeMobileForm(document, composer) {
  if (composer?.localName !== 'textarea' || composer.id !== MOBILE_COMPOSER_ID) return null;
  const form = composer.closest?.('form');
  if (!form) return null;
  const action = String(form.getAttribute('action') || '').trim();
  if (action) {
    try {
      const target = new URL(action, document.location.href);
      if (target.protocol !== 'https:' || target.hostname !== 'chatgpt.com' || target.username || target.password || (target.port && target.port !== '443')) return null;
    } catch { return null; }
  }
  // The known mobile composer form is not an authentication form. Presence of any common credential
  // control disables the fallback; no value is read.
  if (form.querySelector('input[type="password"], input[type="email"], input[autocomplete="username"], input[autocomplete="current-password"], input[autocomplete="new-password"]')) return null;
  return form;
}

function sendButton(document, composer = findChatGPTComposer(document)) {
  const form = composer?.closest?.('form') ?? null;
  let button = form?.querySelector?.(SEND_SELECTOR) ?? null;
  if (!button) {
    const mobile = safeMobileForm(document, composer);
    const submits = mobile ? [...mobile.querySelectorAll('button[type="submit"]')] : [];
    button = submits.length === 1 ? submits[0] : null;
  }
  return button?.localName === 'button' ? button : null;
}

function hasSubmissionSemantics(button) {
  if (!button || button.localName !== 'button') return false;
  const type = String(button.type || button.getAttribute?.('type') || '').toLowerCase();
  if (type === 'submit' || button.matches?.(SEND_SELECTOR)) return true;
  const label = String(button.getAttribute?.('aria-label') || '').trim().toLowerCase();
  return ['send', 'send message', 'send prompt'].includes(label);
}

function safeStructure(document) {
  const editors = [...document.querySelectorAll('textarea, [contenteditable="true"]')].slice(0, 8).map(element => ({
    tag: String(element.localName || '').slice(0, 24),
    id: String(element.id || '').slice(0, 80),
    role: String(element.getAttribute('role') || '').slice(0, 40),
    contenteditable: String(element.getAttribute('contenteditable') || '').slice(0, 16),
    formButtons: element.closest?.('form')?.querySelectorAll?.('button').length ?? 0,
  }));
  return { editors, knownSendButtons: document.querySelectorAll(SEND_SELECTOR).length };
}

function isSubmission(event, composer, document) {
  if (!event.isTrusted || event.isComposing) return false;
  if (event.type === 'keydown') {
    return event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
      && inside(event.target, composer);
  }
  if (event.type === 'click') return event.target?.closest?.('button') === sendButton(document, composer);
  if (event.type === 'submit') return inside(composer, event.target);
  return false;
}

export class ZoteroChatGPTOfficialChatChild extends JSWindowActorChild {
  replaying = false;
  inFlight = false;

  handleEvent(event) {
    if (this.replaying || !isChatGPTDocument(this.document)) return;
    const composer = findChatGPTComposer(this.document);
    if (!composer) {
      const unknown = this.document.querySelector('textarea, [contenteditable="true"]');
      if (!unknown) return;
      const form = unknown.closest?.('form');
      const clicked = event.target?.closest?.('button');
      const unknownSubmit = event.isTrusted && (
        (event.type === 'keydown' && event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && !event.isComposing && inside(event.target, unknown))
        || (event.type === 'click' && hasSubmissionSemantics(clicked) && Boolean(form?.contains(clicked)))
        || (event.type === 'submit' && inside(unknown, event.target))
      );
      if (event.type === 'input' && inside(event.target, unknown)) this.sendAsyncMessage('readiness', { status: 'unsupported-send' });
      if (unknownSubmit) { event.preventDefault(); event.stopImmediatePropagation(); this.sendAsyncMessage('readiness', { status: 'unsupported-send' }); }
      return;
    }
    if (event.type === 'input' && composer && inside(event.target, composer)) {
      const document = this.document;
      this.contentWindow.setTimeout(() => {
        if (this.document !== document) return;
        this.sendAsyncMessage('readiness', { status: readChatGPTComposer(composer).trim() ? 'draft' : sendButton(document) ? 'ready' : 'composer-ready' });
      }, 0);
      return;
    }
    // A changed/unknown button inside the composer form is blocked rather than allowed to submit the
    // raw question. Non-submit controls outside that form (including login) are untouched.
    if (event.isTrusted && event.type === 'click' && readChatGPTComposer(composer).trim()) {
      const button = event.target?.closest?.('button');
      const form = composer.closest?.('form');
      if (button && form?.contains(button) && hasSubmissionSemantics(button) && button !== sendButton(this.document, composer)) {
        event.preventDefault(); event.stopImmediatePropagation();
        this.sendAsyncMessage('readiness', { status: 'unsupported-send' });
        return;
      }
    }
    if (!isSubmission(event, composer, this.document)) return;
    // A second Enter/click while PDF preparation awaits is consumed, never queued as a duplicate.
    if (this.inFlight) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    const question = readChatGPTComposer(composer);
    if (!question.trim()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void this.submitQuestion(question);
  }

  async receiveMessage(message) {
    if (!isChatGPTDocument(this.document)) return { status: 'blocked', reason: 'context-changed' };
    if (message.name === 'stage') {
      const text = message.data?.text;
      if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) return { status: 'blocked', reason: 'invalid-response' };
      const composer = findChatGPTComposer(this.document);
      if (!composer) return { status: 'blocked', reason: 'composer-missing' };
      const current = readChatGPTComposer(composer).trim();
      if (!replaceChatGPTComposer(composer, current ? `${current}\n\n${text}` : text)) return { status: 'blocked', reason: 'composer-missing' };
      composer.focus?.();
      return { status: 'staged' };
    }
    if (message.name === 'submitQuestion') {
      const question = message.data?.question;
      if (typeof question !== 'string' || !question.trim() || question.length > MAX_TEXT) return { status: 'blocked', reason: 'invalid-response' };
      return this.submitQuestion(question);
    }
    if (message.name === 'probe') {
      if (this.inFlight) return { status: 'busy' };
      if (this.document.querySelector(STOP_SELECTOR)) return { status: 'generating' };
      const composer = findChatGPTComposer(this.document);
      if (composer) {
        if (readChatGPTComposer(composer).trim()) return { status: 'draft' };
        return { status: sendButton(this.document) ? 'ready' : 'composer-ready', structure: safeStructure(this.document) };
      }
      // Boolean structure only: values are never read. A generic editor with no named ChatGPT
      // composer means selector drift, and the parent must gate the surface instead of failing open.
      return this.document.querySelector('textarea, [contenteditable="true"]')
        ? { status: 'unsupported-composer', structure: safeStructure(this.document) }
        : { status: 'composer-missing', structure: safeStructure(this.document) };
    }
    return { status: 'blocked', reason: 'invalid-response' };
  }

  async submitQuestion(question) {
    if (this.inFlight) return { status: 'blocked', reason: 'busy' };
    this.inFlight = true;
    const originalDocument = this.document;
    const originalWindow = this.contentWindow;
    const originalComposer = findChatGPTComposer(originalDocument);
    const originalDraft = originalComposer ? readChatGPTComposer(originalComposer) : '';
    const transaction = originalWindow.crypto.randomUUID();
    try {
      // An explicit More-details action may start with an empty official composer. It must never
      // overwrite a draft the owner already typed there.
      if (originalDraft.trim() && originalDraft !== question) return { status: 'blocked', reason: 'draft-changed' };
      let prepared;
      try { prepared = await this.sendQuery('prepare', { question, transaction }); }
      catch {
        this.sendAsyncMessage('status', { status: 'context-blocked', marker: transaction, reason: 'context-changed' });
        return { status: 'blocked', reason: 'context-changed' };
      }
      if (!prepared || !['prepared', 'allow'].includes(prepared.status)) {
        this.sendAsyncMessage('status', { status: 'context-blocked', marker: prepared?.marker ?? null, reason: prepared?.reason ?? 'invalid-response' });
        return prepared ?? { status: 'blocked', reason: 'invalid-response' };
      }
      if (this.document !== originalDocument || this.contentWindow !== originalWindow || !isChatGPTDocument(originalDocument)) {
        this.sendAsyncMessage('status', { status: 'context-blocked', marker: prepared.marker ?? null, reason: 'context-changed' });
        return { status: 'blocked', reason: 'context-changed' };
      }
      const composer = findChatGPTComposer(originalDocument);
      if (!composer || composer !== originalComposer) { this.sendAsyncMessage('status', { status: 'composer-missing', marker: prepared.marker ?? null }); return { status: 'blocked', reason: 'composer-missing' }; }
      // The owner may keep typing while local metadata is read. Preserve those edits and require
      // another deliberate send instead of replacing them with the older frozen question.
      if (readChatGPTComposer(composer) !== originalDraft) {
        this.sendAsyncMessage('status', { status: 'context-blocked', marker: prepared.marker ?? null, reason: 'draft-changed' });
        return { status: 'blocked', reason: 'draft-changed' };
      }
      const text = prepared.status === 'prepared' ? prepared.text : `${question}\n\n[Zotero request ${prepared.marker}]`;
      if (typeof text !== 'string' || text.length > MAX_TEXT || !replaceChatGPTComposer(composer, text)) {
        this.sendAsyncMessage('status', { status: 'context-blocked', marker: prepared.marker ?? null, reason: 'invalid-response' });
        return { status: 'blocked', reason: 'invalid-response' };
      }
      const insertedText = readChatGPTComposer(composer);
      if (!insertedText.includes(`[Zotero request ${prepared.marker}]`)) {
        this.sendAsyncMessage('status', { status: 'context-blocked', marker: prepared.marker, reason: 'invalid-response' });
        return { status: 'blocked', reason: 'invalid-response' };
      }
      const button = await this.waitForSend(originalDocument, originalWindow, composer, insertedText, prepared.marker);
      if (!button) {
        const reason = sameRenderedText(readChatGPTComposer(composer), text) ? 'submit-missing' : 'draft-changed';
        this.sendAsyncMessage('status', { status: reason === 'submit-missing' ? 'submit-missing' : 'context-blocked', marker: prepared.marker ?? null, reason });
        return { status: 'blocked', reason };
      }
      // A click the page ignores leaves the exact prepared text untouched and starts nothing. That was
      // observed once on a brand-new conversation, where the official composer was hydrated but the
      // first click on its send control had no effect. One retry of the identical submission is
      // allowed, and only while every observable signal says the page has not taken the first one:
      // the same draft, no marker message, no generation. A page that consumed the send clears the
      // composer (and usually opens the stop control) before this window elapses, so the draft can
      // never be sent twice by a review of the same submission.
      let attempts = 0;
      const clickSend = () => {
        attempts += 1;
        this.replaying = true;
        try { button.click(); }
        finally { originalWindow.setTimeout(() => { this.replaying = false; }, 0); }
      };
      clickSend();
      if (!await this.waitForConsumption(prepared.marker, originalDocument, originalWindow, composer, insertedText)) {
        const retry = sendButton(originalDocument, composer);
        if (retry && !retry.disabled && sameRenderedText(readChatGPTComposer(composer), insertedText)) {
          this.replaying = true;
          try { retry.click(); }
          finally { originalWindow.setTimeout(() => { this.replaying = false; }, 0); }
          attempts += 1;
        }
      }
      const accepted = await this.waitForMarker(prepared.marker, originalDocument, originalWindow);
      const acceptedStatus = prepared.status === 'prepared' && prepared.hasAutomaticContext ? 'accepted' : 'accepted-without-context';
      this.sendAsyncMessage('status', { status: accepted ? acceptedStatus : 'not-accepted', marker: prepared.marker });
      return { status: accepted ? 'accepted' : 'not-accepted', attempts };
    } finally {
      this.inFlight = false;
    }
  }

  /** Resolves once the page visibly took the send: draft cleared, marker message, or a generation. */
  waitForConsumption(marker, originalDocument, originalWindow, composer, expectedText) {
    const started = Date.now();
    return new Promise(resolve => {
      const check = () => {
        if (this.document !== originalDocument || this.contentWindow !== originalWindow || !isChatGPTDocument(originalDocument)) { resolve(true); return; }
        if (hasAcceptedRequestMarker(originalDocument, marker)) { resolve(true); return; }
        if (originalDocument.querySelector(STOP_SELECTOR)) { resolve(true); return; }
        if (!sameRenderedText(readChatGPTComposer(composer), expectedText)) { resolve(true); return; }
        if (Date.now() - started >= CONSUME_WINDOW_MS) { resolve(false); return; }
        originalWindow.setTimeout(check, 50);
      };
      check();
    });
  }

  waitForMarker(marker, originalDocument, originalWindow) {
    const started = Date.now();
    return new Promise(resolve => {
      const check = () => {
        if (this.document !== originalDocument || this.contentWindow !== originalWindow || !isChatGPTDocument(originalDocument)) { resolve(false); return; }
        if (hasAcceptedRequestMarker(originalDocument, marker)) { resolve(true); return; }
        if (Date.now() - started >= ACCEPT_TIMEOUT_MS) { resolve(false); return; }
        originalWindow.setTimeout(check, POLL_MS);
      };
      check();
    });
  }

  waitForSend(originalDocument, originalWindow, composer, expectedText, marker) {
    const started = Date.now();
    return new Promise(resolve => {
      const check = () => {
        if (this.document !== originalDocument || this.contentWindow !== originalWindow || !isChatGPTDocument(originalDocument)) { resolve(null); return; }
        const current = readChatGPTComposer(composer);
        // The marker, not raw equality, proves this is still our own frozen submission.
        if (!current.includes(`[Zotero request ${marker}]`)) { resolve(null); return; }
        if (!sameRenderedText(current, expectedText)) { resolve(null); return; }
        const button = sendButton(originalDocument, composer);
        if (button && !button.disabled) { resolve(button); return; }
        if (Date.now() - started >= SEND_READY_TIMEOUT_MS) { resolve(null); return; }
        originalWindow.setTimeout(check, 50);
      };
      check();
    });
  }
}
