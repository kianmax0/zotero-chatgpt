import { attachmentIdentity, type AttachmentIdentity } from './context.ts';
import { applyDockWidth, bindDockResize, injectReaderStyles, mountReaderDock, unmountReaderDock } from './dock.ts';
import { DEFAULT_SIDEBAR_WIDTH, MIN_READER_WIDTH, ReaderLayoutController, type Anchor, type DockState, type LayoutHost, type Scale, type ViewPosition } from './layout.ts';
import type { HostReader, ItemDetails, PdfApplication, ZoteroHost, ZoteroWindow } from './host-types.ts';
import { updateToolbarButton } from './toolbar.ts';
export type SidebarRenderer = (body: HTMLElement, identity: AttachmentIdentity, close: () => void, active: boolean) => (() => void) | void;
export interface ReaderPaneAssets { stylesheet?: string; katex?: string }
const WIDTH_PREF = 'extensions.zchatgpt.sidebarWidth';

/** Private PDF state is read in this adapter only. Numeric _location.scale is a percentage. */
export function pdfApplication(reader: HostReader): PdfApplication | undefined {
  return reader._internalReader?._lastView?._iframeWindow?.PDFViewerApplication;
}
export function currentReaderZoom(reader: HostReader): number {
  const scale = pdfApplication(reader)?.pdfViewer?.currentScale;
  if (typeof scale === 'number' && scale > 0) return scale;
  const stored = capturePosition(reader)?.scale;
  if (typeof stored === 'number' && stored > 0) return stored > 8 ? stored / 100 : stored;
  return 1;
}
export function zoomReader(reader: HostReader, action: 'in' | 'out' | 'reset'): void {
  const app = pdfApplication(reader);
  const viewer = app?.pdfViewer;
  if (!viewer) return;
  if (action === 'reset') { viewer.currentScale = 1; return; }
  if (action === 'in' && typeof app.zoomIn === 'function') { app.zoomIn(); return; }
  if (action === 'out' && typeof app.zoomOut === 'function') { app.zoomOut(); return; }
  viewer.currentScale = action === 'in' ? viewer.currentScale * 1.1 : Math.max(0.25, viewer.currentScale / 1.1);
}
export function capturePosition(reader: HostReader): ViewPosition | undefined {
  const viewer = reader._internalReader?._lastView?._iframeWindow?.PDFViewerApplication?.pdfViewer;
  const location = viewer?._location;
  if (!viewer || !location) return;
  const scale = location.scale;
  if (typeof scale !== 'number' && scale !== 'auto' && scale !== 'page-fit' && scale !== 'page-width') return;
  // pdf.js applies a programmatic jump's scroll and sets `currentPageNumber` synchronously, but
  // only refreshes `_location` from the visible page on the next scroll frame: the container's
  // scroll listener reaches `_scrollUpdate`/`_updateLocation` through `watchScroll`'s
  // requestAnimationFrame coalescing (viewer.mjs `#scrollIntoView` vs. `watchScroll`). A close
  // inside that window would capture the page the jump left and re-anchor the reader to it.
  const live = viewer.currentPageNumber;
  if (typeof live === 'number' && Number.isFinite(live) && live !== location.pageNumber) {
    // The committed page is known, but the offset that belongs to it is not. Restoring the page
    // alone is honest; the offset cannot be invented from the stale location.
    return { scale, anchor: { pageIndex: live - 1, left: 0, top: 0 } };
  }
  return { scale, anchor: { pageIndex: location.pageNumber - 1, left: location.left, top: location.top } };
}
export class NativeReaderPane implements LayoutHost {
  readonly controller = new ReaderLayoutController(this);
  private disposeView: (() => void) | undefined;
  private alive = true;
  private expectedPreset: string | undefined;
  private zoomGeneration = 0;
  private pendingFixedScale: number | undefined;
  private disconnectZoom: (() => void) | undefined;
  private disconnectLayout: (() => void) | undefined;
  private layoutTimer: number | undefined;
  private applyingWidth = false;
  private draggingWidth = false;
  private lastAvailable = 0;
  private lastWidth = 0;
  constructor(
    private zotero: ZoteroHost,
    readonly reader: HostReader,
    private buttons: Set<HTMLButtonElement>,
    private renderView: SidebarRenderer,
    private assets?: ReaderPaneAssets,
  ) {}
  private get win(): ZoteroWindow { return this.reader._window; }
  private readerDoc(): Document | undefined {
    try { return this.reader._iframeWindow?.document; } catch { return undefined; }
  }
  supported(): boolean {
    return this.alive && this.reader.type === 'pdf' && !!this.reader.tabID && !!this.win.ZoteroContextPane
      && this.zotero.Prefs.get('layout') !== 'stacked';
  }
  selected(): boolean { return this.supported() && this.win.Zotero_Tabs?.selectedID === this.reader.tabID; }
  private currentDetails(): ItemDetails | undefined {
    return Array.from(this.win.document.querySelectorAll<ItemDetails>('#zotero-context-pane-item-deck > [data-tab-id]'))
      .find(node => node.dataset.tabId === this.reader.tabID);
  }
  captureDock(): DockState {
    const context = this.win.ZoteroContextPane!;
    return { collapsed: context.collapsed, mode: context.context.mode, scrollTop: this.currentDetails()?.querySelector('#zotero-view-item')?.scrollTop ?? 0, width: this.currentWidth() };
  }
  capturePosition(): ViewPosition | undefined {
    const position = capturePosition(this.reader);
    // A reopen inherits the restoration target even before the queued native call.
    return position && { ...position, scale: this.pendingFixedScale ?? position.scale };
  }
  showDock(): void {
    ++this.zoomGeneration;
    this.pendingFixedScale = undefined;
    const context = this.win.ZoteroContextPane;
    if (context) context.collapsed = true;
    const doc = this.readerDoc();
    if (doc) {
      injectReaderStyles(doc, this.assets);
      mountReaderDock(doc);
    }
  }
  restoreDock(state: DockState): void {
    if (!this.selected()) return;
    const context = this.win.ZoteroContextPane;
    if (context) {
      context.context.mode = state.mode;
      context.collapsed = state.collapsed;
    }
    const scroll = this.currentDetails()?.querySelector('#zotero-view-item');
    if (scroll) scroll.scrollTop = state.scrollTop;
  }
  readDesiredWidth(): number {
    const stored = this.zotero.Prefs?.get?.(WIDTH_PREF, true);
    if (typeof stored === 'number' && Number.isFinite(stored) && stored > 0) return stored;
    return DEFAULT_SIDEBAR_WIDTH;
  }
  rememberWidth(cssPixels: number): void { this.zotero.Prefs?.set?.(WIDTH_PREF, cssPixels, true); }
  measureAvailableWidth(): number {
    const readerWidth = this.reader._iframeWindow?.innerWidth ?? 0;
    return readerWidth > 0 ? readerWidth : (this.win.innerWidth || DEFAULT_SIDEBAR_WIDTH + MIN_READER_WIDTH);
  }
  currentWidth(): number {
    const dock = this.readerDoc()?.querySelector<HTMLElement>('[data-zchatgpt-dock]');
    if (dock) {
      const styled = Number.parseFloat(dock.style.width || dock.style.flexBasis);
      if (Number.isFinite(styled) && styled > 0) return styled;
      const rect = dock.getBoundingClientRect().width;
      if (rect > 0) return rect;
    }
    return DEFAULT_SIDEBAR_WIDTH;
  }
  applyWidth(cssPixels: number): void {
    const doc = this.readerDoc();
    if (!doc) return;
    this.applyingWidth = true;
    try {
      const rounded = Math.round(cssPixels);
      applyDockWidth(doc, rounded);
      this.lastWidth = rounded;
      this.lastAvailable = this.measureAvailableWidth();
    } finally { this.applyingWidth = false; }
  }
  async mountChat(): Promise<boolean> {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (!this.selected() || !this.controller.active) return false;
      const doc = this.readerDoc();
      const identity = attachmentIdentity(this.zotero, this.reader);
      const mounted = doc && identity ? mountReaderDock(doc) : undefined;
      if (doc && mounted && identity) {
        injectReaderStyles(doc, this.assets);
        this.render(mounted.body);
        if (!this.controller.active || !this.selected()) { this.unmountChat(); return false; }
        this.observeZoom();
        this.observeLayout();
        mounted.body.querySelector<HTMLElement>('button')?.focus();
        return true;
      }
      await new Promise<void>(resolve => { this.win.setTimeout(resolve, 25); });
    }
    return false;
  }
  render(body: HTMLElement): void {
    this.disposeView?.(); this.disposeView = undefined;
    const identity = attachmentIdentity(this.zotero, this.reader);
    if (!identity) { body.replaceChildren(); return; }
    this.disposeView = this.renderView(body, identity, () => { this.controller.close(); this.focusButton(); }, this.controller.active) || undefined;
  }
  unmountChat(): void {
    this.disposeView?.(); this.disposeView = undefined;
    this.disconnectLayout?.(); this.disconnectLayout = undefined;
    const doc = this.readerDoc();
    if (doc) unmountReaderDock(doc);
  }
  setActive(active: boolean): void { for (const button of this.buttons) updateToolbarButton(button, active && this.selected()); }
  private focusButton(): void { Array.from(this.buttons).find(button => button.isConnected)?.focus(); }
  setZoom(scale: Scale, anchor: Anchor): void {
    const generation = ++this.zoomGeneration;
    this.pendingFixedScale = typeof scale === 'number' ? scale : undefined;
    this.expectedPreset = typeof scale === 'string' ? scale : undefined;
    // Preset zooms reflow and re-anchor from the viewer location, which can still name the page a
    // jump left; declare the anchor we are restoring to before the native reflow reads it.
    this.alignViewerLocation(anchor);
    if (scale === 'page-width') this.reader.zoomPageWidth();
    else if (scale === 'page-fit') this.reader.zoomPageHeight();
    else if (scale === 'auto') this.reader.zoomAuto();
    // Native preset methods resize the canvas. Restore the PDF anchor after layout settles.
    this.win.requestAnimationFrame(() => {
      if (generation !== this.zoomGeneration) return;
      this.pendingFixedScale = undefined;
      const viewer = this.reader._internalReader?._lastView?._iframeWindow?.PDFViewerApplication?.pdfViewer;
      if (!viewer) return;
      // Zotero ignores destination zoom; restore native scale before the anchor.
      if (typeof scale === 'number') viewer.currentScaleValue = scale / 100;
      // Reader.navigate routes through link history and installs a deferred
      // text-layer focus callback, which can jump back after a later zoom render.
      this.scrollTo(anchor);
    });
  }
  keepAnchor(anchor: Anchor): void {
    const generation = ++this.zoomGeneration;
    this.win.requestAnimationFrame(() => {
      if (generation !== this.zoomGeneration) return;
      this.scrollTo(anchor);
    });
  }
  /**
   * pdf.js `#setScaleUpdatePages` re-anchors a preset zoom from `_location`. When a programmatic
   * jump is still waiting for its scroll frame, `_location` names the page that jump left, so the
   * native reflow would pull the reader back before the frame below restores the anchor.
   */
  private alignViewerLocation(anchor: Anchor): void {
    const viewer = this.reader._internalReader?._lastView?._iframeWindow?.PDFViewerApplication?.pdfViewer;
    const location = viewer?._location;
    if (!viewer || !location) return;
    if (location.pageNumber === anchor.pageIndex + 1) return;
    viewer._location = { ...location, pageNumber: anchor.pageIndex + 1, left: anchor.left, top: anchor.top };
  }
  private scrollTo(anchor: Anchor): void {
    const viewer = this.reader._internalReader?._lastView?._iframeWindow?.PDFViewerApplication?.pdfViewer;
    if (!viewer) return;
    viewer.scrollPageIntoView({
      pageNumber: anchor.pageIndex + 1,
      destArray: [anchor.pageIndex, { name: 'XYZ' }, anchor.left, anchor.top, null],
      allowNegativeOffset: true,
      ignoreDestinationZoom: true,
    });
  }
  private observeZoom(): void {
    if (this.disconnectZoom) return;
    const bus = this.reader._internalReader?._lastView?._iframeWindow?.PDFViewerApplication?.eventBus;
    if (!bus) return;
    const handler = (event: { presetValue?: string; scale?: number }) => {
      if (!this.controller.active) return;
      // Repeated same-preset scale events are native viewport resizes, not a manual override.
      if (this.expectedPreset && event.presetValue === this.expectedPreset) return;
      ++this.zoomGeneration; this.expectedPreset = undefined; this.controller.manualZoom();
    };
    bus.on('scalechanging', handler); this.disconnectZoom = () => bus.off('scalechanging', handler);
  }
  private observeLayout(): void {
    if (this.disconnectLayout) return;
    const win = this.win;
    const readerWin = this.reader._iframeWindow;
    const readerDoc = this.readerDoc();
    const dock = readerDoc?.querySelector<HTMLElement>('[data-zchatgpt-dock]');
    const resizer = readerDoc?.querySelector<HTMLElement>('[data-zchatgpt-resizer]');
    const schedule = () => {
      if (this.layoutTimer !== undefined) win.clearTimeout(this.layoutTimer);
      this.layoutTimer = win.setTimeout(() => { this.layoutTimer = undefined; this.onLayoutSettled(); }, 80);
    };
    win.addEventListener('resize', schedule);
    readerWin?.addEventListener?.('resize', schedule);
    const Observer = win.ResizeObserver;
    const observer = dock && Observer ? new Observer(() => schedule()) : undefined;
    if (dock) observer?.observe(dock);
    const unbindResize = resizer ? bindDockResize(resizer, {
      currentWidth: () => this.currentWidth(),
      setWidth: width => {
        if (!this.controller.active) return;
        void this.controller.setWidth(width);
      },
      measureAvailableWidth: () => this.measureAvailableWidth(),
    }) : undefined;
    const startDrag = () => { this.draggingWidth = true; };
    const endDrag = () => { this.draggingWidth = false; this.lastWidth = this.currentWidth(); };
    resizer?.addEventListener('pointerdown', startDrag);
    readerDoc?.addEventListener('pointerup', endDrag);
    this.lastAvailable = this.measureAvailableWidth();
    this.lastWidth = this.currentWidth();
    this.disconnectLayout = () => {
      win.removeEventListener('resize', schedule);
      readerWin?.removeEventListener?.('resize', schedule);
      observer?.disconnect();
      unbindResize?.();
      resizer?.removeEventListener('pointerdown', startDrag);
      readerDoc?.removeEventListener('pointerup', endDrag);
      if (this.layoutTimer !== undefined) win.clearTimeout(this.layoutTimer);
      this.layoutTimer = undefined;
    };
  }
  private onLayoutSettled(): void {
    if (!this.controller.active || this.applyingWidth || this.draggingWidth) return;
    const available = this.measureAvailableWidth();
    const width = this.currentWidth();
    const availableChanged = Math.abs(available - this.lastAvailable) > 1;
    const widthChanged = Math.abs(width - this.lastWidth) > 1;
    if (!availableChanged && !widthChanged) return;
    if (availableChanged) this.controller.viewportChanged();
    else void this.controller.setWidth(width);
    this.lastAvailable = this.measureAvailableWidth();
    this.lastWidth = this.currentWidth();
  }
  reconcile(): void {
    if (!this.controller.active) return;
    const context = this.win.ZoteroContextPane;
    // Switching to another reader is not a close. The dock belongs to the selected tab;
    // this reader keeps ownership so coming back remounts the same conversation.
    if (!this.selected()) { this.unmountChat(); return; }
    if (context && !context.collapsed) this.controller.nativeAction();
    else if (!this.readerDoc()?.querySelector('[data-zchatgpt-dock]')) {
      void this.mountChat().then(ready => { if (ready && this.controller.active && this.selected()) this.setActive(true); });
    }
  }
  dispose(): void {
    this.controller.dispose(); this.disposeView?.(); this.disposeView = undefined; this.alive = false;
    this.disconnectZoom?.(); this.disconnectZoom = undefined;
    this.disconnectLayout?.(); this.disconnectLayout = undefined;
    this.buttons.clear();
  }
}
