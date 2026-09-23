import { ReaderError } from '../../../contracts/src/index.ts';
import type { NormalizedScholarlyDiscoveryRequest, ScholarlyDiscoveryCandidate, ScholarlyDiscoveryPort, ScholarlyDiscoveryPreview, ScholarlyDiscoveryRequest } from '../../../contracts/src/discovery.ts';
export type { ScholarlyDiscoveryCandidate, ScholarlyDiscoveryPort, ScholarlyDiscoveryPreview, ScholarlyDiscoveryRequest } from '../../../contracts/src/discovery.ts';

const MAX_TOPIC_LENGTH = 200;
const MAX_RESULTS = 20;
const YEAR_MIN = 1500;
const YEAR_MAX = 9999;

function invalid(message: string): never { throw new ReaderError('INVALID_REQUEST', message); }
function normalizeRequest(input: ScholarlyDiscoveryRequest): NormalizedScholarlyDiscoveryRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid('Enter a research topic.');
  const topic = typeof input.topic === 'string' ? input.topic.normalize('NFC').trim().replace(/\s+/gu, ' ') : '';
  if (!topic) return invalid('Enter a research topic.');
  if (topic.length > MAX_TOPIC_LENGTH || /[\u0000-\u001f]/u.test(topic)) return invalid('Enter a research topic of at most 200 characters.');
  const limit = input.limit ?? 10;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RESULTS) return invalid('Choose between 1 and 20 results.');
  for (const [label, year] of [['start', input.yearFrom], ['end', input.yearTo]] as const) {
    if (year !== undefined && (!Number.isSafeInteger(year) || year < YEAR_MIN || year > YEAR_MAX)) return invalid(`The publication ${label} year is invalid.`);
  }
  if (input.yearFrom !== undefined && input.yearTo !== undefined && input.yearFrom > input.yearTo) return invalid('The publication year range is invalid.');
  if (input.openAccessOnly !== undefined && typeof input.openAccessOnly !== 'boolean') return invalid('The open-access filter is invalid.');
  return {
    topic, limit, openAccessOnly: input.openAccessOnly ?? false,
    ...(input.yearFrom !== undefined ? { yearFrom: input.yearFrom } : {}),
    ...(input.yearTo !== undefined ? { yearTo: input.yearTo } : {}),
  };
}

function validIdentifier(value: string): boolean {
  try {
    const url = new URL(value); const host = url.hostname.toLowerCase();
    // Network candidates must be HTTPS host names. Reject credentials, IP literals and local names;
    // Zotero's existing URL acquisition boundary performs its own public-host and redirect checks.
    return url.protocol === 'https:' && !url.username && !url.password && host.includes('.') && !host.includes(':')
      && !/^\d+(?:\.\d+){0,3}$/u.test(host) && host !== 'localhost' && !host.endsWith('.localhost') && !host.endsWith('.local');
  } catch { return false; }
}

function keepCandidate(candidate: ScholarlyDiscoveryCandidate): boolean {
  return candidate.source?.provider === 'openalex'
    && typeof candidate.id === 'string' && /^https:\/\/openalex\.org\/W[A-Z0-9]+$/u.test(candidate.id)
    && typeof candidate.title === 'string' && candidate.title.trim().length > 0
    && typeof candidate.identifier === 'string' && validIdentifier(candidate.identifier)
    && typeof candidate.openAccess?.isOpenAccess === 'boolean';
}

/** Validates a model-independent topic query, then deduplicates only the bounded source results. */
export async function discoverScholarlyWorks(
  port: ScholarlyDiscoveryPort,
  input: ScholarlyDiscoveryRequest,
  signal?: AbortSignal,
): Promise<ScholarlyDiscoveryPreview> {
  const query = normalizeRequest(input);
  if (signal?.aborted) throw new ReaderError('INVALID_REQUEST', 'Scholarly search was cancelled.');
  const returned = await port.search(query, signal);
  if (signal?.aborted) throw new ReaderError('INVALID_REQUEST', 'Scholarly search was cancelled.');
  const candidates: ScholarlyDiscoveryCandidate[] = [];
  const identities = new Set<string>();
  for (const candidate of returned) {
    if (!keepCandidate(candidate) || (query.openAccessOnly && !candidate.openAccess.isOpenAccess)) continue;
    const identity = candidate.doi ? `doi:${candidate.doi.toLocaleLowerCase()}` : `url:${candidate.identifier}`;
    if (identities.has(identity)) continue;
    identities.add(identity); candidates.push(candidate);
    if (candidates.length === query.limit) break;
  }
  return { source: 'openalex', query, candidates };
}
