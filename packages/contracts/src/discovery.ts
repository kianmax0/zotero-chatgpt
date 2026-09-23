/** Bounded, source-attributed search result that can be handed to the existing acquisition preview. */
export interface ScholarlyDiscoveryRequest {
  topic: string;
  limit?: number;
  yearFrom?: number;
  yearTo?: number;
  openAccessOnly?: boolean;
}

/** Input after validation and defaulting, passed only to a fixed scholarly-source adapter. */
export interface NormalizedScholarlyDiscoveryRequest {
  topic: string;
  limit: number;
  yearFrom?: number;
  yearTo?: number;
  openAccessOnly: boolean;
}

export interface ScholarlyDiscoveryCandidate {
  /** Stable source identity, useful for deduplication and provenance; never a Zotero key. */
  id: string;
  /** DOI URL when valid, otherwise a validated public landing page URL. */
  identifier: string;
  /** Normalized DOI without a URL prefix, or null when the source DOI is absent/invalid. */
  doi: string | null;
  title: string;
  authors: string[];
  year: number | null;
  source: { provider: 'openalex'; workUrl: string };
  openAccess: {
    isOpenAccess: boolean;
    status: string | null;
    landingPageUrl: string | null;
    pdfUrl: string | null;
    repository: string | null;
  };
}

export interface ScholarlyDiscoveryPreview {
  source: 'openalex';
  query: NormalizedScholarlyDiscoveryRequest;
  candidates: ScholarlyDiscoveryCandidate[];
}

/** The adapter has one fixed upstream source and cannot accept a URL or tool list from a model. */
export interface ScholarlyDiscoveryPort {
  search(request: NormalizedScholarlyDiscoveryRequest, signal?: AbortSignal): Promise<ScholarlyDiscoveryCandidate[]>;
}
