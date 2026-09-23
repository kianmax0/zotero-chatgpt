import { ReaderError } from '../../../contracts/src/index.ts';

const MAX_MENTIONS = 30;
const MAX_SELECTED = 32;
const MAX_SEARCH_LENGTH = 200;
const NATIVE_KEY = /^[A-Z0-9]{8}$/u;

export type LibraryMentionKind = 'library' | 'collection' | 'article';
export interface LibraryMentionOption { id: string; kind: LibraryMentionKind; label: string; detail?: string }
export interface LibraryMentionMetadata {
  title: string;
  authors: string[];
  year?: string;
  DOI?: string;
  publicationTitle?: string;
  abstractNote?: string;
}
/** Safe to send to the model: this shape has no Zotero key, numeric item ID, or library ID. */
export interface LibraryMentionModelContext {
  id: string;
  kind: LibraryMentionKind;
  label: string;
  metadata?: LibraryMentionMetadata;
}
/** Local-only native identity for tasks. Never include this object in model input.
 * Callers must reject a write whose native targets span more than one library. */
export interface LibraryMentionNativeTarget {
  id: string;
  clientId: string;
  kind: LibraryMentionKind;
  libraryId: number;
  editable: boolean;
  collectionKey?: string;
  itemKey?: string;
}
export interface ResolvedLibraryMentions {
  modelContext: LibraryMentionModelContext[];
  nativeTargets: LibraryMentionNativeTarget[];
}
export interface LibraryMentionItemNativeRef {
  id: string;
  clientId: string;
  libraryId: number;
  itemKey: string;
  dateModified: string;
  metadataSignature: string;
  editable: boolean;
}
export interface LibraryMentionItemModelSummary {
  id: string;
  kind: 'article';
  label: string;
  metadata: LibraryMentionMetadata;
}
/** Item contents are capped explicitly; `overLimit` prevents the caller treating a prefix as complete. */
export interface LibraryMentionItemSnapshot {
  mention: { id: string; kind: 'collection' | 'library'; label: string };
  target: LibraryMentionNativeTarget;
  max: number;
  totalItems: number;
  overLimit: boolean;
  modelContext: { mention: { kind: 'collection' | 'library'; label: string }; items: LibraryMentionItemModelSummary[] };
  nativeTargets: LibraryMentionItemNativeRef[];
}
export interface LibraryMentionResolver {
  search(query: string, clientId: string, libraryScope?: number): Promise<LibraryMentionOption[]>;
  resolve(selectedMentionIds: readonly string[]): Promise<ResolvedLibraryMentions>;
  snapshotCollectionItems(opaqueMentionId: string, max?: number): Promise<LibraryMentionItemSnapshot>;
  /** A library snapshot always requires a query and explicit maximum; no whole-library enumeration. */
  snapshotLibraryItems(opaqueMentionId: string, scope: { query: string; max: number }): Promise<LibraryMentionItemSnapshot>;
}

interface MentionLibrary {
  libraryID: number;
  name: string;
  editable: boolean;
  libraryType?: string;
  waitForDataLoad?(type: 'collection'): Promise<void>;
}
interface MentionCollection {
  id: number;
  key: string;
  libraryID: number;
  name: string;
  parentKey?: string | null | false;
  deleted?: boolean;
  isEditable(): boolean;
}
interface MentionItem {
  id: number; key: string; libraryID: number; dateModified: string; deleted?: boolean;
  isRegularItem(): boolean; isEditable(operation?: 'edit' | 'erase'): boolean;
  getField(field: string): string;
  getCreators(): Array<{ firstName?: string; lastName?: string; name?: string; creatorType?: string }>;
  getCollections(): number[];
  loadPrimaryData?(): Promise<void>;
  loadDataType?(type: 'itemData' | 'creators'): Promise<void>;
}
interface MentionHost {
  Libraries: { getAll(): MentionLibrary[]; get(id: number): MentionLibrary | undefined };
  Collections: {
    getByLibrary(libraryID: number, recursive: boolean, includeTrashed: boolean): MentionCollection[];
    getByLibraryAndKey(libraryID: number, key: string): MentionCollection | false | undefined;
  };
  Items: {
    get(id: number): MentionItem | false | undefined;
    getAsync(id: number): Promise<MentionItem | false | undefined>;
    getByLibraryAndKey(libraryID: number, key: string): MentionItem | false | undefined;
  };
  Search: new () => { libraryID?: number; addCondition(condition: string, operator: string, value?: string): void; search(): Promise<number[]> };
}

type MentionSnapshot =
  | { kind: 'library'; id: string; clientId: string; libraryId: number; label: string; name: string }
  | { kind: 'collection'; id: string; clientId: string; libraryId: number; collectionKey: string; label: string; name: string; parentKey: string | null | false }
  | { kind: 'article'; id: string; clientId: string; libraryId: number; itemId: number; itemKey: string; label: string; detail?: string; dateModified: string; metadata: LibraryMentionMetadata; metadataSignature: string };

function invalid(message: string): never { throw new ReaderError('INVALID_REQUEST', message); }
function notFound(): never { throw new ReaderError('NOT_FOUND', 'The selected Zotero mention is no longer available. Search again before sending.'); }
function changed(): never { throw new ReaderError('REQUEST_CONFLICT', 'The selected Zotero mention changed after it was chosen. Search again before sending.'); }
function cleanText(value: unknown, limit: number): string {
  if (typeof value !== 'string') return '';
  return value.normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, '').trim().slice(0, limit);
}
function safeReadField(item: MentionItem, field: string, limit: number): string {
  try { return cleanText(item.getField(field), limit); } catch { return ''; }
}
function yearOf(date: string): string | undefined {
  const year = /(?:1[5-9]|2[0-9])\d{2}/u.exec(date)?.[0]; return year;
}
async function metadataOf(item: MentionItem): Promise<LibraryMentionMetadata> {
  await item.loadPrimaryData?.(); await item.loadDataType?.('itemData'); await item.loadDataType?.('creators');
  const creators = item.getCreators().filter(creator => !creator.creatorType || creator.creatorType === 'author').slice(0, 8);
  const authors = creators.map(creator => cleanText([creator.firstName, creator.lastName].filter(Boolean).join(' ') || creator.name || '', 200)).filter(Boolean);
  const title = safeReadField(item, 'title', 500);
  const metadata: LibraryMentionMetadata = { title: title || 'Untitled Zotero item', authors };
  const year = yearOf(safeReadField(item, 'date', 128)); if (year) metadata.year = year;
  const DOI = safeReadField(item, 'DOI', 256); if (DOI) metadata.DOI = DOI;
  const publicationTitle = safeReadField(item, 'publicationTitle', 256); if (publicationTitle) metadata.publicationTitle = publicationTitle;
  const abstractNote = safeReadField(item, 'abstractNote', 3000); if (abstractNote) metadata.abstractNote = abstractNote;
  return metadata;
}
function detailFor(metadata: LibraryMentionMetadata, libraryName: string): string {
  return [metadata.authors.join(', '), metadata.year, libraryName].filter(Boolean).join(' · ');
}
function editable(read: () => boolean): boolean { try { return read(); } catch { return false; } }

/**
 * Read-only Zotero mentions for the main-window Agent. Opaque IDs map to native identities only in
 * this adapter instance. Model-safe context and local native targets are deliberately separate.
 */
export function createLibraryMentionResolver(
  zotero: unknown,
  options: { uuid?: () => string } = {},
): LibraryMentionResolver {
  const z = zotero as MentionHost;
  const uuid = options.uuid ?? (() => crypto.randomUUID());
  const byId = new Map<string, MentionSnapshot>();
  const idByNativeIdentity = new Map<string, string>();
  const idFor = (identity: string, build: (id: string) => MentionSnapshot): string => {
    const existing = idByNativeIdentity.get(identity);
    if (existing) return existing;
    const id = uuid(); idByNativeIdentity.set(identity, id); byId.set(id, build(id)); return id;
  };
  const mentionLibraries = (scope?: number): MentionLibrary[] => {
    const libraries = z.Libraries.getAll().filter(library => library.libraryType !== 'feed'
      && Number.isSafeInteger(library.libraryID) && library.libraryID > 0 && (!scope || library.libraryID === scope));
    return libraries.slice(0, 100);
  };
  const collectionPath = (library: MentionLibrary, collection: MentionCollection, all: readonly MentionCollection[]): string => {
    const byKey = new Map(all.map(row => [row.key, row]));
    const names = [cleanText(collection.name, 256) || 'Untitled collection']; const seen = new Set([collection.key]); let parentKey = collection.parentKey;
    while (typeof parentKey === 'string' && parentKey && !seen.has(parentKey) && seen.size < 64) {
      seen.add(parentKey); const parent = byKey.get(parentKey); if (!parent || parent.deleted) break;
      names.unshift(cleanText(parent.name, 256) || 'Untitled collection'); parentKey = parent.parentKey;
    }
    return [cleanText(library.name, 256) || `Library ${library.libraryID}`, ...names].join(' / ').slice(0, 1000);
  };
  const optionForLibrary = (library: MentionLibrary, clientId: string): LibraryMentionOption => {
    const name = cleanText(library.name, 256) || `Library ${library.libraryID}`;
    const identity = `library\u0000${clientId}\u0000${library.libraryID}`;
    const id = idFor(identity, value => ({ kind: 'library', id: value, clientId, libraryId: library.libraryID, label: name, name }));
    return { id, kind: 'library', label: name, detail: 'Zotero library' };
  };
  const optionForCollection = (library: MentionLibrary, collection: MentionCollection, all: readonly MentionCollection[], clientId: string): LibraryMentionOption => {
    const label = collectionPath(library, collection, all);
    const name = cleanText(collection.name, 256) || 'Untitled collection';
    const identity = `collection\u0000${clientId}\u0000${library.libraryID}\u0000${collection.key}`;
    const id = idFor(identity, value => ({ kind: 'collection', id: value, clientId, libraryId: library.libraryID, collectionKey: collection.key, label, name, parentKey: collection.parentKey ?? null }));
    return { id, kind: 'collection', label, detail: 'Zotero collection' };
  };
  const optionForItem = (item: MentionItem, libraryName: string, clientId: string, metadata: LibraryMentionMetadata): LibraryMentionOption => {
    const detail = detailFor(metadata, libraryName);
    const identity = `article\u0000${clientId}\u0000${item.libraryID}\u0000${item.key}`;
    const signature = JSON.stringify(metadata);
    const id = idFor(identity, value => ({ kind: 'article', id: value, clientId, libraryId: item.libraryID, itemId: item.id, itemKey: item.key, label: metadata.title, detail, dateModified: item.dateModified, metadata, metadataSignature: signature }));
    return { id, kind: 'article', label: metadata.title, ...(detail ? { detail } : {}) };
  };

  const checkedLimit = (max: number): number => {
    if (!Number.isSafeInteger(max) || max < 1 || max > 50) invalid('Choose between 1 and 50 Zotero items.');
    return max;
  };
  const snapshotItems = async (
    snapshot: Extract<MentionSnapshot, { kind: 'library' | 'collection' }>,
    max: number,
    itemIDs: number[],
    collectionId?: number,
  ): Promise<LibraryMentionItemSnapshot> => {
    const liveLibrary = z.Libraries.get(snapshot.libraryId);
    const listedLibrary = z.Libraries.getAll().find(library => library.libraryID === snapshot.libraryId && library.libraryType !== 'feed');
    if (!liveLibrary || !listedLibrary) notFound();
    let target: LibraryMentionNativeTarget;
    if (snapshot.kind === 'library') {
      if ((cleanText(listedLibrary.name, 256) || `Library ${listedLibrary.libraryID}`) !== snapshot.name) changed();
      target = { id: snapshot.id, clientId: snapshot.clientId, kind: snapshot.kind, libraryId: snapshot.libraryId, editable: liveLibrary.editable === true };
    } else {
      const collection = z.Collections.getByLibraryAndKey(snapshot.libraryId, snapshot.collectionKey);
      if (!collection || collection.deleted || collection.libraryID !== snapshot.libraryId || collection.key !== snapshot.collectionKey) notFound();
      if ((cleanText(collection.name, 256) || 'Untitled collection') !== snapshot.name || (collection.parentKey ?? null) !== snapshot.parentKey) changed();
      target = { id: snapshot.id, clientId: snapshot.clientId, kind: snapshot.kind, libraryId: snapshot.libraryId, collectionKey: snapshot.collectionKey, editable: liveLibrary.editable === true && editable(() => collection.isEditable()) };
    }
    const uniqueIDs = [...new Set(itemIDs)];
    const modelItems: LibraryMentionItemModelSummary[] = [];
    const nativeItems: LibraryMentionItemNativeRef[] = [];
    let totalItems = 0;
    for (const itemId of uniqueIDs) {
      const item = await z.Items.getAsync(itemId);
      if (!item || item.deleted || !item.isRegularItem() || item.libraryID !== snapshot.libraryId || !NATIVE_KEY.test(item.key)) continue;
      if (collectionId !== undefined && !item.getCollections().includes(collectionId)) continue;
      totalItems++;
      if (nativeItems.length >= max) continue;
      const metadata = await metadataOf(item);
      const dateModified = item.dateModified;
      const fresh = z.Items.getByLibraryAndKey(snapshot.libraryId, item.key);
      if (!fresh || fresh.deleted || fresh.id !== item.id || fresh.key !== item.key || fresh.libraryID !== snapshot.libraryId || !fresh.isRegularItem()) changed();
      if (fresh.dateModified !== dateModified || (collectionId !== undefined && !fresh.getCollections().includes(collectionId))) changed();
      if (JSON.stringify(await metadataOf(fresh)) !== JSON.stringify(metadata)) changed();
      const id = uuid();
      const label = [metadata.title, metadata.authors[0], metadata.year].filter(Boolean).join(' · ');
      const metadataSignature = JSON.stringify(metadata);
      modelItems.push({ id, kind: 'article', label, metadata });
      nativeItems.push({
        id, clientId: snapshot.clientId, libraryId: snapshot.libraryId, itemKey: item.key,
        dateModified, metadataSignature,
        editable: editable(() => liveLibrary.editable === true && item.isEditable('edit')),
      });
    }
    return {
      mention: { id: snapshot.id, kind: snapshot.kind, label: snapshot.label },
      target,
      max,
      totalItems,
      overLimit: totalItems > max,
      modelContext: { mention: { kind: snapshot.kind, label: snapshot.label }, items: modelItems },
      nativeTargets: nativeItems,
    };
  };

  return {
    search: async (queryValue, clientId, libraryScope) => {
      if (typeof queryValue !== 'string') invalid('Use a valid Zotero search and library.');
      const query = cleanText(queryValue, MAX_SEARCH_LENGTH);
      if (queryValue.length > MAX_SEARCH_LENGTH || queryValue.includes('\0') || !clientId || clientId.length > 128
        || (libraryScope !== undefined && (!Number.isSafeInteger(libraryScope) || libraryScope < 1))) invalid('Use a valid Zotero search and library.');
      const needle = query.toLocaleLowerCase(); const results: LibraryMentionOption[] = [];
      const libraries = mentionLibraries(libraryScope);
      for (const library of libraries) {
        const libraryLabel = cleanText(library.name, 256) || `Library ${library.libraryID}`;
        if (!needle || libraryLabel.toLocaleLowerCase().includes(needle)) results.push(optionForLibrary(library, clientId));
        let collections: MentionCollection[] = [];
        try {
          await library.waitForDataLoad?.('collection');
          collections = z.Collections.getByLibrary(library.libraryID, true, false)
            .filter(collection => !collection.deleted && collection.libraryID === library.libraryID && NATIVE_KEY.test(collection.key));
        } catch { /* A collection listing failure does not hide readable item matches or other libraries. */ }
        for (const collection of collections) {
          const label = collectionPath(library, collection, collections);
          if (!needle || label.toLocaleLowerCase().includes(needle)) results.push(optionForCollection(library, collection, collections, clientId));
          if (results.length >= MAX_MENTIONS) return results.slice(0, MAX_MENTIONS);
        }
      }
      if (!needle) return results.slice(0, MAX_MENTIONS);

      let searched = false; let searchFailure: unknown;
      const seenItems = new Set<string>();
      for (const library of libraries) {
        if (results.length >= MAX_MENTIONS) break;
        let ids: number[];
        try {
          const search = new z.Search(); search.libraryID = library.libraryID;
          search.addCondition('quicksearch-titleCreatorYear', 'contains', query);
          ids = await search.search(); searched = true;
        } catch (error) { searchFailure ??= error; continue; }
        for (const id of ids.slice(0, 100)) {
          const item = await z.Items.getAsync(id);
          if (!item || item.deleted || !item.isRegularItem() || item.libraryID !== library.libraryID || !NATIVE_KEY.test(item.key)) continue;
          const nativeIdentity = `${item.libraryID}:${item.key}`;
          if (seenItems.has(nativeIdentity)) continue;
          const metadata = await metadataOf(item); if (!metadata.title || !`${metadata.title} ${metadata.authors.join(' ')} ${metadata.year ?? ''}`.toLocaleLowerCase().includes(needle)) continue;
          seenItems.add(nativeIdentity);
          results.push(optionForItem(item, library.name || `Library ${library.libraryID}`, clientId, metadata));
          if (results.length >= MAX_MENTIONS) break;
        }
      }
      if (!searched && searchFailure) throw new ReaderError('INVALID_REQUEST', 'Zotero items could not be searched.');
      const articleRows = results.filter(row => row.kind === 'article');
      const duplicateLabels = new Map<string, number>();
      for (const row of articleRows) duplicateLabels.set(row.label, (duplicateLabels.get(row.label) ?? 0) + 1);
      const uniqueLabels = new Set<string>();
      for (const row of results) {
        if (row.kind !== 'article' || (duplicateLabels.get(row.label) ?? 0) < 2) { uniqueLabels.add(row.label); continue; }
        const snapshot = byId.get(row.id); if (!snapshot || snapshot.kind !== 'article') continue;
        const base = [snapshot.label, snapshot.detail].filter(Boolean).join(' · '); let label = base; let suffix = 2;
        while (uniqueLabels.has(label)) label = `${base} · ${suffix++}`;
        row.label = label; snapshot.label = label; uniqueLabels.add(label);
      }
      return results.slice(0, MAX_MENTIONS);
    },
    resolve: async selectedMentionIds => {
      if (!Array.isArray(selectedMentionIds) || selectedMentionIds.length > MAX_SELECTED) invalid('Choose at most 32 distinct Zotero mentions.');
      const ids: unknown[] = selectedMentionIds;
      if (!ids.every((id): id is string => typeof id === 'string') || new Set(ids).size !== ids.length) invalid('Choose at most 32 distinct Zotero mentions.');
      const snapshots = ids.map(id => byId.get(id) ?? notFound());
      const modelContext: LibraryMentionModelContext[] = [];
      const nativeTargets: LibraryMentionNativeTarget[] = [];
      for (const snapshot of snapshots) {
        const listedLibrary = z.Libraries.getAll().find(library => library.libraryID === snapshot.libraryId && library.libraryType !== 'feed');
        const liveLibrary = z.Libraries.get(snapshot.libraryId);
        if (!listedLibrary || !liveLibrary || (liveLibrary.libraryType === 'feed')) notFound();
        let canEditLibrary = editable(() => liveLibrary.editable === true);
        let metadata: LibraryMentionMetadata | undefined;
        let target: LibraryMentionNativeTarget;
        if (snapshot.kind === 'library') {
          if ((cleanText(listedLibrary.name, 256) || `Library ${listedLibrary.libraryID}`) !== snapshot.name) changed();
          target = { id: snapshot.id, clientId: snapshot.clientId, kind: snapshot.kind, libraryId: snapshot.libraryId, editable: canEditLibrary };
          modelContext.push({ id: snapshot.id, kind: snapshot.kind, label: snapshot.label });
        } else if (snapshot.kind === 'collection') {
          const collection = z.Collections.getByLibraryAndKey(snapshot.libraryId, snapshot.collectionKey);
          if (!collection || collection.deleted || collection.libraryID !== snapshot.libraryId || collection.key !== snapshot.collectionKey) notFound();
          if ((cleanText(collection.name, 256) || 'Untitled collection') !== snapshot.name || (collection.parentKey ?? null) !== snapshot.parentKey) changed();
          const canEditCollection = editable(() => collection.isEditable());
          target = { id: snapshot.id, clientId: snapshot.clientId, kind: snapshot.kind, libraryId: snapshot.libraryId, collectionKey: snapshot.collectionKey, editable: canEditLibrary && canEditCollection };
          modelContext.push({ id: snapshot.id, kind: snapshot.kind, label: snapshot.label });
        } else {
          const item = z.Items.getByLibraryAndKey(snapshot.libraryId, snapshot.itemKey);
          if (!item || item.deleted || item.libraryID !== snapshot.libraryId || item.key !== snapshot.itemKey || item.id !== snapshot.itemId || !item.isRegularItem()) notFound();
          metadata = await metadataOf(item);
          if (item.dateModified !== snapshot.dateModified || JSON.stringify(metadata) !== snapshot.metadataSignature) changed();
          const canEditItem = editable(() => item.isEditable('edit'));
          canEditLibrary = canEditLibrary && canEditItem;
          target = { id: snapshot.id, clientId: snapshot.clientId, kind: snapshot.kind, libraryId: snapshot.libraryId, itemKey: snapshot.itemKey, editable: canEditLibrary };
          modelContext.push({ id: snapshot.id, kind: snapshot.kind, label: snapshot.label, metadata });
        }
        nativeTargets.push(target);
      }
      return { modelContext, nativeTargets };
    },
    snapshotCollectionItems: async (opaqueMentionId, max = 50) => {
      const snapshot = byId.get(opaqueMentionId);
      if (!snapshot || snapshot.kind !== 'collection') notFound();
      const limit = checkedLimit(max);
      const collection = z.Collections.getByLibraryAndKey(snapshot.libraryId, snapshot.collectionKey);
      if (!collection || collection.deleted || collection.libraryID !== snapshot.libraryId || collection.key !== snapshot.collectionKey) notFound();
      if ((cleanText(collection.name, 256) || 'Untitled collection') !== snapshot.name || (collection.parentKey ?? null) !== snapshot.parentKey) changed();
      if (!Number.isSafeInteger(collection.id) || collection.id < 1) notFound();
      let ids: number[];
      try {
        const search = new z.Search(); search.libraryID = snapshot.libraryId;
        search.addCondition('collection', 'is', String(collection.id));
        ids = await search.search();
      } catch { throw new ReaderError('INVALID_REQUEST', 'The selected Zotero collection could not be read.'); }
      try { return await snapshotItems(snapshot, limit, ids, collection.id); }
      catch (error) { if (error instanceof ReaderError) throw error; throw new ReaderError('INVALID_REQUEST', 'The selected Zotero collection changed while it was being read. Search again before sending.'); }
    },
    snapshotLibraryItems: async (opaqueMentionId, scope) => {
      const snapshot = byId.get(opaqueMentionId);
      if (!snapshot || snapshot.kind !== 'library') notFound();
      if (!scope || typeof scope !== 'object' || typeof scope.query !== 'string') invalid('Choose a specific Zotero search before reading a library.');
      const query = cleanText(scope.query, MAX_SEARCH_LENGTH);
      if (!query || scope.query.length > MAX_SEARCH_LENGTH || scope.query.includes('\0')) invalid('Choose a nonempty bounded Zotero search before reading a library.');
      const limit = checkedLimit(scope.max);
      let ids: number[];
      try {
        const search = new z.Search(); search.libraryID = snapshot.libraryId;
        search.addCondition('quicksearch-titleCreatorYear', 'contains', query);
        ids = await search.search();
      } catch { throw new ReaderError('INVALID_REQUEST', 'The bounded Zotero library search could not be read.'); }
      try { return await snapshotItems(snapshot, limit, ids); }
      catch (error) { if (error instanceof ReaderError) throw error; throw new ReaderError('INVALID_REQUEST', 'The selected Zotero library changed while it was being read. Search again before sending.'); }
    },
  };
}
