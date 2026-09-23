import { Window as HappyWindow } from 'happy-dom';
import { describe, expect, it, vi } from 'vitest';
import { createLibraryOfficialChat, type LibraryChatItem } from '../../../packages/zotero/src/chat/library-official.ts';
import type { ChatEmbedSurface, OfficialChatContextProvider } from '../../../packages/zotero/src/chat/embed.ts';

function article(overrides: Partial<LibraryChatItem> = {}): LibraryChatItem {
  const fields: Record<string, string> = {
    title: 'A frozen paper', publicationTitle: 'Journal of Tests', date: '2025-03-01', DOI: '10.1234/frozen',
    abstractNote: '<p>Stored abstract only.</p>',
  };
  return {
    id: 41, key: 'ABCDEF12', libraryID: 1, itemType: 'journalArticle',
    isRegularItem: () => true, getField: name => fields[name] ?? '',
    getCreators: () => [{ firstName: 'Ada', lastName: 'Lovelace', creatorType: 'author' }],
    ...overrides,
  };
}

function fixture(selected: LibraryChatItem[], automaticContextEnabled?: () => boolean) {
  const win = new HappyWindow({ url: 'https://zotero.test/' }).window as unknown as Window;
  const contextProviders: OfficialChatContextProvider[] = [];
  let rememberBound: (url: string) => void = () => {};
  const bindConversation = vi.fn((_binding: string, _savedURL: string | null, remember: (url: string) => void) => { rememberBound = remember; });
  let attached = false; let hasDraft = false;
  const showSurface = vi.fn(() => { attached = true; });
  const hideSurface = vi.fn(() => { attached = false; });
  const destroySurface = vi.fn();
  const surface: ChatEmbedSurface = {
    show: showSurface, hide: hideSurface, destroy: destroySurface, sync: vi.fn(), reload: vi.fn(),
    bindContext: vi.fn((_binding: string, provider: OfficialChatContextProvider) => { contextProviders.push(provider); }),
    stage: vi.fn(), submitQuestion: vi.fn(), bindConversation,
    evictable: vi.fn(() => !attached && !hasDraft), snapshot: vi.fn(() => ({ url: null, loading: false, loaded: false })),
  };
  const createSurface = vi.fn(() => surface);
  const rememberConversation = vi.fn();
  const adapter = createLibraryOfficialChat({
    window: win, selectedItems: () => selected, createSurface,
    ...(automaticContextEnabled ? { automaticContextEnabled } : {}),
    readConversation: binding => `https://chatgpt.com/c/${binding === 'zotero-item:1:ABCDEF12' ? 'saved' : 'other'}`,
    rememberConversation,
  });
  const anchor = win.document.createElement('div'); win.document.body.append(anchor);
  return { adapter, anchor, surface, showSurface, createSurface, contextProviders, bindConversation, hideSurface, destroySurface, rememberConversation, rememberBound: (url: string) => rememberBound(url), setDraft: (value: boolean) => { hasDraft = value; } };
}

describe('main-library official Chat adapter', () => {
  it('requires exactly one regular parent item and reports zero/multiple selection without creating a surface', () => {
    for (const selected of [[], [article(), article({ id: 42, key: 'ABCDEF13' })], [article({ isRegularItem: () => false })], [article({ parentItemID: 6 })]]) {
      const f = fixture(selected);
      const state = f.adapter.show(f.anchor);
      expect(state.status).toBe('blocked');
      expect(state.title).toBeNull();
      expect(f.createSurface).not.toHaveBeenCalled();
      f.adapter.dispose();
    }
  });

  it('shows an official Chat surface bound to frozen bibliography only and the item conversation', async () => {
    const item = article(); const f = fixture([item]);
    const state = f.adapter.show(f.anchor);
    expect(state).toMatchObject({ status: 'ready', title: 'A frozen paper', binding: 'zotero-item:1:ABCDEF12', contextStatus: 'bibliography-only' });
    expect(f.createSurface).toHaveBeenCalledOnce();
    expect(f.showSurface).toHaveBeenCalledWith(f.anchor, null);
    expect(f.bindConversation).toHaveBeenCalledWith(
      'zotero-item:1:ABCDEF12', 'https://chatgpt.com/c/saved', expect.any(Function),
    );
    const provider = f.contextProviders[0]!;
    expect(await provider('Explain this')).toEqual({
      status: 'ready', paperContext: 'Title: A frozen paper\nAuthors: Ada Lovelace\nPublication: Journal of Tests\nYear: 2025\nDOI: 10.1234/frozen\n\nAbstract:\nStored abstract only.',
      selection: null, coverage: { kind: 'bibliography' },
    });
    // Subsequent sends keep the bound metadata while the selected item remains unchanged.
    expect((await provider('Follow up')).status).toBe('ready');
    expect(f.adapter.state().title).toBe('A frozen paper');
    f.rememberBound('https://chatgpt.com/c/next');
    expect(f.rememberConversation).toHaveBeenCalledWith('zotero-item:1:ABCDEF12', 'https://chatgpt.com/c/next');
    f.adapter.dispose();
    expect(f.destroySurface).toHaveBeenCalledOnce();
  });

  it('blocks a send if the live selection changes after binding, without retargeting context', async () => {
    const selected = [article()]; const f = fixture(selected);
    f.adapter.show(f.anchor);
    selected[0] = article({ id: 42, key: 'ABCDEF13', getField: name => name === 'title' ? 'Different paper' : '' });
    expect(await f.contextProviders[0]!('Question')).toEqual({ status: 'blocked', reason: 'context-failed' });
    expect(f.adapter.state()).toMatchObject({ status: 'blocked', contextStatus: 'selection-changed' });
    expect(f.adapter.state().title).toBe('A frozen paper');
    f.adapter.dispose();
  });

  it('uses the selected title as minimal context and keeps lifecycle methods idempotent', async () => {
    const f = fixture([article({ itemType: '', getField: name => name === 'title' ? 'Bare title' : '', getCreators: () => [] })]);
    f.adapter.show(f.anchor);
    expect(await f.contextProviders[0]!('Question')).toEqual({ status: 'ready', paperContext: 'Title: Bare title', selection: null, coverage: { kind: 'bibliography' } });
    f.adapter.hide(); f.adapter.hide();
    expect(f.hideSurface).toHaveBeenCalledTimes(2);
    f.adapter.dispose(); f.adapter.dispose();
    expect(f.destroySurface).toHaveBeenCalledOnce();
    expect(f.adapter.show(f.anchor).status).toBe('error');
  });

  it('blocks a send if the same selected Zotero item metadata changes after binding', async () => {
    let title = 'A frozen paper';
    const selected = article({ getField: name => name === 'title' ? title : name === 'abstractNote' ? 'Stored abstract only.' : name === 'publicationTitle' ? 'Journal of Tests' : name === 'date' ? '2025' : name === 'DOI' ? '10.1234/frozen' : '' });
    const f = fixture([selected]);
    f.adapter.show(f.anchor);
    title = 'Edited paper title';
    expect(await f.contextProviders[0]!('Question')).toEqual({ status: 'blocked', reason: 'context-failed' });
    expect(f.adapter.state()).toMatchObject({ status: 'blocked', contextStatus: 'selection-changed' });
    f.adapter.dispose();
  });

  it('lets the main-window context icon turn automatic paper details off and back on without a new surface', async () => {
    let enabled = false;
    const f = fixture([article()], () => enabled);
    expect(f.adapter.show(f.anchor).contextStatus).toBe('context-disabled');
    const provider = f.contextProviders[0]!;
    expect(await provider('Question without context')).toEqual({ status: 'allow' });
    enabled = true;
    expect((await provider('Question with context')).status).toBe('ready');
    expect(f.createSurface).toHaveBeenCalledOnce();
    f.adapter.dispose();
  });

  it('automatically rebinds an idle official Chat surface to a newly selected article', async () => {
    const selected = [article()]; const f = fixture(selected);
    f.adapter.show(f.anchor);
    expect(f.surface.evictable()).toBe(false);
    selected[0] = article({ id: 42, key: 'ABCDEF13', getField: name => name === 'title' ? 'Next paper' : '' });
    expect(f.adapter.show(f.anchor)).toMatchObject({ status: 'ready', title: 'Next paper', binding: 'zotero-item:1:ABCDEF13' });
    expect(f.createSurface).toHaveBeenCalledOnce();
    expect(f.hideSurface).toHaveBeenCalledOnce();
    expect((await f.contextProviders[1]!('Question')).status).toBe('ready');
    expect(f.bindConversation).toHaveBeenLastCalledWith('zotero-item:1:ABCDEF13', 'https://chatgpt.com/c/other', expect.any(Function));
    f.adapter.dispose();
  });

  it('keeps the old binding visible when its official Chat surface has a draft', () => {
    const selected = [article()]; const f = fixture(selected);
    f.adapter.show(f.anchor); f.setDraft(true);
    selected[0] = article({ id: 42, key: 'ABCDEF13', getField: name => name === 'title' ? 'Next paper' : '' });
    expect(f.adapter.show(f.anchor)).toMatchObject({ status: 'blocked', contextStatus: 'selection-changed', binding: 'zotero-item:1:ABCDEF12' });
    expect(f.hideSurface).toHaveBeenCalledOnce();
    expect(f.showSurface).toHaveBeenCalledTimes(2);
    expect(f.bindConversation).toHaveBeenCalledOnce();
    f.adapter.dispose();
  });

  it('keeps an unfinished draft bound when the library selection is cleared', () => {
    const selected = [article()]; const f = fixture(selected);
    f.adapter.show(f.anchor); f.setDraft(true); selected.splice(0);
    expect(f.adapter.show(f.anchor)).toMatchObject({ status: 'blocked', contextStatus: 'selection-changed', binding: 'zotero-item:1:ABCDEF12' });
    expect(f.bindConversation).toHaveBeenCalledOnce();
    f.adapter.dispose();
  });
});
