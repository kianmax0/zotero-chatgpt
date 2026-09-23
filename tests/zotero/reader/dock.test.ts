import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Window } from 'happy-dom';
import { expect, it, vi } from 'vitest';
import { renderReaderShell } from '../../../packages/zotero/src/chat/view.ts';
import { applyDockWidth, bindDockResize, injectReaderStyles, mountReaderDock, unmountReaderDock } from '../../../packages/zotero/src/reader/dock.ts';
import { MIN_SIDEBAR_WIDTH } from '../../../packages/zotero/src/reader/layout.ts';
import { NativeReaderPane } from '../../../packages/zotero/src/reader/reader-pane.ts';
import type { HostReader, ZoteroHost, ZoteroWindow } from '../../../packages/zotero/src/reader/host-types.ts';

function readerDocument(): Document {
  const win = new Window({ url: 'https://reader.test/' });
  const doc = win.document as unknown as Document;
  doc.body.innerHTML = [
    '<div id="reader-ui"><div class="toolbar"><button class="find">Find</button></div></div>',
    '<div id="split-view"><div id="primary-view" class="primary-view"></div><div id="secondary-view" class="secondary-view"></div></div>',
    '<div id="zotero-context-pane"><item-details class="zchatgpt-chat-active"><item-pane-custom-section data-zchatgpt-section data-pane="codex-reader"><div data-type="body"></div></item-pane-custom-section></item-details></div>',
  ].join('');
  return doc;
}

it('mounts the chat dock inside reader content below the toolbar, not in a context-pane header', () => {
  const doc = readerDocument();
  const toolbar = doc.querySelector('.toolbar')!;
  const split = doc.getElementById('split-view')!;
  const context = doc.getElementById('zotero-context-pane')!;
  const mounted = mountReaderDock(doc);
  expect(mounted).toBeTruthy();
  const { dock, body } = mounted!;
  const sidebar = renderReaderShell(body, { title: 'Paper', key: 'PDFONE01', libraryID: 1 });
  expect(split.contains(dock)).toBe(true);
  expect(split.contains(sidebar)).toBe(true);
  expect(split.classList.contains('zchatgpt-dock-open')).toBe(true);
  expect(toolbar.contains(dock)).toBe(false);
  expect(context.contains(dock)).toBe(false);
  expect(context.contains(sidebar)).toBe(false);
  expect(doc.querySelector('#reader-ui .zchatgpt-chrome, .toolbar .zchatgpt-chrome')).toBeNull();
  expect(sidebar.classList.contains('zchatgpt-paper')).toBe(true);
  expect(dock.classList.contains('zchatgpt-paper')).toBe(true);
  expect(dock.parentElement?.id).toBe('split-view');
  expect(toolbar.closest('#split-view')).toBeNull();
  expect(toolbar.compareDocumentPosition(dock) & 4).toBe(4);
});

it('shrinks the PDF column with a real remaining width instead of covering the page', () => {
  const doc = readerDocument();
  const split = doc.getElementById('split-view') as HTMLElement;
  const primary = doc.getElementById('primary-view') as HTMLElement;
  Object.defineProperty(split, 'clientWidth', { configurable: true, get: () => 1440 });
  const mounted = mountReaderDock(doc)!;
  applyDockWidth(doc, 400);
  expect(mounted.dock.style.display).toBe('flex');
  expect(mounted.dock.style.flexGrow).toBe('0');
  expect(mounted.dock.style.flexShrink).toBe('0');
  expect(mounted.dock.style.flexBasis).toBe('400px');
  expect(mounted.dock.style.width).toBe('400px');
  expect(mounted.dock.style.minWidth).toBe(`${MIN_SIDEBAR_WIDTH}px`);
  expect(Number.parseFloat(mounted.dock.style.minWidth)).toBeLessThan(400);
  expect(mounted.dock.style.height).toBe('100%');
  expect(doc.documentElement.style.getPropertyValue('--zchatgpt-dock-width')).toBe('400px');
  expect(split.classList.contains('zchatgpt-dock-open')).toBe(true);
  expect(split.contains(mounted.dock)).toBe(true);
  expect(primary.style.transform).toBe('');
  expect(primary.style.zoom).toBe('');
  unmountReaderDock(doc);
  expect(doc.querySelector('[data-zchatgpt-dock]')).toBeNull();
  expect(split.classList.contains('zchatgpt-dock-open')).toBe(false);
  expect(doc.documentElement.style.getPropertyValue('--zchatgpt-dock-width')).toBe('');
});

it('opens NativeReaderPane chat in the reader iframe column and hides the ItemPane Codex section', async () => {
  const main = new Window({ url: 'https://zotero.test/' });
  const readerWin = new Window({ url: 'https://reader.test/' });
  const mainDoc = main.document as unknown as Document;
  const readerDoc = readerWin.document as unknown as Document;
  mainDoc.body.innerHTML = '<div id="zotero-context-pane" width="280"></div><div id="zotero-context-splitter"></div>';
  readerDoc.body.innerHTML = '<div id="reader-ui"><div class="toolbar"><button class="find">Find</button></div></div><div id="split-view"><div id="primary-view" class="primary-view"></div></div>';
  const context = { collapsed: false, context: { mode: 'notes' as 'notes' | 'item' }, width: 280 };
  const win = {
    document: mainDoc,
    ZoteroContextPane: context,
    Zotero_Tabs: { selectedID: 'pdf-a' },
    setTimeout: (callback: () => void) => { callback(); return 0; },
    requestAnimationFrame: (callback: FrameRequestCallback) => { callback(0); return 0; },
    addEventListener() {},
    removeEventListener() {},
    innerWidth: 1440,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  } as unknown as ZoteroWindow;
  const reader = {
    itemID: 7, tabID: 'pdf-a', type: 'pdf', _window: win,
    _iframeWindow: readerWin,
    zoomPageWidth() {}, zoomPageHeight() {}, zoomAuto() {}, navigate() {},
  } as unknown as HostReader;
  const zotero = {
    Prefs: { get: (key: string) => key === 'layout' ? 'standard' : 360, set() {} },
    Items: { get: () => ({ key: 'PDFONE01', libraryID: 1, getField: () => 'Synthetic paper' }) },
  } as unknown as ZoteroHost;
  const pane = new NativeReaderPane(zotero, reader, new Set(), (body, identity) => { renderReaderShell(body, identity); });
  await pane.controller.toggle();
  const dock = readerDoc.querySelector('[data-zchatgpt-dock]');
  const sidebar = readerDoc.querySelector('[data-zchatgpt-sidebar]');
  const toolbar = readerDoc.querySelector('.toolbar')!;
  expect(context.collapsed).toBe(true);
  expect(readerDoc.querySelector('[data-zchatgpt-sidebar-css]')?.textContent).toMatch(/writing-mode:\s*horizontal-tb/u);
  expect(mainDoc.querySelector('[data-zchatgpt-sidebar-css]')).toBeNull();
  expect(readerDoc.getElementById('split-view')?.contains(dock)).toBe(true);
  expect(readerDoc.getElementById('split-view')?.contains(sidebar)).toBe(true);
  expect(toolbar.contains(sidebar)).toBe(false);
  expect(mainDoc.querySelector('#zotero-context-pane [data-zchatgpt-sidebar]')).toBeNull();
  expect(mainDoc.querySelector('item-details.zchatgpt-chat-active')).toBeNull();
  expect(sidebar?.classList.contains('zchatgpt-paper')).toBe(true);
  pane.controller.close();
  expect(readerDoc.querySelector('[data-zchatgpt-dock]')).toBeNull();
  expect(context.collapsed).toBe(false);
  expect(context.context.mode).toBe('notes');
});

it('paints sidebar chrome with the reader paper background, not grey sidepane fill', () => {
  const css = readFileSync(resolve(import.meta.dirname, '../../../packages/zotero/assets/sidebar.css'), 'utf8');
  expect(css).toMatch(/\.zchatgpt-paper[\s\S]*--material-background/u);
  expect(css).not.toMatch(/\.zchatgpt-paper[\s\S]{0,200}--material-sidepane/u);
  expect(css).toMatch(/#split-view\s*>\s*\.zchatgpt-dock|#split-view \.zchatgpt-dock/u);
  expect(css).toMatch(/#split-view\.zchatgpt-dock-open[\s\S]{0,120}flex-direction:\s*row/u);
  expect(css).toMatch(/#split-view\.zchatgpt-dock-open \.primary-view[\s\S]{0,80}min-width:\s*0/u);
});

it('refreshes the injected reader stylesheet so an upgraded bundle cannot style new markup with old CSS', () => {
  const doc = readerDocument();
  // A reader document outlives one add-on version: it still holds the text the previous bundle put
  // there. Reloading the plugin re-renders the sidebar from the new bundle against exactly this.
  const stale = doc.createElement('style');
  stale.setAttribute('data-zchatgpt-sidebar-css', '');
  stale.textContent = '.zchatgpt-previous-build-only { color: red; }';
  doc.head.append(stale);
  injectReaderStyles(doc, {});
  const sheets = [...doc.querySelectorAll('style[data-zchatgpt-sidebar-css]')];
  expect(sheets).toHaveLength(1);
  expect(sheets[0]).toBe(stale);
  expect(sheets[0]!.textContent ?? '').toMatch(/\.zchatgpt-visually-hidden/u);
  expect(sheets[0]!.textContent ?? '').not.toMatch(/zchatgpt-previous-build-only/u);
  // A second call with the current text rewrites nothing.
  const text = sheets[0]!.textContent;
  injectReaderStyles(doc, {});
  expect([...doc.querySelectorAll('style[data-zchatgpt-sidebar-css]')]).toHaveLength(1);
  expect(sheets[0]!.textContent).toBe(text);
});

it('attaches the dock stylesheet to the reader iframe document and keeps a composer-width column against reader smash rules', () => {
  const doc = readerDocument();
  const smash = doc.createElement('style');
  // Real zotero/reader chrome: button { all: unset; display: block; font: inherit }
  // and #split-view { position: absolute; display: flex } with .primary-view { flex-grow: 1 }.
  smash.textContent = [
    'aside { writing-mode: vertical-rl; flex: 1 1 0; min-width: 0; width: 0; }',
    '#split-view { position: absolute; inset-inline-start: 0; inset-inline-end: 0; top: 41px; display: flex; }',
    '.primary-view { flex-grow: 1; }',
    'button { all: unset; display: block; font: inherit; user-select: none; }',
    'section, p { writing-mode: vertical-rl; }',
  ].join('\n');
  doc.head.append(smash);

  injectReaderStyles(doc, { stylesheet: 'https://plugin.test/content/assets/sidebar.css' });
  const sheet = doc.querySelector('style[data-zchatgpt-sidebar-css]');
  expect(sheet?.ownerDocument).toBe(doc);
  expect(sheet?.textContent ?? '').toMatch(/writing-mode:\s*horizontal-tb/u);
  expect(sheet?.textContent ?? '').toMatch(/#split-view[\s\S]*\.zchatgpt-dock[\s\S]*flex:\s*0 0/u);
  expect(sheet?.textContent ?? '').toMatch(/\.zchatgpt-dock[\s\S]*min-width:\s*320px/u);
  expect(sheet?.textContent ?? '').not.toMatch(/min-width:\s*var\(--zchatgpt-dock-width/u);
  expect(sheet?.textContent ?? '').toMatch(/\.zchatgpt-dock[^{]*:where\(\s*button/u);
  expect(sheet?.textContent ?? '').toMatch(/\.zchatgpt-dock[^{]*:where\([^)]*\bp\b/u);
  expect(sheet?.textContent ?? '').toMatch(/\.zchatgpt-dock[^{]*:where\([^)]*\bsection\b/u);
  expect(sheet?.textContent ?? '').toMatch(/\.zchatgpt-dock[^{]*:where\([^)]*\baside\b/u);
  expect(sheet?.textContent ?? '').toMatch(/all:\s*revert/u);

  const { dock, body } = mountReaderDock(doc)!;
  applyDockWidth(doc, 360);
  expect(dock.style.flexShrink).toBe('0');
  expect(dock.style.flexGrow).toBe('0');
  expect(dock.style.flexBasis).toBe('360px');
  expect(dock.style.width).toBe('360px');
  expect(dock.style.minWidth).toBe(`${MIN_SIDEBAR_WIDTH}px`);
  expect(dock.style.writingMode).toBe('horizontal-tb');
  expect(dock.style.getPropertyPriority('flex-shrink')).toBe('important');
  expect(dock.style.getPropertyPriority('min-width')).toBe('important');
  expect(dock.style.getPropertyPriority('writing-mode')).toBe('important');
  expect(dock.style.fontFamily).toBe('inherit');
  expect(dock.style.background).toMatch(/material-background|Canvas/u);
  expect(dock.style.background).not.toMatch(/#fff/u);
  expect(dock.getAttribute('style') ?? '').not.toMatch(/min-width:\s*0(?:px)?(?:;|$)/u);

  const sidebar = renderReaderShell(body, { title: 'Paper', key: 'PDFONE01', libraryID: 1 });
  expect(sidebar.classList.contains('zchatgpt-sidebar')).toBe(true);
  expect(doc.getElementById('split-view')?.contains(sidebar)).toBe(true);
  expect(doc.querySelector('.toolbar')?.contains(sidebar)).toBe(false);
});

it('lets the dock splitter change width without locking min-width to the current column', () => {
  const doc = readerDocument();
  const { dock } = mountReaderDock(doc)!;
  applyDockWidth(doc, 400);
  const resizer = dock.querySelector<HTMLElement>('[data-zchatgpt-resizer]');
  expect(resizer).toBeTruthy();
  const applied: number[] = [];
  const unbind = bindDockResize(resizer!, {
    currentWidth: () => Number.parseFloat(dock.style.width),
    setWidth: width => { applied.push(width); applyDockWidth(doc, width); },
    measureAvailableWidth: () => 1440,
  });
  const view = doc.defaultView!;
  resizer!.dispatchEvent(new view.PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 1000, pointerId: 1 }));
  doc.dispatchEvent(new view.PointerEvent('pointermove', { bubbles: true, clientX: 880, pointerId: 1 }));
  doc.dispatchEvent(new view.PointerEvent('pointerup', { bubbles: true, clientX: 880, pointerId: 1 }));
  expect(applied.at(-1)).toBe(520);
  expect(dock.style.width).toBe('520px');
  expect(dock.style.minWidth).toBe(`${MIN_SIDEBAR_WIDTH}px`);
  expect(doc.documentElement.style.getPropertyValue('--zchatgpt-dock-width')).toBe('520px');
  unbind();
});

it('coalesces a splitter drag into one width change per frame and flushes the release exactly', async () => {
  const doc = readerDocument();
  const { dock } = mountReaderDock(doc)!;
  applyDockWidth(doc, 400);
  const resizer = dock.querySelector<HTMLElement>('[data-zchatgpt-resizer]')!;
  const applied: number[] = [];
  const unbind = bindDockResize(resizer, {
    currentWidth: () => Number.parseFloat(dock.style.width),
    setWidth: width => { applied.push(width); applyDockWidth(doc, width); },
    measureAvailableWidth: () => 1440,
  });
  const view = doc.defaultView!;
  resizer.dispatchEvent(new view.PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 1000, pointerId: 2 }));
  doc.dispatchEvent(new view.PointerEvent('pointermove', { bubbles: true, clientX: 980, pointerId: 2 }));
  doc.dispatchEvent(new view.PointerEvent('pointermove', { bubbles: true, clientX: 960, pointerId: 2 }));
  doc.dispatchEvent(new view.PointerEvent('pointermove', { bubbles: true, clientX: 940, pointerId: 2 }));
  expect(applied).toEqual([]);
  await vi.waitFor(() => expect(applied).toEqual([460]));
  doc.dispatchEvent(new view.PointerEvent('pointermove', { bubbles: true, clientX: 880, pointerId: 2 }));
  doc.dispatchEvent(new view.PointerEvent('pointerup', { bubbles: true, clientX: 880, pointerId: 2 }));
  expect(applied).toEqual([460, 520]);
  expect(dock.style.width).toBe('520px');
  await new Promise(resolve => setTimeout(resolve, 40));
  expect(applied).toEqual([460, 520]);
  unbind();
});
