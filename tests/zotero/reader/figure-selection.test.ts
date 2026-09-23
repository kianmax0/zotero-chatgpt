import { expect, it, vi } from 'vitest';
import { Window as HappyWindow } from 'happy-dom';
import { paperA } from '../../contracts/factories.ts';
import { createFigureRequestGate, selectFigureRegion } from '../../../packages/zotero/src/reader/figure-selection.ts';
import type { HostReader, ZoteroHost } from '../../../packages/zotero/src/reader/host-types.ts';

const revision = { fingerprint: 'figure-pdf-v1', size: 1024, modifiedAt: 1000 };

it('allows one Figure request per attachment until the first selection and proposal settle', async () => {
  const gate = createFigureRequestGate();
  let release!: () => void;
  const pending = gate.run('attachment-one', () => new Promise<void>(resolve => { release = resolve; }));
  await expect(gate.run('attachment-one', () => Promise.resolve())).rejects.toMatchObject({ code: 'BUSY' });
  await expect(gate.run('attachment-two', () => Promise.resolve('independent'))).resolves.toBe('independent');
  release(); await pending;
  await expect(gate.run('attachment-one', () => Promise.resolve('ready'))).resolves.toBe('ready');
});

function fixture(options: { pages?: number; itemID?: number; resolvedItemID?: number; timeoutMs?: number; conversion?: 'rotated-zoomed' | 'identity'; waiveXrays?: <T extends object>(value: T) => T } = {}) {
  const window = new HappyWindow(); const doc = window.document;
  const pages = Array.from({ length: options.pages ?? 1 }, (_, index) => {
    const div = doc.createElement('div') as unknown as HTMLElement; div.dataset.pageNumber = String(index + 1);
    (doc.body as unknown as { appendChild(node: object): object }).appendChild(div);
    const left = index * 1700; Object.defineProperty(div, 'getBoundingClientRect', { value: () => ({ left, top: 20, right: left + 1600, bottom: 1220, width: 1600, height: 1200, x: left, y: 20, toJSON: () => ({}) }) });
    const convertToPdfPoint = options.conversion === 'identity' ? (x: number, y: number): [number, number] => [x, y] : (x: number, y: number): [number, number] => [600 - y / 2, x / 2];
    const convertToViewportPoint = options.conversion === 'identity' ? (x: number, y: number): [number, number] => [x, y] : (x: number, y: number): [number, number] => [2 * y, 2 * (600 - x)];
    return { id: index + 1, div, viewport: { viewBox: [0, 0, 600, 800], convertToPdfPoint, convertToViewportPoint } };
  });
  const frame = { document: doc, PDFViewerApplication: { pdfDocument: { numPages: pages.length }, pdfViewer: { _pages: pages } } };
  const reader = { itemID: options.itemID ?? 22, _internalReader: { _primaryView: { _iframeWindow: frame } } } as unknown as HostReader;
  const item = { id: options.resolvedItemID ?? 22, libraryID: paperA.libraryId, key: paperA.attachmentKey };
  const zotero = { Items: { getByLibraryAndKey: vi.fn(() => item) } } as unknown as Pick<ZoteroHost, 'Items'>;
  const start = (signal?: AbortSignal) => selectFigureRegion({ zotero, reader, paper: paperA, revision, ...(signal ? { signal } : {}), ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}), ...(options.waiveXrays ? { waiveXrays: options.waiveXrays } : {}) });
  const pointer = (type: string, x: number, y: number, target: { dispatchEvent(event: unknown): boolean }, id = 1) => {
    const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
    Object.defineProperties(event, { pointerId: { value: id }, pointerType: { value: 'pen' }, isPrimary: { value: true } });
    target.dispatchEvent(event); return event;
  };
  return { window, doc, pages, reader, zotero, start, pointer };
}

it('freezes one explicit drag as a PDF-space rectangle under page zoom and rotation', async () => {
  const f = fixture(); const pending = f.start();
  const down = f.pointer('pointerdown', 210, 820, f.pages[0]!.div);
  f.pointer('pointermove', 510, 620, f.pages[0]!.div);
  const up = f.pointer('pointerup', 610, 420, f.pages[0]!.div);
  const selection = await pending;
  expect(down.defaultPrevented).toBe(true); expect(up.defaultPrevented).toBe(true);
  expect(selection).toEqual({ paper: paperA, revision, pageIndex: 0, rect: [200, 105, 400, 305] });
  expect(f.doc.querySelector('[aria-hidden="true"]')).toBeNull();
});

it('rejects cross-page drags instead of guessing which page owns the figure', async () => {
  const f = fixture({ pages: 2 }); const pending = f.start();
  f.pointer('pointerdown', 210, 820, f.pages[0]!.div);
  f.pointer('pointerup', 1710, 820, f.pages[1]!.div);
  await expect(pending).rejects.toThrow(/one PDF page/u);
  expect(f.doc.querySelector('[aria-hidden="true"]')).toBeNull();
});

it('rejects tiny/missing selections, cancels on Escape, and cleans up its listeners', async () => {
  const tiny = fixture(); const tinyPending = tiny.start();
  tiny.pointer('pointerdown', 210, 820, tiny.pages[0]!.div);
  tiny.pointer('pointerup', 212, 822, tiny.pages[0]!.div);
  await expect(tinyPending).rejects.toThrow(/larger figure/u);
  expect(tiny.doc.querySelector('[aria-hidden="true"]')).toBeNull();

  const cancel = fixture(); const cancelPending = cancel.start();
  const rejected = expect(cancelPending).rejects.toThrow(/cancelled/u);
  cancel.doc.dispatchEvent(new cancel.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await rejected; expect(cancel.doc.querySelector('[aria-hidden="true"]')).toBeNull();

  const abort = fixture(); const controller = new AbortController(); const abortPending = abort.start(controller.signal);
  controller.abort(); await expect(abortPending).rejects.toThrow(/cancelled/u);

  vi.useFakeTimers();
  try {
    const missing = fixture({ timeoutMs: 10 }); const missingPending = missing.start();
    const rejectedMissing = expect(missingPending).rejects.toThrow(/No figure region was selected/u);
    await vi.advanceTimersByTimeAsync(10); await rejectedMissing;
    expect(missing.doc.querySelector('[aria-hidden="true"]')).toBeNull();
  } finally { vi.useRealTimers(); }
});

it('rejects stale article bindings and a PDF.js surface without coordinate transforms', async () => {
  const wrong = fixture({ itemID: 999, resolvedItemID: 22 });
  expect(() => wrong.start()).toThrow(/no longer matches/u);

  const unsupported = fixture();
  const frame = unsupported.reader._internalReader!._primaryView!._iframeWindow as unknown as { PDFViewerApplication: { pdfViewer: { _pages: Array<{ viewport: object }> } } };
  frame.PDFViewerApplication.pdfViewer._pages[0]!.viewport = {};
  const pending = unsupported.start();
  unsupported.pointer('pointerdown', 210, 820, unsupported.pages[0]!.div);
  await expect(pending).rejects.toMatchObject({ code: 'UNSUPPORTED_INTERACTION' });
});

it('keeps the frozen identity independent from later caller mutation', async () => {
  const f = fixture({ conversion: 'identity' }); const pending = f.start();
  f.pointer('pointerdown', 10, 40, f.pages[0]!.div); f.pointer('pointerup', 40, 80, f.pages[0]!.div);
  const selection = await pending;
  (selection.paper as { attachmentKey: string }).attachmentKey = 'OTHERPDF';
  expect(paperA.attachmentKey).not.toBe('OTHERPDF');
});
