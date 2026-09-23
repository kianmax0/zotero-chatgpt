import { Window } from 'happy-dom';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let Child: typeof import('../../../packages/zotero/actors/OfficialChatChild.mjs').ZoteroChatGPTOfficialChatChild;

beforeAll(async () => {
  vi.stubGlobal('JSWindowActorChild', class {});
  ({ ZoteroChatGPTOfficialChatChild: Child } = await import('../../../packages/zotero/actors/OfficialChatChild.mjs'));
});
afterAll(() => { vi.unstubAllGlobals(); });

function page() {
  const window = new Window({ url: 'https://chatgpt.com/' });
  const doc = window.document;
  const composer = doc.createElement('div'); composer.id = 'prompt-textarea'; composer.contentEditable = 'true';
  const send = doc.createElement('button'); send.dataset.testid = 'send-button';
  const form = doc.createElement('form'); form.append(composer, send); doc.body.append(form);
  Object.assign(doc, { execCommand: (_command: string, _showUI: boolean, value: string) => {
    composer.textContent = value; composer.dispatchEvent(new doc.defaultView!.InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' })); return true;
  } });
  return { window, doc: doc as unknown as Document, composer, send };
}

function actorFor(current: { doc: Document; window: unknown }) {
  const actor = new Child();
  actor.document = current.doc;
  actor.contentWindow = current.window;
  actor.sendAsyncMessage = vi.fn();
  return actor;
}

function mobilePage(options: { action?: string; credential?: boolean; submits?: number } = {}) {
  const window = new Window({ url: 'https://chatgpt.com/' }); const doc = window.document;
  const form = doc.createElement('form'); if (options.action !== undefined) form.setAttribute('action', options.action);
  const composer = doc.createElement('textarea'); composer.id = 'mobile-composer-prompt'; form.append(composer);
  if (options.credential) { const credential = doc.createElement('input'); credential.type = 'password'; form.append(credential); }
  const buttons = Array.from({ length: options.submits ?? 1 }, () => { const button = doc.createElement('button'); button.type = 'submit'; form.append(button); return button; });
  doc.body.append(form);
  return { window, doc: doc as unknown as Document, composer, send: buttons[0]!, buttons };
}

function acceptedOnClick(current: { doc: Document; send: { addEventListener(type: string, listener: () => void): void } }, marker: string): void {
  current.send.addEventListener('click', () => {
    const message = current.doc.createElement('div'); message.dataset.messageAuthorRole = 'user';
    message.textContent = `accepted [Zotero request ${marker}]`; current.doc.body.append(message);
  });
}

describe('official ChatGPT child send transaction', () => {
  it('leaves ordinary upload, voice and menu buttons usable beside a nonempty known composer', () => {
    const current = page(); const actor = actorFor(current); current.composer.textContent = 'draft';
    for (const label of ['Upload', 'Voice', 'Menu']) {
      const control = current.composer.ownerDocument.createElement('button'); control.type = 'button'; control.setAttribute('aria-label', label); current.composer.closest('form')!.append(control);
      const preventDefault = vi.fn(); const stopImmediatePropagation = vi.fn();
      actor.handleEvent({ type: 'click', isTrusted: true, target: control, preventDefault, stopImmediatePropagation });
      expect(preventDefault, label).not.toHaveBeenCalled();
      expect(stopImmediatePropagation, label).not.toHaveBeenCalled();
    }
  });

  it('blocks only actual submit semantics for an unknown composer', () => {
    const current = page(); const actor = actorFor(current); current.composer.id = 'changed-site-editor'; current.composer.textContent = 'draft';
    const ordinary = current.composer.ownerDocument.createElement('button'); ordinary.type = 'button'; current.composer.closest('form')!.append(ordinary);
    const ordinaryPrevent = vi.fn(); actor.handleEvent({ type: 'click', isTrusted: true, target: ordinary, preventDefault: ordinaryPrevent, stopImmediatePropagation: vi.fn() });
    expect(ordinaryPrevent).not.toHaveBeenCalled();
    current.send.type = 'submit';
    const preventDefault = vi.fn(); const stopImmediatePropagation = vi.fn();
    actor.handleEvent({ type: 'click', isTrusted: true, target: current.send, preventDefault, stopImmediatePropagation });
    expect(preventDefault).toHaveBeenCalledTimes(1); expect(stopImmediatePropagation).toHaveBeenCalledTimes(1);
  });

  it('intercepts the resolved mobile submit button exactly once', () => {
    const current = mobilePage(); const actor = actorFor(current); current.composer.value = 'question';
    const submit = vi.fn(() => Promise.resolve({ status: 'accepted' })); actor.submitQuestion = submit;
    const preventDefault = vi.fn(); const stopImmediatePropagation = vi.fn();
    actor.handleEvent({ type: 'click', isTrusted: true, target: current.send, preventDefault, stopImmediatePropagation });
    expect(preventDefault).toHaveBeenCalledTimes(1); expect(stopImmediatePropagation).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1); expect(submit).toHaveBeenCalledWith('question');
  });

  it('reports an unknown editor as unsupported so the parent can fail closed', async () => {
    const current = page(); const actor = actorFor(current);
    current.composer.id = 'changed-site-editor';
    await expect(actor.receiveMessage({ name: 'probe' })).resolves.toMatchObject({ status: 'unsupported-composer' });
    const preventDefault = vi.fn(); const stopImmediatePropagation = vi.fn();
    actor.handleEvent({ type: 'keydown', key: 'Enter', shiftKey: false, isTrusted: true, target: current.composer, preventDefault, stopImmediatePropagation });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopImmediatePropagation).toHaveBeenCalledTimes(1);
    current.composer.remove();
    await expect(actor.receiveMessage({ name: 'probe' })).resolves.toMatchObject({ status: 'composer-missing' });
  });

  it('gates a double submission while the frozen context is being prepared', async () => {
    const current = page(); const actor = actorFor(current); current.composer.textContent = 'question';
    let finish!: (value: unknown) => void;
    const sendQuery = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    actor.sendQuery = sendQuery;
    const first = actor.submitQuestion('question');
    await expect(actor.submitQuestion('question')).resolves.toEqual({ status: 'blocked', reason: 'busy' });
    acceptedOnClick(current, 'marker-1');
    finish({ status: 'prepared', hasAutomaticContext: true, text: 'frozen [Zotero request marker-1]', marker: 'marker-1' });
    await expect(first).resolves.toMatchObject({ status: 'accepted' });
    expect(sendQuery).toHaveBeenCalledTimes(1);
  });

  it('preserves newer composer edits instead of overwriting them after extraction', async () => {
    const current = page(); const actor = actorFor(current); current.composer.textContent = 'question';
    let finish!: (value: unknown) => void;
    actor.sendQuery = () => new Promise(resolve => { finish = resolve; });
    const submission = actor.submitQuestion('question');
    current.composer.textContent = 'question plus a new thought';
    finish({ status: 'prepared', hasAutomaticContext: true, text: 'stale frozen prompt', marker: 'marker-2' });
    await expect(submission).resolves.toEqual({ status: 'blocked', reason: 'draft-changed' });
    expect(current.composer.textContent).toBe('question plus a new thought');
  });

  it('refuses an explicit More-details submission when the official composer already has another draft', async () => {
    const current = page(); const actor = actorFor(current); current.composer.textContent = 'my unrelated unsent draft';
    const prepare = vi.fn(() => Promise.resolve({ status: 'prepared', hasAutomaticContext: true, text: 'should never replace', marker: 'marker-explicit' }));
    actor.sendQuery = prepare;
    await expect(actor.submitQuestion('Explain the selected passage.')).resolves.toEqual({ status: 'blocked', reason: 'draft-changed' });
    expect(prepare).not.toHaveBeenCalled();
    expect(current.composer.textContent).toBe('my unrelated unsent draft');
  });

  it('does not replay into a new document after navigation completes during extraction', async () => {
    const current = page(); const actor = actorFor(current); current.composer.textContent = 'question';
    let finish!: (value: unknown) => void;
    actor.sendQuery = () => new Promise(resolve => { finish = resolve; });
    const submission = actor.submitQuestion('question');
    const navigated = page(); actor.document = navigated.doc; actor.contentWindow = navigated.window;
    finish({ status: 'prepared', hasAutomaticContext: true, text: 'stale frozen prompt', marker: 'marker-3' });
    await expect(submission).resolves.toEqual({ status: 'blocked', reason: 'context-changed' });
    expect(navigated.composer.textContent).toBe('');
  });

  it('confirms an opt-out send by a non-content marker before reporting accepted', async () => {
    const current = page(); const actor = actorFor(current); current.composer.textContent = 'question';
    const status = vi.fn(); actor.sendAsyncMessage = (name, data) => { status(name, data); };
    actor.sendQuery = () => Promise.resolve({ status: 'allow', marker: 'marker-off' });
    acceptedOnClick(current, 'marker-off');
    await expect(actor.submitQuestion('question')).resolves.toMatchObject({ status: 'accepted' });
    expect(status).toHaveBeenCalledWith('status', { status: 'accepted-without-context', marker: 'marker-off' });
  });

  it('reports selection-only sends without claiming automatic paper context', async () => {
    const current = page(); const actor = actorFor(current); current.composer.textContent = 'question';
    const status = vi.fn(); actor.sendAsyncMessage = (name, data) => { status(name, data); };
    actor.sendQuery = () => Promise.resolve({
      status: 'prepared', hasAutomaticContext: false,
      text: 'question\n\nExplicit selected text from Zotero:\nselected passage [Zotero request marker-selection]',
      marker: 'marker-selection',
    });
    acceptedOnClick(current, 'marker-selection');
    await expect(actor.submitQuestion('question')).resolves.toMatchObject({ status: 'accepted' });
    expect(current.composer.textContent).toContain('selected passage');
    expect(status).toHaveBeenCalledWith('status', { status: 'accepted-without-context', marker: 'marker-selection' });
  });

  it('waits for the official form send button to render after a controlled-textarea update', async () => {
    const current = page(); const actor = actorFor(current); current.composer.textContent = 'question';
    current.send.remove();
    actor.sendQuery = () => Promise.resolve({ status: 'prepared', hasAutomaticContext: true, text: 'frozen [Zotero request marker-late]', marker: 'marker-late' });
    const submission = actor.submitQuestion('question');
    const late = current.composer.ownerDocument.createElement('button'); late.dataset.testid = 'send-button';
    late.addEventListener('click', () => {
      const message = current.doc.createElement('div'); message.dataset.messageAuthorRole = 'user'; message.textContent = '[Zotero request marker-late]'; current.doc.body.append(message);
    });
    current.composer.closest('form')!.append(late);
    await expect(submission).resolves.toMatchObject({ status: 'accepted' });
  });

  it('uses the observed unique mobile form submit button without broadening to unsafe forms', async () => {
    const current = mobilePage(); const actor = actorFor(current); current.composer.value = 'question';
    await expect(actor.receiveMessage({ name: 'probe' })).resolves.toMatchObject({ status: 'draft' });
    actor.sendQuery = () => Promise.resolve({ status: 'prepared', hasAutomaticContext: true, text: 'mobile frozen [Zotero request marker-mobile]', marker: 'marker-mobile' });
    acceptedOnClick(current, 'marker-mobile');
    await expect(actor.submitQuestion('question')).resolves.toMatchObject({ status: 'accepted' });

    for (const unsafe of [mobilePage({ action: 'https://evil.invalid/submit' }), mobilePage({ credential: true }), mobilePage({ submits: 2 })]) {
      const unsafeActor = actorFor(unsafe);
      await expect(unsafeActor.receiveMessage({ name: 'probe' })).resolves.toMatchObject({ status: 'composer-ready' });
    }
  });

  it('retries the identical submission once when the official send control ignores the first click', async () => {
    const current = page(); const actor = actorFor(current); current.composer.textContent = 'question';
    actor.sendQuery = () => Promise.resolve({ status: 'prepared', hasAutomaticContext: true, text: 'frozen [Zotero request marker-retry]', marker: 'marker-retry' });
    let clicks = 0;
    current.send.addEventListener('click', () => {
      clicks += 1;
      // A brand-new conversation was observed accepting the composer but consuming the send only on a
      // second, identical click.
      if (clicks < 2) return;
      const message = current.doc.createElement('div'); message.dataset.messageAuthorRole = 'user';
      message.textContent = '[Zotero request marker-retry]'; current.doc.body.append(message);
    });

    await expect(actor.submitQuestion('question')).resolves.toMatchObject({ status: 'accepted', attempts: 2 });
    expect(clicks).toBe(2);
    expect(current.doc.querySelectorAll('[data-message-author-role="user"]').length).toBe(1);
  });

  it('never sends a second time when the page consumed the first click', async () => {
    const current = page(); const actor = actorFor(current); current.composer.textContent = 'question';
    actor.sendQuery = () => Promise.resolve({ status: 'prepared', hasAutomaticContext: true, text: 'frozen [Zotero request marker-consumed]', marker: 'marker-consumed' });
    let clicks = 0;
    current.send.addEventListener('click', () => {
      clicks += 1;
      // The real page clears its composer the moment it consumes the send; a slower marker message
      // must not be read as "the click was ignored".
      current.composer.textContent = '';
      current.window.setTimeout(() => {
        const message = current.doc.createElement('div'); message.dataset.messageAuthorRole = 'user';
        message.textContent = '[Zotero request marker-consumed]'; current.doc.body.append(message);
      }, 150);
    });

    await expect(actor.submitQuestion('question')).resolves.toMatchObject({ status: 'accepted', attempts: 1 });
    expect(clicks).toBe(1);
  });

  it('accepts the page re-rendering the inserted rich text before the send control appears', async () => {
    const current = page(); const actor = actorFor(current); current.composer.textContent = 'question';
    actor.sendQuery = () => Promise.resolve({ status: 'prepared', hasAutomaticContext: true, text: 'frozen\n\nwith\n\n\nbreaks [Zotero request marker-normalized]', marker: 'marker-normalized' });
    current.send.remove();
    // The real rich-text editor re-renders from its own state after insertText and collapses the
    // blank lines. That is the page's own formatting, not an owner edit.
    current.window.setTimeout(() => {
      current.composer.textContent = 'frozen\nwith\nbreaks [Zotero request marker-normalized]';
      const late = current.composer.ownerDocument.createElement('button'); late.dataset.testid = 'send-button';
      late.addEventListener('click', () => {
        const message = current.doc.createElement('div'); message.dataset.messageAuthorRole = 'user';
        message.textContent = '[Zotero request marker-normalized]'; current.doc.body.append(message);
      });
      current.composer.closest('form')!.append(late);
    }, 60);

    await expect(actor.submitQuestion('question')).resolves.toMatchObject({ status: 'accepted', attempts: 1 });
  });

  it('still refuses to send when the page replaced the frozen text with real different words', async () => {
    const current = page(); const actor = actorFor(current); current.composer.textContent = 'question';
    actor.sendQuery = () => Promise.resolve({ status: 'prepared', hasAutomaticContext: true, text: 'frozen [Zotero request marker-edited]', marker: 'marker-edited' });
    current.send.remove();
    current.window.setTimeout(() => {
      current.composer.textContent = 'the owner typed something else entirely';
      const late = current.composer.ownerDocument.createElement('button'); late.dataset.testid = 'send-button';
      current.composer.closest('form')!.append(late);
    }, 40);

    await expect(actor.submitQuestion('question')).resolves.toEqual({ status: 'blocked', reason: 'draft-changed' });
  });
});
