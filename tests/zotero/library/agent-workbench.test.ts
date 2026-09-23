import { Window } from 'happy-dom';
import { expect, it, vi } from 'vitest';
import { mountLibraryAgentWorkbench, type LibraryAgentWorkbenchState } from '../../../packages/zotero/src/views/library-agent-workbench.ts';

function fixture(withChat = false) {
  const document = new Window({ url: 'https://zotero.test/' }).document as unknown as Document;
  const page = document.createElement('div'); page.id = 'zotero-pane';
  const toolbar = document.createElement('div'); toolbar.id = 'zotero-items-toolbar';
  const note = document.createElement('button'); note.id = 'zotero-tb-note-add';
  const search = document.createElement('input'); search.id = 'zotero-tb-search'; toolbar.append(note, search);
  const dock = document.createElement('div'); dock.id = 'zotero-items-pane';
  const list = document.createElement('div'); list.id = 'zotero-items-tree'; dock.append(list);
  const detail = document.createElement('div'); detail.id = 'zotero-item-pane';
  page.append(toolbar, dock, detail); document.body.append(page);
  const state: LibraryAgentWorkbenchState = { lines: [], busy: false, model: 'gpt-6-sol', models: [{ id: 'gpt-6-sol', label: 'GPT-6 Sol' }, { id: 'gpt-6-luna', label: 'GPT-6 Luna' }] };
  const send = vi.fn(() => Promise.resolve());
  let automaticContext = true;
  const openSelectedPdf = vi.fn(() => Promise.resolve());
  const searchMentions = vi.fn(() => Promise.resolve([{ id: 'collection:1:COLLECT1', kind: 'collection' as const, label: 'Methods', detail: 'My Library' }]));
  const startLogin = vi.fn(() => Promise.resolve(() => {}));
  const showChat = vi.fn(() => Promise.resolve({ title: 'Selected paper', contextStatus: automaticContext ? 'bibliography-only' as const : 'context-disabled' as const }));
  const dispose = mountLibraryAgentWorkbench({
    document, sessionId: '123e4567-e89b-42d3-a456-426614174000', stylesheetURL: 'resource://test/content/assets/sidebar.css',
    load: () => Promise.resolve(state), subscribe: () => () => {}, send,
    skills: () => Promise.resolve([{ id: 'discover', name: 'discover', description: 'Find papers by topic' }]),
    searchMentions,
    getTasks: () => Promise.resolve({ list: () => Promise.resolve([]), subscribe: () => () => {} } as never),
    startLogin, openOutput: () => Promise.resolve(),
    ...(withChat ? { showChat } : {}),
    readAutomaticContext: () => automaticContext,
    toggleAutomaticContext: () => (automaticContext = !automaticContext),
    openSelectedPdf,
  });
  const click = (element: Element) => element.dispatchEvent(new document.defaultView!.Event('click', { bubbles: true }));
  return { document, page, dock, note, search, send, searchMentions, startLogin, showChat, openSelectedPdf, automaticContext: () => automaticContext, dispose, click };
}

it('opens a native conversation composer after Zotero Add Item controls', () => {
  const f = fixture();
  try {
    const trigger = f.document.querySelector('[data-zchatgpt-library-agent]')!;
    expect(trigger.previousElementSibling).toBe(f.search);
    f.click(trigger);
    const panel = f.document.querySelector<HTMLElement>('[data-zchatgpt-library-agent-panel]')!;
    expect(panel.hidden).toBe(false);
    expect(panel.parentElement).toBe(f.dock);
    expect(f.page.classList.contains('zchatgpt-library-dock-open')).toBe(true);
    expect(panel.classList.contains('zchatgpt-sidebar')).toBe(true);
    expect(panel.querySelector('.zchatgpt-mode-switch')).not.toBeNull();
    expect(panel.querySelector('.zchatgpt-composer')).not.toBeNull();
    expect(f.document.querySelector('link[href="resource://test/content/assets/sidebar.css"]')).not.toBeNull();
    expect(panel.querySelector('[aria-label="Message Zotero Agent"]')).not.toBeNull();
    expect(panel.textContent).toContain('Find papers');
    expect(panel.querySelectorAll('.zchatgpt-library-start [role="button"]')).toHaveLength(4);
    expect(panel.querySelector('input[placeholder*="DOI"]')).toBeNull();
    f.click(trigger);
    expect(panel.hidden).toBe(true);
    expect(f.page.classList.contains('zchatgpt-library-dock-open')).toBe(false);
  } finally { f.dispose(); }
});

it('shows Reader-style history, context and PDF controls with a direct context toggle', async () => {
  const f = fixture();
  try {
    f.click(f.document.querySelector('[data-zchatgpt-library-agent]')!);
    const automatic = f.document.querySelector<HTMLButtonElement>('[aria-label="Automatic article context"]')!;
    expect(automatic.getAttribute('aria-pressed')).toBe('true');
    f.click(automatic);
    expect(f.automaticContext()).toBe(false);
    expect(automatic.getAttribute('aria-pressed')).toBe('false');
    f.click(f.document.querySelector('[aria-label="Open selected article PDF"]')!);
    await vi.waitFor(() => expect(f.openSelectedPdf).toHaveBeenCalledOnce());
    f.click(f.document.querySelector('[aria-label="Library Agent history"]')!);
    expect(f.document.querySelector<HTMLElement>('.zchatgpt-library-history')?.hidden).toBe(false);
    expect(f.document.querySelector('.zchatgpt-library-history')?.textContent).toContain('No library Agent messages yet');
  } finally { f.dispose(); }
});

it('shows concise ChatGPT context scope before sending and updates it with the icon toggle', async () => {
  const f = fixture(true);
  try {
    f.click(f.document.querySelector('[data-zchatgpt-library-agent]')!);
    f.click(f.document.querySelector('[data-zchatgpt-library-mode="chat"]')!);
    await vi.waitFor(() => expect(f.showChat).toHaveBeenCalledOnce());
    const notice = f.document.querySelector<HTMLElement>('[data-zchatgpt-library-chat-notice]')!;
    await vi.waitFor(() => expect(notice.hidden).toBe(false));
    expect(notice.textContent).toContain('ChatGPT receives available bibliography and saved abstract. No PDF body text.');
    f.click(f.document.querySelector('[aria-label="Automatic article context"]')!);
    await vi.waitFor(() => expect(notice.textContent).toBe('Automatic article context is off.'));
    f.click(f.document.querySelector('[data-zchatgpt-library-mode="agent"]')!);
    expect(notice.hidden).toBe(true);
  } finally { f.dispose(); }
});

it('closes the library dock on a Reader tab switch without focusing the hidden library toolbar', () => {
  const f = fixture();
  try {
    f.click(f.document.querySelector('[data-zchatgpt-library-agent]')!);
    const panel = f.document.querySelector<HTMLElement>('[data-zchatgpt-library-agent-panel]')!;
    f.document.body.focus();
    f.dispose.onTabChange(false);
    expect(panel.hidden).toBe(true);
    expect(f.page.classList.contains('zchatgpt-library-dock-open')).toBe(false);
    expect(f.document.activeElement).not.toBe(f.document.querySelector('[data-zchatgpt-library-agent]'));
  } finally { f.dispose(); }
});

it('resizes only the library dock and leaves the native item pane in place', () => {
  const f = fixture();
  try {
    f.click(f.document.querySelector('[data-zchatgpt-library-agent]')!);
    const panel = f.document.querySelector<HTMLElement>('[data-zchatgpt-library-agent-panel]')!;
    const resizer = f.document.querySelector<HTMLElement>('[aria-label="Resize Zotero ChatGPT sidebar"]')!;
    expect(resizer.hidden).toBe(false);
    f.dock.getBoundingClientRect = () => ({ width: 800, height: 600 }) as DOMRect;
    panel.getBoundingClientRect = () => ({ width: 360, height: 300 }) as DOMRect;
    const stacked = f.document.defaultView!.getComputedStyle(f.dock).flexDirection === 'column';
    resizer.dispatchEvent(new f.document.defaultView!.KeyboardEvent('keydown', { key: stacked ? 'ArrowUp' : 'ArrowLeft', bubbles: true, cancelable: true }));
    expect(panel.style.getPropertyValue(stacked ? '--zchatgpt-library-height' : '--zchatgpt-library-width')).toBe(stacked ? '324px' : '384px');
    expect(f.document.getElementById('zotero-item-pane')?.isConnected).toBe(true);
    f.dispose.onTabChange(false);
    expect(resizer.hidden).toBe(true);
  } finally { f.dispose(); }
});

it('uses the Reader-style plus menu for skills and Zotero references', async () => {
  const f = fixture();
  try {
    f.click(f.document.querySelector('[data-zchatgpt-library-agent]')!);
    const plus = f.document.querySelector<HTMLButtonElement>('[aria-label="Add a skill or Zotero reference"]')!;
    f.click(plus);
    expect(plus.getAttribute('aria-expanded')).toBe('true');
    expect(f.document.querySelector('[aria-label="Add a skill"]')).not.toBeNull();
    f.click(f.document.querySelector('[aria-label="Add a Zotero reference"]')!);
    await vi.waitFor(() => expect(f.searchMentions).toHaveBeenCalledWith(''));
    expect(plus.getAttribute('aria-expanded')).toBe('false');
  } finally { f.dispose(); }
});

it('starts official sign-in from the visible button and reports pending status', () => {
  const f = fixture();
  try {
    f.click(f.document.querySelector('[data-zchatgpt-library-agent]')!);
    f.click(f.document.querySelector('[data-zchatgpt-codex-login]')!);
    expect(f.startLogin).toHaveBeenCalledOnce();
    expect(f.document.querySelector('[data-zchatgpt-codex-login-status]')?.textContent).toContain('official Codex sign-in');
  } finally { f.dispose(); }
});

it('updates the live sign-in state and retries a failed startup', async () => {
  const document = new Window({ url: 'https://zotero.test/' }).document as unknown as Document;
  const toolbar = document.createElement('div'); toolbar.id = 'zotero-items-toolbar'; document.body.append(toolbar);
  let notify: ((snapshot: import('../../../packages/contracts/src/runtime.ts').RuntimeSnapshot) => void) | undefined;
  const stop = vi.fn();
  const startLogin = vi.fn().mockRejectedValueOnce(new Error('Codex runtime could not start.'))
    .mockImplementationOnce((listener: typeof notify) => { notify = listener; return Promise.resolve(stop); });
  const dispose = mountLibraryAgentWorkbench({
    document, sessionId: '123e4567-e89b-42d3-a456-426614174000',
    load: () => Promise.resolve({ lines: [], busy: false, model: null, models: [] }), subscribe: () => () => {},
    send: () => Promise.resolve(), skills: () => Promise.resolve([]), searchMentions: () => Promise.resolve([]),
    getTasks: () => Promise.resolve({ list: () => Promise.resolve([]), subscribe: () => () => {} } as never),
    startLogin, openOutput: () => Promise.resolve(),
  });
  try {
    const click = (element: Element) => element.dispatchEvent(new document.defaultView!.Event('click', { bubbles: true }));
    click(document.querySelector('[data-zchatgpt-library-agent]')!);
    const login = document.querySelector<HTMLButtonElement>('[data-zchatgpt-codex-login]')!;
    const status = document.querySelector<HTMLElement>('[data-zchatgpt-codex-login-status]')!;
    click(login);
    await vi.waitFor(() => expect(status.textContent).toBe('Codex runtime could not start.'));
    expect(login.disabled).toBe(false);
    click(login);
    await vi.waitFor(() => expect(startLogin).toHaveBeenCalledTimes(2));
    notify?.({ revision: 1, runtime: 'ready', account: { state: 'signingIn' }, login: { loginId: 'login-1', state: 'pending' }, models: [], error: null });
    expect(status.textContent).toContain('Complete the official Codex sign-in');
    notify?.({ revision: 2, runtime: 'ready', account: { state: 'signedIn' }, login: { loginId: 'login-1', state: 'succeeded' }, models: [], error: null });
    expect(login.textContent).toBe('Signed in');
    expect(login.disabled).toBe(true);
  } finally { dispose(); }
  expect(stop).toHaveBeenCalledOnce();
});

it('freezes selected slash skill and Zotero mention into one conversation send', async () => {
  const f = fixture();
  try {
    f.click(f.document.querySelector('[data-zchatgpt-library-agent]')!);
    const input = f.document.querySelector<HTMLTextAreaElement>('[aria-label="Message Zotero Agent"]')!;
    await vi.waitFor(() => expect(f.document.querySelector('[aria-label="Agent model"] option')).not.toBeNull());
    const model = f.document.querySelector<HTMLSelectElement>('[aria-label="Agent model"]')!;
    model.value = 'gpt-6-luna'; model.dispatchEvent(new f.document.defaultView!.Event('change', { bubbles: true }));
    input.value = '/disc'; input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new f.document.defaultView!.Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(f.document.querySelector('[role="option"]')?.textContent).toContain('/discover'));
    f.click(f.document.querySelector('[role="option"]')!);
    input.value = 'Find predictive coding papers @Meth'; input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new f.document.defaultView!.Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(f.searchMentions).toHaveBeenCalledWith('Meth'));
    f.click(f.document.querySelector('[role="option"]')!);
    f.click(f.document.querySelector('[data-zchatgpt-library-send]')!);
    await vi.waitFor(() => expect(f.send).toHaveBeenCalledWith({
      question: 'Find predictive coding papers', skillId: 'discover', modelId: 'gpt-6-luna',
      mentions: [{ id: 'collection:1:COLLECT1', kind: 'collection', label: 'Methods', detail: 'My Library' }],
    }));
  } finally { f.dispose(); }
});

it('starts common library work as an editable conversation draft', async () => {
  const f = fixture();
  try {
    f.click(f.document.querySelector('[data-zchatgpt-library-agent]')!);
    await vi.waitFor(() => expect(f.document.querySelector('[aria-label="Agent model"] option')).not.toBeNull());
    const starter = [...f.document.querySelectorAll<HTMLElement>('.zchatgpt-library-start [role="button"]')].find(button => button.querySelector('.zchatgpt-agent-empty-action-title')?.textContent === 'Find papers')!;
    f.click(starter);
    expect(f.document.querySelector<HTMLTextAreaElement>('[aria-label="Message Zotero Agent"]')?.value).toBe('Find recent open-access papers on ');
    expect(f.send).not.toHaveBeenCalled();
    expect(f.document.querySelector('[data-zchatgpt-library-context]')?.textContent).toContain('/discover');
  } finally { f.dispose(); }
});

it('keeps official Chat and native Agent surfaces separate in the same library shell', async () => {
  const document = new Window({ url: 'https://zotero.test/' }).document as unknown as Document;
  const toolbar = document.createElement('div'); toolbar.id = 'zotero-items-toolbar'; document.body.append(toolbar);
  const showChat = vi.fn(() => Promise.resolve({ title: 'Selected paper', contextStatus: 'bibliography-only' as const }));
  const hideChat = vi.fn();
  const loadAgent = vi.fn(() => Promise.resolve({ lines: [], busy: false, model: null, models: [] }));
  const dispose = mountLibraryAgentWorkbench({
    document, sessionId: '123e4567-e89b-42d3-a456-426614174000',
    load: loadAgent, subscribe: () => () => {},
    send: () => Promise.resolve(), skills: () => Promise.resolve([]), searchMentions: () => Promise.resolve([]),
    getTasks: () => Promise.resolve({ list: () => Promise.resolve([]), subscribe: () => () => {} } as never),
    startLogin: () => Promise.resolve(() => {}), showChat, hideChat, openOutput: () => Promise.resolve(),
  });
  try {
    const click = (element: Element) => element.dispatchEvent(new document.defaultView!.Event('click', { bubbles: true }));
    click(document.querySelector('[data-zchatgpt-library-agent]')!);
    click(document.querySelector('[data-zchatgpt-library-mode="chat"]')!);
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Zotero Agent"]')?.textContent).toContain('Chat · Selected paper'));
    expect(showChat).toHaveBeenCalledOnce();
    expect(loadAgent).not.toHaveBeenCalled();
    expect((showChat.mock.calls[0] as unknown as [HTMLElement])[0].hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('[aria-label="Message Zotero Agent"]')?.closest('.zchatgpt-library-draft')?.hasAttribute('hidden')).toBe(true);
    click(document.querySelector('[data-zchatgpt-library-mode="agent"]')!);
    expect(loadAgent).toHaveBeenCalledOnce();
    expect(hideChat).toHaveBeenCalledOnce();
    expect(document.querySelector<HTMLElement>('[aria-label="Message Zotero Agent"]')?.closest('.zchatgpt-library-draft')?.hasAttribute('hidden')).toBe(false);
  } finally { dispose(); }
});

it('rebinds library Chat on reopen and returns to Agent when the selected paper is gone', async () => {
  const document = new Window({ url: 'https://zotero.test/' }).document as unknown as Document;
  const toolbar = document.createElement('div'); toolbar.id = 'zotero-items-toolbar'; document.body.append(toolbar);
  const showChat = vi.fn().mockResolvedValueOnce({ title: 'First paper', contextStatus: 'bibliography-only' }).mockResolvedValueOnce({ title: '', contextStatus: 'unbound' });
  const hideChat = vi.fn();
  const dispose = mountLibraryAgentWorkbench({
    document, sessionId: '123e4567-e89b-42d3-a456-426614174000',
    load: () => Promise.resolve({ lines: [], busy: false, model: null, models: [] }), subscribe: () => () => {},
    send: () => Promise.resolve(), skills: () => Promise.resolve([]), searchMentions: () => Promise.resolve([]),
    getTasks: () => Promise.resolve({ list: () => Promise.resolve([]), subscribe: () => () => {} } as never),
    startLogin: () => Promise.resolve(() => {}), showChat, hideChat, openOutput: () => Promise.resolve(),
  });
  try {
    const click = (element: Element) => element.dispatchEvent(new document.defaultView!.Event('click', { bubbles: true }));
    const trigger = document.querySelector('[data-zchatgpt-library-agent]')!;
    click(trigger); click(document.querySelector('[data-zchatgpt-library-mode="chat"]')!);
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Zotero Agent"]')?.textContent).toContain('Chat · First paper'));
    click(trigger); click(trigger);
    await vi.waitFor(() => expect(document.querySelector('[data-zchatgpt-library-chat-notice]')?.textContent).toContain('Select one Zotero article'));
    expect(document.querySelector('[data-zchatgpt-library-mode="chat"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector<HTMLElement>('.zchatgpt-library-draft')?.hidden).toBe(true);
  } finally { dispose(); }
});

it('refreshes the current article Chat binding when Zotero selection changes in the library tree', async () => {
  const document = new Window({ url: 'https://zotero.test/' }).document as unknown as Document;
  const toolbar = document.createElement('div'); toolbar.id = 'zotero-items-toolbar'; document.body.append(toolbar);
  const tree = document.createElement('div'); tree.id = 'zotero-items-tree'; document.body.append(tree);
  const showChat = vi.fn().mockResolvedValueOnce({ title: 'First paper', contextStatus: 'bibliography-only' }).mockResolvedValueOnce({ title: 'Next paper', contextStatus: 'bibliography-only' });
  const dispose = mountLibraryAgentWorkbench({
    document, sessionId: '123e4567-e89b-42d3-a456-426614174000',
    load: () => Promise.resolve({ lines: [], busy: false, model: null, models: [] }), subscribe: () => () => {},
    send: () => Promise.resolve(), skills: () => Promise.resolve([]), searchMentions: () => Promise.resolve([]),
    getTasks: () => Promise.resolve({ list: () => Promise.resolve([]), subscribe: () => () => {} } as never),
    startLogin: () => Promise.resolve(() => {}), showChat, openOutput: () => Promise.resolve(),
  });
  try {
    const click = (element: Element) => element.dispatchEvent(new document.defaultView!.Event('click', { bubbles: true }));
    click(document.querySelector('[data-zchatgpt-library-agent]')!);
    click(document.querySelector('[data-zchatgpt-library-mode="chat"]')!);
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Zotero Agent"]')?.textContent).toContain('Chat · First paper'));
    click(tree);
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Zotero Agent"]')?.textContent).toContain('Chat · Next paper'));
    expect(showChat).toHaveBeenCalledTimes(2);
  } finally { dispose(); }
});
