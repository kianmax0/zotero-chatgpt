import { Window } from 'happy-dom';
import { expect, it, vi } from 'vitest';
import { NativeReaderPane } from '../../../packages/zotero/src/reader/reader-pane.ts';
import type { HostReader, ZoteroHost, ZoteroWindow } from '../../../packages/zotero/src/reader/host-types.ts';
it('resizes the open dock from the keyboard through the layout controller and persists the width', async () => {
  const main = new Window({ url: 'https://zotero.test/' });
  const readerWin = new Window({ url: 'https://reader.test/' });
  const mainDoc = main.document as unknown as Document;
  const readerDoc = readerWin.document as unknown as Document;
  mainDoc.body.innerHTML = '<div id="zotero-context-pane"></div>';
  readerDoc.body.innerHTML = '<div id="reader-ui"><div class="toolbar"><button class="find">Find</button></div></div><div id="split-view"><div id="primary-view"></div></div>';
  const context = { collapsed: false, context: { mode: 'notes' as 'notes' | 'item' }, width: 280 };
  const remembered: number[] = [];
  const win = {
    document: mainDoc,
    ZoteroContextPane: context,
    Zotero_Tabs: { selectedID: 'pdf-a' },
    setTimeout: (callback: () => void) => { callback(); return 0; },
    clearTimeout() {},
    requestAnimationFrame: (callback: FrameRequestCallback) => { callback(0); return 0; },
    cancelAnimationFrame() {},
    addEventListener() {},
    removeEventListener() {},
    innerWidth: 1440,
    ResizeObserver: class { observe() {} disconnect() {} },
  } as unknown as ZoteroWindow;
  const reader = {
    itemID: 7, tabID: 'pdf-a', type: 'pdf', _window: win, _iframeWindow: readerWin,
    zoomPageWidth() {}, zoomPageHeight() {}, zoomAuto() {}, navigate() {},
  } as unknown as HostReader;
  const zotero = {
    Prefs: {
      get: (key: string) => key === 'layout' ? 'standard' : 360,
      set: (key: string, value: number) => { if (key === 'extensions.zchatgpt.sidebarWidth') remembered.push(value); },
    },
    Items: { get: () => ({ key: 'PDFONE01', libraryID: 1, getField: () => 'Synthetic paper' }) },
  } as unknown as ZoteroHost;
  const pane = new NativeReaderPane(zotero, reader, new Set(), () => undefined);
  await pane.controller.toggle();
  const dock = readerDoc.querySelector<HTMLElement>('[data-zchatgpt-dock]')!;
  const resizer = dock.querySelector<HTMLElement>('[data-zchatgpt-resizer]')!;
  expect(dock.style.width).toBe('360px');
  expect(resizer.getAttribute('role')).toBe('separator');

  const event = new (readerDoc.defaultView!.KeyboardEvent)('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
  resizer.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  await vi.waitFor(() => expect(dock.style.width).toBe('376px'));
  expect(remembered).toEqual([376]);
  expect(resizer.getAttribute('aria-valuenow')).toBe('376');
  pane.controller.close();
});
it('keeps chat ownership across tab switches and only closes for a native pane action on the selected reader', async () => {
  const context = { collapsed: false, context: { mode: 'item' as 'item' | 'notes' } };
  const tabs = { selectedID: 'pdf-a' };
  const win = { ZoteroContextPane: context, Zotero_Tabs: tabs, requestAnimationFrame: () => 0 } as unknown as ZoteroWindow;
  const reader: HostReader = {
    itemID: 1, tabID: 'pdf-a', type: 'pdf', _window: win,
    zoomPageWidth() {}, zoomPageHeight() {}, zoomAuto() {}, navigate() {},
  };
  const pane = new NativeReaderPane({ Prefs: { get: () => 'standard' } } as unknown as ZoteroHost, reader, new Set(), () => undefined);
  const mount = vi.spyOn(pane, 'mountChat').mockResolvedValue(true);
  const unmount = vi.spyOn(pane, 'unmountChat');
  vi.spyOn(pane, 'captureDock').mockReturnValue({ collapsed: false, mode: 'item', scrollTop: 0, width: 280 });
  vi.spyOn(pane, 'restoreDock').mockImplementation(() => {});
  await pane.controller.toggle();
  expect(pane.controller.active).toBe(true);
  mount.mockClear(); unmount.mockClear();
  tabs.selectedID = 'pdf-b';
  pane.reconcile();
  expect(pane.controller.active).toBe(true);
  expect(unmount).toHaveBeenCalled();
  expect(mount).not.toHaveBeenCalled();
  tabs.selectedID = 'pdf-a';
  pane.reconcile();
  expect(pane.controller.active).toBe(true);
  expect(mount).toHaveBeenCalled();
  context.collapsed = false;
  pane.reconcile();
  expect(pane.controller.active).toBe(false);
});
it('treats a repeated or post-disposal close as a no-op', async () => {
  const context = { collapsed: false, context: { mode: 'item' as 'item' | 'notes' } };
  const win = { ZoteroContextPane: context, Zotero_Tabs: { selectedID: 'pdf-a' }, requestAnimationFrame: () => 0 } as unknown as ZoteroWindow;
  const reader: HostReader = {
    itemID: 1, tabID: 'pdf-a', type: 'pdf', _window: win,
    zoomPageWidth() {}, zoomPageHeight() {}, zoomAuto() {}, navigate() {},
  };
  const pane = new NativeReaderPane({ Prefs: { get: () => 'standard' } } as unknown as ZoteroHost, reader, new Set(), () => undefined);
  const capture = vi.spyOn(pane, 'capturePosition');
  const unmount = vi.spyOn(pane, 'unmountChat');
  const restore = vi.spyOn(pane, 'restoreDock').mockImplementation(() => {});
  vi.spyOn(pane, 'captureDock').mockReturnValue({ collapsed: false, mode: 'item', scrollTop: 0, width: 280 });
  vi.spyOn(pane, 'mountChat').mockResolvedValue(true);
  await pane.controller.toggle();
  expect(pane.controller.active).toBe(true);
  capture.mockClear(); unmount.mockClear(); restore.mockClear();
  // The first close performs the real teardown once.
  pane.controller.close();
  expect(capture).toHaveBeenCalledTimes(1);
  expect(unmount).toHaveBeenCalledTimes(1);
  expect(restore).toHaveBeenCalledTimes(1);
  expect(pane.controller.active).toBe(false);
  capture.mockClear(); unmount.mockClear(); restore.mockClear();
  // A second close on the already-collapsed dock must not capture, unmount or restore anything again.
  pane.controller.close();
  expect(pane.controller.active).toBe(false);
  expect(capture).not.toHaveBeenCalled();
  expect(unmount).not.toHaveBeenCalled();
  expect(restore).not.toHaveBeenCalled();
  // Close during teardown: `dispose()` closes (here a no-op, already collapsed) and a further close
  // after disposal stays a no-op as well rather than touching the host.
  pane.controller.dispose();
  pane.controller.close();
  expect(pane.controller.active).toBe(false);
  expect(capture).not.toHaveBeenCalled();
  expect(unmount).not.toHaveBeenCalled();
  expect(restore).not.toHaveBeenCalled();
});
it('closes exactly once when the pane is disposed while the dock is still open', async () => {
  const context = { collapsed: false, context: { mode: 'item' as 'item' | 'notes' } };
  const win = { ZoteroContextPane: context, Zotero_Tabs: { selectedID: 'pdf-a' }, requestAnimationFrame: () => 0 } as unknown as ZoteroWindow;
  const reader: HostReader = {
    itemID: 1, tabID: 'pdf-a', type: 'pdf', _window: win,
    zoomPageWidth() {}, zoomPageHeight() {}, zoomAuto() {}, navigate() {},
  };
  const pane = new NativeReaderPane({ Prefs: { get: () => 'standard' } } as unknown as ZoteroHost, reader, new Set(), () => undefined);
  const capture = vi.spyOn(pane, 'capturePosition');
  const unmount = vi.spyOn(pane, 'unmountChat');
  vi.spyOn(pane, 'restoreDock').mockImplementation(() => {});
  vi.spyOn(pane, 'captureDock').mockReturnValue({ collapsed: false, mode: 'item', scrollTop: 0, width: 280 });
  vi.spyOn(pane, 'mountChat').mockResolvedValue(true);
  await pane.controller.toggle();
  expect(pane.controller.active).toBe(true);
  capture.mockClear(); unmount.mockClear();
  // Teardown while open closes the dock through the same single path.
  pane.controller.dispose();
  expect(pane.controller.active).toBe(false);
  expect(capture).toHaveBeenCalledTimes(1);
  expect(unmount).toHaveBeenCalledTimes(1);
  // A close arriving after that disposal does not repeat the teardown.
  pane.controller.close();
  expect(capture).toHaveBeenCalledTimes(1);
  expect(unmount).toHaveBeenCalledTimes(1);
});
it('restores fixed scale across rapid reopen when Zotero ignores destination zoom', async () => {
  const frames: FrameRequestCallback[] = [];
  const location = { pageNumber: 3, left: 12, top: 190, scale: 125 as string | number };
  const win = { ZoteroContextPane: { collapsed: true, context: { mode: 'item' } }, requestAnimationFrame: (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; } } as ZoteroWindow;
  const scales: number[] = [];
  const pdfViewer = { _location: location,
    get currentScale() { return typeof location.scale === 'number' ? location.scale / 100 : 1; },
    set currentScale(value: number) { location.scale = value * 100; },
    set currentScaleValue(value: number) { scales.push(value); location.scale = value * 100; },
    scrollPageIntoView: ({ pageNumber }: { pageNumber: number }) => { location.pageNumber = pageNumber; },
  };
  const reader: HostReader = {
    itemID: 42, tabID: 'pdf-tab', type: 'pdf', _window: win,
    _internalReader: { _lastView: { _iframeWindow: { PDFViewerApplication: { pdfViewer } } } },
    zoomPageWidth: () => { location.scale = 'page-width'; }, zoomPageHeight: () => { location.scale = 'page-fit'; }, zoomAuto: () => { location.scale = 'auto'; },
    // Zotero sets ignoreDestinationZoom=true, so navigation cannot change scale.
    navigate: ({ dest }) => { location.pageNumber = dest![0] + 1; },
  };
  const pane = new NativeReaderPane({} as ZoteroHost, reader, new Set(), () => undefined);
  vi.spyOn(pane, 'captureDock').mockReturnValue({ collapsed: true, mode: 'item', scrollTop: 0, width: 280 });
  vi.spyOn(pane, 'restoreDock').mockImplementation(() => {});
  vi.spyOn(pane, 'mountChat').mockResolvedValue(true);
  const flushFrames = () => { for (const callback of frames.splice(0)) callback(0); };
  await pane.controller.toggle(); flushFrames();
  expect(location.scale).toBe('page-width');
  pane.controller.close();
  await pane.controller.toggle();
  flushFrames();
  expect(location.scale).toBe('page-width');
  pane.controller.close(); flushFrames();
  expect(location.scale).toBe(125);
  expect(scales).toEqual([1.25]);
});
it('restores the current page without delayed link-navigation focus from the opening page', async () => {
  const frames: FrameRequestCallback[] = [];
  const location = { pageNumber: 1, left: -11, top: 600, scale: 210 as string | number };
  const textLayerFocus: (() => void)[] = [];
  const operations: string[] = [];
  const win = { ZoteroContextPane: { collapsed: true, context: { mode: 'item' } }, requestAnimationFrame: (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; } } as ZoteroWindow;
  const viewer = { _location: location,
    get currentScale() { return typeof location.scale === 'number' ? location.scale / 100 : 1; },
    set currentScale(value: number) { location.scale = value * 100; },
    set currentScaleValue(value: number) {
      operations.push('scale'); location.scale = value * 100;
      // A scale change renders old pages again. Link-service destinations left
      // textlayerrendered callbacks that can focus and scroll the opening page.
      for (const focus of textLayerFocus.splice(0)) frames.push(() => focus());
    },
    scrollPageIntoView: ({ pageNumber, destArray, allowNegativeOffset }: { pageNumber: number; destArray: [number, { name: string }, number, number, null]; allowNegativeOffset: boolean }) => {
      operations.push('anchor'); location.pageNumber = pageNumber;
      location.left = allowNegativeOffset ? destArray[2] : Math.max(0, destArray[2]); location.top = destArray[3];
    },
  };
  const reader: HostReader = {
    itemID: 42, tabID: 'pdf-tab', type: 'pdf', _window: win,
    _internalReader: { _lastView: { _iframeWindow: { PDFViewerApplication: { pdfViewer: viewer } } } },
    zoomPageWidth: () => { location.scale = 'page-width'; }, zoomPageHeight: () => {}, zoomAuto: () => {},
    navigate: ({ dest }) => { location.pageNumber = dest![0] + 1; textLayerFocus.push(() => { location.pageNumber = dest![0] + 1; }); },
  };
  const pane = new NativeReaderPane({} as ZoteroHost, reader, new Set(), () => undefined);
  vi.spyOn(pane, 'captureDock').mockReturnValue({ collapsed: true, mode: 'item', scrollTop: 0, width: 280 });
  vi.spyOn(pane, 'restoreDock').mockImplementation(() => {});
  vi.spyOn(pane, 'mountChat').mockResolvedValue(true);
  const flushFrames = () => { for (const callback of frames.splice(0)) callback(0); };
  await pane.controller.toggle(); flushFrames();
  location.pageNumber = 2; location.top = 651;
  operations.length = 0;
  pane.controller.close(); flushFrames(); flushFrames();
  expect(location).toEqual({ pageNumber: 2, left: -11, top: 651, scale: 210 });
  expect(operations).toEqual(['scale', 'anchor']);
  expect(textLayerFocus).toHaveLength(0);
});
it('keeps the page a programmatic jump moved to while the viewer location still lags it', async () => {
  // pdf.js applies a jump's scroll and sets `currentPageNumber` synchronously (`#scrollIntoView`),
  // but only derives `_location` from the visible page when the scroll-driven `update()` runs on
  // the next frame. Host evidence: resource/reader/pdf/web/viewer.mjs `_setCurrentPageNumber` /
  // `#scrollIntoView` versus `_scrollUpdate()` / `_updateLocation()`.
  const PAGE_HEIGHT = 800;
  const frames: FrameRequestCallback[] = [];
  let appliedPage = 1; // the scroll offset a programmatic jump already applied
  let currentPageNumber = 1;
  const location = { pageNumber: 1, left: -11, top: 600, scale: 210 as string | number };
  const win = { ZoteroContextPane: { collapsed: true, context: { mode: 'item' } }, requestAnimationFrame: (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; } } as ZoteroWindow;
  const viewer = {
    _location: location,
    get currentPageNumber() { return currentPageNumber; },
    get currentScale() { return typeof location.scale === 'number' ? location.scale / 100 : 1; },
    set currentScale(value: number) { location.scale = value * 100; },
    get currentScaleValue() { return location.scale; },
    set currentScaleValue(value: number | string) { location.scale = typeof value === 'number' ? value * 100 : value; },
    scrollPageIntoView: ({ pageNumber }: { pageNumber: number }) => {
      currentPageNumber = pageNumber; appliedPage = pageNumber;
      frames.push(() => { currentPageNumber = appliedPage; location.pageNumber = appliedPage; location.top = (appliedPage - 1) * PAGE_HEIGHT; });
    },
  };
  const reader: HostReader = {
    itemID: 42, tabID: 'pdf-tab', type: 'pdf', _window: win,
    _internalReader: { _lastView: { _iframeWindow: { PDFViewerApplication: { pdfViewer: viewer } } } },
    zoomPageWidth: () => { location.scale = 'page-width'; }, zoomPageHeight: () => {}, zoomAuto: () => {},
    navigate: () => {},
  };
  const pane = new NativeReaderPane({} as ZoteroHost, reader, new Set(), () => undefined);
  vi.spyOn(pane, 'captureDock').mockReturnValue({ collapsed: true, mode: 'item', scrollTop: 0, width: 280 });
  vi.spyOn(pane, 'restoreDock').mockImplementation(() => {});
  vi.spyOn(pane, 'mountChat').mockResolvedValue(true);
  const flushFrames = () => { for (let guard = 0; frames.length && guard < 10; guard++) for (const callback of frames.splice(0)) callback(0); };
  await pane.controller.toggle(); flushFrames();
  // The jump is applied, but the scroll-driven `update()` has not refreshed `_location` yet.
  location.pageNumber = 1; location.top = 600;
  viewer.scrollPageIntoView({ pageNumber: 2 });
  expect(viewer.currentPageNumber).toBe(2);
  expect(location.pageNumber).toBe(1);
  expect(pane.capturePosition()?.anchor.pageIndex).toBe(1);
  pane.controller.close();
  flushFrames();
  expect(location.pageNumber).toBe(2);
  expect(viewer.currentPageNumber).toBe(2);
});
