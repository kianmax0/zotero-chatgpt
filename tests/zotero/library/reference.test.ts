import { expect, it, vi } from 'vitest';
import { Window as HappyWindow } from 'happy-dom';
import { createLibraryReferencePort, type LibraryDocumentSource, type LibraryItem, type LibraryReader, type LibraryReferenceOptions, type NativeLibraryHost } from '../../../packages/zotero/src/library/reference.ts';
import { createFileActions } from '../../../packages/zotero/src/actions/files.ts';
import { type LibraryFilePicker } from '../../../packages/zotero/src/library/native-files.ts';
import { ReaderDocumentCache, type DocumentSource } from '../../../packages/zotero/src/reader/document.ts';
import { paperA, TINY_PNG_DATA_URL } from '../../contracts/factories.ts';
import type { ReaderReference } from '../../../packages/contracts/src/workspace.ts';
import { validateReference } from '../../../packages/contracts/src/workspace-validation.ts';

const uuid = '9a1c3e5f-7b2d-4c6e-8f0a-1b3d5f7a9c0e';
const png = Uint8Array.from(atob(TINY_PNG_DATA_URL.split(',')[1]!), c => c.charCodeAt(0));
const reference: ReaderReference = { id: 'article-one', kind: 'article', label: 'Paper · Main PDF', paper: paperA, identity: { title: 'Paper', authors: ['Ada'], year: '2026' }, capturedAt: '2026-09-12T00:00:00Z' };

function setup(options: Partial<LibraryReferenceOptions> = {}, nativeRaster = false) {
  const metadataReads: string[] = [];
  const item = (id: number, key: string, title: string, pdf: boolean, parentID?: number): LibraryItem => ({ id, key, libraryID: paperA.libraryId, ...(parentID ? { parentID } : {}), getField: field => field === 'title' ? title : field === 'date' ? '2026-01-01' : '', getCreators: () => pdf ? [] : [{ firstName: 'Ada', lastName: 'Lovelace' }], isRegularItem: () => !pdf, isPDFAttachment: () => pdf, getAttachments: () => pdf ? [] : [2, 3], loadDataType: type => { metadataReads.push(type); return Promise.resolve(); }, getFilePathAsync: vi.fn().mockResolvedValue('/synthetic/paper.pdf') });
  const items = [item(1, 'PARENT01', 'Same paper', false), item(2, paperA.attachmentKey, 'Main PDF', true, 1), item(3, 'PDFSUPP2', 'Supplement', true, 1)];
  const tabs = new Map<string, { id: string; data: { itemID: number } }>();
  const nativeTabs = { selectedID: 'user-tab', getTabInfo: (id: string) => tabs.get(id) ?? {}, add: (options: { id: string; type: string; title: string; data: { itemID: number }; select: false }) => { tabs.set(options.id, { id: options.id, data: options.data }); return { id: options.id }; }, close: (id: string) => { tabs.delete(id); } };
  const win = { Zotero_Tabs: nativeTabs } as unknown as Window & { Zotero_Tabs: typeof nativeTabs };
  let onSelection: (id: string) => void = () => undefined;
  const unwatch = vi.fn();
  const closes = vi.fn();
  const conditions: Array<[string, string, string | undefined]> = [];
  const pdf: DocumentSource = { revision: { fingerprint: 'synthetic-v1', size: 1024, modifiedAt: 1000 }, pdf: { numPages: 2, fingerprints: ['synthetic-v1'], getPageLabels2: () => Promise.resolve(['i', 'ii']), getPageData: vi.fn(({ pageIndex }) => Promise.resolve({ chars: [{ c: `Page ${pageIndex + 1} evidence` }] })) } };
  const source: LibraryDocumentSource = { capture: vi.fn().mockResolvedValue(pdf), validate: vi.fn().mockResolvedValue(undefined) };
  const picker: LibraryFilePicker = { modeOpen: 0, modeOpenMultiple: 3, modeSave: 1, returnOK: 0, returnReplace: 2, defaultString: '', file: '/synthetic/SKILL.md', files: ['/synthetic/image.png'], init: vi.fn(), appendFilter: vi.fn(), show: vi.fn().mockResolvedValue(0) };
  const io = { stat: vi.fn().mockResolvedValue({ size: png.length }), read: vi.fn().mockResolvedValue(png), write: vi.fn().mockResolvedValue(undefined) };
  const host: NativeLibraryHost = {
    Items: { get: id => items.find(item => item.id === id), getAsync: id => Promise.resolve(items.find(item => item.id === id)), getByLibraryAndKey: (library, key) => items.find(item => item.libraryID === library && item.key === key) },
    Search: class { addCondition(condition: string, operator: string, value?: string) { conditions.push([condition, operator, value]); } search() { return Promise.resolve([1]); } },
    Reader: { _readers: [], open: vi.fn<NativeLibraryHost['Reader']['open']>((itemID, _location, options) => {
      if (options?.tabID && !tabs.has(options.tabID)) return Promise.reject(new TypeError('A supplied tabID requires an existing native container'));
      const tabID = options?.tabID ?? 'host-selected-existing';
      const reader: LibraryReader = { itemID, tabID, _window: win, _initPromise: Promise.resolve(), close: () => { closes(tabID); tabs.delete(tabID); host.Reader._readers = host.Reader._readers.filter(item => item !== reader); } };
      tabs.set(tabID, { id: tabID, data: { itemID } }); host.Reader._readers.push(reader); return Promise.resolve(reader);
    }) }, getMainWindow: () => win,
  };
  const config: LibraryReferenceOptions = { clientId: paperA.clientId, documentCache: new ReaderDocumentCache({ yield: async () => {} }), uuid: () => uuid, now: () => '2026-09-12T00:00:00Z', source: () => source, getWindow: () => win, watchTabSelection: selected => { onSelection = selected; return unwatch; }, createFilePicker: () => picker, io, decodeImage: () => Promise.resolve({ width: 1, height: 1 }), ...(!nativeRaster ? { rasterize: vi.fn().mockResolvedValue(png) } : {}), ...options };
  // The composition root merges the read port with the file actions; the tests exercise the same
  // single object the presenter sees.
  const port = { ...createLibraryReferencePort(host, config), ...createFileActions(host, config) };
  return { port, host, items, pdf, source, conditions, metadataReads, tabs, nativeTabs, closes, unwatch, picker, io, select: (id: string) => { nativeTabs.selectedID = id; onSelection(id); } };
}

it('performs metadata-only explicit article search and disambiguates PDF attachments', async () => {
  const f = setup(); expect(f.conditions).toEqual([]);
  expect(await f.port.search('  ')).toEqual([]); expect(f.conditions).toEqual([]);
  const result = await f.port.search('Same paper');
  expect(result).toHaveLength(2); expect(result[0]?.identity?.authors).toEqual(['Ada Lovelace']);
  expect(result.map(item => item.label)).toEqual(['Same paper · Main PDF', 'Same paper · Supplement']);
  expect(result.map(item => item.paper?.attachmentKey)).toEqual([paperA.attachmentKey, 'PDFSUPP2']);
  expect(f.conditions).toContainEqual(['quicksearch-titleCreatorYear', 'contains', 'Same paper']);
  expect(f.conditions.some(([name]) => /note|annotation|fulltext/iu.test(name))).toBe(false);
  expect(f.source.capture).not.toHaveBeenCalled();
  for (const item of f.items) expect(item.getFilePathAsync).not.toHaveBeenCalled();
});

it('searches every readable library and disambiguates same-title articles by author and year', async () => {
  const searches: Array<{ libraryID?: number; conditions: Array<[string, string, string | undefined]> }> = [];
  const item = (id: number, key: string, libraryID: number, title: string, pdf: boolean, author: string, year: string, parentID?: number): LibraryItem => ({ id, key, libraryID, ...(parentID ? { parentID } : {}), getField: field => field === 'title' ? title : field === 'date' ? `${year}-01-01` : '', getCreators: () => pdf ? [] : [{ firstName: author.split(' ')[0]!, lastName: author.split(' ').slice(1).join(' ') }], isRegularItem: () => !pdf, isPDFAttachment: () => pdf, getAttachments: () => pdf ? [] : [id + 1], loadDataType: () => Promise.resolve() });
  const items = [
    item(10, 'USERITEM', 1, 'Shared Methods', false, 'Ada Lovelace', '2020'), item(11, 'USERPDF1', 1, 'Shared Methods', true, '', '', 10),
    item(20, 'GROUPITE', 2, 'Shared Methods', false, 'Alan Turing', '2024'), item(21, 'GRPPDF01', 2, 'Shared Methods', true, '', '', 20),
    item(30, 'LOCKEDIT', 3, 'Shared Methods', false, 'Grace Hopper', '1952'), item(31, 'LOCKPDF1', 3, 'Shared Methods', true, '', '', 30),
  ];
  const host: NativeLibraryHost = {
    Items: { get: id => items.find(entry => entry.id === id), getAsync: id => Promise.resolve(items.find(entry => entry.id === id)), getByLibraryAndKey: (library, key) => items.find(entry => entry.libraryID === library && entry.key === key) },
    Search: class {
      libraryID = 1; conditions: Array<[string, string, string | undefined]> = [];
      addCondition(condition: string, operator: string, value?: string) { this.conditions.push([condition, operator, value]); }
      search() {
        searches.push({ libraryID: this.libraryID, conditions: this.conditions });
        return Promise.resolve(this.libraryID === 1 ? [10] : this.libraryID === 2 ? [20] : [30]);
      }
    },
    Libraries: { getAll: () => [
      { libraryID: 1, name: 'Personal', editable: true, libraryType: 'user' },
      { libraryID: 2, name: 'Lab Group', editable: false, libraryType: 'group' },
      { libraryID: 3, name: 'Locked Group', editable: false, libraryType: 'group' },
      { libraryID: 9, name: 'Feeds', editable: false, libraryType: 'feed' },
    ] },
    Reader: { _readers: [], open: vi.fn() },
  };
  const port = createLibraryReferencePort(host, { clientId: paperA.clientId, documentCache: new ReaderDocumentCache({ yield: async () => {} }), uuid: () => uuid, now: () => '2026-09-12T00:00:00Z' });
  const results = await port.search('Shared Methods');
  expect(searches.map(entry => entry.libraryID)).toEqual([1, 2, 3]);
  expect(searches.every(entry => entry.conditions.some(([name]) => name === 'quicksearch-titleCreatorYear'))).toBe(true);
  expect(results.map(reference => reference.paper?.libraryId)).toEqual([1, 2, 3]);
  expect(results.map(reference => reference.label)).toEqual([
    'Shared Methods · Ada Lovelace · 2020',
    'Shared Methods · Alan Turing · 2024',
    'Shared Methods · Grace Hopper · 1952',
  ]);
  expect(results.map(reference => reference.identity?.authors[0])).toEqual(['Ada Lovelace', 'Alan Turing', 'Grace Hopper']);
  // A single unreachable library is skipped; the reachable libraries still answer.
  const flaky = { ...host, Search: class { libraryID = 1; addCondition() { /* noop */ } search() { if (this.libraryID === 3) return Promise.reject(new Error('This library is unavailable.')); return Promise.resolve(this.libraryID === 1 ? [10] : [20]); } } } as NativeLibraryHost;
  const tolerant = createLibraryReferencePort(flaky, { clientId: paperA.clientId, documentCache: new ReaderDocumentCache({ yield: async () => {} }), uuid: () => uuid, now: () => '2026-09-12T00:00:00Z' });
  expect((await tolerant.search('Shared Methods')).map(reference => reference.paper?.libraryId)).toEqual([1, 2]);
  // Every library failing is still a real failure, never a silent empty list.
  const broken = { ...host, Search: class { libraryID = 1; addCondition() { /* noop */ } search() { return Promise.reject(new Error('offline')); } } } as NativeLibraryHost;
  const failing = createLibraryReferencePort(broken, { clientId: paperA.clientId, documentCache: new ReaderDocumentCache({ yield: async () => {} }), uuid: () => uuid, now: () => '2026-09-12T00:00:00Z' });
  await expect(failing.search('Shared Methods')).rejects.toMatchObject({ code: 'INVALID_REQUEST', message: 'Article metadata could not be searched.' });
});

it('uses an isolated background tab even when an unloaded tab already exists, then closes only its own', async () => {
  const f = setup(); f.tabs.set('unloaded-user-tab', { id: 'unloaded-user-tab', data: { itemID: 2 } });
  const result = await f.port.read(reference, new AbortController().signal);
  expect(f.host.Reader.open).toHaveBeenCalledWith(2, undefined, expect.objectContaining({ openInBackground: true, allowDuplicate: true, tabID: `zchatgpt-reference-${uuid}` }));
  expect(result.document?.paper).toEqual(paperA); expect(result.document?.revision).toEqual(f.pdf.revision);
  expect(result.document?.pages).toHaveLength(2); expect(f.source.validate).toHaveBeenCalled();
  expect(f.closes).toHaveBeenCalledWith(`zchatgpt-reference-${uuid}`); expect(f.tabs.has('unloaded-user-tab')).toBe(true);
  expect(f.nativeTabs.selectedID).toBe('user-tab'); expect(f.unwatch).toHaveBeenCalledTimes(1);
});
it('creates the reserved native tab container before passing its id to Reader.open', async () => {
  const f = setup(); const result = await f.port.read(reference, new AbortController().signal);
  expect(result.document?.pages).toHaveLength(2); expect(f.tabs.has(`zchatgpt-reference-${uuid}`)).toBe(false); expect(f.nativeTabs.selectedID).toBe('user-tab');
});

it('reuses a loaded reader without selecting or closing it', async () => {
  const f = setup(); const close = vi.fn();
  f.host.Reader._readers.push({ itemID: 2, tabID: 'existing', close });
  await f.port.read(reference, new AbortController().signal);
  expect(f.host.Reader.open).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
});

it('retains a background reader once the user selects it, even after selecting another tab', async () => {
  const f = setup();
  vi.mocked(f.source.validate).mockImplementation(() => { f.select(`zchatgpt-reference-${uuid}`); f.select('other-user-tab'); return Promise.resolve(); });
  await f.port.read(reference, new AbortController().signal);
  expect(f.closes).not.toHaveBeenCalled(); expect(f.nativeTabs.selectedID).toBe('other-user-tab');
});

it('freezes caller scope and range before asynchronous preparation and checks the source version', async () => {
  const f = setup(); const requested = structuredClone(reference); requested.range = [2, 2];
  const pending = f.port.read(requested, new AbortController().signal);
  requested.paper!.attachmentKey = 'PDFSUPP2'; requested.range[0] = 1;
  const result = await pending;
  expect(result.paper).toEqual(paperA); expect(result.document?.pages.map(page => page.pageIndex)).toEqual([1]);
  vi.mocked(f.source.validate).mockRejectedValueOnce(new Error('private filepath'));
  await expect(f.port.read(reference, new AbortController().signal)).rejects.toThrow(/source|PDF|read/iu);
});

it('rejects a foreign profile and never closes an unexpected host-owned tab', async () => {
  const f = setup();
  await expect(f.port.read({ ...reference, paper: { ...paperA, clientId: 'other-client' } }, new AbortController().signal)).rejects.toThrow(/environment|profile/iu);
  expect(f.host.Reader.open).not.toHaveBeenCalled();
  const close = vi.fn(); vi.mocked(f.host.Reader.open).mockResolvedValueOnce({ itemID: 2, tabID: 'existing-user-tab', close });
  await expect(f.port.read(reference, new AbortController().signal)).rejects.toThrow(/background|isolated/iu);
  expect(close).not.toHaveBeenCalled();
});

it('cancels pending source work and closes only the untouched background tab', async () => {
  const f = setup(); vi.mocked(f.source.capture).mockImplementation(() => new Promise(() => {}));
  const controller = new AbortController(); const pending = f.port.read(reference, controller.signal);
  await vi.waitFor(() => expect(f.source.capture).toHaveBeenCalled()); controller.abort();
  await expect(pending).rejects.toThrow(/cancel/iu); expect(f.closes).toHaveBeenCalledTimes(1);
});

it('validates picked image bytes and rejects oversized input before reading it', async () => {
  const f = setup(); const result = await f.port.pickFile();
  expect(result.images[0]?.mime).toBe('image/png'); expect(result.images[0]?.name).toBe('image.png');
  expect(f.io.read).toHaveBeenCalledWith('/synthetic/image.png', { maxBytes: 2 * 1024 * 1024 + 1 });
  f.io.read.mockClear(); f.io.stat.mockResolvedValueOnce({ size: 3 * 1024 * 1024 });
  await expect(f.port.pickFile()).rejects.toThrow(/large|limit/iu); expect(f.io.read).not.toHaveBeenCalled();
  f.io.read.mockResolvedValueOnce(new TextEncoder().encode('%PDF-not-an-image'));
  await expect(f.port.pickFile()).rejects.toThrow(/image/iu);
});

it('captures whole pages with real paper provenance, then exports image bytes', async () => {
  const rasterize = vi.fn<NonNullable<LibraryReferenceOptions['rasterize']>>().mockResolvedValue(png);
  const f = setup({ rasterize });
  const page = await f.port.capturePage(paperA, 1); expect(page.origin).toEqual({ kind: 'paper', paper: paperA, pageIndex: 1, revision: f.pdf.revision });
  await f.port.exportImage(page); expect(f.io.write).toHaveBeenCalledWith('/synthetic/SKILL.md', png);
});

it('handles native tab lookup throwing for a not-yet-created tab', async () => {
  const f = setup();
  f.nativeTabs.getTabInfo = id => { const tab = f.tabs.get(id); if (!tab) throw new Error('No such tab'); return tab; };
  await expect(f.port.read(reference, new AbortController().signal)).resolves.toHaveProperty('document');
  expect(f.closes).toHaveBeenCalledTimes(1);
});

it('cleans up an untouched background tab when cancellation beats native Reader.open', async () => {
  const f = setup(); const original = vi.mocked(f.host.Reader.open).getMockImplementation()!;
  let release!: () => void;
  vi.mocked(f.host.Reader.open).mockImplementation((...args) => new Promise(resolve => { release = () => { void original(...args).then(resolve); }; }));
  const controller = new AbortController(); const pending = f.port.read(reference, controller.signal);
  const rejected = expect(pending).rejects.toThrow(/cancel/iu);
  await vi.waitFor(() => expect(f.host.Reader.open).toHaveBeenCalled()); controller.abort(); await rejected;
  expect(f.unwatch).not.toHaveBeenCalled(); release();
  await vi.waitFor(() => expect(f.closes).toHaveBeenCalledTimes(1));
  expect(f.unwatch).toHaveBeenCalledTimes(1);
});

it('keeps a shared background reader alive until all concurrent reads finish', async () => {
  const f = setup(); let firstDone!: () => void; let secondDone!: () => void;
  vi.mocked(f.source.validate).mockImplementationOnce(() => new Promise(resolve => { firstDone = resolve; })).mockImplementationOnce(() => new Promise(resolve => { secondDone = resolve; }));
  const first = f.port.read(reference, new AbortController().signal);
  await vi.waitFor(() => expect(f.source.validate).toHaveBeenCalledTimes(1));
  const second = f.port.read(reference, new AbortController().signal);
  await vi.waitFor(() => expect(f.source.validate).toHaveBeenCalledTimes(2));
  firstDone(); await first; expect(f.closes).not.toHaveBeenCalled();
  secondDone(); await second; expect(f.closes).toHaveBeenCalledTimes(1);
});

it('uses native PDF coordinates at fixed resolution without changing reader zoom or creating annotations', async () => {
  const f = setup({ cloneInto: value => value }, true);
  const document = new HappyWindow().document as unknown as Document;
  const canvas = document.createElement('canvas');
  const dimensions: number[][] = [];
  vi.spyOn(canvas, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
  vi.spyOn(canvas, 'toDataURL').mockReturnValue(TINY_PNG_DATA_URL);
  vi.spyOn(document, 'createElement').mockImplementation(() => canvas);
  const getViewport = vi.fn((options: { scale: number; offsetX?: number; offsetY?: number }) => ({ width: 300 * options.scale, height: 400 * options.scale, convertToViewportRectangle: (rect: number[]) => rect.map(value => value * options.scale) }));
  const render = vi.fn(() => { dimensions.push([canvas.width, canvas.height]); return { promise: Promise.resolve() }; });
  const page = { view: [0, 0, 300, 400], getViewport, render };
  const pdf = { ...f.pdf.pdf, getPage: vi.fn(() => Promise.resolve(page)) };
  const pdfViewer = { currentScale: 1.5, currentScaleValue: 'page-width', scrollPageIntoView: vi.fn() };
  const nativeWindow = { document, PDFViewerApplication: { pdfDocument: pdf, pdfViewer } };
  f.host.Reader._readers.push({ itemID: 2, _internalReader: { _primaryView: { _iframeWindow: nativeWindow } } });
  const result = await f.port.capturePage(paperA, 0);
  expect(result.mime).toBe('image/png'); expect(dimensions).toEqual([[600, 800]]);
  expect(getViewport).toHaveBeenLastCalledWith({ scale: 2, offsetX: 0, offsetY: 0 });
  expect(pdfViewer.currentScale).toBe(1.5); expect(pdfViewer.currentScaleValue).toBe('page-width');
  expect(pdfViewer.scrollPageIntoView).not.toHaveBeenCalled(); expect(canvas.width).toBe(0);
  page.view = [0, 0, 10000, 10000];
  await expect(f.port.capturePage(paperA, 0)).rejects.toThrow(/not downsampled/iu);
  expect(render).toHaveBeenCalledTimes(1);
});

it('captures only a frozen user-selected rectangle and rejects an obsolete PDF revision', async () => {
  const rasterize = vi.fn().mockResolvedValue(png);
  const f = setup({ rasterize });
  const selection = { paper: paperA, revision: { ...f.pdf.revision }, pageIndex: 1, rect: [20, 30, 120, 180] as [number, number, number, number] };
  const image = await f.port.captureRegion(selection);
  expect(rasterize).toHaveBeenCalledWith(expect.objectContaining({ paper: paperA, revision: f.pdf.revision, pageIndex: 1, rect: selection.rect, scale: 2 }));
  expect(image.origin).toEqual({ kind: 'paper', paper: paperA, pageIndex: 1, revision: f.pdf.revision });

  rasterize.mockClear();
  await expect(f.port.captureRegion({ ...selection, revision: { ...selection.revision, fingerprint: 'stale' } })).rejects.toThrow(/PDF changed/u);
  expect(() => f.port.captureRegion({ ...selection, rect: [10, 10, 10, 20] })).toThrow(/valid rectangle/u);
  expect(rasterize).not.toHaveBeenCalled();
});

it('rasterizes a selected region with the PDF page transform while preserving reader zoom', async () => {
  const f = setup({ cloneInto: value => value }, true);
  const document = new HappyWindow().document as unknown as Document; const canvas = document.createElement('canvas');
  const dimensions: number[][] = [];
  vi.spyOn(canvas, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
  vi.spyOn(canvas, 'toDataURL').mockReturnValue(TINY_PNG_DATA_URL);
  vi.spyOn(document, 'createElement').mockImplementation(() => canvas);
  const getViewport = vi.fn((options: { scale: number; offsetX?: number; offsetY?: number }) => ({ width: 300 * options.scale, height: 400 * options.scale, convertToViewportRectangle: (rect: number[]) => rect.map(value => value * options.scale) }));
  const render = vi.fn(() => { dimensions.push([canvas.width, canvas.height]); return { promise: Promise.resolve() }; });
  const page = { view: [0, 0, 300, 400], getViewport, render };
  const pdf = { ...f.pdf.pdf, getPage: vi.fn(() => Promise.resolve(page)) };
  const pdfViewer = { currentScale: 1.5, currentScaleValue: 'page-width', scrollPageIntoView: vi.fn() };
  const nativeWindow = { document, PDFViewerApplication: { pdfDocument: pdf, pdfViewer } };
  f.host.Reader._readers.push({ itemID: 2, _internalReader: { _primaryView: { _iframeWindow: nativeWindow } } });
  const image = await f.port.captureRegion({ paper: paperA, revision: f.pdf.revision, pageIndex: 0, rect: [30, 40, 120, 140] });
  expect(image.mime).toBe('image/png'); expect(dimensions).toEqual([[180, 200]]);
  expect(getViewport).toHaveBeenNthCalledWith(1, { scale: 2 });
  expect(getViewport).toHaveBeenNthCalledWith(2, { scale: 2, offsetX: -60, offsetY: -80 });
  expect(pdfViewer.currentScale).toBe(1.5); expect(pdfViewer.currentScaleValue).toBe('page-width');
  expect(pdfViewer.scrollPageIntoView).not.toHaveBeenCalled(); expect(canvas.width).toBe(0);
});
it('unwraps the host page proxy before using its hidden PDF rendering methods', async () => {
  const wrappedPage = {};
  const document = new HappyWindow().document as unknown as Document; const canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'getContext').mockReturnValue({} as CanvasRenderingContext2D); vi.spyOn(canvas, 'toDataURL').mockReturnValue(TINY_PNG_DATA_URL); vi.spyOn(document, 'createElement').mockImplementation(() => canvas);
  const page = { view: [0, 0, 300, 400], getViewport: (options: { scale: number }) => ({ width: 300 * options.scale, height: 400 * options.scale, convertToViewportRectangle: (rect: number[]) => rect.map(value => value * options.scale) }), render: vi.fn(() => ({ promise: Promise.resolve() })) };
  const f = setup({ cloneInto: value => value, waiveXrays: value => value === wrappedPage ? page : value }, true);
  const nativeWindow = { document, PDFViewerApplication: { pdfDocument: { ...f.pdf.pdf, getPage: () => Promise.resolve(wrappedPage) }, pdfViewer: { currentScale: 1, currentScaleValue: 'page-width', scrollPageIntoView: () => {} } } };
  f.host.Reader._readers.push({ itemID: 2, _internalReader: { _primaryView: { _iframeWindow: nativeWindow } } });
  expect((await f.port.capturePage(paperA, 0)).mime).toBe('image/png'); expect(page.render).toHaveBeenCalledTimes(1);
});

it('fails explicitly when native raster capability is absent or the PDF version changes during capture', async () => {
  const unsupported = setup({}, true);
  await expect(unsupported.port.capturePage(paperA, 0)).rejects.toThrow(/render/iu);
  const f = setup({ rasterize: () => { f.pdf.revision.modifiedAt++; return Promise.resolve(png); } });
  await expect(f.port.capturePage(paperA, 0)).rejects.toThrow(/changed/iu);
});

it('lists only editable native collections and keeps profile, library, and collection keys intact', async () => {
  const f = setup(); const listed = vi.fn(() => [
    { libraryID: 1, name: 'Personal', editable: true },
    { libraryID: 2, name: 'Read only', editable: false },
  ]);
  f.host.Libraries = { getAll: listed };
  const collection = (key: string, name: string, editable = true, parentKey?: string) => ({ key, name, libraryID: 1, isEditable: () => editable, ...(parentKey ? { parentKey } : {}) });
  f.host.Collections = { getByLibrary: vi.fn(() => [collection('PARENT01', 'Research'), collection('CHILD001', 'Methods', true, 'PARENT01'), collection('LOCKED01', 'Locked', false), { ...collection('DELETED1', 'Deleted'), deleted: true }]) };
  expect(listed).not.toHaveBeenCalled();
  expect(await f.port.collections()).toEqual([
    { clientId: paperA.clientId, libraryId: 1, collectionKey: 'PARENT01', name: 'Personal / Research' },
    { clientId: paperA.clientId, libraryId: 1, collectionKey: 'CHILD001', name: 'Personal / Research / Methods' },
  ]);
  expect(f.host.Collections.getByLibrary).toHaveBeenCalledTimes(1);
  expect(f.source.capture).not.toHaveBeenCalled();
});

// This test really base64-encodes and decodes an image just over the ordinary 2 MiB limit and
// compares the exported bytes. The comparison is byte-exact but no longer uses vitest's generic
// deep equality over the multi-MiB `Uint8Array` (that was the measured timeout root cause); it now
// checks the target and length, then one `Buffer.equals` memcmp. The payload stays the exact
// 2 MiB + 1 boundary, and the explicit budget stays as defence for slower shared CI runners — the
// real work and the strength of the assertion are unchanged.
it('exports generated output images above the input limit while retaining the ordinary 2 MiB limit', { timeout: 15000 }, async () => {
  const f = setup(); const bytes = new Uint8Array(2 * 1024 * 1024 + 1); bytes.set(png);
  const image = { id: uuid, name: 'generated.png', mime: 'image/png' as const, dataUrl: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}` };
  await expect(f.port.exportImage(image)).rejects.toThrow(/larger/iu);
  expect(f.io.write).not.toHaveBeenCalled();
  await f.port.exportImage({ ...image, origin: { kind: 'generated', model: 'image-model' } });
  const write = (f.io.write.mock.calls as unknown as Array<[string, Uint8Array]>).find(([target]) => target === '/synthetic/SKILL.md');
  expect(write, 'exports to the SKILL.md target').toBeDefined();
  const writtenBytes = write![1];
  expect(writtenBytes.length).toBe(bytes.length);
  expect(Buffer.from(writtenBytes).equals(Buffer.from(bytes))).toBe(true);
});

// Item A — attaching a real file. This port is the only place a local path is ever touched; the
// tests below pin both halves of that contract: the file is really read through the host file port,
// and nothing that leaves the port can name the chosen location or bypass a cap.
const TEXT_FILE = '# Weekly analysis\n\nEvidence on p. 3.\n';
/** One mutable file port so each case states its bytes once instead of queueing one-shot mocks. */
function fileSetup(f: ReturnType<typeof setup>) {
  const state: { path: string; bytes: Uint8Array; type: string | undefined } = { path: '', bytes: new Uint8Array(), type: undefined };
  f.io.stat.mockImplementation(() => Promise.resolve(state.type ? { size: state.bytes.length, type: state.type } : { size: state.bytes.length }));
  f.io.read.mockImplementation(() => Promise.resolve(state.bytes));
  const at = (path: string, bytes: Uint8Array, type?: string) => { state.path = path; state.bytes = bytes; state.type = type; f.picker.file = path; delete f.picker.files; };
  return {
    text: (path: string, body = TEXT_FILE) => at(path, new TextEncoder().encode(body)),
    bytes: at,
  };
}

it('attaches a text file as bounded reference text and never leaks the chosen path', async () => {
  const f = setup(); const file = fileSetup(f); file.text('/synthetic/Notes/Weekly.Analysis.md');
  const picked = await f.port.pickFile();
  expect(picked.images).toEqual([]);
  expect(picked.references).toHaveLength(1);
  const [reference] = picked.references;
  expect(reference).toMatchObject({ kind: 'file', label: 'Weekly.Analysis.md', text: TEXT_FILE, capturedAt: '2026-09-12T00:00:00Z' });
  // The bare name, not the path, and no paper/document: the model is handed content, never a location.
  expect(reference!.paper).toBeUndefined();
  expect(JSON.stringify(picked)).not.toContain('/synthetic');
  expect(JSON.stringify(picked)).not.toContain('Notes');
  // The bytes really came from the host file port, bounded by the reference text cap.
  expect(f.io.read).toHaveBeenCalledWith('/synthetic/Notes/Weekly.Analysis.md', { maxBytes: 48 * 1024 + 1 });
  expect(validateReference(reference)).toEqual(reference);
});

it('keeps one id per file body so the same file cannot be attached twice', async () => {
  const f = setup(); const file = fileSetup(f);
  file.text('/synthetic/Notes/Weekly.Analysis.md');
  const first = await f.port.pickFile();
  file.text('/synthetic/other/weekly-copy.txt');
  const renamed = await f.port.pickFile();
  file.text('/synthetic/Notes/Weekly.Analysis.md', '# A different body\n');
  const changed = await f.port.pickFile();
  // Same bytes under another name share one id (the presenter dedupes on it); other bytes do not.
  expect(renamed.references[0]?.id).toBe(first.references[0]?.id);
  expect(changed.references[0]?.id).not.toBe(first.references[0]?.id);
});

it('routes an image-extension file to the validated image path', async () => {
  const f = setup(); const file = fileSetup(f); file.bytes('/synthetic/figure.png', png);
  const picked = await f.port.pickFile();
  expect(picked.references).toEqual([]);
  expect(picked.images[0]).toMatchObject({ mime: 'image/png', name: 'figure.png' });
  expect(f.io.read).toHaveBeenCalledWith('/synthetic/figure.png', { maxBytes: 2 * 1024 * 1024 + 1 });
  // A text body behind a .png extension still has to pass the shared image validation.
  file.bytes('/synthetic/figure.png', new TextEncoder().encode('not really an image'));
  await expect(f.port.pickFile()).rejects.toThrow(/image/iu);
});

it('refuses an unsupported, oversized, binary, non-UTF8, empty or non-regular file instead of guessing', async () => {
  const f = setup(); const file = fileSetup(f);
  file.bytes('/synthetic/paper.pdf', new TextEncoder().encode('%PDF-1.7'));
  await expect(f.port.pickFile()).rejects.toThrow(/text file|image/iu);
  file.bytes('/synthetic/notes.txt', new Uint8Array(48 * 1024 + 2));
  await expect(f.port.pickFile()).rejects.toThrow(/large|limit/iu);
  // Neither an unsupported extension nor an oversized file is ever handed to the native reader.
  expect(f.io.read).not.toHaveBeenCalled();
  file.bytes('/synthetic/notes.txt', Uint8Array.from([0x68, 0x69, 0x00, 0x01]));
  await expect(f.port.pickFile()).rejects.toThrow(/binary/iu);
  file.bytes('/synthetic/notes.txt', Uint8Array.from([0xc0, 0x80]));
  await expect(f.port.pickFile()).rejects.toThrow(/UTF-8/iu);
  file.text('/synthetic/notes.txt', '   \n\t');
  await expect(f.port.pickFile()).rejects.toThrow(/no text/iu);
  // A folder whose name happens to carry a text extension is refused before any bytes are read.
  const reads = f.io.read.mock.calls.length;
  file.bytes('/synthetic/notes.txt', new Uint8Array(64), 'directory');
  await expect(f.port.pickFile()).rejects.toThrow(/folder/iu);
  expect(f.io.read.mock.calls.length).toBe(reads);
});

it('attaches multiple chosen files in one pick and never leaks their paths', async () => {
  const f = setup();
  f.picker.files = ['/synthetic/Notes/Weekly.Analysis.md', '/synthetic/figure.png'];
  f.io.stat.mockImplementation((path: string) => Promise.resolve({ size: path.endsWith('.png') ? png.length : TEXT_FILE.length }));
  f.io.read.mockImplementation((path: string) => Promise.resolve(path.endsWith('.png') ? png : new TextEncoder().encode(TEXT_FILE)));
  const picked = await f.port.pickFile();
  // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn spy, not invoked as a method
  expect(f.picker.init).toHaveBeenCalledWith(expect.anything(), 'Attach files', f.picker.modeOpenMultiple);
  expect(picked.references).toHaveLength(1);
  expect(picked.references[0]).toMatchObject({ kind: 'file', label: 'Weekly.Analysis.md', text: TEXT_FILE });
  expect(picked.images).toHaveLength(1);
  expect(picked.images[0]).toMatchObject({ mime: 'image/png', name: 'figure.png' });
  expect(JSON.stringify(picked)).not.toContain('/synthetic');
});

it('treats a cancelled file selection as no attachment and never reads anything', async () => {
  const f = setup(); fileSetup(f); vi.mocked(f.picker.show).mockResolvedValueOnce(1);
  await expect(f.port.pickFile()).resolves.toEqual({ references: [], images: [] });
  expect(f.io.read).not.toHaveBeenCalled();
});
