import { ReaderError, type DocumentRevision, type PaperScope, type Rect } from '../../../contracts/src/index.ts';
import type { FigureRegionSelection } from '../../../contracts/src/workspace.ts';
import type { HostReader, ZoteroHost } from './host-types.ts';

const MIN_REGION_POINTS = 6;

/** One Figure selection/model request per attachment until its task proposal settles. */
export function createFigureRequestGate() {
  const active = new Set<string>();
  return {
    async run<T>(attachment: string, work: () => Promise<T>): Promise<T> {
      if (active.has(attachment)) throw new ReaderError('BUSY', 'A Figure request is already in progress for this PDF.');
      active.add(attachment);
      try { return await work(); }
      finally { active.delete(attachment); }
    },
  };
}

interface PDFViewport {
  viewBox?: readonly number[];
  width?: number;
  height?: number;
  scale?: number;
  rotation?: number;
  convertToPdfPoint(x: number, y: number): [number, number];
}
interface PDFPageView { id?: number; div: HTMLElement; viewport: PDFViewport }
interface PDFSelectionApplication {
  pdfDocument?: { numPages?: number };
  pdfViewer?: { _pages?: PDFPageView[] };
}
interface ReaderFrame { document?: Document; PDFViewerApplication?: PDFSelectionApplication }

export interface FigureSelectionOptions {
  zotero: Pick<ZoteroHost, 'Items'>;
  reader: HostReader;
  paper: PaperScope;
  revision: DocumentRevision;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Gecko's `Cu.waiveXrays`, injected only for the confirmed PDF.js window objects. */
  waiveXrays?: <T extends object>(value: T) => T;
}

function invalid(message: string, code: 'INVALID_REQUEST' | 'UNSUPPORTED_INTERACTION' | 'NOT_FOUND' = 'INVALID_REQUEST'): never {
  throw new ReaderError(code, message);
}

function samePaper(zotero: Pick<ZoteroHost, 'Items'>, reader: HostReader, paper: PaperScope): void {
  if (!paper || typeof paper.clientId !== 'string' || !Number.isSafeInteger(paper.libraryId) || paper.libraryId < 1 || !/^[A-Z0-9]{8}$/u.test(paper.attachmentKey)) invalid('The selected figure is not bound to a valid Zotero PDF.', 'INVALID_REQUEST');
  const item = zotero.Items.getByLibraryAndKey?.(paper.libraryId, paper.attachmentKey);
  if (!item || item.id !== reader.itemID || item.libraryID !== paper.libraryId || item.key !== paper.attachmentKey) invalid('The active Reader no longer matches the selected paper.', 'NOT_FOUND');
}

function pdfSelectionFrame(reader: HostReader, waive: <T extends object>(value: T) => T): { doc: Document; app: PDFSelectionApplication; pages: PDFPageView[] } {
  const view = reader._internalReader?._primaryView ?? reader._internalReader?._lastView;
  const wrapped = view?._iframeWindow;
  if (!wrapped) invalid('The active Reader does not expose a PDF selection surface.', 'UNSUPPORTED_INTERACTION');
  const frame = wrapped as unknown as ReaderFrame;
  const app = frame.PDFViewerApplication;
  const viewer = app?.pdfViewer ? waive(app.pdfViewer) : undefined;
  const pages = viewer?._pages ? waive(viewer._pages) : undefined;
  const pdf = app?.pdfDocument;
  if (!frame.document || !pdf || !Number.isSafeInteger(pdf.numPages) || !Array.isArray(pages) || !pages.length) invalid('The active Reader PDF selection surface is unavailable.', 'UNSUPPORTED_INTERACTION');
  return { doc: frame.document, app: { pdfDocument: pdf, ...(viewer ? { pdfViewer: viewer } : {}) }, pages };
}

function pageForNode(pages: readonly PDFPageView[], target: EventTarget | null): PDFPageView | undefined {
  if (!target || typeof target !== 'object' || !('nodeType' in target)) return undefined;
  const node = target as Node;
  return pages.find(page => page.div === node || page.div.contains(node));
}

function pageAtPoint(pages: readonly PDFPageView[], x: number, y: number): PDFPageView | undefined {
  const matches = pages.filter(page => {
    const bounds = page.div.getBoundingClientRect();
    return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
  });
  return matches.length === 1 ? matches[0] : undefined;
}

function pageIndex(page: PDFPageView, pages: readonly PDFPageView[], pageCount: number): number {
  const index = Number.isSafeInteger(page.id) ? page.id! - 1 : pages.indexOf(page);
  if (!Number.isSafeInteger(index) || index < 0 || index >= pageCount || pages[index] !== page) invalid('The PDF page identity is ambiguous.', 'UNSUPPORTED_INTERACTION');
  return index;
}

function pdfPoint(page: PDFPageView, event: PointerEvent): [number, number] {
  if (typeof page.viewport?.convertToPdfPoint !== 'function') invalid('The active PDF page cannot convert selections to PDF coordinates.', 'UNSUPPORTED_INTERACTION');
  const bounds = page.div.getBoundingClientRect();
  const localX = event.clientX - bounds.left; const localY = event.clientY - bounds.top;
  const point = page.viewport.convertToPdfPoint(localX, localY);
  if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) invalid('The PDF could not map this selection to page coordinates.', 'UNSUPPORTED_INTERACTION');
  return [point[0], point[1]];
}

function selectedRect(page: PDFPageView, start: [number, number], end: [number, number]): Rect {
  const bounds = page.viewport.viewBox;
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)) invalid('The selected PDF page has no reliable coordinate bounds.', 'UNSUPPORTED_INTERACTION');
  const rect: Rect = [Math.min(start[0], end[0]), Math.min(start[1], end[1]), Math.max(start[0], end[0]), Math.max(start[1], end[1])];
  if (rect[2] - rect[0] < MIN_REGION_POINTS || rect[3] - rect[1] < MIN_REGION_POINTS) invalid('Drag around a larger figure region on one PDF page.');
  if (rect.some(value => Math.abs(value) >= 1_000_000)) invalid('The selected figure is outside the supported PDF coordinate range.');
  if (rect[0] < bounds[0]! || rect[1] < bounds[1]! || rect[2] > bounds[2]! || rect[3] > bounds[3]!) invalid('Keep the figure selection inside one PDF page.');
  return rect;
}

/**
 * Wait for one explicit drag on the active PDF page and freeze its PDF-space rectangle.
 * The temporary overlay and event handlers are always removed on success, cancellation, or failure.
 */
export function selectFigureRegion(options: FigureSelectionOptions): Promise<FigureRegionSelection> {
  const { zotero, reader, signal } = options;
  const paper = { ...options.paper };
  const revision = { ...options.revision };
  samePaper(zotero, reader, paper);
  if (!revision || typeof revision.fingerprint !== 'string' || !revision.fingerprint || !Number.isSafeInteger(revision.size) || revision.size < 0 || !Number.isFinite(revision.modifiedAt)) invalid('A current PDF revision is required before selecting a figure.');
  if (signal?.aborted) return Promise.reject(new ReaderError('INVALID_REQUEST', 'Figure selection was cancelled.'));
  const waive = options.waiveXrays ?? (<T extends object>(value: T) => value);
  const { doc, app, pages } = pdfSelectionFrame(reader, waive);
  const pageCount = app.pdfDocument!.numPages!;
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) invalid('The figure selection timeout is invalid.');

  return new Promise((resolve, reject) => {
    let start: [number, number] | undefined;
    let startLocal: [number, number] | undefined;
    let startPage: PDFPageView | undefined;
    let startViewport: PDFViewport | undefined;
    let startDimensions: [number, number] | undefined;
    let startIndex = -1;
    let pointerId: number | undefined;
    let overlay: HTMLElement | undefined;
    const timerHolder: { timeout?: ReturnType<typeof setTimeout> } = {};
    let settled = false;

    const cleanup = () => {
      doc.removeEventListener('pointerdown', onDown, true);
      doc.removeEventListener('pointermove', onMove, true);
      doc.removeEventListener('pointerup', onUp, true);
      doc.removeEventListener('pointercancel', onCancel, true);
      doc.removeEventListener('keydown', onKey, true);
      signal?.removeEventListener('abort', onAbort);
      if (timerHolder.timeout !== undefined) clearTimeout(timerHolder.timeout);
      overlay?.remove(); overlay = undefined;
    };
    const finish = (error?: Error, selection?: FigureRegionSelection) => {
      if (settled) return;
      settled = true; cleanup();
      if (error) reject(error);
      else if (selection) resolve(selection);
      else reject(new ReaderError('INVALID_REQUEST', 'No figure region was selected.'));
    };
    const consume = (event: Event) => { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); };
    const onAbort = () => finish(new ReaderError('INVALID_REQUEST', 'Figure selection was cancelled.'));
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { consume(event); finish(new ReaderError('INVALID_REQUEST', 'Figure selection was cancelled.')); } };
    const onDown = (event: Event) => {
      if (start || !('button' in event)) return;
      const pointer = event as PointerEvent;
      if (pointer.button !== 0 || pointer.isPrimary === false || pointer.pointerType === 'touch') return;
      const page = pageForNode(pages, pointer.target);
      if (!page) return;
      try {
        startPage = page; startViewport = page.viewport; startIndex = pageIndex(page, pages, pageCount); start = pdfPoint(page, pointer); startLocal = localPoint(page, pointer);
        const bounds = page.div.getBoundingClientRect(); startDimensions = [bounds.width, bounds.height]; pointerId = pointer.pointerId;
      } catch (error) { finish(error instanceof Error ? error : new ReaderError('UNSUPPORTED_INTERACTION', 'This Reader selection is unsupported.')); return; }
      consume(pointer);
      overlay = doc.createElement('div'); overlay.setAttribute('aria-hidden', 'true');
      Object.assign(overlay.style, { position: 'fixed', pointerEvents: 'none', zIndex: '99999', border: '2px solid #7c5cff', background: 'rgba(124,92,255,.16)', boxSizing: 'border-box' });
      doc.body.append(overlay);
    };
    const onMove = (event: Event) => {
      if (!start || !startPage || !startLocal || !overlay || !('pointerId' in event) || (event as PointerEvent).pointerId !== pointerId) return;
      const pointer = event as PointerEvent; consume(pointer);
      const bounds = startPage.div.getBoundingClientRect();
      const x = Math.max(0, Math.min(bounds.width, pointer.clientX - bounds.left));
      const y = Math.max(0, Math.min(bounds.height, pointer.clientY - bounds.top));
      // Keep overlay geometry in client CSS pixels; PDF geometry is independently transformed below.
      overlay.style.left = `${bounds.left + Math.min(startLocal[0], x)}px`; overlay.style.top = `${bounds.top + Math.min(startLocal[1], y)}px`;
      overlay.style.width = `${Math.abs(x - startLocal[0])}px`; overlay.style.height = `${Math.abs(y - startLocal[1])}px`;
    };
    const onUp = (event: Event) => {
      if (!start || !startPage || !startViewport || !startDimensions || !('pointerId' in event) || (event as PointerEvent).pointerId !== pointerId) return;
      const pointer = event as PointerEvent; consume(pointer);
      const endPage = pageAtPoint(pages, pointer.clientX, pointer.clientY);
      if (endPage !== startPage) { finish(new ReaderError('UNSUPPORTED_INTERACTION', 'A figure selection must stay on one PDF page.')); return; }
      const bounds = startPage.div.getBoundingClientRect();
      if (startPage.viewport !== startViewport || bounds.width !== startDimensions[0] || bounds.height !== startDimensions[1]) { finish(new ReaderError('UNSUPPORTED_INTERACTION', 'The PDF page changed while selecting. Select the figure again.')); return; }
      try {
        const end = pdfPoint(startPage, pointer);
        const rect = selectedRect(startPage, start, end);
        finish(undefined, { paper: { ...paper }, revision: { ...revision }, pageIndex: startIndex, rect: [...rect] });
      } catch (error) { finish(error instanceof Error ? error : new ReaderError('INVALID_REQUEST', 'The figure selection is invalid.')); }
    };
    const onCancel = (event: Event) => { if (start && 'pointerId' in event && (event as PointerEvent).pointerId === pointerId) finish(new ReaderError('INVALID_REQUEST', 'Figure selection was cancelled.')); };
    doc.addEventListener('pointerdown', onDown, true);
    doc.addEventListener('pointermove', onMove, true);
    doc.addEventListener('pointerup', onUp, true);
    doc.addEventListener('pointercancel', onCancel, true);
    doc.addEventListener('keydown', onKey, true);
    signal?.addEventListener('abort', onAbort, { once: true });
    timerHolder.timeout = setTimeout(() => finish(new ReaderError('INVALID_REQUEST', 'No figure region was selected before the selection expired.')), timeoutMs);
  });
}

function localPoint(page: PDFPageView, event: PointerEvent): [number, number] {
  const bounds = page.div.getBoundingClientRect();
  return [event.clientX - bounds.left, event.clientY - bounds.top];
}
