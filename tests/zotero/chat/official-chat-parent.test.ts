import { Window } from 'happy-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const EMBED_ATTR = 'data-zchatgpt-embed-browser';
const BINDING_ATTR = 'data-zchatgpt-embed-binding';
const BRIDGE_EVENT = 'ZoteroChatGPT:OfficialChatBridge';

function parentActor(response: unknown) {
  const win = new Window({ url: 'https://chatgpt.com/' });
  const browser = {
    ownerGlobal: win,
    currentURI: { spec: 'https://chatgpt.com/' },
    hasAttribute: (name: string) => name === EMBED_ATTR,
    getAttribute: (name: string) => name === BINDING_ATTR ? 'paper-binding' : null,
    dispatchEvent: (event: Event) => {
      const detail = (event as CustomEvent<{ respond(value: unknown): void }>).detail;
      if (event.type === BRIDGE_EVENT) detail.respond(response);
      return true;
    },
  };
  const manager = { documentURI: { spec: 'https://chatgpt.com/' } };
  const actor = new ZoteroChatGPTOfficialChatParent();
  Object.assign(actor, { manager, browsingContext: { top: { embedderElement: browser }, currentWindowGlobal: manager } });
  return actor;
}

let ZoteroChatGPTOfficialChatParent: typeof import('../../../packages/zotero/actors/OfficialChatParent.mjs').ZoteroChatGPTOfficialChatParent;
beforeAll(async () => {
  vi.stubGlobal('JSWindowActorParent', class {});
  ({ ZoteroChatGPTOfficialChatParent } = await import('../../../packages/zotero/actors/OfficialChatParent.mjs'));
});
afterEach(() => vi.unstubAllGlobals());

describe('official Chat parent context validation', () => {
  it('preserves whether prepared context actually contains automatic bibliography', async () => {
    const actor = parentActor({ status: 'prepared', text: 'question', hasAutomaticContext: false, marker: 'transaction-1' });
    await expect(actor.receiveMessage({
      name: 'prepare', data: { question: 'question', transaction: 'transaction-1' },
    })).resolves.toEqual({ status: 'prepared', text: 'question', hasAutomaticContext: false, marker: 'transaction-1' });
  });

  it('rejects a prepared response that omits the context-presence flag', async () => {
    const actor = parentActor({ status: 'prepared', text: 'question', marker: 'transaction-2' });
    await expect(actor.receiveMessage({
      name: 'prepare', data: { question: 'question', transaction: 'transaction-2' },
    })).resolves.toEqual({ status: 'blocked', reason: 'invalid-response', marker: 'transaction-2' });
  });
});
