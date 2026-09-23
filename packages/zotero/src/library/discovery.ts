import { ReaderError } from '../../../contracts/src/index.ts';
import type { NormalizedScholarlyDiscoveryRequest, ScholarlyDiscoveryCandidate, ScholarlyDiscoveryPort } from '../../../contracts/src/discovery.ts';
import type { NativeZoteroHost } from '../host/native.ts';
import { publicURL } from './native-support.ts';

const OPENALEX_ENDPOINT = 'https://api.openalex.org/works';
const MAX_RESULTS = 20;
const REQUEST_TIMEOUT_MS = 12_000;
const RESPONSE_BYTES = 2_000_000;
const SELECT = 'id,doi,title,authorships,publication_year,open_access,best_oa_location';
const DOI_PATTERN = /^10\.\d{4,9}\/[^\s<>"'\\]+$/iu;

interface OpenAlexLocation {
  landing_page_url?: unknown;
  pdf_url?: unknown;
  source?: { display_name?: unknown } | null;
}
interface OpenAlexWork {
  id?: unknown;
  doi?: unknown;
  title?: unknown;
  publication_year?: unknown;
  authorships?: unknown;
  open_access?: { is_oa?: unknown; oa_status?: unknown; oa_url?: unknown } | null;
  best_oa_location?: OpenAlexLocation | null;
}

function unavailable(): ReaderError { return new ReaderError('RUNTIME_UNAVAILABLE', 'Scholarly search is currently unavailable.'); }
function invalidResponse(): ReaderError { return new ReaderError('UNSUPPORTED_INTERACTION', 'Scholarly search returned an invalid response.'); }
function canceled(): ReaderError { return new ReaderError('INVALID_REQUEST', 'Scholarly search was cancelled.'); }
function object(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }

/** Only HTTPS host names are eligible as acquisition identifiers or OA provenance links. */
function safePublicHttps(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  const safe = publicURL(value);
  return safe && new URL(safe).protocol === 'https:' ? safe : null;
}

function normalizeDOI(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 1024) return null;
  let doi = value.trim().normalize('NFC').replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, '');
  try { doi = decodeURIComponent(doi); } catch { return null; }
  return DOI_PATTERN.test(doi) ? doi : null;
}

function shortText(value: unknown, limit: number): string | null {
  return typeof value === 'string' && value.trim() && value.length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)
    ? value.normalize('NFC').trim() : null;
}

function workURL(value: unknown): string | null {
  if (typeof value !== 'string' || !/^https:\/\/openalex\.org\/W[A-Z0-9]+$/u.test(value)) return null;
  return value;
}

function authorsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const authors: string[] = [];
  for (const entry of value.slice(0, 20)) {
    const name = shortText(object(object(entry)?.author)?.display_name, 256);
    if (name && !authors.includes(name)) authors.push(name);
    if (authors.length === 12) break;
  }
  return authors;
}

function mapWork(value: unknown): ScholarlyDiscoveryCandidate | null {
  const work = object(value) as OpenAlexWork | null;
  if (!work) return null;
  const id = workURL(work.id); const title = shortText(work.title, 2000);
  if (!id || !title) return null;
  const openAccessRecord = object(work.open_access) as OpenAlexWork['open_access'];
  const location = object(work.best_oa_location) as OpenAlexLocation | null;
  const doi = normalizeDOI(work.doi);
  const landingPageUrl = safePublicHttps(location?.landing_page_url) ?? safePublicHttps(openAccessRecord?.oa_url);
  // Explicit DOI is the strongest identifier for Zotero's existing translator acquisition flow.
  // DOI-less works remain eligible only when OpenAlex supplied a safe public landing page.
  const identifier = doi ? `https://doi.org/${doi}` : landingPageUrl;
  if (!identifier) return null;
  const isOpenAccess = openAccessRecord?.is_oa === true;
  const year = Number.isSafeInteger(work.publication_year) && (work.publication_year as number) >= 1500 && (work.publication_year as number) <= 9999
    ? work.publication_year as number : null;
  return {
    id, identifier, doi, title, authors: authorsOf(work.authorships), year,
    source: { provider: 'openalex', workUrl: id },
    openAccess: {
      isOpenAccess,
      status: shortText(openAccessRecord?.oa_status, 32),
      landingPageUrl,
      pdfUrl: safePublicHttps(location?.pdf_url),
      repository: shortText(object(location?.source)?.display_name, 256),
    },
  };
}

function parseResponse(response: unknown): OpenAlexWork[] {
  let value = response;
  if (typeof value === 'string') {
    if (new TextEncoder().encode(value).length > RESPONSE_BYTES) throw invalidResponse();
    try { value = JSON.parse(value) as unknown; } catch { throw invalidResponse(); }
  }
  if (value && typeof value === 'object') {
    try { if (new TextEncoder().encode(JSON.stringify(value)).length > RESPONSE_BYTES) throw invalidResponse(); }
    catch (error) { if (error instanceof ReaderError) throw error; throw invalidResponse(); }
  }
  const root = object(value);
  if (!root || !Array.isArray(root.results) || root.results.length > MAX_RESULTS) throw invalidResponse();
  return root.results as OpenAlexWork[];
}

function validateRequest(request: NormalizedScholarlyDiscoveryRequest): void {
  if (!request || typeof request.topic !== 'string' || !request.topic.trim() || request.topic.length > 200
    || !Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > MAX_RESULTS
    || typeof request.openAccessOnly !== 'boolean'
    || (request.yearFrom !== undefined && (!Number.isSafeInteger(request.yearFrom) || request.yearFrom < 1500 || request.yearFrom > 9999))
    || (request.yearTo !== undefined && (!Number.isSafeInteger(request.yearTo) || request.yearTo < 1500 || request.yearTo > 9999))
    || (request.yearFrom !== undefined && request.yearTo !== undefined && request.yearFrom > request.yearTo)) {
    throw new ReaderError('INVALID_REQUEST', 'The scholarly search request is invalid.');
  }
}

/** A single fixed OpenAlex endpoint; callers cannot supply URLs, headers, tools, or network policy. */
export function createOpenAlexDiscoveryPort(zotero: Pick<NativeZoteroHost, 'HTTP'>): ScholarlyDiscoveryPort {
  return {
    search: async (request, signal) => {
      validateRequest(request);
      if (signal?.aborted) throw canceled();
      const url = new URL(OPENALEX_ENDPOINT);
      url.searchParams.set('search', request.topic);
      url.searchParams.set('per-page', String(request.limit));
      url.searchParams.set('select', SELECT);
      const filters: string[] = [];
      if (request.yearFrom !== undefined) filters.push(`from_publication_date:${request.yearFrom}-01-01`);
      if (request.yearTo !== undefined) filters.push(`to_publication_date:${request.yearTo}-12-31`);
      if (request.openAccessOnly) filters.push('is_oa:true');
      if (filters.length) url.searchParams.set('filter', filters.join(','));

      let cancel = () => {};
      const onAbort = () => cancel();
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const response = await zotero.HTTP.request('GET', url.href, {
          anon: true, timeout: REQUEST_TIMEOUT_MS, errorDelayMax: 0,
          followRedirects: false, numRedirects: 0, responseType: 'json',
          cancellerReceiver: callback => { cancel = callback; if (signal?.aborted) callback(); },
        });
        if (signal?.aborted) throw canceled();
        let final: URL;
        try { final = new URL(response.responseURL); } catch { throw new ReaderError('UNSUPPORTED_INTERACTION', 'Scholarly search left the permitted source.'); }
        if (final.protocol !== 'https:' || final.hostname !== 'api.openalex.org' || final.pathname !== '/works' || final.username || final.password) {
          throw new ReaderError('UNSUPPORTED_INTERACTION', 'Scholarly search left the permitted source.');
        }
        if (response.status !== 200) throw unavailable();
        const candidates = parseResponse(response.response).map(mapWork).filter((candidate): candidate is ScholarlyDiscoveryCandidate => !!candidate);
        const unique: ScholarlyDiscoveryCandidate[] = []; const seen = new Set<string>();
        for (const candidate of candidates) {
          if (request.openAccessOnly && !candidate.openAccess.isOpenAccess) continue;
          const identity = candidate.doi ? `doi:${candidate.doi.toLocaleLowerCase()}` : `url:${candidate.identifier}`;
          if (seen.has(identity)) continue;
          seen.add(identity); unique.push(candidate);
          if (unique.length >= request.limit) break;
        }
        return unique;
      } catch (error) {
        if (error instanceof ReaderError) throw error;
        if (signal?.aborted) throw canceled();
        throw unavailable();
      } finally { signal?.removeEventListener('abort', onAbort); }
    },
  };
}
