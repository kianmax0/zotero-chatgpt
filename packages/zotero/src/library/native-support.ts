import { clone } from '../../../contracts/src/clone.ts';
import { NATIVE_ANNOTATION_PROVENANCE, type NativeAnnotationPosition, type NativeAnnotationSnapshot, type NativeFigureAnnotationPosition, type NativeFigureAnnotationRecord, type NativeFigureAnnotationSnapshot, type NativeFigureCalloutInput, type NativeFigureCalloutPrepared, type NativeItemRef, type NativeItemSnapshot, type NativeMetadata, type NativeOperationErrorCode, NativeOperationError, type NativeOrganizationItemSnapshot, type NativeCreator } from '../../../contracts/src/native.ts';
import type { DocumentRevision, PaperScope, Rect } from '../../../contracts/src/index.ts';
import { validateImageAttachment } from '../../../contracts/src/validation.ts';
import { cleanAnnotationReason, validateFigureCalloutProposal } from '../../../contracts/src/tasks.ts';
import { nativeDocumentSource, type DocumentSource } from '../reader/document.ts';
import type { ZoteroHost } from '../reader/host-types.ts';
import type { HostEnvironment, HostHTTPOptions, HostHTTPResponse, NativeHostItem, NativeZoteroHost } from '../host/native.ts';

/**
 * Host access and validation shared by the native read port and the native action port. Everything
 * here is stateless per call: no approval state, task ledger or model-selected path lives below the
 * task controller. Pure validation helpers are exported for tests and for both ports.
 */

export interface NativeSupportOptions {
  clientId: string;
  zotero: NativeZoteroHost;
  captureDocument?(paper: PaperScope, signal?: AbortSignal): Promise<DocumentSource>;
  environment?: HostEnvironment;
}

const NATIVE_ITEM_TYPES = new Set(['journalArticle', 'conferencePaper', 'preprint', 'book', 'bookSection', 'report', 'thesis', 'webpage']);
const NATIVE_METADATA_FIELDS = ['DOI', 'url', 'date', 'publicationTitle', 'bookTitle', 'conferenceName', 'volume', 'issue', 'pages', 'publisher', 'place', 'ISBN', 'abstractNote', 'language'] as const;
const NATIVE_KEY = /^[A-Z0-9]{8}$/u;
export function fail(code: NativeOperationErrorCode, message: string): never { throw new NativeOperationError(code, message); }
export function checkSignal(signal?: AbortSignal): void { if (signal?.aborted) fail('CANCELLED', 'Task cancelled before the next native operation.'); }
export function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_INPUT', 'Expected a structured native task input.'); return value as Record<string, unknown>; }
export function string(value: unknown, max = 8192): string { if (typeof value !== 'string' || value.length > max || value.includes('\0')) fail('INVALID_INPUT', 'Invalid native task text.'); return value.trim().normalize('NFC'); }
export function key(value: unknown): string { if (typeof value !== 'string' || !NATIVE_KEY.test(value)) fail('INVALID_INPUT', 'Invalid reserved Zotero key.'); return value; }
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}
export function equal(a: unknown, b: unknown): boolean { return canonical(a) === canonical(b); }
export function revisionMatches(expected: DocumentRevision, actual: DocumentRevision): boolean {
  return expected.fingerprint === actual.fingerprint && expected.size === actual.size && expected.modifiedAt === actual.modifiedAt
    && (!('sha256' in expected) || expected.sha256 === (actual as DocumentRevision & { sha256?: string }).sha256);
}
export function normalizedText(value: string): string { return value.normalize('NFC').replace(/\s+/gu, ' ').trim(); }
export function normalizedTitle(value: string): string { return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
/** Reject loopback, link-local, private, carrier-grade-NAT and IPv6 literals before any web request. */
export function publicURL(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 8192) return null;
  try {
    const url = new URL(value); const host = url.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || !host.includes('.')) return null;
    if (/^(?:0|10|127)\./u.test(host) || /^169\.254\./u.test(host) || /^192\.168\./u.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./u.test(host) || /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./u.test(host) || /^2(?:2[4-9]|[3-5]\d)\./u.test(host) || host.includes(':')) return null;
    return url.href;
  } catch { return null; }
}
export function rect(value: unknown): Rect | null {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1_000_000)) return null;
  const [x1, y1, x2, y2] = value as Rect;
  return x2 > x1 && y2 > y1 ? [x1, y1, x2, y2] : null;
}
export function position(value: unknown): NativeAnnotationPosition {
  const p = object(value);
  if (!Number.isSafeInteger(p.pageIndex) || (p.pageIndex as number) < 0 || !Array.isArray(p.rects) || !p.rects.length || p.rects.length > 1000) fail('INVALID_INPUT', 'Invalid annotation position.');
  const parseRects = (values: unknown[]): Rect[] => values.map(value => rect(value) ?? fail('INVALID_INPUT', 'Invalid annotation rectangle.'));
  const result: NativeAnnotationPosition = { pageIndex: p.pageIndex as number, rects: parseRects(p.rects) };
  if (p.nextPageRects !== undefined) {
    if (!Array.isArray(p.nextPageRects) || !p.nextPageRects.length || p.nextPageRects.length > 1000) fail('INVALID_INPUT', 'Invalid second-page annotation position.');
    result.nextPageRects = parseRects(p.nextPageRects);
  }
  return result;
}
function figurePosition(value: unknown, type: 'image' | 'ink'): NativeFigureAnnotationPosition {
  const p = object(value);
  if (!Number.isSafeInteger(p.pageIndex) || (p.pageIndex as number) < 0) fail('INVALID_INPUT', 'Invalid figure annotation page.');
  if (type === 'image') {
    if (!Array.isArray(p.rects) || p.rects.length !== 1) fail('INVALID_INPUT', 'A figure area must contain one rectangle.');
    const one = rect(p.rects[0]); if (!one) fail('INVALID_INPUT', 'Invalid figure area bounds.');
    return { pageIndex: p.pageIndex as number, rects: [one] };
  }
  if (!Array.isArray(p.paths) || !p.paths.length || p.paths.length > 5 || typeof p.width !== 'number' || !Number.isFinite(p.width) || p.width <= 0 || p.width > 100) fail('INVALID_INPUT', 'Invalid figure ink geometry.');
  const paths: number[][] = p.paths.map(raw => {
    if (!Array.isArray(raw) || raw.length < 4 || raw.length > 128 || raw.length % 2 || !raw.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1_000_000)) fail('INVALID_INPUT', 'Invalid figure ink path.');
    return raw.map(n => Math.round(n * 1000) / 1000);
  });
  return { pageIndex: p.pageIndex as number, paths, width: Math.round(p.width * 1000) / 1000 };
}
async function sha256Text(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function waitRead<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  checkSignal(signal); if (!signal) return work;
  let abort = () => {};
  try { return await Promise.race([work, new Promise<never>((_resolve, reject) => { abort = () => reject(new NativeOperationError('CANCELLED', 'Task cancelled before the next native operation.')); signal.addEventListener('abort', abort, { once: true }); })]); }
  finally { signal.removeEventListener('abort', abort); }
}
export async function boundary<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); }
  catch (error) { if (error instanceof NativeOperationError) throw error; fail('UNAVAILABLE', 'The native operation could not be completed.'); }
}
function nativeEnvironment(): HostEnvironment {
  const native = globalThis as unknown as { IOUtils: Omit<HostEnvironment, 'join'>; PathUtils: Pick<HostEnvironment, 'join'> };
  return { join: (...parts) => native.PathUtils.join(...parts), stat: path => native.IOUtils.stat(path), read: path => native.IOUtils.read(path), remove: (path, options) => native.IOUtils.remove(path, options), computeHexDigest: (path, algorithm) => native.IOUtils.computeHexDigest(path, algorithm) };
}
/** Lower-level host HTTP retains cancellation and anonymous options; Attachments.downloadFile drops them. */
async function requestWithSignal<T>(signal: AbortSignal | undefined, run: (options: HostHTTPOptions) => Promise<T>): Promise<T> {
  checkSignal(signal); let cancel = () => {};
  const abort = () => cancel(); signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await run({ anon: true, timeout: 30000, errorDelayMax: 0, cancellerReceiver: callback => { cancel = callback; if (signal?.aborted) callback(); } });
    checkSignal(signal); return response;
  } catch (error) { checkSignal(signal); throw error; }
  finally { signal?.removeEventListener('abort', abort); }
}

/** Bound native host access; read and action ports are built from one instance of this. */
export interface NativeSupport {
  readonly clientId: string;
  readonly z: NativeZoteroHost;
  readonly environment: HostEnvironment;
  readURL(url: string, signal?: AbortSignal, path?: string): Promise<HostHTTPResponse>;
  scope(value: { clientId: string; libraryId: number }): void;
  paper(value: PaperScope): NativeHostItem;
  capture(paper: PaperScope, signal?: AbortSignal): Promise<DocumentSource>;
  cleanDOI(value: string): string;
  readMetadata(value: unknown, strict: boolean): NativeMetadata;
  itemSnapshot(item: NativeHostItem): NativeItemSnapshot;
  organizationItemSnapshot(item: NativeHostItem): NativeOrganizationItemSnapshot;
  getItem(ref: NativeItemRef): NativeHostItem | null;
  contentSignature(item: NativeHostItem): string;
  annotationSnapshot(paper: PaperScope, item: NativeHostItem): NativeAnnotationSnapshot | null;
  prepareFigureCallout(input: NativeFigureCalloutInput, signal?: AbortSignal): Promise<NativeFigureCalloutPrepared>;
  figureAnnotationRecord(paper: PaperScope, item: NativeHostItem): NativeFigureAnnotationRecord | null;
  figureAnnotationSnapshot(paper: PaperScope, item: NativeHostItem): Promise<NativeFigureAnnotationSnapshot | null>;
}

export function createNativeSupport(options: NativeSupportOptions): NativeSupport {
  const z = options.zotero; const environment = options.environment ?? nativeEnvironment();
  const readURL = async (url: string, signal?: AbortSignal, path?: string): Promise<HostHTTPResponse> => {
    let current = publicURL(url);
    for (let redirects = 0; redirects < 6; redirects++) {
      if (!current) fail('INVALID_INPUT', 'The requested URL is outside the permitted web scope.');
      const requested = current;
      const response = await requestWithSignal(signal, requestOptions => path
        ? z.HTTP.download(requested, path, { ...requestOptions, followRedirects: false })
        // Zotero HTTP also follows HTML meta refreshes; numRedirects=3 disables that branch.
        : z.HTTP.request('GET', requested, { ...requestOptions, responseType: 'document', followRedirects: false, numRedirects: 3 }));
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.getResponseHeader?.('Location');
        current = location ? publicURL(new URL(location, requested).href) : null;
        continue;
      }
      if (response.status < 200 || response.status >= 300) fail('UNAVAILABLE', 'The web request did not return a successful response.');
      const finalURL = publicURL(response.responseURL || requested); if (!finalURL) fail('INVALID_INPUT', 'The response URL is outside the permitted web scope.');
      return { response: response.response, status: response.status, responseURL: finalURL };
    }
    fail('UNAVAILABLE', 'The article link redirected too many times.');
  };
  const scope = (value: { clientId: string; libraryId: number }): void => {
    if (value.clientId !== options.clientId || !Number.isSafeInteger(value.libraryId) || value.libraryId < 1 || !z.Libraries.get(value.libraryId)) fail('INVALID_INPUT', 'The native task belongs to another profile or library.');
  };
  const paper = (value: PaperScope): NativeHostItem => {
    scope(value); key(value.attachmentKey);
    const item = z.Items.getByLibraryAndKey(value.libraryId, value.attachmentKey);
    if (!item || item.deleted || !item.isPDFAttachment()) fail('NOT_FOUND', 'The task PDF is no longer available.');
    return item;
  };
  const capture = options.captureDocument ? (p: PaperScope, signal?: AbortSignal) => options.captureDocument!(p, signal) : ((p: PaperScope, signal?: AbortSignal) => {
    const source = nativeDocumentSource(z as unknown as ZoteroHost, () => z.Reader._readers.find(r => { const item = z.Items.get(r.itemID); return item && item.key === p.attachmentKey && item.libraryID === p.libraryId; }), p);
    return source.capture(signal);
  });
  const cleanDOI = (value: string): string => { const doi = z.Utilities.cleanDOI(value); return doi ? doi.toLowerCase() : ''; };
  const readMetadata = (value: unknown, strict: boolean): NativeMetadata => {
    const raw = object(value);
    if (strict && Object.keys(raw).some(k => !['itemType', 'title', 'creators', ...NATIVE_METADATA_FIELDS].includes(k))) fail('INVALID_INPUT', 'Metadata contains fields outside the approved import scope.');
    const type = string(raw.itemType); if (!NATIVE_ITEM_TYPES.has(type)) fail('INVALID_INPUT', 'This item type is not supported for task imports.');
    const title = string(raw.title); if (!title) fail('INVALID_INPUT', 'Verified metadata must have a title.');
    if (raw.creators !== undefined && (!Array.isArray(raw.creators) || raw.creators.length > 100)) fail('INVALID_INPUT', 'Invalid metadata creators.');
    const creators: NativeCreator[] = [];
    for (const value of (raw.creators ?? []) as unknown[]) {
      const creator = object(value);
      if (strict && Object.keys(creator).some(k => !['creatorType', 'firstName', 'lastName', 'name'].includes(k))) fail('INVALID_INPUT', 'Invalid metadata creator fields.');
      if (creator.creatorType !== undefined && creator.creatorType !== 'author' && creator.creatorType !== 'editor') { if (strict) fail('INVALID_INPUT', 'Unsupported creator role.'); continue; }
      const c: NativeCreator = { creatorType: creator.creatorType === 'editor' ? 'editor' : 'author' };
      if (creator.name) c.name = string(creator.name, 512);
      else { if (creator.firstName) c.firstName = string(creator.firstName, 512); if (creator.lastName) c.lastName = string(creator.lastName, 512); }
      if (c.name || c.lastName) creators.push(c);
    }
    const result: NativeMetadata = { itemType: type as NativeMetadata['itemType'], title, creators };
    for (const field of NATIVE_METADATA_FIELDS) {
      if (raw[field] === undefined || raw[field] === '') continue;
      const value = string(raw[field], field === 'abstractNote' ? 32768 : 8192);
      if (!value) continue;
      if (field === 'DOI') { const doi = cleanDOI(value); if (!doi) { if (strict) fail('INVALID_INPUT', 'Invalid metadata DOI.'); continue; } result.DOI = doi; }
      else if (field === 'url') { const url = publicURL(value); if (!url) { if (strict) fail('INVALID_INPUT', 'Invalid metadata URL.'); continue; } result.url = url; }
      else result[field] = value;
    }
    return result;
  };
  // Canonical full native item JSON: only used to detect later edits, never sent to the model.
  const contentSignature = (item: NativeHostItem): string => canonical(item.toJSON());
  const organizationSignature = (item: NativeHostItem): string => {
    const raw = clone(item.toJSON()) as Record<string, unknown>;
    for (const field of ['tags', 'collections', 'dateAdded', 'dateModified', 'version']) delete raw[field];
    return canonical(raw);
  };
  const itemSnapshot = (item: NativeHostItem): NativeItemSnapshot => {
    const raw: Record<string, unknown> = { itemType: item.itemType, title: item.getField('title'), creators: item.getCreatorsJSON() };
    for (const field of NATIVE_METADATA_FIELDS) { const value = item.getField(field); if (value) raw[field] = value; }
    return { clientId: options.clientId, libraryId: item.libraryID, key: item.key, metadata: readMetadata(raw, false),
      collectionKeys: item.getCollections().map(id => z.Collections.get(id)).filter(c => !!c).map(c => c.key).sort(),
      attachmentKeys: item.getAttachments().map(id => z.Items.get(id)).filter(i => !!i).map(i => i.key).sort(), dateModified: item.dateModified, contentSignature: contentSignature(item) };
  };
  const organizationItemSnapshot = (item: NativeHostItem): NativeOrganizationItemSnapshot => ({
    ...itemSnapshot(item),
    tags: item.getTags().map(entry => entry.tag.trim().normalize('NFC')).filter(Boolean).sort(),
    organizationSignature: organizationSignature(item),
  });
  const getItem = (ref: NativeItemRef): NativeHostItem | null => { scope(ref); key(ref.key); const item = z.Items.getByLibraryAndKey(ref.libraryId, ref.key); return item && !item.deleted && item.isRegularItem() ? item : null; };
  const annotationSnapshot = (p: PaperScope, item: NativeHostItem): NativeAnnotationSnapshot | null => {
    const parent = paper(p);
    if (item.deleted || !item.isAnnotation() || item.parentID !== parent.id || !['highlight', 'underline'].includes(item.annotationType)) return null;
    return { paper: clone(p), key: item.key, type: item.annotationType as 'highlight' | 'underline', text: item.annotationText ?? '', comment: item.annotationComment ?? '', color: item.annotationColor ?? '', pageLabel: item.annotationPageLabel ?? '', sortIndex: item.annotationSortIndex ?? '', position: position(JSON.parse(item.annotationPosition ?? '{}')), authorName: item.annotationAuthorName ?? '', isExternal: item.annotationIsExternal, tags: item.getTags().map(t => t.tag).sort(), dateModified: item.dateModified };
  };
  const prepareFigureCallout = (value: NativeFigureCalloutInput, signal?: AbortSignal): Promise<NativeFigureCalloutPrepared> => boundary(async () => {
    checkSignal(signal); const input = clone(value); key(input.imageKey); key(input.inkKey);
    if (input.imageKey === input.inkKey || !Number.isSafeInteger(input.index) || input.index < 0 || input.index >= 5) fail('INVALID_INPUT', 'The figure callout identity is invalid.');
    const selection = input.selection; paper(selection.paper);
    if (!Number.isSafeInteger(selection.pageIndex) || selection.pageIndex < 0 || selection.pageIndex >= 10000 || !selection.revision || typeof selection.revision.fingerprint !== 'string' || !selection.revision.fingerprint || !Number.isSafeInteger(selection.revision.size) || selection.revision.size < 0 || !Number.isFinite(selection.revision.modifiedAt)) fail('INVALID_INPUT', 'The selected figure identity is invalid.');
    const region = rect(selection.rect); if (!region) fail('INVALID_INPUT', 'The selected figure bounds are invalid.');
    const image = validateImageAttachment(input.image);
    if (image.mime !== 'image/png' || image.origin?.kind !== 'paper' || !equal(image.origin.paper, selection.paper) || image.origin.pageIndex !== selection.pageIndex || !equal(image.origin.revision, selection.revision)) fail('CONFLICT', 'The selected figure image does not match the frozen PDF region.');
    const source = await waitRead(capture(selection.paper, signal), signal);
    if (!revisionMatches(selection.revision, source.revision)) fail('SOURCE_CHANGED', 'The selected PDF changed after the figure was explained.');
    if (selection.pageIndex >= source.pdf.numPages) fail('NOT_FOUND', 'The selected PDF page no longer exists.');
    const pageData = await waitRead(source.pdf.getPageData({ pageIndex: selection.pageIndex }), signal);
    const viewBox = pageData.viewBox;
    if (!Array.isArray(viewBox) || viewBox.length !== 4 || !viewBox.every(Number.isFinite) || region[0] < viewBox[0]! || region[1] < viewBox[1]! || region[2] > viewBox[2]! || region[3] > viewBox[3]!) fail('INVALID_INPUT', 'The selected figure lies outside the current PDF page.');
    const proposal = validateFigureCalloutProposal(input.proposal);
    const width = region[2] - region[0]; const height = region[3] - region[1];
    const normRect = proposal.box;
    const pdfRect = rect([
      region[0] + normRect[0] * width,
      region[3] - normRect[3] * height,
      region[0] + normRect[2] * width,
      region[3] - normRect[1] * height,
    ]);
    if (!pdfRect || pdfRect[0] < viewBox[0]! || pdfRect[1] < viewBox[1]! || pdfRect[2] > viewBox[2]! || pdfRect[3] > viewBox[3]!) fail('INVALID_INPUT', 'The callout rectangle lies outside the selected PDF region.');
    const labels = await waitRead(source.pdf.getPageLabels2(), signal);
    const fresh = await waitRead(capture(selection.paper, signal), signal);
    if (!revisionMatches(selection.revision, fresh.revision)) fail('SOURCE_CHANGED', 'The selected PDF changed while validating Figure callout coordinates.');
    const pageLabel = labels?.[selection.pageIndex]?.trim() || String(selection.pageIndex + 1);
    const top = Math.min(99999, Math.max(0, Math.floor(viewBox[3]! - pdfRect[3])));
    const sortIndex = `${String(selection.pageIndex).padStart(5, '0')}|000000|${String(top).padStart(5, '0')}`;
    const label = String.fromCharCode(65 + input.index);
    const comment = `${NATIVE_ANNOTATION_PROVENANCE}\n${label}: ${cleanAnnotationReason(proposal.explanation)}`;
    const color = '#7c5cff';
    const imageSHA256 = await sha256Text(image.dataUrl);
    const imageAnnotation: Omit<NativeFigureAnnotationSnapshot, 'dateModified'> = {
      paper: clone(selection.paper), key: input.imageKey, type: 'image', comment, color, pageLabel, sortIndex,
      position: { pageIndex: selection.pageIndex, rects: [pdfRect] }, authorName: '', isExternal: false, tags: [], imageSHA256,
    };
    const paths = proposal.strokes.map(stroke => stroke.flatMap(([x, y]) => [
      Math.round((region[0] + x * width) * 1000) / 1000,
      Math.round((region[3] - y * height) * 1000) / 1000,
    ]));
    const inkAnnotation: Omit<NativeFigureAnnotationSnapshot, 'dateModified'> = {
      paper: clone(selection.paper), key: input.inkKey, type: 'ink', comment: `${NATIVE_ANNOTATION_PROVENANCE}\n${label} callout`, color, pageLabel, sortIndex,
      position: figurePosition({ pageIndex: selection.pageIndex, paths, width: 2.5 }, 'ink'), authorName: '', isExternal: false, tags: [], imageSHA256,
    };
    return { selection: clone(selection), image: imageAnnotation, ink: inkAnnotation };
  });
  const figureAnnotationRecord = (p: PaperScope, item: NativeHostItem): NativeFigureAnnotationRecord | null => {
    const parent = paper(p);
    if (item.deleted || !item.isAnnotation() || item.parentID !== parent.id || !['image', 'ink'].includes(item.annotationType)) return null;
    const type = item.annotationType as 'image' | 'ink';
    const position = figurePosition(JSON.parse(item.annotationPosition ?? '{}'), type);
    return { paper: clone(p), key: item.key, type, comment: item.annotationComment ?? '', color: item.annotationColor ?? '', pageLabel: item.annotationPageLabel ?? '', sortIndex: item.annotationSortIndex ?? '', position, authorName: item.annotationAuthorName ?? '', isExternal: item.annotationIsExternal, tags: item.getTags().map(t => t.tag).sort(), dateModified: item.dateModified };
  };
  const figureAnnotationSnapshot = async (p: PaperScope, item: NativeHostItem): Promise<NativeFigureAnnotationSnapshot | null> => {
    const record = figureAnnotationRecord(p, item); if (!record) return null;
    const serialized = await z.Annotations.toJSON(item);
    if (typeof serialized.image !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u.test(serialized.image)) return null;
    return { ...record, imageSHA256: await sha256Text(serialized.image) };
  };
  return { clientId: options.clientId, z, environment, readURL, scope, paper, capture, cleanDOI, readMetadata, itemSnapshot, organizationItemSnapshot, getItem, contentSignature, annotationSnapshot, prepareFigureCallout, figureAnnotationRecord, figureAnnotationSnapshot };
}
