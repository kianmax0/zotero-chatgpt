/* global JSWindowActorParent */

const BRIDGE_EVENT = 'ZoteroChatGPT:OfficialChatBridge';
const EMBED_ATTR = 'data-zchatgpt-embed-browser';
const MAX_QUESTION = 200_000;
const MAX_PREPARED = 512_000;
const RESPONSE_TIMEOUT_MS = 60_000;
const MARKER = /^[0-9a-z-]{1,80}$/iu;

function officialURL(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && url.hostname === 'chatgpt.com'
      && !url.username && !url.password && (!url.port || url.port === '443');
  } catch {
    return false;
  }
}

function browserFor(context, manager) {
  const top = context?.top ?? context;
  const browser = top?.embedderElement ?? null;
  if (!browser?.hasAttribute?.(EMBED_ATTR)) return null;
  if (!officialURL(browser.currentURI?.spec)) return null;
  if (!manager || context?.currentWindowGlobal !== manager || !officialURL(manager.documentURI?.spec)) return null;
  return browser;
}

function validateResponse(value) {
  if (!value || typeof value !== 'object') return { status: 'blocked', reason: 'invalid-response' };
  const marker = typeof value.marker === 'string' && MARKER.test(value.marker) ? value.marker : null;
  if (value.status === 'allow' && marker) return { status: 'allow', marker };
  if (value.status === 'blocked') {
    const allowed = ['context-changed', 'context-disabled', 'context-empty', 'context-failed', 'invalid-response'];
    return { status: 'blocked', reason: allowed.includes(value.reason) ? value.reason : 'invalid-response', ...(marker ? { marker } : {}) };
  }
  if (value.status === 'prepared' && typeof value.text === 'string' && value.text.length <= MAX_PREPARED
      && typeof value.hasAutomaticContext === 'boolean'
      && typeof value.marker === 'string' && MARKER.test(value.marker)) {
    return { status: 'prepared', text: value.text, hasAutomaticContext: value.hasAutomaticContext, marker: value.marker };
  }
  return { status: 'blocked', reason: 'invalid-response' };
}

/**
 * The actor never reads page fields itself and never receives a path or credential. It only relays a
 * user-entered composer question to the exact plugin-owned browser, which returns a frozen prompt.
 */
export class ZoteroChatGPTOfficialChatParent extends JSWindowActorParent {
  async receiveMessage(message) {
    const manager = this.manager;
    const browser = browserFor(this.browsingContext, manager);
    if (!browser) return { status: 'blocked', reason: 'context-changed' };
    const binding = browser.getAttribute('data-zchatgpt-embed-binding');
    if (!binding) return { status: 'blocked', reason: 'context-changed' };
    if (message.name === 'status') {
      const status = message.data?.status;
      const marker = message.data?.marker;
      if (!['accepted', 'accepted-without-context', 'not-accepted', 'composer-missing', 'submit-missing', 'context-blocked'].includes(status)) return null;
      if (marker !== null && marker !== undefined && (typeof marker !== 'string' || !MARKER.test(marker))) return null;
      const win = browser.ownerGlobal;
      const reason = message.data?.reason;
      const allowedReason = ['context-changed', 'context-disabled', 'context-empty', 'context-failed', 'invalid-response', 'busy', 'draft-changed'].includes(reason) ? reason : null;
      browser.dispatchEvent(new win.CustomEvent(BRIDGE_EVENT, { detail: { kind: 'status', binding, status, marker: marker ?? null, reason: allowedReason } }));
      return null;
    }
    if (message.name === 'readiness') {
      const status = message.data?.status;
      if (!['ready', 'composer-ready', 'draft', 'unsupported-send'].includes(status)) return null;
      const win = browser.ownerGlobal;
      browser.dispatchEvent(new win.CustomEvent(BRIDGE_EVENT, { detail: { kind: 'readiness', binding, status } }));
      return null;
    }
    if (message.name !== 'prepare') return { status: 'blocked', reason: 'invalid-response' };
    const question = message.data?.question;
    const transaction = message.data?.transaction;
    if (typeof question !== 'string' || !question.trim() || question.length > MAX_QUESTION || typeof transaction !== 'string' || !MARKER.test(transaction)) return { status: 'blocked', reason: 'invalid-response' };
    const win = browser.ownerGlobal;
    const response = await new Promise(resolve => {
      let settled = false;
      const finish = value => { if (!settled) { settled = true; win.clearTimeout(timer); resolve(value); } };
      const timer = win.setTimeout(() => finish({ status: 'blocked', reason: 'context-failed' }), RESPONSE_TIMEOUT_MS);
      browser.dispatchEvent(new win.CustomEvent(BRIDGE_EVENT, {
        detail: { kind: 'prepare', binding, transaction, question, respond: finish },
      }));
    });
    // Navigation, window replacement or a reader switch while metadata was read invalidates
    // the response. The content actor cannot choose a different recipient.
    if (browser !== browserFor(this.browsingContext, manager) || browser.getAttribute('data-zchatgpt-embed-binding') !== binding) {
      return { status: 'blocked', reason: 'context-changed' };
    }
    const validated = validateResponse(response);
    return validated.marker === transaction ? validated : { status: 'blocked', reason: 'invalid-response', marker: transaction };
  }
}
