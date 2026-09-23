import { afterEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import { mountLibraryAgentEntry } from '../../../packages/zotero/src/views/library-agent-entry.ts';

const mounted: Array<() => void> = [];
afterEach(() => { for (const dispose of mounted.splice(0)) dispose(); });

describe('library Agent entry', () => {
  it('places a visible Agent button beside Zotero’s DOI lookup and keeps a Tools menu entry', () => {
    const document = new Window({ url: 'https://zotero.test/' }).document as unknown as Document;
    const controls = document.createElement('div');
    const lookup = document.createElement('button'); lookup.id = 'zotero-tb-lookup'; controls.append(lookup);
    const tools = document.createElement('div'); tools.id = 'menu_ToolsPopup';
    document.body.append(controls, tools);
    mounted.push(mountLibraryAgentEntry({
      document, sessionId: '123e4567-e89b-42d3-a456-426614174000',
      getTasks: () => Promise.resolve({ list: () => Promise.resolve([]), subscribe: () => () => {} } as never),
      collections: () => Promise.resolve([]), openOutput: () => Promise.resolve(),
    }));
    const button = document.querySelector<HTMLElement>('[data-zchatgpt-library-agent]');
    expect(button?.previousElementSibling).toBe(lookup);
    expect(button?.getAttribute('label')).toBe('Agent');
    expect(button?.getAttribute('tooltiptext')).toContain('Zotero Agent');
    expect(tools.querySelector('[data-zchatgpt-library-agent-menu]')).not.toBeNull();
  });

  it('adds a visible main-window entry and starts no acquisition until opened and submitted', async () => {
    const document = new Window({ url: 'https://zotero.test/' }).document as unknown as Document;
    const toolbar = document.createElement('div'); toolbar.id = 'zotero-toolbar'; document.body.append(toolbar);
    const tasks = {
      list: vi.fn(() => Promise.resolve([])),
      subscribe: vi.fn(() => () => {}),
      planAcquisition: vi.fn(() => Promise.resolve({ id: 'task-id' })),
    };
    const collections = vi.fn(() => Promise.resolve([{ clientId: 'profile', libraryId: 1, collectionKey: 'COLLECT1', name: 'Reading' }]));
    const dispose = mountLibraryAgentEntry({
      document,
      sessionId: '123e4567-e89b-42d3-a456-426614174000',
      getTasks: vi.fn(() => Promise.resolve(tasks as never)),
      collections,
      openOutput: vi.fn(() => Promise.resolve()),
    });
    mounted.push(dispose);

    const trigger = document.querySelector<HTMLElement>('[data-zchatgpt-library-agent]');
    expect(trigger).not.toBeNull();
    expect(trigger?.isConnected).toBe(true);
    expect(trigger?.hasAttribute('hidden')).toBe(false);
    expect(tasks.planAcquisition).not.toHaveBeenCalled();
    const click = document.createEvent('Event'); click.initEvent('click', true, true); trigger?.dispatchEvent(click);
    await vi.waitFor(() => expect(collections).toHaveBeenCalledOnce());
    expect(tasks.planAcquisition).not.toHaveBeenCalled();
    const panel = document.querySelector<HTMLElement>('[data-zchatgpt-library-agent-panel]');
    expect(panel?.hidden).toBe(false);
    const collection = panel?.querySelector<HTMLSelectElement>('select');
    if (!collection) throw new Error('The acquisition collection picker did not render.');
    await vi.waitFor(() => expect(collection.options).toHaveLength(2));
    collection.value = 'profile:1:COLLECT1'; const change = document.createEvent('Event'); change.initEvent('change', true, true); collection.dispatchEvent(change);
    expect(collection.value).toBe('profile:1:COLLECT1');
    const identifierInput = panel?.querySelector<HTMLTextAreaElement>('#zchatgpt-library-agent-identifiers');
    if (!identifierInput) throw new Error('The DOI/URL input did not render.');
    identifierInput.value = '10.1234/example';
    const submit = document.createEvent('Event'); submit.initEvent('submit', true, true); panel?.querySelector('form')?.dispatchEvent(submit);
    await vi.waitFor(() => expect(tasks.planAcquisition).toHaveBeenCalledOnce());
    expect(tasks.planAcquisition).toHaveBeenCalledWith({
      conversationId: '123e4567-e89b-42d3-a456-426614174000',
      target: { clientId: 'profile', libraryId: 1, collectionKey: 'COLLECT1' },
      question: 'Acquire 10.1234/example',
      identifiers: ['10.1234/example'],
    });
  });

  it('starts Codex sign-in only when requested and reports its result', async () => {
    const document = new Window({ url: 'https://zotero.test/' }).document as unknown as Document;
    const toolbar = document.createElement('div'); toolbar.id = 'zotero-toolbar'; document.body.append(toolbar);
    const startLogin = vi.fn(() => Promise.resolve());
    const dispose = mountLibraryAgentEntry({
      document,
      sessionId: '123e4567-e89b-42d3-a456-426614174000',
      getTasks: () => Promise.resolve({ list: () => Promise.resolve([]), subscribe: () => () => {} } as never),
      collections: () => Promise.resolve([]),
      startLogin,
      openOutput: () => Promise.resolve(),
    });
    mounted.push(dispose);
    const trigger = document.querySelector<HTMLElement>('[data-zchatgpt-library-agent]');
    const click = document.createEvent('Event'); click.initEvent('click', true, true); trigger?.dispatchEvent(click);
    const login = document.querySelector<HTMLButtonElement>('[data-zchatgpt-codex-login]');
    expect(login?.textContent).toBe('Sign in to Codex');
    expect(startLogin).not.toHaveBeenCalled();
    const request = document.createEvent('Event'); request.initEvent('click', true, true); login?.dispatchEvent(request);
    await vi.waitFor(() => expect(startLogin).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(document.querySelector('[data-zchatgpt-codex-login-status]')?.textContent).toContain('Complete sign-in there'));
  });
});
