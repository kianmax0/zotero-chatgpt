import { ReaderError, paperId, type DocumentContext, type DocumentRevision, type ImageAttachment, type PaperIdentity, type PaperScope, type Rect } from '../../../contracts/src/index.ts';
import { clone } from '../../../contracts/src/clone.ts';
import type { NativeCollectionTarget } from '../../../contracts/src/native.ts';
import type { FigureRegionSelection, LibraryReferencePort, ReaderReference } from '../../../contracts/src/workspace.ts';
import { paperIdentityOf, type PaperMetadata } from '../../../core/src/context/bibliography.ts';
import { nativeDocumentSource, type DocumentSource, type ReaderDocumentCache } from '../reader/document.ts';
import type { HostReader, ZoteroHost } from '../reader/host-types.ts';
import type { NativeZoteroHost } from '../host/native.ts';
import { createNativeSupport } from './native-support.ts';
import { createNativeReaderPort } from './native-read.ts';
import { captureSelectedLibraryItems, type SelectedLibraryWindow } from './selection.ts';
import { boundary, createNativeFiles, fail, type NativeFileOptions } from './native-files.ts';

export interface LibraryItem {
  id: number; key: string; libraryID: number; parentID?: number | null; parentItemID?: number; deleted?: boolean;
  /** Zotero exposes the item type as a property, not a `getField` field (`item.js:143-145`). */
  itemType?: string;
  getField(name: string): string;
  getCreators(): Array<{ firstName?: string; lastName?: string; name?: string; creatorType?: string }>;
  getTags?(): Array<{ tag: string }>;
  isRegularItem(): boolean; isPDFAttachment(): boolean; getAttachments(): number[];
  loadDataType?(type: 'itemData' | 'creators' | 'childItems'): Promise<void>;
  getFilePathAsync?: () => Promise<string | false>;
}
/**
 * The single-line bibliographic fields `paperMetadata` reads from a reader (`reader/selection.ts`).
 * Kept identical here so an `@`-reference candidate and the sidebar cannot drift.
 */
const METADATA_FIELDS = ['publicationTitle', 'journalAbbreviation', 'bookTitle', 'conferenceName', 'proceedingsTitle', 'university', 'institution', 'volume', 'issue', 'pages', 'publisher', 'language'] as const;
/** `getField` can throw on an unloaded item or a field the item type does not declare; that is absent. */
function readField(item: LibraryItem, name: string): string {
  try { const value = item.getField(name); return typeof value === 'string' ? value.trim() : ''; } catch { return ''; }
}
export interface LibraryTabs {
  selectedID: string;
  getTabInfo(id: string): { id?: string; data?: { itemID?: number } };
  add?(options: { id: string; type: 'reader'; title: string; data: { itemID: number }; select: false }): { id: string };
  close?(id: string): void;
}
export interface LibraryWindow extends SelectedLibraryWindow { Zotero_Tabs?: LibraryTabs }
export interface LibraryReader extends Pick<HostReader, 'itemID' | 'tabID' | '_internalReader'> {
  _window?: LibraryWindow; _initPromise?: Promise<void>; close?(): void;
}
export interface NativeLibraryHost {
  Items: { get(id: number): LibraryItem | false | undefined; getAsync(id: number): Promise<LibraryItem | false | undefined>; getByLibraryAndKey(libraryID: number, key: string): LibraryItem | false | undefined };
  Search: new () => { libraryID?: number; addCondition(condition: string, operator: string, value?: string): void; search(): Promise<number[]> };
  Reader: { _readers: LibraryReader[]; open: (itemID: number, location?: unknown, options?: { tabID?: string; openInBackground?: boolean; allowDuplicate?: boolean }) => Promise<LibraryReader | false | undefined> };
  getMainWindow?(): Window & LibraryWindow;
  Notifier?: { registerObserver(observer: { notify(event: string, type: string, ids: Array<string | number>): void }, types: string[], id: string): string | number; unregisterObserver(id: string | number): void };
  Libraries?: { getAll: () => Array<{ libraryID: number; name: string; editable: boolean; libraryType?: string; waitForDataLoad?(type: 'collection'): Promise<void> }> };
  Collections?: { getByLibrary: (libraryID: number, recursive: boolean, includeTrashed: boolean) => Array<{ key: string; libraryID: number; name: string; parentKey?: string | null | false; deleted?: boolean; isEditable(): boolean }> };
}
export interface LibraryDocumentSource { capture: (signal?: AbortSignal) => Promise<DocumentSource>; validate: (document: DocumentContext) => Promise<void> }
export interface LibraryRasterInput { reader: LibraryReader; paper: PaperScope; revision: DocumentRevision; pageIndex: number; rect?: Rect; scale: number; signal: AbortSignal }
export interface LibraryReferenceOptions extends NativeFileOptions {
  clientId: string; documentCache: Pick<ReaderDocumentCache, 'read'>; now?(): string;
  getWindow?(): (Window & LibraryWindow) | undefined;
  source?(reader: LibraryReader, paper: PaperScope): LibraryDocumentSource;
  watchTabSelection?(selected: (id: string) => void): () => void;
  cloneInto?: (value: object, target: object, options?: { wrapReflectors?: boolean }) => object;
  waiveXrays?: (value: object) => object;
  rasterize?(input: LibraryRasterInput): Promise<Uint8Array>;
}
export interface NativeLibraryReferencePort extends LibraryReferencePort {
  capturePage(paper: PaperScope, pageIndex: number, signal?: AbortSignal): Promise<ImageAttachment>;
  captureRegion(selection: FigureRegionSelection, signal?: AbortSignal): Promise<ImageAttachment>;
  collections(): Promise<Array<NativeCollectionTarget & { name: string }>>;
}

const KEY = /^[A-Z0-9]{8}$/u;
const MAX_RESULTS = 50;
const MAX_RASTER_PIXELS = 8_000_000;
function check(signal: AbortSignal): void { if (signal.aborted) fail('Reference preparation cancelled.'); }
async function waitRead<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  check(signal); let abort = () => {};
  try { return await Promise.race([work, new Promise<never>((_resolve, reject) => { abort = () => reject(new ReaderError('INVALID_REQUEST', 'Reference preparation cancelled.')); signal.addEventListener('abort', abort, { once: true }); })]); }
  finally { signal.removeEventListener('abort', abort); }
}
function sameRevision(a: DocumentRevision, b: DocumentRevision): boolean { return JSON.stringify(a) === JSON.stringify(b); }

/** Metadata lookup and native file/reader inputs. No search path parses attachment bodies. */
export function createLibraryReferencePort(zotero: unknown, options: LibraryReferenceOptions): NativeLibraryReferencePort {
  const z = zotero as NativeLibraryHost;
  const files = createNativeFiles(zotero, options);
  const nativeReader = createNativeReaderPort(createNativeSupport({ clientId: options.clientId, zotero: zotero as NativeZoteroHost }));
  const globals = () => files.globals();
  const now = () => options.now?.() ?? new Date().toISOString();
  const window = () => options.getWindow?.() ?? z.getMainWindow?.();
  const scopeOf = (scope: PaperScope): PaperScope => {
    if (!scope || scope.clientId !== options.clientId) fail('This reference belongs to another reading environment.');
    if (!Number.isSafeInteger(scope.libraryId) || scope.libraryId < 1 || !KEY.test(scope.attachmentKey)) fail('The reference attachment scope is invalid.');
    return { clientId: options.clientId, libraryId: scope.libraryId, attachmentKey: scope.attachmentKey };
  };
  const attachment = (scope: PaperScope): LibraryItem => {
    const item = z.Items.getByLibraryAndKey(scope.libraryId, scope.attachmentKey);
    if (!item || item.deleted || !item.isPDFAttachment() || item.libraryID !== scope.libraryId || item.key !== scope.attachmentKey) fail('The referenced PDF attachment is no longer available.', 'NOT_FOUND');
    return item;
  };
  const sources = new WeakMap<LibraryReader, { scope: string; source: LibraryDocumentSource }>();
  const leases = new WeakMap<LibraryReader, { users: number; release: () => void }>();
  const dropLease = (reader: LibraryReader, lease: { users: number; release: () => void }) => {
    lease.users--; if (lease.users === 0) { leases.delete(reader); lease.release(); }
  };
  const tabInfo = (tabs: LibraryTabs | undefined, id: string) => { try { return tabs?.getTabInfo(id); } catch { return undefined; } };
  const sourceOf = (reader: LibraryReader, scope: PaperScope) => {
    const cached = sources.get(reader); const key = paperId(scope);
    if (cached?.scope === key) return cached.source;
    const source = options.source?.(reader, clone(scope)) ?? nativeDocumentSource(z as unknown as ZoteroHost, () => reader as unknown as HostReader, scope);
    sources.set(reader, { scope: key, source }); return source;
  };
  const watch = (selected: (id: string) => void) => {
    if (options.watchTabSelection) return options.watchTabSelection(selected);
    const notifier = z.Notifier;
    if (!notifier) fail('Safe background reader ownership is unavailable in this Zotero version.', 'UNSUPPORTED_INTERACTION');
    const id = notifier.registerObserver({ notify: (event, type, ids) => { if (event === 'select' && type === 'tab') for (const id of ids) selected(String(id)); } }, ['tab'], 'zchatgpt-reference-reader');
    return () => notifier.unregisterObserver(id);
  };
  const withReader = async <T>(scope: PaperScope, signal: AbortSignal, work: (reader: LibraryReader, source: LibraryDocumentSource) => Promise<T>): Promise<T> => {
    check(signal); const item = attachment(scope);
    const existing = z.Reader._readers.find(reader => reader.itemID === item.id);
    if (existing) {
      const lease = leases.get(existing); if (lease) lease.users++;
      try {
        if (existing._initPromise) await waitRead(existing._initPromise, signal);
        check(signal); return await work(existing, sourceOf(existing, scope));
      } finally { if (lease) dropLease(existing, lease); }
    }
    const tabID = `zchatgpt-reference-${options.uuid()}`;
    const owner = window();
    if (!owner?.Zotero_Tabs?.getTabInfo || typeof owner.Zotero_Tabs.add !== 'function' || typeof owner.Zotero_Tabs.close !== 'function' || tabInfo(owner.Zotero_Tabs, tabID)?.id || z.Reader._readers.some(reader => reader.tabID === tabID)) fail('An isolated background reader could not be reserved.', 'UNSUPPORTED_INTERACTION');
    const ownerTabs = owner.Zotero_Tabs;
    let adopted = false; let released = false; let settled = false; let reserved = false; let reader: LibraryReader | false | undefined;
    let lease: { users: number; release: () => void } | undefined;
    const unwatch = watch(selected => { if (selected === tabID) adopted = true; });
    const release = () => {
      if (released) return; released = true;
      try {
        const tabs = reader ? reader._window?.Zotero_Tabs : undefined;
        const info = tabInfo(tabs, tabID);
        if (reader && reader.tabID === tabID && !adopted && tabs?.selectedID !== tabID && info?.id === tabID && info.data?.itemID === item.id && z.Reader._readers.includes(reader)) reader.close?.();
        else if (reserved && !adopted && ownerTabs.selectedID !== tabID && !z.Reader._readers.some(reader => reader.tabID === tabID)) {
          const placeholder = tabInfo(ownerTabs, tabID);
          if (placeholder?.id === tabID && placeholder.data?.itemID === item.id) ownerTabs.close?.(tabID);
        }
      } finally { unwatch(); }
    };
    // Zotero 9 treats tabID as an existing container. Reserve that native container first.
    // allowDuplicate avoids both loaded- and unloaded-tab reuse branches that select a user tab.
    const opening = Promise.resolve().then(() => {
      check(signal); reserved = true;
      const tab = ownerTabs.add!({ id: tabID, type: 'reader', title: '', data: { itemID: item.id }, select: false });
      if (tab.id !== tabID || tabInfo(ownerTabs, tabID)?.data?.itemID !== item.id) fail('Zotero did not reserve the requested background tab.');
      return z.Reader.open(item.id, undefined, { tabID, allowDuplicate: true, openInBackground: true });
    }).then(value => {
      reader = value; settled = true;
      if (value && value.tabID === tabID) { lease = { users: 1, release }; leases.set(value, lease); }
      return value;
    }, error => { settled = true; throw error; });
    const finish = () => { if (reader && lease) dropLease(reader, lease); else release(); };
    try {
      reader = await waitRead(opening, signal);
      if (!reader || reader.itemID !== item.id || reader.tabID !== tabID || !reader.close) fail('Zotero did not return the requested isolated background reader.');
      if (reader._initPromise) await waitRead(reader._initPromise, signal);
      check(signal); attachment(scope); return await work(reader, sourceOf(reader, scope));
    } finally {
      // Cancellation can beat Reader.open. Keep ownership observation until that native call settles.
      if (settled) finish(); else void opening.then(() => finish(), () => finish());
    }
  };
  const metadata = async (item: LibraryItem, children = false) => {
    await item.loadDataType?.('itemData'); await item.loadDataType?.('creators'); if (children) await item.loadDataType?.('childItems');
  };
  /**
   * The same field list the reader's selection path reads, applied to an `@`-reference candidate.
   * `paperIdentityOf` owns the caps and the "absent stays absent" rule, so a search result and the
   * sidebar describe one paper the same way. `getField` can refuse a field on an item type; a
   * refusal is an absent field, never a guessed value.
   */
  const metadataOf = (item: LibraryItem, fallback: LibraryItem): PaperMetadata => {
    const name = (creator: { firstName?: string; lastName?: string; name?: string }) => [creator.firstName, creator.lastName].filter(Boolean).join(' ') || creator.name || '';
    const creators = item.getCreators() ?? [];
    const result: PaperMetadata = {
      title: readField(item, 'title') || readField(fallback, 'title'),
      authors: creators.filter(creator => !creator.creatorType || creator.creatorType === 'author').map(name).filter(Boolean),
    };
    const itemType = typeof item.itemType === 'string' ? item.itemType.trim() : '';
    if (itemType && itemType !== 'attachment') result.itemType = itemType;
    for (const field of METADATA_FIELDS) { const value = readField(item, field); if (value) result[field] = value; }
    const year = /(?:1[5-9]|2[0-9])\d{2}/u.exec(readField(item, 'date'))?.[0]; if (year) result.year = year;
    const doi = readField(item, 'DOI'); if (doi) result.doi = doi;
    const isbn = readField(item, 'ISBN'); if (isbn) result.isbn = isbn;
    const issn = readField(item, 'ISSN'); if (issn) result.issn = issn;
    const abstractNote = readField(item, 'abstractNote'); if (abstractNote) result.abstractNote = abstractNote;
    const editors = creators.filter(creator => creator.creatorType === 'editor').map(name).filter(Boolean); if (editors.length) result.editors = editors;
    const tags = (item.getTags?.() ?? []).map(entry => entry.tag).filter(Boolean); if (tags.length) result.tags = tags;
    return result;
  };
  const identity = (item: LibraryItem, fallback: LibraryItem): PaperIdentity =>
    paperIdentityOf(metadataOf(item, fallback), readField(item, 'title') || readField(fallback, 'title') || 'PDF attachment');
  /** Every library an @-reference may point at. A feed has no PDF items; the fallback keeps the default search path. */
  const libraries = (): Array<{ libraryID?: number }> => {
    const readable = (z.Libraries?.getAll() ?? []).filter(library => library.libraryType !== 'feed' && Number.isSafeInteger(library.libraryID) && library.libraryID >= 1);
    return readable.length ? readable : [{}];
  };
  /** Same-title items are routinely different papers; author and year keep their candidates distinguishable. */
  const disambiguate = (results: ReaderReference[]): ReaderReference[] => {
    const counts = new Map<string, number>();
    for (const reference of results) counts.set(reference.label, (counts.get(reference.label) ?? 0) + 1);
    for (const reference of results) {
      if ((counts.get(reference.label) ?? 0) < 2) continue;
      const detail = [reference.identity?.authors[0], reference.identity?.year].filter(Boolean).join(' · ');
      if (detail) reference.label = `${reference.label} · ${detail}`;
    }
    return results;
  };
  const capture = (paper: PaperScope, pageIndex: number, rect?: Rect, expected?: DocumentRevision, signal = new AbortController().signal) => {
    const scope = scopeOf(paper); const frozenRect = rect ? [...rect] as Rect : undefined;
    if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) fail('Choose a valid PDF page.');
    return boundary(() => withReader(scope, signal, async (reader, source) => {
      const captured = await waitRead(source.capture(signal), signal); const revision = clone(captured.revision);
      if (pageIndex >= captured.pdf.numPages) fail('The selected PDF page is unavailable.');
      if (expected && !sameRevision(expected, revision)) fail('The PDF changed after this selection was captured. Capture the page again.');
      const input: LibraryRasterInput = { reader, paper: scope, revision, pageIndex, scale: 2, signal, ...(frozenRect ? { rect: frozenRect } : {}) };
      const bytes = await waitRead(options.rasterize ? options.rasterize(input) : rasterizeNative(input, options.cloneInto ?? ((value, target, flags) => globals().Cu?.cloneInto(value, target, flags) ?? fail('Native PDF rendering is unavailable.', 'UNSUPPORTED_INTERACTION')), options.waiveXrays ?? (value => globals().Cu?.waiveXrays?.(value) ?? value)), signal);
      const fresh = await waitRead(source.capture(signal), signal);
      if (!sameRevision(revision, fresh.revision)) fail('The PDF changed while preparing this image. Capture it again.');
      attachment(scope);
      return files.image(bytes, `${scope.attachmentKey} - p.${pageIndex + 1}.png`, { kind: 'paper', paper: scope, pageIndex, revision });
    }), 'The native PDF image could not be rendered. This reader may not support page capture.');
  };
  const captureRegion = (selection: FigureRegionSelection, signal = new AbortController().signal) => {
    if (!selection || !Array.isArray(selection.rect) || selection.rect.length !== 4 || !selection.rect.every(Number.isFinite)) fail('Select a valid rectangle inside one PDF page.');
    const [x1, y1, x2, y2] = selection.rect;
    if (!(x2 > x1 && y2 > y1) || Math.max(Math.abs(x1), Math.abs(y1), Math.abs(x2), Math.abs(y2)) >= 1_000_000) fail('Select a valid rectangle inside one PDF page.');
    if (!selection.revision || typeof selection.revision.fingerprint !== 'string' || !selection.revision.fingerprint || !Number.isSafeInteger(selection.revision.size) || selection.revision.size < 0 || !Number.isFinite(selection.revision.modifiedAt)) fail('Capture a current PDF revision before selecting a figure.');
    return capture(selection.paper, selection.pageIndex, [...selection.rect] as Rect, { ...selection.revision }, signal);
  };
  return {
    ...(options.getWindow ? { selectedItems: () => captureSelectedLibraryItems({ clientId: options.clientId, getWindow: () => options.getWindow!(), reader: nativeReader }) } : {}),
    collections: () => boundary(async () => {
      if (!z.Libraries || !z.Collections) fail('Native collection listing is unavailable.', 'UNSUPPORTED_INTERACTION');
      const targets: Array<NativeCollectionTarget & { name: string }> = [];
      for (const library of z.Libraries.getAll()) {
        if (!library.editable || !Number.isSafeInteger(library.libraryID) || library.libraryID < 1) continue;
        await library.waitForDataLoad?.('collection');
        const collections = z.Collections.getByLibrary(library.libraryID, true, false).filter(collection => !collection.deleted && collection.libraryID === library.libraryID && KEY.test(collection.key));
        const byKey = new Map(collections.map(collection => [collection.key, collection]));
        for (const collection of collections) {
          if (!collection.isEditable()) continue;
          const names = [collection.name]; const visited = new Set([collection.key]); let parentKey = collection.parentKey;
          while (parentKey && !visited.has(parentKey) && visited.size < 64) {
            visited.add(parentKey); const parent = byKey.get(parentKey); if (!parent) break;
            names.unshift(parent.name); parentKey = parent.parentKey;
          }
          targets.push({ clientId: options.clientId, libraryId: library.libraryID, collectionKey: collection.key, name: [library.name || `Library ${library.libraryID}`, ...names].join(' / ') });
        }
      }
      return targets;
    }, 'Editable Zotero collections could not be listed.'),
    search: query => boundary(async () => {
      const text = query.trim(); if (!text) return [];
      if (text.length > 512 || text.includes('\0')) fail('Use a shorter article search.');
      const results: ReaderReference[] = []; const seen = new Set<string>();
      let searched = false; let failure: Error | undefined;
      // A bare `Zotero.Search` defaults to the user library, so group libraries would never surface
      // an @-reference. Search every readable library explicitly; a referencable PDF is read-only.
      for (const library of libraries()) {
        if (results.length >= MAX_RESULTS) break;
        let ids: number[];
        try {
          const search = new z.Search();
          if (library.libraryID !== undefined) search.libraryID = library.libraryID;
          search.addCondition('quicksearch-titleCreatorYear', 'contains', text);
          ids = await search.search(); searched = true;
        } catch (error) { failure ??= error instanceof Error ? error : new Error('Article metadata could not be searched.'); continue; }
        for (const id of ids.slice(0, MAX_RESULTS)) {
          const item = await z.Items.getAsync(id); if (!item || item.deleted) continue;
          await metadata(item, item.isRegularItem());
          const candidates = item.isPDFAttachment() ? [item.id] : item.isRegularItem() ? item.getAttachments() : [];
          for (const attachmentID of candidates) {
            const pdf = await z.Items.getAsync(attachmentID); if (!pdf || pdf.deleted || !pdf.isPDFAttachment()) continue;
            await metadata(pdf);
            const parentID = pdf.parentID ?? pdf.parentItemID; const parent = parentID ? await z.Items.getAsync(parentID) : undefined;
            if (parent && !parent.deleted) await metadata(parent);
            const source = parent && !parent.deleted ? parent : pdf; const paper = { clientId: options.clientId, libraryId: pdf.libraryID, attachmentKey: pdf.key };
            scopeOf(paper); const key = paperId(paper); if (seen.has(key)) continue; seen.add(key);
            const info = identity(source, pdf); const attachmentTitle = pdf.getField('title');
            results.push({ id: `article-${options.clientId}-${pdf.libraryID}-${pdf.key}`, kind: 'article', label: attachmentTitle && attachmentTitle !== info.title ? `${info.title} · ${attachmentTitle}` : info.title, paper, identity: info, capturedAt: now() });
            if (results.length >= MAX_RESULTS) break;
          }
          if (results.length >= MAX_RESULTS) break;
        }
      }
      // Every library failing is a real search failure; a single unreachable library must not hide the rest.
      if (!searched && failure) throw failure;
      return disambiguate(results);
    }, 'Article metadata could not be searched.'),
    read: (reference, signal) => {
      const frozen = clone(reference);
      return boundary(async () => {
        if (frozen.kind !== 'article' || !frozen.paper) fail('This native reader accepts an explicit PDF article reference.');
        const paper = scopeOf(frozen.paper);
        return withReader(paper, signal, async (_reader, source) => {
          const captured = await waitRead(source.capture(signal), signal);
          const document = await options.documentCache.read(paper, captured, signal, () => {}, frozen.range);
          await waitRead(source.validate(document), signal); check(signal); attachment(paper);
          return { ...frozen, paper, document: clone(document) };
        });
      }, 'The referenced PDF could not be read locally.');
    },
    open: paper => boundary(async () => { const scope = scopeOf(paper); await z.Reader.open(attachment(scope).id); }, 'The referenced PDF could not be opened.'),
    capturePage: (paper, pageIndex, signal) => capture(paper, pageIndex, undefined, undefined, signal),
    captureRegion,
  };
}

interface RasterViewport { width: number; height: number; convertToViewportRectangle(rect: number[]): number[] }
interface RasterPage {
  view: number[];
  getViewport(options: { scale: number; offsetX?: number; offsetY?: number }): RasterViewport;
  render(options: { canvasContext: CanvasRenderingContext2D; viewport: RasterViewport; background?: string }): { promise: Promise<void>; cancel?(): void };
}
/** Source-audited PDF.js rendering path; never changes reader zoom or creates annotations. */
async function rasterizeNative(input: LibraryRasterInput, cloneInto: NonNullable<LibraryReferenceOptions['cloneInto']>, waiveXrays: NonNullable<LibraryReferenceOptions['waiveXrays']>): Promise<Uint8Array> {
  const view = input.reader._internalReader?._primaryView ?? input.reader._internalReader?._lastView;
  const nativeWindow = view?._iframeWindow as unknown as { document?: Document; PDFViewerApplication?: { pdfDocument?: { getPage?(number: number): Promise<RasterPage> } } } | undefined;
  const pdf = nativeWindow?.PDFViewerApplication?.pdfDocument;
  if (!nativeWindow?.document || !pdf?.getPage) fail('This reader does not expose native PDF page rendering.', 'UNSUPPORTED_INTERACTION');
  // Awaited content-realm class instances arrive behind an Xray that hides PDF.js methods.
  const page = waiveXrays(await waitRead(pdf.getPage(input.pageIndex + 1), input.signal)) as RasterPage;
  if (typeof page.getViewport !== 'function' || typeof page.render !== 'function' || !Array.isArray(page.view) || page.view.length !== 4) fail('Native PDF region rendering is unavailable.', 'UNSUPPORTED_INTERACTION');
  const rect = input.rect ?? [...page.view] as Rect;
  if (!rect.every(Number.isFinite) || rect[2] <= rect[0] || rect[3] <= rect[1] || rect[0] < page.view[0]! || rect[1] < page.view[1]! || rect[2] > page.view[2]! || rect[3] > page.view[3]!) fail('The selected region is outside this PDF page.');
  const viewport = waiveXrays(page.getViewport(cloneInto({ scale: input.scale }, nativeWindow) as { scale: number })) as RasterViewport;
  if (typeof viewport.convertToViewportRectangle !== 'function') fail('Native PDF coordinate conversion is unavailable.', 'UNSUPPORTED_INTERACTION');
  const bounds = viewport.convertToViewportRectangle(cloneInto([...rect], nativeWindow) as number[]);
  const left = Math.min(bounds[0]!, bounds[2]!); const top = Math.min(bounds[1]!, bounds[3]!);
  const width = Math.ceil(Math.abs(bounds[2]! - bounds[0]!)); const height = Math.ceil(Math.abs(bounds[3]! - bounds[1]!));
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > MAX_RASTER_PIXELS) fail('This PDF region exceeds the readable image size limit. Select a smaller region; it was not downsampled.', 'PAYLOAD_TOO_LARGE');
  const crop = waiveXrays(page.getViewport(cloneInto({ scale: input.scale, offsetX: 0 - left, offsetY: 0 - top }, nativeWindow) as { scale: number; offsetX: number; offsetY: number })) as RasterViewport;
  const canvas = nativeWindow.document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context: (CanvasRenderingContext2D & { skipBlender?: boolean }) | null = canvas.getContext('2d', { alpha: false });
  if (!context) fail('Native PDF image rendering is unavailable.', 'UNSUPPORTED_INTERACTION');
  context.skipBlender = true;
  let render: ReturnType<RasterPage['render']> | undefined;
  try {
    const params = cloneInto({ canvasContext: context, viewport: crop, background: '#ffffff' }, nativeWindow, { wrapReflectors: true }) as Parameters<RasterPage['render']>[0];
    render = waiveXrays(page.render(params)) as ReturnType<RasterPage['render']>; await waitRead(render.promise, input.signal); check(input.signal);
    const url = canvas.toDataURL('image/png'); if (!url.startsWith('data:image/png;base64,')) fail('The PDF renderer did not return a PNG image.');
    return Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), char => char.charCodeAt(0));
  } finally { if (input.signal.aborted) render?.cancel?.(); canvas.width = 0; canvas.height = 0; }
}
