import { clone } from '../../../contracts/src/clone.ts';
import { type NativeAnnotationCandidate, type NativeAnnotationPosition, type NativeFigureCalloutInput, type NativeFigureCalloutSnapshot, type NativeCollectionSnapshot, type NativeItemSnapshot, type NativeReaderPort } from '../../../contracts/src/native.ts';
import type { Rect } from '../../../contracts/src/index.ts';
import { lineRects, type LocateChar } from '../reader/locate.ts';
import type { NativeHostCollection, NativeZoteroHost } from '../host/native.ts';
import { boundary, canonical, checkSignal, equal, fail, key, normalizedText, publicURL, revisionMatches, string, waitRead, type NativeSupport } from './native-support.ts';

const MAX_PAGES = 256;
const MAX_TEXT = 2_000_000;

export function nativeCollectionSnapshot(support: NativeSupport, collection: NativeHostCollection): NativeCollectionSnapshot {
  const z = support.z;
  const childItemKeys = collection.getChildItems(true, true).map(value => typeof value === 'number' ? z.Items.get(value) : value).filter(item => item !== false && item !== undefined).map(item => item.key).sort();
  const childCollectionKeys = collection.getChildCollections(true, true).map(value => typeof value === 'number' ? z.Collections.get(value) : value).filter(item => item !== false && item !== undefined).map(item => item.key).sort();
  return { clientId: support.clientId, libraryId: collection.libraryID, collectionKey: collection.key, name: collection.name, parentKey: typeof collection.parentKey === 'string' ? collection.parentKey : null, childItemKeys, childCollectionKeys, dateModified: collection.dateModified, contentSignature: canonical(collection.toJSON()) };
}

/**
 * Read-only native Zotero access: PDF quote resolution, annotation/item/attachment inspection and
 * DOI duplicate lookup. Nothing here writes to the library or the account.
 *
 * The action layer (`zotero/actions`) wraps this port rather than reimplementing reads; the
 * reader/chat product path can be built against `NativeReaderPort` alone.
 */
export function createNativeReaderPort(support: NativeSupport): NativeReaderPort {
  const { z } = support;
  return {
    inspectAnnotation: (input, signal) => boundary(async () => {
      checkSignal(signal); support.paper(input.paper); key(input.key);
      const item = z.Items.getByLibraryAndKey(input.paper.libraryId, input.key); if (!item) return null;
      await item.loadAllData?.(); checkSignal(signal); return support.annotationSnapshot(input.paper, item);
    }),
    inspectFigureCallout: (value: NativeFigureCalloutInput, signal) => boundary(async () => {
      checkSignal(signal); const plan = await support.prepareFigureCallout(value, signal); const parent = support.paper(plan.selection.paper);
      const imageItem = z.Items.getByLibraryAndKey(parent.libraryID, plan.image.key);
      const inkItem = z.Items.getByLibraryAndKey(parent.libraryID, plan.ink.key);
      if (!imageItem && !inkItem) return { status: 'absent' } as const;
      if (!imageItem || !inkItem) return { status: 'partial' } as const;
      await imageItem.loadAllData?.(); await inkItem.loadAllData?.(); checkSignal(signal);
      const image = await support.figureAnnotationSnapshot(plan.selection.paper, imageItem);
      const ink = await support.figureAnnotationSnapshot(plan.selection.paper, inkItem);
      if (!image || !ink) return { status: 'partial' } as const;
      const nativeFields = <T extends { imageSHA256: string }>(snapshot: T): unknown => { const copy = clone(snapshot); Reflect.deleteProperty(copy, 'dateModified'); Reflect.deleteProperty(copy, 'imageSHA256'); return copy; };
      if (!equal(nativeFields(image), nativeFields(plan.image)) || !equal(nativeFields(ink), nativeFields(plan.ink))) return { status: 'conflict' } as const;
      const callout: NativeFigureCalloutSnapshot = { selection: plan.selection, image, ink };
      return { status: 'complete', callout } as const;
    }),
    resolveQuote: (value, signal) => boundary(async () => {
      checkSignal(signal); const input = clone(value); support.paper(input.paper);
      const quote = normalizedText(string(input.quote, 16000)); if (quote.length < 2) fail('INVALID_INPUT', 'Choose a nonempty original passage for annotation.');
      const source = await waitRead(support.capture(input.paper, signal), signal);
      if (!revisionMatches(input.revision, source.revision)) fail('SOURCE_CHANGED', 'The PDF changed after the task was prepared.');
      const total = source.pdf.numPages;
      if (!Number.isSafeInteger(total) || total < 1 || total > 10000) fail('UNAVAILABLE', 'The PDF page count is unavailable.');
      if (input.pageIndexes !== undefined && (!Array.isArray(input.pageIndexes) || !input.pageIndexes.length || input.pageIndexes.some(n => !Number.isSafeInteger(n) || n < 0 || n >= total))) fail('INVALID_INPUT', 'Choose valid physical PDF pages.');
      const indexes = input.pageIndexes ? [...new Set(input.pageIndexes)].sort((a, b) => a - b) : Array.from({ length: total }, (_, i) => i);
      if (indexes.length > MAX_PAGES) return { status: 'unresolved', reason: 'range-required' };
      const labels = await waitRead(source.pdf.getPageLabels2(), signal);
      const pages = new Map<number, { chars: readonly LocateChar[]; viewBox: readonly number[] }>();
      const offsets: Array<{ pageIndex: number; charIndex: number; glyph: boolean }> = []; let text = ''; let previousPage = -2;
      const append = (value: string, pageIndex: number, charIndex: number, glyph = false) => {
        for (const c of value.normalize('NFC')) {
          const normalized = /\s/u.test(c) ? ' ' : c;
          if (normalized === ' ' && (!text || text.endsWith(' '))) continue;
          text += normalized; for (let i = 0; i < normalized.length; i++) offsets.push({ pageIndex, charIndex, glyph });
        }
      };
      for (const pageIndex of indexes) {
        checkSignal(signal);
        let page: { partial?: boolean; chars: LocateChar[]; viewBox?: readonly number[] };
        try { page = await waitRead(source.pdf.getPageData({ pageIndex }), signal); } catch (error) { if (error instanceof Error && error.name === 'NativeOperationError') throw error; return { status: 'unresolved', reason: 'incomplete-text' }; }
        if (page.partial || !Array.isArray(page.chars)) return { status: 'unresolved', reason: 'incomplete-text' };
        pages.set(pageIndex, { chars: page.chars, viewBox: page.viewBox ?? [] });
        if (previousPage !== -2) append(previousPage + 1 === pageIndex ? ' ' : '\u0000', pageIndex, 0);
        for (let charIndex = 0; charIndex < page.chars.length; charIndex++) {
          const char = page.chars[charIndex]!; if (typeof char.c !== 'string' || char.c.length > 64) return { status: 'unresolved', reason: 'incomplete-text' };
          if (!char.ignorable) { append(char.c, pageIndex, charIndex, true); if (char.spaceAfter || char.lineBreakAfter || char.paragraphBreakAfter) append(' ', pageIndex, charIndex); }
          if (text.length > MAX_TEXT) return { status: 'unresolved', reason: 'range-required' };
        }
        previousPage = pageIndex;
        if (text.length > MAX_TEXT) return { status: 'unresolved', reason: 'range-required' };
      }
      const matches: number[] = []; let from = 0;
      while (from < text.length) { const at = text.indexOf(quote, from); if (at < 0) break; matches.push(at); from = at + 1; }
      if (!matches.length) return { status: 'unresolved', reason: 'not-found' };
      if (matches.length > 1) return { status: 'ambiguous', matches: matches.length };
      const start = offsets[matches[0]!]!; const end = offsets[matches[0]! + quote.length - 1]!;
      const sameGlyph = (a: typeof start | undefined, b: typeof start) => a?.glyph && b.glyph && a.pageIndex === b.pageIndex && a.charIndex === b.charIndex;
      if (sameGlyph(offsets[matches[0]! - 1], start) || sameGlyph(offsets[matches[0]! + quote.length], end)) return { status: 'unresolved', reason: 'invalid-geometry' };
      if (end.pageIndex - start.pageIndex > 1) return { status: 'unresolved', reason: 'unsupported-span' };
      const selected: Array<{ pageIndex: number; rects: Rect[] }> = [];
      for (let pageIndex = start.pageIndex; pageIndex <= end.pageIndex; pageIndex++) {
        const page = pages.get(pageIndex); if (!page) return { status: 'unresolved', reason: 'unsupported-span' };
        const chars = page.chars.slice(pageIndex === start.pageIndex ? start.charIndex : 0, pageIndex === end.pageIndex ? end.charIndex + 1 : undefined);
        if (chars.some(c => c.isolated) && chars.some(c => !c.isolated && !c.ignorable)) return { status: 'unresolved', reason: 'invalid-geometry' };
        const rects = lineRects(chars, page.viewBox); if (!rects?.length) return { status: 'unresolved', reason: 'invalid-geometry' };
        selected.push({ pageIndex, rects });
      }
      const first = selected[0]!; const page = pages.get(first.pageIndex)!; const top = Math.max(0, page.viewBox[3]! - page.viewBox[1]! - Math.max(...first.rects.map(r => r[3])));
      if (start.charIndex > 999999 || top > 99999) return { status: 'unresolved', reason: 'invalid-geometry' };
      const resolvedPosition: NativeAnnotationPosition = { pageIndex: first.pageIndex, rects: first.rects };
      if (selected[1]) resolvedPosition.nextPageRects = selected[1].rects;
      const candidate: NativeAnnotationCandidate = { source: input, text: quote, pageLabel: labels?.[first.pageIndex] || String(first.pageIndex + 1), position: resolvedPosition, sortIndex: `${String(first.pageIndex).padStart(5, '0')}|${String(start.charIndex).padStart(6, '0')}|${String(Math.floor(top)).padStart(5, '0')}` };
      const fresh = await waitRead(support.capture(input.paper, signal), signal);
      if (!revisionMatches(input.revision, fresh.revision)) fail('SOURCE_CHANGED', 'The PDF changed during quote validation.');
      return { status: 'resolved', candidate };
    }),
    findDuplicateDOI: (input, signal) => boundary(async () => {
      checkSignal(signal); support.scope(input); const doi = support.cleanDOI(string(input.doi)); if (!doi) fail('INVALID_INPUT', 'A valid DOI is required for duplicate lookup.');
      const search = new z.Search(); search.libraryID = input.libraryId;
      search.addCondition('joinMode', 'any'); search.addCondition('DOI', 'contains', doi); search.addCondition('extra', 'contains', doi);
      const ids = await waitRead(search.search(), signal); if (ids.length > 1000) fail('UNAVAILABLE', 'Duplicate lookup returned too many candidates.');
      const results: NativeItemSnapshot[] = [];
      for (const id of ids) { const item = await z.Items.getAsync(id); await item.loadAllData?.(); checkSignal(signal); if (item.libraryID !== input.libraryId || item.deleted || !item.isRegularItem()) continue; const existing = item.getField('DOI') || item.getExtraField?.('DOI') || ''; if (support.cleanDOI(existing) === doi) results.push(support.itemSnapshot(item)); }
      return results;
    }),
    inspectItem: (input, signal) => boundary(async () => { checkSignal(signal); const item = support.getItem(input); if (!item) return null; await item.loadAllData?.(); checkSignal(signal); return support.itemSnapshot(item); }),
    inspectCollection: (input, signal) => boundary(async () => {
      checkSignal(signal); support.scope(input); key(input.collectionKey);
      const collection = z.Collections.getByLibraryAndKey(input.libraryId, input.collectionKey);
      if (!collection || collection.deleted || collection.libraryID !== input.libraryId) return null;
      await collection.loadDataType('primaryData'); await collection.loadDataType('childItems'); await collection.loadDataType('childCollections'); checkSignal(signal);
      return nativeCollectionSnapshot(support, collection);
    }),
    inspectChildNote: (input, signal) => boundary(async () => {
      checkSignal(signal); support.scope(input); key(input.key); key(input.parentKey);
      const note = z.Items.getByLibraryAndKey(input.libraryId, input.key);
      if (!note || note.deleted || note.itemType !== 'note' || !note.parentID) return null;
      await note.loadAllData?.(); checkSignal(signal);
      const parent = z.Items.get(note.parentID);
      if (!parent || parent.deleted || !parent.isRegularItem() || parent.libraryID !== input.libraryId || parent.key !== input.parentKey) return null;
      return { clientId: support.clientId, libraryId: note.libraryID, key: note.key, parentKey: parent.key, body: note.getNote(), contentSignature: support.contentSignature(note) };
    }),
    inspectOrganizationItem: (input, signal) => boundary(async () => { checkSignal(signal); const item = support.getItem(input); if (!item) return null; await item.loadAllData?.(); checkSignal(signal); return support.organizationItemSnapshot(item); }),
    previewMetadata: (value, signal) => boundary(async () => {
      checkSignal(signal); const identifier = string(value.identifier, 8192); if (!identifier) fail('INVALID_INPUT', 'Enter a DOI or a public article link.');
      const identifiers = z.Utilities.extractIdentifiers(identifier);
      if (identifiers.length > 1) fail('INVALID_INPUT', 'Preview one identifier at a time within the task list.');
      const cookieContext = z.HTTP.newCookieContext();
      try {
        const translator = identifiers.length ? new z.Translate.Search() : new z.Translate.Web();
        translator.setUserContextId(cookieContext.id);
        if (identifiers.length) (translator as InstanceType<NativeZoteroHost['Translate']['Search']>).setIdentifier(identifiers[0]!);
        else {
          const url = publicURL(identifier); if (!url) fail('INVALID_INPUT', 'Enter a DOI or a public article link.');
          const response = await support.readURL(url, signal);
          if (!publicURL(response.responseURL)) fail('INVALID_INPUT', 'The article link redirected outside the permitted web scope.');
          (translator as InstanceType<NativeZoteroHost['Translate']['Web']>).setDocument(response.response as Document);
        }
        // A multi-item page is a candidate list, not authority to expand collection scope.
        translator.setHandler('select', (_object, _items, done) => done({}));
        const translators = await waitRead(translator.getTranslators(), signal); if (!translators.length) return { identifier, source: identifiers.length ? 'identifier' : 'web', candidates: [] };
        translator.setTranslator(identifiers.length ? translators : translators[0]!);
        const results = await waitRead(translator.translate({ libraryID: false, saveAttachments: false }), signal);
        if (results.length > 20) fail('UNAVAILABLE', 'Metadata lookup returned too many candidates.');
        const candidates = results.map(result => support.readMetadata(result, false));
        const expectedDOI = identifiers[0]?.DOI && support.cleanDOI(identifiers[0].DOI);
        if (expectedDOI && candidates.some(c => c.DOI !== expectedDOI)) fail('CONFLICT', 'The returned metadata does not match the requested DOI.');
        return { identifier, source: identifiers.length ? 'identifier' : 'web', candidates };
      } finally { cookieContext.dispose(); }
    }),
    inspectAttachment: (input, signal) => boundary(async () => {
      checkSignal(signal); support.scope(input); key(input.key);
      const attachment = z.Items.getByLibraryAndKey(input.libraryId, input.key);
      if (!attachment || attachment.deleted || !attachment.isPDFAttachment() || !attachment.parentID) return null;
      await attachment.loadAllData?.(); const parent = z.Items.get(attachment.parentID); if (!parent || parent.deleted) return null;
      const path = await attachment.getFilePathAsync(); if (!path) fail('UNAVAILABLE', 'The recorded PDF file is unavailable.');
      const sha256 = await support.environment.computeHexDigest(path, 'sha256'); checkSignal(signal);
      return { clientId: support.clientId, libraryId: attachment.libraryID, key: attachment.key, parentKey: parent.key, url: attachment.getField('url'), contentType: 'application/pdf', sha256, contentSignature: support.contentSignature(attachment) };
    }),
  };
}
