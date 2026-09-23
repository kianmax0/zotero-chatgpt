/** Main-library ChatGPT surface bound to one explicitly selected Zotero bibliographic item.
 *
 * Chat remains the official ChatGPT web application. This adapter only reads Zotero metadata and
 * supplies the compact bibliography block through the existing constrained page bridge; it never
 * opens or reads an attachment, starts Codex, or inspects account/transcript data.
 */
import { paperContext } from '../../../core/src/chat/paper-context.ts';
import { paperIdentityOf, type PaperMetadata } from '../../../core/src/context/bibliography.ts';
import { createChatEmbedSurface, type ChatEmbedSurface, type OfficialChatContextResult } from './embed.ts';

export interface LibraryChatItem {
  id: number;
  key: string;
  libraryID: number;
  parentID?: number | null;
  parentItemID?: number;
  deleted?: boolean;
  itemType?: string;
  isRegularItem(this: void): boolean;
  getField(name: string): string;
  getCreators(): Array<{ firstName?: string; lastName?: string; name?: string; creatorType?: string }>;
}

export interface LibraryOfficialChatState {
  status: 'idle' | 'ready' | 'blocked' | 'error';
  title: string | null;
  binding: string | null;
  message: string;
  contextStatus: 'unbound' | 'bibliography-only' | 'context-disabled' | 'selection-changed';
}

export interface LibraryOfficialChatOptions {
  window: Window;
  /** Must return the main library window's live selected rows (not the active Reader parent item). */
  selectedItems(): LibraryChatItem[];
  /** Test seam; production defaults to Zotero's official ChatGPT browser surface. */
  createSurface?(window: Window): ChatEmbedSurface;
  readConversation?(binding: string): string | null;
  rememberConversation?(binding: string, url: string): void;
  automaticContextEnabled?(): boolean;
}

const PUBLICATION_FIELDS = ['publicationTitle', 'journalAbbreviation', 'bookTitle', 'conferenceName', 'proceedingsTitle', 'university', 'institution', 'publisher'] as const;

function field(item: LibraryChatItem, name: string): string {
  try { const value = item.getField(name); return typeof value === 'string' ? value.trim() : ''; }
  catch { return ''; }
}

function metadata(item: LibraryChatItem): PaperMetadata {
  const creators = (() => { try { return item.getCreators(); } catch { return []; } })();
  const authors = creators.filter(creator => !creator.creatorType || creator.creatorType === 'author')
    .map(creator => [creator.firstName, creator.lastName].filter(Boolean).join(' ').trim() || creator.name?.trim() || '')
    .filter(Boolean);
  const result: PaperMetadata = { title: field(item, 'title'), authors };
  const itemType = typeof item.itemType === 'string' ? item.itemType.trim() : '';
  if (itemType) result.itemType = itemType;
  for (const key of PUBLICATION_FIELDS) { const value = field(item, key); if (value) result[key] = value; }
  const year = /(?:1[5-9]|2[0-9])\d{2}/u.exec(field(item, 'date'))?.[0];
  if (year) result.year = year;
  const doi = field(item, 'DOI'); if (doi) result.doi = doi;
  const abstractNote = field(item, 'abstractNote'); if (abstractNote) result.abstractNote = abstractNote;
  return result;
}

function bindingOf(item: LibraryChatItem): string { return `zotero-item:${item.libraryID}:${item.key}`; }

function validSelection(items: LibraryChatItem[]): LibraryChatItem | null {
  if (!Array.isArray(items) || items.length !== 1) return null;
  const item = items[0];
  if (!item || item.deleted || !item.isRegularItem() || item.parentID || item.parentItemID
    || !Number.isSafeInteger(item.id) || !Number.isSafeInteger(item.libraryID) || item.libraryID < 1
    || !/^[A-Z0-9]{8}$/u.test(item.key) || !field(item, 'title')) return null;
  return item;
}

function blocked(reason: 'context-disabled' | 'context-empty' | 'context-failed'): OfficialChatContextResult {
  return { status: 'blocked', reason };
}

/** Binds the real ChatGPT web surface to the current single selected Zotero item. */
export function createLibraryOfficialChat(options: LibraryOfficialChatOptions) {
  const createSurface = options.createSurface
    ? (window: Window) => options.createSurface!(window)
    : (window: Window) => createChatEmbedSurface(window);
  let surface: ChatEmbedSurface | null = null;
  let frozen: { binding: string; id: number; libraryID: number; key: string; title: string; context: string } | null = null;
  let state: LibraryOfficialChatState = { status: 'idle', title: null, binding: null, message: '', contextStatus: 'unbound' };
  let disposed = false;

  const currentSelectionMatches = (): boolean => {
    if (!frozen) return false;
    try {
      const current = validSelection(options.selectedItems());
      if (!current || current.id !== frozen.id || current.libraryID !== frozen.libraryID || current.key !== frozen.key) return false;
      const currentIdentity = paperIdentityOf(metadata(current), field(current, 'title'));
      return (paperContext(currentIdentity)?.text ?? `Title: ${currentIdentity.title}`) === frozen.context && currentIdentity.title === frozen.title;
    } catch { return false; }
  };

  const blockChangedSelection = () => {
    state = { ...state, status: 'blocked', contextStatus: 'selection-changed', message: 'The selected article or its saved metadata changed. Reopen Chat to bind the updated article.' };
  };

  const show = (anchor: Element): LibraryOfficialChatState => {
    if (disposed) return state = { status: 'error', title: null, binding: null, message: 'This Chat surface has been closed.', contextStatus: 'unbound' };
    let selected: LibraryChatItem | null = null;
    try { selected = validSelection(options.selectedItems()); }
    catch { /* Report the same actionable state as an absent or ambiguous Zotero selection. */ }
    if (!selected) {
      if (surface && frozen) {
        surface.hide();
        if (!surface.evictable()) { surface.show(anchor, null); blockChangedSelection(); return state; }
      }
      surface?.hide(); frozen = null;
      return state = {
        status: 'blocked', title: null, binding: null,
        message: 'Select exactly one regular Zotero article before opening Chat.', contextStatus: 'unbound',
      };
    }

    const identity = paperIdentityOf(metadata(selected), field(selected, 'title'));
    const formatted = paperContext(identity);
    const binding = bindingOf(selected);
    const nextContext = formatted?.text ?? `Title: ${identity.title}`;
    if (surface && frozen && (binding !== frozen.binding || nextContext !== frozen.context)) {
      // A visible Chat surface is never evictable by design. Park it first, then ask the
      // actor-backed idle check whether its draft and request state permit rebinding.
      surface.hide();
      if (!surface.evictable()) {
        surface.show(anchor, null);
        blockChangedSelection();
        return state;
      }
    }
    // Keep the selected item identity and bibliography captured at bind time. Every later official
    // send rechecks the selection, but never substitutes metadata from a newly selected row.
    frozen = {
      binding, id: selected.id, libraryID: selected.libraryID, key: selected.key,
      title: identity.title, context: nextContext,
    };
    if (!surface) surface = createSurface(options.window);
    surface.bindContext(binding, (): Promise<OfficialChatContextResult> => {
      if (options.automaticContextEnabled?.() === false) return Promise.resolve({ status: 'allow' });
      if (!currentSelectionMatches()) { blockChangedSelection(); return Promise.resolve(blocked('context-failed')); }
      if (!frozen?.context) return Promise.resolve(blocked('context-empty'));
      return Promise.resolve({ status: 'ready', paperContext: frozen.context, selection: null, coverage: { kind: 'bibliography' } });
    });
    const savedURL = options.readConversation?.(binding) ?? null;
    surface.bindConversation(binding, savedURL, url => options.rememberConversation?.(binding, url));
    surface.show(anchor, null);
    state = {
      status: 'ready', title: identity.title, binding,
      message: options.automaticContextEnabled?.() === false
        ? 'ChatGPT is bound to the selected article; automatic paper context is off.'
        : 'ChatGPT is bound to this selected Zotero article. Only saved bibliographic metadata and abstract are included; no PDF text is read.',
      contextStatus: options.automaticContextEnabled?.() === false ? 'context-disabled' : 'bibliography-only',
    };
    return state;
  };

  const hide = () => { surface?.hide(); };
  const dispose = () => { if (disposed) return; disposed = true; surface?.destroy(); surface = null; frozen = null; };
  const getState = (): LibraryOfficialChatState => state;

  return { show, hide, dispose, state: getState };
}
