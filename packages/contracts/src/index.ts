// Shared business contracts. Runtime validation lives in ./validation.ts and must be applied at
// every boundary; TypeScript types alone are not trusted for input crossing modules.
export type { NormalizedScholarlyDiscoveryRequest, ScholarlyDiscoveryCandidate, ScholarlyDiscoveryPort, ScholarlyDiscoveryPreview, ScholarlyDiscoveryRequest } from './discovery.ts';
export type UUID = string;
export type Rect = [number, number, number, number];

export interface PaperScope {
  clientId: UUID;        // persistent random namespace of the Zotero profile
  libraryId: number;     // Zotero local library id; meaningful only inside clientId
  attachmentKey: string; // Zotero attachment item key
}

export function paperId(paper: PaperScope): string {
  return JSON.stringify([paper.clientId, paper.libraryId, paper.attachmentKey]);
}

export interface GenerationSettings {
  model: string;
  serviceTier: string | null; // null: the model's catalog default tier
  effort: string | null;      // null: the model's catalog default reasoning effort
}

export interface Citation {
  id: UUID;
  paper: PaperScope;
  text: string;          // original text, never HTML
  title: string;
  authors: string[];
  year?: string;
  doi?: string;
  pageLabel: string;
  positions: Array<{ pageIndex: number; rects: Rect[] }>;
  capturedAt: string;    // ISO 8601
  contextScope: 'selection';
  sourceRevision?: { size: number; modifiedAt: string };
  documentRevision?: DocumentRevision;
}

export type RequestState = 'accepted' | 'dispatching' | 'running' | 'completed' | 'cancelled' | 'failed' | 'uncertain';
export type MessageStatus = 'pending' | 'streaming' | 'completed' | 'cancelled' | 'failed' | 'uncertain';
/**
 * How one request is routed, frozen per request like its model settings. `chat` is the read-only
 * reader; `agent` may additionally reach the task/action path. It is a separate field on purpose and
 * does not extend `WorkflowKind`: the UI/skill state and the routing contract evolve independently.
 */
export type RequestMode = 'chat' | 'agent';

/**
 * Local, honest timing of one request. `firstTextAt` is the first delivered assistant text, not a
 * tokenizer measurement: the core coalesces deltas, so it may lag the upstream first token slightly.
 * `settledAt` stays null until the request reaches a terminal state; views must not infer completion
 * from elapsed time.
 */
export interface RequestTiming {
  requestId: UUID;
  acceptedAt: string;
  firstTextAt: string | null;
  settledAt: string | null;
  /**
   * Last time upstream showed real activity for this request, after acceptance — including liveness
   * that never becomes assistant text (reasoning deltas, usage reports, item lifecycle). Acceptance
   * itself is our own bookkeeping, not evidence the model started, so it must NOT stamp this mark:
   * `acceptedAt` already carries the send time, and counting acceptance here would make "nothing heard
   * from upstream yet" unreachable and disagree with the core, which only persists upstream activity.
   * Optional so timings persisted before this field existed, and callers that only know
   * accept/first-text/settle, stay valid; absent means no upstream activity observed yet, which is not
   * the same as activity having stopped. Keep it optional and keep `accepted` out — see `requestProgress`.
   */
  lastActivityAt?: string | null;
}

/** What a view can honestly say about one request right now. */
export interface RequestProgress {
  requestId: UUID;
  /** True once the core reported a terminal state; `elapsedSeconds` is then frozen at that time. */
  settled: boolean;
  /**
   * Whole seconds since acceptance: to `settledAt` once settled, otherwise to `now`. Never negative;
   * null when the timestamps cannot be read, so a view shows no counter rather than a fabricated one.
   */
  elapsedSeconds: number | null;
  /** Whole seconds from acceptance to the first delivered assistant text, or null before it arrives. */
  firstTextSeconds: number | null;
  /**
   * Whole seconds since the last observed activity for this request, or null when none was observed
   * or the timestamp cannot be read. Liveness only: it proves the runtime is still working on the
   * turn (reasoning output, usage reports), not that an answer is imminent.
   */
  sinceActivitySeconds: number | null;
}

function wholeSeconds(from: string, to: string | number): number | null {
  const start = Date.parse(from); const end = typeof to === 'number' ? to : Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.floor((end - start) / 1000));
}

/**
 * Derives the honest progress of one request. Callers pass their own clock, so the same function
 * serves a live "waiting Ns" counter and a settled "answered in Ns" summary: a settled request stops
 * at `settledAt` instead of growing, and `firstTextSeconds` stays null until the core stamps it.
 */
export function requestProgress(timing: RequestTiming, now: number | string = Date.now()): RequestProgress {
  const { settledAt } = timing;
  return {
    requestId: timing.requestId,
    settled: settledAt !== null,
    elapsedSeconds: wholeSeconds(timing.acceptedAt, settledAt ?? now),
    firstTextSeconds: timing.firstTextAt === null ? null : wholeSeconds(timing.acceptedAt, timing.firstTextAt),
    sinceActivitySeconds: timing.lastActivityAt ? wholeSeconds(timing.lastActivityAt, settledAt ?? now) : null,
  };
}

const TERMINAL_EVENTS = new Set<ReaderEvent['type']>(['completed', 'cancelled', 'failed', 'uncertain']);

function eventText(event: ReaderEvent): string | null {
  switch (event.type) {
    case 'delta': return event.text;
    case 'messageCompleted': return event.finalText;
    case 'completed': return event.finalText;
    default: return null;
  }
}

/**
 * Applies one core event to a conversation's timing, mirroring the core's own rule: the first
 * delivered text is stamped once by the event that carried it, and a terminal event stops the clock
 * even when the view never saw text. Returns a new array; entries are only added for requests the
 * core already described, because inventing an acceptance time mid-stream would fake the elapsed
 * value. Re-delivered events keep the earliest first-text/settle stamps and the latest activity mark;
 * `accepted` drives the accepted time but never stamps that mark, which tracks upstream activity only.
 */
export function advanceRequestTiming(current: readonly RequestTiming[] | undefined, event: ReaderEvent): RequestTiming[] {
  const entries = [...(current ?? [])];
  const index = entries.findIndex(entry => entry.requestId === event.requestId);
  if (index === -1) return entries;
  const entry = { ...entries[index] } as RequestTiming;
  const text = eventText(event);
  if (entry.firstTextAt === null && text !== null && text.length > 0) entry.firstTextAt = event.at;
  if (TERMINAL_EVENTS.has(event.type) && entry.settledAt === null) entry.settledAt = event.at;
  // Any upstream event for this request proves the runtime is still working on it, even when it carries
  // no answer text (reasoning deltas, usage reports, progress pings, item lifecycle). Acceptance is the
  // one exception: it is our own bookkeeping, and the core persists only upstream activity, so stamping
  // it here would make the displayed liveness mean something different from the stored one. Activity
  // moves forward only, so a re-delivered or out-of-order event cannot make the turn look fresher.
  if (event.type !== 'accepted') {
    const activity = Date.parse(event.at);
    const previous = entry.lastActivityAt == null ? Number.NaN : Date.parse(entry.lastActivityAt);
    if (!Number.isFinite(previous) || (Number.isFinite(activity) && activity >= previous)) entry.lastActivityAt = event.at;
  }
  entries[index] = entry;
  return entries;
}

/**
 * Bibliographic identity of one paper. The four original fields stay required semantics: every
 * field below them is optional and absent means "not declared by Zotero", never "empty string".
 * Requests are hashed with this object verbatim (hashVersion 2), so a reader that rebuilds a request
 * must preserve field absence instead of filling a default.
 *
 * The optional names mirror Zotero's own item field names (`publicationTitle`, `journalAbbreviation`,
 * `bookTitle`, ...) so an extracted value stays traceable to the single field it came from. The
 * reader only fills a field it actually read; see `packages/core/src/context/bibliography.ts`.
 */
export interface PaperIdentity {
  title: string;
  authors: string[];
  year?: string;
  doi?: string;
  /** Zotero item type of the bibliographic parent, for example `journalArticle`; omitted for a bare PDF. */
  itemType?: string;
  publicationTitle?: string;
  journalAbbreviation?: string;
  bookTitle?: string;
  conferenceName?: string;
  proceedingsTitle?: string;
  university?: string;
  institution?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  publisher?: string;
  isbn?: string;
  issn?: string;
  language?: string;
  abstractNote?: string;
  tags?: string[];
  editors?: string[];
}

export interface DocumentRevision { fingerprint: string; size: number; modifiedAt: number; sha256?: string }
export interface DocumentPage { pageIndex: number; pageLabel: string; text: string; status: 'text' | 'empty' | 'error'; partial?: true }
/** Locally extracted text. No filesystem path or claim that figures were read. */
export interface DocumentContext {
  id: UUID;
  paper: PaperScope;
  revision: DocumentRevision;
  parserVersion: string;
  totalPages: number;
  pages: DocumentPage[];
  sourceId?: UUID;
}
export interface DocumentSummary {
  id: UUID;
  revision: DocumentRevision;
  parserVersion: string;
  totalPages: number;
  pages: Array<Pick<DocumentPage, 'pageIndex' | 'pageLabel' | 'status' | 'partial'>>;
  textBytes: number;
  sourceId?: UUID;
}
export interface ContextBatch {
  id: UUID; index: number; total: number; phase: 'map' | 'reduce'; question: string;
  summaries?: Array<{ index: number; pages: number[]; pageLabels?: string[]; text: string; paper?: PaperScope; title?: string }>;
}
export interface UsageReport {
  model: string;
  contextWindow: number | null;
  last: { inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningOutputTokens: number; totalTokens: number };
  total: { inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningOutputTokens: number; totalTokens: number };
}
export interface ContextReport {
  mode: 'full' | 'focused' | 'multi-pass';
  capacity: number | null; provenance: 'runtime-reported' | 'pinned-catalog' | 'unknown';
  reservedTokens: number | null; textBudgetTokens: number | null;
  selectedPages: number[]; totalPages: number; reason: string;
}

/** User-attached image for `turn/start` UserInput::Image `{ type: "image", url }` (rust-v0.144.1). */
export interface ImageAttachment {
  id: UUID;
  name: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  dataUrl: string;
  origin?: { kind: 'generated'; model?: string } | { kind: 'paper'; paper: PaperScope; pageIndex: number; revision: DocumentRevision };
}

export interface Message {
  id: UUID;
  /** Opaque native item identity for restart reconciliation; never a filesystem path. */
  upstreamItemId?: string;
  requestId: UUID;
  role: 'user' | 'assistant';
  phase: 'commentary' | 'final' | null;
  settings: GenerationSettings;
  effectiveSettings?: GenerationSettings;
  text: string;
  citations: Citation[];
  status: MessageStatus;
  /** Present on user messages so the view can hide internal explain prompts. */
  action?: 'explain' | 'ask';
  /**
   * Routing mode frozen for this request. Absent on messages persisted before the field existed and
   * then means `'chat'` (D3); the store does not rewrite an old record to add it.
   */
  mode?: RequestMode;
  images?: ImageAttachment[];
  document?: DocumentSummary;
  paper?: PaperIdentity;
  workflow?: import('./workspace.ts').WorkflowSnapshot;
  references?: import('./workspace.ts').ReaderReference[];
  referenceDocuments?: Array<{ referenceId: string; document: DocumentSummary }>;
  batch?: ContextBatch;
  contextReport?: ContextReport;
  /** Host-frozen native selection for an organization request; never rebuilt from current focus. */
  organization?: OrganizationContext;
  generatedImages?: ImageAttachment[];
}

export interface OrganizationContext {
  selection: import('./native.ts').NativeOrganizationItemSnapshot[];
  collections: Array<import('./native.ts').NativeCollectionTarget & { name: string }>;
}

export interface Conversation {
  id: UUID;
  paper: PaperScope;
  title: string;
  settings: GenerationSettings;
  activeRequestId: UUID | null;
  queuedRequestIds?: UUID[];
  activeBatchId?: UUID;
  messages: Message[];
  lastSeq: number;
  createdAt: string;
  updatedAt: string;
  /** Per-request accept/first-text/settle times so a reopened view can show honest elapsed time. */
  requestTiming?: RequestTiming[];
  paperIdentity?: PaperIdentity;
  titleCustomized?: boolean;
  parentConversationId?: UUID;
  forkMessageId?: UUID;
  usage?: UsageReport;
  /**
   * ISO timestamp set when this chat is archived. Archiving is non-destructive: the record still
   * loads and can be restored by removing this field. Absent on every pre-archive record, so an old
   * conversation is not archived. Archived chats leave the default history listing but stay on disk.
   */
  archivedAt?: string;
}

export interface SendInput {
  requestId: UUID;
  conversationId: UUID;
  action: 'explain' | 'ask';
  question: string;
  citations: Citation[];
  settings: GenerationSettings;
  /** Bibliographic identity of the current paper; required for asks without a citation. */
  paper?: PaperIdentity;
  /**
   * Routing mode for this request. Absent means `'chat'` (D3): it is a legacy request or a direct
   * caller that did not freeze one. The value is frozen per request and never mutated afterwards.
   */
  readonly mode?: RequestMode;
  /** Optional image parts for rust-v0.144.1 `{ type: "image", url: dataUrl }`. */
  images?: ImageAttachment[];
  document?: DocumentContext;
  workflow?: import('./workspace.ts').WorkflowSnapshot;
  references?: import('./workspace.ts').ReferenceInput[];
  batch?: ContextBatch;
  contextReport?: ContextReport;
  /** Full local validation scope. The model receives only its bounded index-based projection. */
  organization?: OrganizationContext;
}

export interface SendReceipt {
  requestId: UUID;
  state: RequestState;
  replay: boolean;
}

export type ReaderEvent = {
  seq: number;
  conversationId: UUID;
  requestId: UUID;
  at: string;
} & (
  | { type: 'accepted' }
  | { type: 'delta'; messageId: UUID; text: string }
  | { type: 'messageCompleted'; messageId: UUID; finalText: string; phase: 'commentary' | 'final' | null }
  | { type: 'completed'; messageId: UUID; finalText: string }
  | { type: 'cancelled'; messageId: UUID | null }
  | { type: 'failed'; code: ErrorCode; message: string }
  | { type: 'uncertain'; message: string }
  | { type: 'usage'; usage: UsageReport }
  | { type: 'image'; messageId: UUID; image: ImageAttachment }
  /**
   * Liveness ping: the runtime is still working on this turn but produced nothing the reader renders
   * (for example reasoning output). It carries no answer text and never settles the request; views use
   * its `at` only to refresh the honest "last activity" clock.
   */
  | { type: 'progress' }
);

export type ErrorCode =
  | 'RUNTIME_UNAVAILABLE' | 'INVALID_REQUEST' | 'PAYLOAD_TOO_LARGE'
  | 'VERSION_UNSUPPORTED' | 'CODEX_NOT_FOUND' | 'AUTH_REQUIRED'
  | 'BUSY' | 'REQUEST_CONFLICT' | 'MODEL_UNAVAILABLE'
  | 'RATE_LIMITED' | 'CODEX_EXITED' | 'HISTORY_UNAVAILABLE'
  | 'CURSOR_EXPIRED' | 'READER_POLICY_UNAVAILABLE' | 'UNSUPPORTED_INTERACTION'
  | 'NOT_FOUND' | 'INTERNAL_ERROR';

/** Business failure with a stable code and constant, user-presentable text. */
export class ReaderError extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly retryable = false) {
    super(message); this.name = 'ReaderError';
  }
  get error(): { code: ErrorCode; message: string; retryable: boolean } { return { code: this.code, message: this.message, retryable: this.retryable }; }
}

export interface Draft {
  settings: GenerationSettings | null;
  paper: PaperScope;
  question: string;
  citations: Citation[];
  images: ImageAttachment[];
}

/** Generic location shown in shareable diagnostics. Never include a username or real path. */
export const SHAREABLE_STORAGE_LOCATION = 'Zotero profile/zotero-chatgpt/v1/records' as const;

/** Whitelist-only report. Must never contain paper text, paths, tokens or account identifiers. */
export interface ShareableDiagnostics {
  pluginVersion: string;
  runtimeVersion: string;
  errorCode: ErrorCode | null;
  requestCount: number;
  states: Partial<Record<RequestState, number>>;
  storageLocation: typeof SHAREABLE_STORAGE_LOCATION;
}
