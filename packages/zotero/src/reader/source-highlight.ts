import { ReaderError, type DocumentRevision, type PaperScope, type Rect } from '../../../contracts/src/index.ts';
import type { NativeFigureSelection } from '../../../contracts/src/native.ts';
import { nativeDocumentSource } from './document.ts';
import type { HostReader, ZoteroHost } from './host-types.ts';
import { locateQuoteOnPage, type LocatePage, type LocatedPosition } from './locate.ts';

/** The frozen document identity a citation link was answered against. */
export interface SourcePageTarget { paper: PaperScope; revision: DocumentRevision }
export type SourceOpenOutcome = 'highlighted' | 'opened' | 'unlocated';

/**
 * Minimal port for one citation click. `validate` must throw unless the live document still matches
 * the frozen revision; `locate` may only return a position for the same page and revision; and
 * `navigate` is the only visible effect. There is deliberately no library or annotation method.
 */
export interface SourcePageNavigator {
  validate(target: SourcePageTarget): Promise<void>;
  locate(target: SourcePageTarget, pageIndex: number, quote: string): Promise<LocatedPosition | null>;
  navigate(pageIndex: number, position: LocatedPosition | null): Promise<void>;
}

/**
 * Open one frozen citation: verify the revision first, then highlight only a reliably located
 * quote. An absent or unlocatable quote navigates to the page and reports `unlocated` honestly
 * instead of inventing a highlight.
 */
export async function openSourcePage(
  navigator: SourcePageNavigator,
  target: SourcePageTarget,
  pageIndex: number,
  quote: string | null,
): Promise<SourceOpenOutcome> {
  await navigator.validate(target);
  if (!quote) { await navigator.navigate(pageIndex, null); return 'opened'; }
  const position = await navigator.locate(target, pageIndex, quote);
  if (!position) { await navigator.navigate(pageIndex, null); return 'unlocated'; }
  await navigator.navigate(pageIndex, position);
  return 'highlighted';
}

/** Navigate to a user-selected Figure rectangle after validating its frozen PDF revision. */
export async function openFigureSelection(navigator: SourcePageNavigator, selection: NativeFigureSelection): Promise<void> {
  const rect = selection.rect;
  if (!Number.isSafeInteger(selection.pageIndex) || selection.pageIndex < 0 || !Array.isArray(rect) || rect.length !== 4
    || !rect.every(Number.isFinite) || rect[2] <= rect[0] || rect[3] <= rect[1])
    throw new ReaderError('INVALID_REQUEST', 'The saved Figure position is invalid.');
  await navigator.validate({ paper: selection.paper, revision: selection.revision });
  await navigator.navigate(selection.pageIndex, { pageIndex: selection.pageIndex, rects: [[...rect]] });
}

function sameRevision(expected: DocumentRevision, actual: DocumentRevision): boolean {
  return JSON.stringify(expected) === JSON.stringify(actual);
}

/**
 * Native implementation over the current reader. The frozen revision is checked again after the
 * capture used for locating, so a highlight can never come from a different PDF version.
 */
export function nativeSourceNavigator(zotero: ZoteroHost, reader: () => HostReader | undefined, scope: PaperScope): SourcePageNavigator {
  const source = nativeDocumentSource(zotero, reader, scope);
  return {
    validate: target => source.validate(target),
    locate: async (target, pageIndex, quote) => {
      const captured = await source.capture();
      if (!sameRevision(target.revision, captured.revision)) throw new ReaderError('INVALID_REQUEST', 'The PDF changed before this citation could be located. Reopen it and try again.');
      const pdf = captured.pdf;
      if (!Number.isSafeInteger(pageIndex) || pageIndex < 0 || pageIndex >= pdf.numPages) return null;
      let page: LocatePage;
      try {
        const data = await pdf.getPageData({ pageIndex });
        page = { pageIndex, chars: data.chars, ...(Array.isArray(data.viewBox) ? { viewBox: data.viewBox } : {}) };
      } catch {
        // A page that cannot be read is an honest miss, not a request to highlight something else.
        return null;
      }
      const outcome = locateQuoteOnPage(page, quote);
      if (outcome.status !== 'located' || outcome.position.pageIndex !== pageIndex) return null;
      return outcome.position;
    },
    navigate: async (pageIndex, position) => {
      const host = reader();
      if (!host) throw new ReaderError('NOT_FOUND', 'The current PDF reader is no longer open.');
      if (position) await host.navigate({ position: { pageIndex: position.pageIndex, rects: position.rects.map((rect: Rect) => [...rect]) } });
      else await host.navigate({ pageIndex });
    },
  };
}
