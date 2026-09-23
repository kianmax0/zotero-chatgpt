import type { ReaderClient, RuntimeSnapshot } from '../../../contracts/src/runtime.ts';
import { clone } from '../../../contracts/src/clone.ts';
import { advanceRequestTiming, ReaderError, paperId, type Citation, type ContextReport, type Conversation, type DocumentContext, type GenerationSettings, type ImageAttachment, type Message, type OrganizationContext, type PaperIdentity, type PaperScope, type ReaderEvent, type RequestMode, type SendInput } from '../../../contracts/src/index.ts';
import type { HistoryChange, HistoryEntry, LibraryReferencePort, Personalization, ReaderReference, ReaderSkill, ReaderWorkspace, ReferenceInput, ResearchProfile, SavedDraft, WorkflowSnapshot, WorkspaceDraft, WorkspaceSettings } from '../../../contracts/src/workspace.ts';
import { citationFromAnnotation, parseAnnotationCandidates, parseOrganizationProposals, type ActionTaskChoices, type ActionTaskRecord, type ActionTasks } from '../../../contracts/src/tasks.ts';
import type { NativeCollectionTarget, NativeItemRef } from '../../../contracts/src/native.ts';
import { validatePreferences, validateReference, validateReferenceInput, validateWorkflow } from '../../../contracts/src/workspace-validation.ts';
import { LIMITS, validateImageAttachment, validateOutputImage } from '../../../contracts/src/validation.ts';
import { estimateRequestBudget, type ContextBudget } from '../../../core/src/codex/model-capabilities.ts';
import { planContext, type ContextPlan } from '../../../core/src/context/planner.ts';
import type { ReadingJob } from '../../../core/src/context/coordinator.ts';
import { conversationHasAgentWork } from '../../../core/src/chat/agent-work.ts';
import { paperContext } from '../../../core/src/chat/paper-context.ts';
import { addCitation, addImage, makeAsk, makeExplain, moveImage, removeCitation, removeImage, workspaceDraft } from './draft.ts';
import { pluginClipboardAccess, readGeckoClipboardImage, type ClipboardImageRead } from './pick-images.ts';
import { alignSettings, catalogDefaultSettings } from './generation-settings.ts';
import { enforcedAllowedModelIds } from '../../../core/src/workspace/allowed-models.ts';
import type { DocumentServices, ReaderContext } from '../reader/context.ts';
import type { PresenterAgent, PresenterReading } from './capability.ts';
import { executeAgentSend, requestsCurrentPaperAnnotations, requestsSelectionOrganization, type AgentSendContext } from './agent-execution.ts';
import { executeChatSend, refuseChatAction, refuseChatWorkflow } from './chat-execution.ts';
import { traceMode } from './mode-trace.ts';
/** Shown when a legacy per-chat research profile no longer resolves; global preferences take over. */
const STALE_PROFILE_MESSAGE = 'The saved research profile is no longer available; global preferences apply.';
/**
 * Stage 8 moved the Agent capability into `chat/capability.ts` and re-exports it here so every
 * existing caller keeps this import site. `PresenterAgent` and `PresenterReading` are the names the
 * composition root and tests already use; `AgentCapability` is the same interface.
 */
export type { AgentCapability, PresenterAgent, PresenterReading } from './capability.ts';
/**
 * The outcome of preparing the current paper for the clipboard. It is a result rather than an
 * exception because "this PDF has no readable text" and "copying is unavailable here" are ordinary
 * answers the owner sees, not failures of the sidebar.
 */
export type DocumentBriefResult =
  | { ok: true; text: string; pages: number; totalPages: number; truncated: boolean }
  | { ok: false; reason: 'unavailable' | 'no-text' | 'failed' };
/**
 * The outcome of copying the paper's bibliographic context. `no-info` means the item proved nothing
 * a bibliography can hold (a bare PDF with no parent metadata), so the control is disabled rather
 * than copying a file name as if it were a citation.
 */
export type PaperContextResult =
  | { ok: true; text: string; hasAbstract: boolean }
  | { ok: false; reason: 'no-info' | 'failed' };
export interface PresenterServices {
  /**
   * The one shared reader client. Obtaining it performs no Codex work: opening the sidebar, listing
   * chats and sending in Chat mode all resolve it without starting the Agent runtime.
   */
  client(): Promise<ReaderClient>;
  /**
   * Agent readiness. Called only from Agent-only paths (Agent mode, login, retry); this is what
   * lazily starts Codex. Chat never calls it.
   */
  ensureAgent(): Promise<void>;
  /** The honest reason a Chat send cannot run in this build, or null when a transport is integrated. */
  chatUnavailableReason(): string | null;
  /**
   * True when the host owns Chat mode by hosting the real ChatGPT application, so this presenter's
   * Chat path never produces a Chat answer. Chat mode then renders no native transcript, and the
   * local PDF read that only a native Chat request needs is not started for it; Agent mode is
   * unaffected and still prepares the shared document when it is selected.
   */
  chatHostedExternally?: boolean;
  openAuthorization(url: string): void; uuid(): string; now(): string; document?: DocumentServices;
  getWorkspace?(): Promise<ReaderWorkspace>; library?: LibraryReferencePort; agent?: PresenterAgent;
  openHistory?(paper: PaperScope, conversationId: string): Promise<void>;
  openCitation?(citation: Citation): Promise<void>; openItem?(item: NativeItemRef): Promise<void>;
  /**
   * Re-reads the bibliographic identity of one attachment from the local Zotero metadata, addressed
   * by the frozen `PaperScope` rather than "whatever the reader shows now". Optional: without it the
   * presenter copies the identity it already froze with the reader context.
   */
  readPaperIdentity?(paper: PaperScope): Promise<PaperIdentity | null>;
  contextBudget?(input: SendInput, conversation: Conversation): ContextBudget;
  /** Test seam for the bounded '@' search; production uses the default bound. */
  searchTimeoutMs?: number;
  /**
   * Host seam for the privileged clipboard read the reader realm cannot do. Production leaves it
   * unset so the presenter uses its own plugin-realm pasteboard access; tests inject a double.
   */
  readClipboardImage?: () => Promise<ClipboardImageRead>;
}
export type PresenterSkillEdit = Pick<ReaderSkill, 'name' | 'description' | 'version' | 'workflow' | 'markdown' | 'enabled'> & { id: string | null; revision?: string };
type RequestContext = { enabled: boolean; range: [number, number] | null; acquisitionTarget?: NativeCollectionTarget | null };
type FrozenOrganizationResult = { ok: true; value: OrganizationContext } | { ok: false; error: unknown };
export interface PresenterState {
  connection: 'idle' | 'starting' | 'ready' | 'error';
  runtime: RuntimeSnapshot | null;
  conversation: Conversation | null;
  /**
   * Every chat the reader currently has open in the dock, oldest first, including the active one.
   * The reader can keep several chats open at once: `conversation` stays the *active* chat — the one
   * the composer edits, the one the persisted `current` pointer names — and each entry here keeps its
   * own transcript, draft and scroll position. Starting a chat adds a pane instead of replacing what
   * is on screen, and a background event for an open but inactive chat is applied to that entry.
   */
  openConversations: Conversation[];
  /**
   * True while the unbound New chat tab is in the strip. Cursor keeps that tab after the reader
   * switches to a named chat: `+` opens it, the first send turns it into a record, and close
   * removes it. `conversation === null` means the tab is the one on screen. The tab is always the
   * `New chat` copy; paper identity is carried by the attachment/context system, not the label.
   */
  newChatOpen: boolean;
  conversations: Conversation[];
  draft: WorkspaceDraft;
  pendingExplain: Citation | null;
  message: string | null;
  generating: boolean;
  /**
   * The routing mode the composer will freeze onto its next request. It is the authoritative source
   * for `mode` (Stage 6): the mode control sets it, `workflow`/skill never infers it, and changing
   * it only affects the next send — recorded requests keep the mode they were frozen with.
   */
  mode: RequestMode;
  /**
   * The honest reason a Chat send cannot run in this build, or null when a Chat transport exists.
   * It is Agent-independent state: it is known without starting Codex, so Chat mode can state its
   * own status instead of borrowing the Agent sign-in line.
   */
  chatUnavailable: string | null;
  /** Incremented when the view should move focus into the question input. */
  focusToken: number;
  workspace: WorkspaceSettings | null;
  /**
   * The one chat listing. It holds every stored chat for the query, including records that carry a
   * legacy `archivedAt`: there is no archive surface in the sidebar any more, so those render and
   * behave exactly like ordinary chats and nothing is ever hidden or rewritten. `historyQuery` lets
   * the view re-filter a host-list listing locally.
   */
  history: HistoryEntry[];
  historyQuery: string;
  scrollTop: number;
  persistence: 'session' | 'loading' | 'saving' | 'saved' | 'error';
  tasks: ActionTaskRecord[];
  readingJobs: ReadingJob[];
  contextReport: ContextReport | null;
  queueing: boolean;
  messageFocus: { messageId: string; token: number } | null;
  acquisitionTarget: NativeCollectionTarget | null;
  collectionOptions: Array<NativeCollectionTarget & { name: string }>;
  /** The one reader context for this attachment: identity, frozen read, range and local read status. */
  document: ReaderContext;
}
const LOGIN_HOSTS = ['auth.openai.com', 'chatgpt.com'];
const UNCERTAIN_ISOLATION = 'An earlier request in this conversation could not be confirmed; start a new conversation to continue.';
function bytes(value: unknown): number { return new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).length; }
/**
 * The planner owns the coverage explanation and enumerates unread or clipped pages inside it. Two
 * fast paths never reach the planner — a window so unknown that there is no budget to partition
 * against, and a document that fits the estimate outright — so they repeat the same disclosure from
 * the same source fields rather than claiming the gaps stayed explicit. A page is a gap when it
 * carries no text or was clipped as `partial`; the wording mirrors `gapSummary` in
 * `core/context/planner.ts` so the report never states less than the planner would.
 */
function gapDisclosure(document: DocumentContext): string {
  const gaps = document.pages.filter(page => page.status !== 'text' || page.partial);
  if (!gaps.length) return '';
  const shown = gaps.slice(0, 12).map(page => `${page.pageLabel} (${page.status === 'text' ? 'partial text' : `no text: ${page.status}`})`);
  return ` Recorded source gaps: ${shown.join(', ')}${gaps.length > 12 ? `, and ${gaps.length - 12} more` : ''}.`;
}
function unfinishedReading(job: ReadingJob): boolean { return !['completed', 'cancelled', 'failed'].includes(job.status); }
/** A saved draft with anything the owner put in it; an empty record with only settings is not content. */
function draftHasContent(draft: WorkspaceDraft): boolean {
  return draft.question.trim().length > 0 || draft.citations.length > 0 || draft.images.length > 0
    || draft.references.length > 0 || !!draft.skillId || !!draft.profileId || Object.keys(draft.overrides ?? {}).length > 0;
}
/** Newest first with a stable tiebreak, so the merged single listing keeps one deterministic order. */
function newestFirst<T extends { id: string; updatedAt: string; createdAt: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt) || a.id.localeCompare(b.id));
}
function activeReading(job: ReadingJob): boolean { return ['reserved', 'submitting', 'running', 'cancelling'].includes(job.status); }
function aborted(signal: AbortSignal): void { if (signal.aborted) throw new ReaderError('INVALID_REQUEST', 'Request preparation cancelled. Your draft is kept.'); }
async function waitPreparation<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  aborted(signal); let stop = () => {};
  try { return await Promise.race([work, new Promise<never>((_resolve, reject) => { stop = () => reject(new ReaderError('INVALID_REQUEST', 'Request preparation cancelled. Your draft is kept.')); signal.addEventListener('abort', stop, { once: true }); })]); }
  finally { signal.removeEventListener('abort', stop); }
}
/** Default bound for a host search bridge call. The bridge carries no timeout contract of its own. */
export const REFERENCE_SEARCH_TIMEOUT_MS = 10_000;
/**
 * Bound a host callback so an unanswered bridge settles with an honest failure instead of leaving
 * the composer waiting forever. Abort settles immediately; the original work is never resent.
 */
async function waitBounded<T>(work: Promise<T>, signal: AbortSignal, milliseconds: number, message: string): Promise<T> {
  aborted(signal); let stop = () => {}; let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      stop = () => { reject(new ReaderError('INVALID_REQUEST', 'Request preparation cancelled. Your draft is kept.')); };
      timer = setTimeout(() => { reject(new ReaderError('READER_POLICY_UNAVAILABLE', message)); }, milliseconds);
      signal.addEventListener('abort', stop, { once: true });
    })]);
  } finally { signal.removeEventListener('abort', stop); if (timer !== null) clearTimeout(timer); }
}
/**
 * One presenter per attachment for the plugin lifetime. It owns the unsent draft and the view's copy
 * of the conversation; the runtime keeps generating whether or not a view is bound.
 */
export class ConversationPresenter {
  private state: PresenterState;
  private renders = new Set<(state: PresenterState) => void>();
  private client: ReaderClient | null = null;
  private connecting: Promise<ReaderClient> | null = null;
  private unobserve: (() => void) | null = null;
  private unsubscribe: (() => void) | null = null;
  private unsubscribeClient: ReaderClient | null = null;
  /** The store this presenter is listening to for removals committed by another view. */
  private historyUnsubscribe: (() => void) | null = null;
  private historySubscribed: ReaderWorkspace | null = null;
  private buffered: ReaderEvent[] = [];
  private syncing = false;
  private syncGeneration = 0;
  private submissions = new Map<string, AbortController>();
  private get submitting(): boolean { return this.submissions.size > 0; }
  private explainFlights = new Map<string, Promise<void>>();
  private continuing = false;
  /** Mode that authorized the pre-submit More-details intent waiting on disclosure/login. */
  private pendingExplainMode: RequestMode | null = null;
  private drafts = new Map<string, WorkspaceDraft>();
  /**
   * The draft each conversation's request was built from, so Stop can hand the question, citations
   * and images back to the composer instead of losing them. Bounded by the conversations the reader
   * actually sent from in this session.
   */
  private submitted = new Map<string, WorkspaceDraft>();
  private positions = new Map<string, { scrollTop: number; range: [number, number] | null }>();
  private sendFlights = new Map<string, Promise<void>>();
  private queueFlight: Promise<void> | null = null;
  private draftVersion = 0;
  private workspace: ReaderWorkspace | null = null;
  private workspaceFlight: Promise<ReaderWorkspace> | null = null;
  private localFlight: Promise<void> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSaves = new Map<string, SavedDraft>();
  private saveFlight: Promise<void> | null = null;
  private navigation = 0;
  private historySearch = 0;
  private taskPort: ActionTasks | null = null;
  private taskFlight: Promise<ActionTasks> | null = null;
  private untasks: (() => void) | null = null;
  private readingPort: PresenterReading | null = null;
  private readingClient: ReaderClient | null = null;
  private unreading: (() => void) | null = null;
  private readingDescriptions = new Map<string, { question: string; scopeLabel: string }>();
  private planningActions = new Set<string>();
  private disposed = false;
  /**
   * Set by an explicit close or by `New chat`. The persisted paper index still points at the last
   * chat, so the adoption paths must not treat it as the active conversation: the next request
   * starts a fresh chat. Cleared as soon as a conversation becomes active again.
   *
   * A new chat is not stored until its first question is sent (`ensureConversation`), the way a tab
   * exists only on screen until it is used: opening the dock, pressing `+`, or closing the last tab
   * never leaves an empty record behind, so nothing invisible is ever counted or named.
   */
  private selectionCleared = false;
  /**
   * The mode selected per chat. The unbound new chat has no id yet, so its mode lives under
   * `unbound` until `ensureConversation` transfers it onto the stored conversation — the same shape
   * the draft already uses for the pre-first-send tab. Switching chats switches the selector with
   * them: mode is a property of the chat, not of the composer widget.
   */
  private modes = new Map<string, RequestMode>();
  /** Monotonic owner intent; async navigation may transfer only a mode chosen after it began. */
  private modeIntentRevision = 0;
  private documentJob: { controller: AbortController; range: string; promise: Promise<DocumentContext>; consumers: number } | null = null;
  constructor(context: ReaderContext, private services: PresenterServices) {
    this.state = { connection: 'idle', runtime: null, conversation: null, openConversations: [], newChatOpen: false, conversations: [], draft: workspaceDraft({ settings: null, paper: context.paper, question: '', citations: [], images: [] }), pendingExplain: null, message: null, generating: false, mode: 'chat', chatUnavailable: null, focusToken: 0,
      workspace: null, history: [], historyQuery: '', scrollTop: 0, persistence: services.getWorkspace ? 'loading' : 'session', tasks: [], readingJobs: [], contextReport: null, queueing: false, messageFocus: null, acquisitionTarget: null, collectionOptions: [],
      // The port decides the initial opt-in/disclosure; everything else comes from the reader context.
      document: { ...context, enabled: services.document?.readEnabled() ?? false, disclosure: services.document?.needsDisclosure?.() ?? false } };
  }
  /** The durable identity of the paper this presenter is bound to, owned by the reader context. */
  private get paper(): PaperScope { return this.state.document.paper; }
  /** The frozen bibliographic identity of this paper, owned by the reader context. */
  private get identity(): PaperIdentity { return this.state.document.identity; }
  /**
   * The identity sent with a request. It forwards every optional field the reader extracted instead
   * of rebuilding a four-field subset, so the send path and a `hashVersion: 2` replay of the stored
   * identity are the same object; dropping a field here would make the same question hash twice.
   */
  private paperIdentity(): PaperIdentity {
    const title = this.identity.title.trim() || this.state.conversation?.title || '';
    return { ...this.identity, title };
  }
  /** Ask in sidechat: the citation is already in the draft; the view should focus the question input. */
  focusInput(): void { this.update({ focusToken: this.state.focusToken + 1 }); }
  snapshot(): PresenterState { return clone(this.state); }
  /** Views are read-only; they must not mutate this object. External callers still use snapshot(). */
  private render(render: (state: PresenterState) => void): void {
    // A failing view must never stop propagation to the other views (or abort the caller).
    try { render(this.state); } catch { /* the view reports its own failure; state stays authoritative */ }
  }
  private notify(): void { for (const render of this.renders) this.render(render); }
  /** A view binds to receive state; unbinding releases only the view, never the runtime or the draft. */
  bind(render: (state: PresenterState) => void): () => void {
    this.renders.add(render); this.render(render);
    if (this.client && this.state.conversation) void this.sync();
    return () => { this.renders.delete(render); if (!this.renders.size) void this.flushDraft().catch(() => {}); };
  }
  private update(patch: Partial<PresenterState>): void {
    this.state = { ...this.state, ...patch };
    // Mode tracks the chat on screen (its stored id, or `unbound` before the first send) and falls
    // back to the product default. Deriving it here keeps one authority: whichever chat the view is
    // showing is the chat whose selector the composer renders.
    this.state.mode = this.modes.get(this.draftKey()) ?? 'chat';
    // The chat on screen is one of the open chats, so its pane entry is always the same object as
    // `conversation`: a pane list, a transcript and a composer can never disagree about one chat.
    if (this.state.conversation) this.state.openConversations = this.withOpen(this.state.conversation);
    this.state.generating = !!this.state.conversation && (this.submissions.has(this.state.conversation.id) || !!this.state.conversation.activeRequestId || this.state.readingJobs.some(activeReading));
    this.notify();
  }
  /**
   * Choose the mode for the next request from the composer control. It is frozen per request by
   * `sendDraft`, so switching here never rewrites an already recorded request or message.
   */
  setMode(mode: RequestMode): void {
    if (this.modes.get(this.draftKey()) === mode) return;
    const pending = this.state.pendingExplain;
    if (pending && this.pendingExplainMode && this.pendingExplainMode !== mode) {
      // This intent was never accepted by a service. Preserve its frozen selection as a draft
      // citation, but revoke auto-resume so a later shared-runtime login cannot submit behind Chat.
      this.pendingExplainMode = null;
      this.changeDraft(addCitation(this.state.draft, pending));
      this.update({ pendingExplain: null, message: 'The pending Agent explanation was not sent after switching modes. The selection remains in the draft.' });
    }
    traceMode(`[mode] selected ${mode} for ${this.draftKey()}`);
    this.modes.set(this.draftKey(), mode);
    this.modeIntentRevision++;
    this.update({});
    // Agent state is hydrated on demand: Chat never touches the Agent runtime or the task/reading
    // infrastructure, so switching to Agent is what licenses the first Codex startup and refresh.
    // Selecting Chat again is free of both.
    if (mode === 'agent') {
      // Agent's sends carry the document, and a host-hosted Chat surface never prepares it eagerly,
      // so selecting Agent is what starts the local read; the send path would otherwise do it and
      // make the first Agent request wait for a whole PDF.
      if (this.state.document.enabled && this.state.document.phase === 'idle') void this.prepareContext().catch(() => {});
      void this.hydrateAgentState().catch(error => {
        if (this.state.mode === 'agent') this.reportError(this.errorText(error));
      });
    }
  }
  private errorText(error: unknown): string { return error instanceof Error && error.message ? error.message : 'Codex could not complete this action.'; }
  private signedIn(): boolean { return this.state.runtime?.account.state === 'signedIn' && (this.state.runtime?.models.length ?? 0) > 0; }
  /**
   * Make the frozen mode's runtime ready before a request is built.
   *
   * Chat never starts Codex: without a supported transport it reports the honest reason and nothing
   * is recorded. Agent starts Codex lazily and needs the ChatGPT sign-in, sending a signed-out
   * reader into the official login instead of failing the request.
   *
   * Returns false when the caller must stop: the reason is already on screen (or login is pending).
   */
  private async prepareMode(mode: RequestMode, options: { pendingExplain?: Citation; pendingMode?: RequestMode } = {}): Promise<boolean> {
    if (mode === 'chat') {
      const reason = this.services.chatUnavailableReason();
      if (!reason) return true;
      this.update({ message: reason });
      return false;
    }
    try { await this.services.ensureAgent(); }
    catch (error) { this.update({ connection: 'error', message: this.errorText(error) }); throw error; }
    if (this.signedIn()) return true;
    if (options.pendingExplain) this.pendingExplainMode = options.pendingMode ?? mode;
    this.update({ message: options.pendingExplain ? null : 'Sign in with ChatGPT first.', ...(options.pendingExplain ? { pendingExplain: clone(options.pendingExplain) } : {}) });
    await this.login();
    return false;
  }
  private currentSettings(): GenerationSettings | null {
    const models = this.state.runtime?.models ?? [];
    const allowedIds = enforcedAllowedModelIds(this.state.workspace?.allowedModels);
    const current = this.state.draft.settings ?? this.state.conversation?.settings ?? catalogDefaultSettings(models, allowedIds);
    if (!current) return null;
    return models.length ? alignSettings(models, current, allowedIds) : current;
  }
  private draftKey(): string { return this.state.conversation?.id ?? 'unbound'; }
  private transferUnboundMode(conversationId: string): void {
    const mode = this.modes.get('unbound');
    if (!mode) return;
    this.modes.delete('unbound'); this.modes.set(conversationId, mode);
  }
  private emptyDraft(settings: GenerationSettings | null = this.currentSettings()): WorkspaceDraft {
    return workspaceDraft({ settings, paper: this.paper, question: '', citations: [], images: [] });
  }
  private getWorkspace(): Promise<ReaderWorkspace> {
    if (this.workspace) return Promise.resolve(this.workspace);
    if (!this.services.getWorkspace) return Promise.reject(new ReaderError('UNSUPPORTED_INTERACTION', 'Saved workspace controls are unavailable.'));
    if (!this.workspaceFlight) this.workspaceFlight = this.services.getWorkspace().then(workspace => { this.workspace = workspace; this.attachHistory(workspace); return workspace; }).catch(error => { this.workspaceFlight = null; throw error; });
    return this.workspaceFlight;
  }
  /**
   * A removal committed by another view (the Preferences pane today) must reach this sidebar
   * without a restart, a mode switch or a re-open. The store publishes that one change; this is the
   * only subscription the presenter keeps for it, and it is released with the presenter.
   */
  private attachHistory(workspace: ReaderWorkspace): void {
    if (this.historySubscribed === workspace || !workspace.subscribeHistory) return;
    this.historyUnsubscribe?.();
    this.historySubscribed = workspace;
    this.historyUnsubscribe = workspace.subscribeHistory(change => this.onHistoryChange(change));
  }
  /**
   * Reconcile one committed removal. Order matters: the in-flight query is invalidated first (an
   * older list/search must not put the row back), the rows are dropped immediately, everything this
   * presenter still holds for those ids — draft, position and a debounced save that has not run —
   * is discarded so nothing re-creates them, and only then is the store re-read for the query the
   * owner is looking at. The current chat is handled like the sidebar's own delete: another open
   * chat takes over, otherwise the reader lands on the unbound New chat state.
   */
  private onHistoryChange(change: HistoryChange): void {
    if (this.disposed) return;
    const removed = new Set(Array.isArray(change.removed) ? change.removed : []);
    if (!removed.size) return;
    this.historySearch += 1;
    for (const id of removed) {
      this.drafts.delete(id); this.positions.delete(id); this.pendingSaves.delete(id); this.submitted.delete(id);
    }
    if (this.state.history.some(entry => removed.has(entry.id))) {
      this.update({ history: this.state.history.filter(entry => !removed.has(entry.id)) });
    }
    const currentRemoved = !!this.state.conversation && removed.has(this.state.conversation.id);
    if (currentRemoved) {
      const remaining = this.state.openConversations.filter(entry => !removed.has(entry.id));
      const next = remaining.at(-1);
      this.draftVersion++;
      if (next) { this.update(this.panePatch(next, this.drafts.get(next.id) ?? null, this.positions.get(next.id), remaining)); this.stageDraft(); }
      else this.enterNewChat(remaining);
    } else {
      // A removed chat may still sit in the presenter's own list or pane strip — the host-list
      // fallback reads it from there — so both are reconciled, not only the active pane.
      const open = this.state.openConversations.filter(entry => !removed.has(entry.id));
      const known = this.state.conversations.filter(entry => !removed.has(entry.id));
      if (open.length !== this.state.openConversations.length || known.length !== this.state.conversations.length) {
        this.update({ openConversations: open, conversations: known });
      }
    }
    void this.searchHistory(this.state.historyQuery).catch(error => this.reportError(this.errorText(error)));
  }
  private captureWorkspace(): Promise<WorkspaceSettings | null> {
    const previous = this.state.workspace;
    const captured = this.services.getWorkspace ? this.getWorkspace().then(workspace => workspace.settings()).then(settings => { if (this.state.workspace === previous && !this.disposed) this.update({ workspace: settings }); return clone(settings); }) : Promise.resolve(null);
    // A queued request can wait behind preparation while this snapshot finishes.
    void captured.catch(() => {}); return captured;
  }
  private loadLocal(): Promise<void> {
    if (!this.services.getWorkspace) return Promise.resolve();
    if (this.localFlight) return this.localFlight;
    const version = this.draftVersion;
    this.localFlight = (async () => {
      const workspace = await this.getWorkspace();
      const [settings, current] = await Promise.all([workspace.settings(), workspace.currentConversation(this.paper)]);
      if (this.disposed) return;
      this.update({ workspace: settings });
      // A cleared selection is new-chat state: the persisted pointer to the just-closed chat must
      // not silently restore it while the reader is composing the next question.
      if (!this.state.conversation && !this.selectionCleared && current && paperId(current.paper) === paperId(this.paper)) {
        this.transferUnboundMode(current.id);
        this.update({ conversation: current, openConversations: this.withOpen(current), conversations: [current], draft: { ...this.state.draft, settings: this.state.draft.settings ?? current.settings } });
      }
      const id = this.state.conversation?.id ?? null;
      const saved = await workspace.readDraft(this.paper, id) ?? (id ? await workspace.readDraft(this.paper, null) : null);
      if (this.disposed) return;
      if (saved && this.draftVersion === version) {
        // The persisted `pageRange` is deliberately not restored. The panel that could show or clear a
        // saved range is gone, so adopting one would silently narrow every later request with no way
        // out of that state. The field stays in the schema (always written as null) so an older record
        // still reads without error; its range value is simply dropped. `setDocumentRange` and
        // `prepareContext` remain available for an explicit programmatic scope.
        this.update({ draft: workspaceDraft(saved.draft), scrollTop: saved.scrollTop, document: { ...this.state.document, range: null, prepared: null, phase: 'idle', error: null } });
      } else if (this.draftVersion !== version && id) {
        this.pendingSaves.delete('unbound'); this.stageDraft();
      }
      this.stashDraft(); this.update({ persistence: this.pendingSaves.size ? 'saving' : 'saved' });
      void this.searchHistory('').catch(error => this.reportError(this.errorText(error)));
    })().catch(error => { this.update({ persistence: 'error', message: this.errorText(error) }); throw error; });
    return this.localFlight;
  }
  private stageDraft(): void {
    this.stashDraft();
    if (!this.services.getWorkspace || this.disposed) return;
    const key = this.draftKey();
    // `pageRange` is retained in the schema but never populated: no UI can show or clear a range, so
    // persisting one would create an unreachable narrowing state. Always write null.
    this.pendingSaves.set(key, { schemaVersion: 1, paper: clone(this.paper), conversationId: this.state.conversation?.id ?? null, draft: clone(this.state.draft), scrollTop: this.state.scrollTop, pageRange: null, updatedAt: this.services.now() });
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { this.saveTimer = null; void this.flushDraft().catch(() => {}); }, 150);
  }
  /** Await this barrier during plugin shutdown; closing a view only schedules the same safe flush. */
  async flushDraft(): Promise<void> {
    if (!this.services.getWorkspace) return;
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    if (this.saveFlight) { await this.saveFlight; if (!this.pendingSaves.size) return; }
    this.saveFlight = (async () => {
      await this.loadLocal(); const workspace = await this.getWorkspace();
      while (this.pendingSaves.size) {
        const [key, saved] = this.pendingSaves.entries().next().value!; this.pendingSaves.delete(key);
        this.update({ persistence: 'saving' });
        try { await workspace.saveDraft(saved); }
        catch (error) { if (!this.pendingSaves.has(key)) this.pendingSaves.set(key, saved); this.update({ persistence: 'error', message: this.errorText(error) }); throw error; }
      }
      this.update({ persistence: 'saved' });
    })().finally(() => { this.saveFlight = null; });
    return this.saveFlight;
  }
  setScrollTop(scrollTop: number): void {
    if (!Number.isFinite(scrollTop) || scrollTop < 0 || this.state.scrollTop === scrollTop) return;
    this.update({ scrollTop }); this.stageDraft();
  }
  reportError(message: string): void { this.update({ message }); }
  private changeDraft(draft: WorkspaceDraft): void {
    if (draft === this.state.draft) return;
    this.draftVersion++; this.update({ draft, message: null }); this.stageDraft();
  }
  private entryFromConversation(conversation: Conversation): HistoryEntry {
    return { id: conversation.id, paper: conversation.paper, title: conversation.title, identity: conversation.paperIdentity ?? { title: conversation.title, authors: [] }, createdAt: conversation.createdAt, updatedAt: conversation.updatedAt, messageCount: conversation.messages.length, preview: conversation.messages.at(-1)?.text ?? '', hasDraft: !!this.drafts.get(conversation.id)?.question.trim(), activeRequestId: conversation.activeRequestId, ...(conversation.archivedAt ? { archivedAt: conversation.archivedAt } : {}) };
  }
  /**
   * The fallback host-list path has no archive filter of its own, so the presenter filters the list
   * it already holds. There is no archive scene to partition here: every chat is an ordinary chat.
   */
  private fallbackHistory(query: string): HistoryEntry[] {
    const search = query.toLocaleLowerCase();
    return this.state.conversations.filter(conversation => `${conversation.title} ${conversation.messages.map(message => message.text).join(' ')}`.toLocaleLowerCase().includes(search)).map(conversation => this.entryFromConversation(conversation));
  }
  /**
   * One listing for every stored chat, newest first. A stored `archivedAt` is not a scope: records
   * that carry it are merged in as ordinary chats so they stay readable and are never hidden. The
   * two `HistoryScope` reads are only how the store exposes the field; the scope contract and the
   * store's `archived` parameter are left intact and unused by the sidebar UI.
   */
  async searchHistory(query: string): Promise<HistoryEntry[]> {
    const search = ++this.historySearch;
    let history: HistoryEntry[];
    if (this.services.getWorkspace) {
      const workspace = await this.getWorkspace();
      const [current, legacy] = await Promise.all([workspace.history(query), workspace.history(query, { archived: true })]);
      history = newestFirst([...current, ...legacy]);
    } else {
      history = newestFirst(this.fallbackHistory(query));
    }
    if (search === this.historySearch && !this.disposed) this.update({ history, historyQuery: query });
    return clone(history);
  }
  async openHistoryEntry(id: string): Promise<void> {
    const conversation = this.services.getWorkspace ? await (await this.getWorkspace()).readConversation(id) : await (await this.connect()).get(id);
    if (paperId(conversation.paper) === paperId(this.paper)) { await this.openConversation(id); return; }
    if (!this.services.openHistory) throw new ReaderError('UNSUPPORTED_INTERACTION', 'Opening another article from history is unavailable.');
    await this.flushDraft(); await this.services.openHistory(conversation.paper, id);
  }
  async searchReferences(query: string, kind: 'all' | 'article' | 'chat' = 'all', signal = new AbortController().signal): Promise<ReaderReference[]> {
    aborted(signal); const results: ReaderReference[] = [];
    // Only '@' searches reach here, and both sources are host bridges. Each is bounded so the
    // composer reports an honest failure instead of waiting on a request the host never answers.
    const limit = this.services.searchTimeoutMs ?? REFERENCE_SEARCH_TIMEOUT_MS;
    if (kind !== 'chat' && this.services.library) {
      results.push(...await waitBounded(Promise.resolve(this.services.library.search(query)), signal, limit, 'The article search did not answer. Try again.'));
    }
    if (kind !== 'article' && this.services.getWorkspace) {
      // The UI has no archive scope, so a legacy record carrying `archivedAt` is an ordinary chat and
      // '@' reads both store scopes exactly like the sidebar's one listing. The default scope alone
      // would hide such a record from mentions while the sidebar shows it as an ordinary chat.
      const entries = await waitBounded(this.getWorkspace().then(async workspace => {
        const [current, legacy] = await Promise.all([workspace.history(query), workspace.history(query, { archived: true })]);
        return newestFirst([...current, ...legacy]);
      }), signal, limit, 'Saved chats could not be searched. Try again.');
      results.push(...entries.map(entry => ({ id: `chat-${entry.id}`, kind: 'chat' as const, label: entry.title, paper: entry.paper, identity: entry.identity, conversationId: entry.id, capturedAt: this.services.now() })));
    }
    aborted(signal); return results.map(validateReference);
  }
  async previewReference(reference: ReaderReference, signal = new AbortController().signal): Promise<ReferenceInput> {
    const frozen = validateReference(reference); aborted(signal);
    if (frozen.kind === 'chat') return frozen.text !== undefined ? frozen : (await this.getWorkspace()).snapshotChat(frozen.conversationId!, frozen.messageIds);
    // An attached file carries its own text snapshot and has no native readable source, so its
    // preview is the frozen body itself: the host is never asked to re-open the chosen path.
    if (frozen.kind === 'file') {
      if (frozen.text === undefined || !frozen.text.trim()) throw new ReaderError('INVALID_REQUEST', 'This attached file has no readable text. Attach it again.');
      return frozen;
    }
    if (!this.services.library) throw new ReaderError('UNSUPPORTED_INTERACTION', 'Native reference reading is unavailable.');
    return validateReferenceInput(await this.services.library.read(frozen, signal));
  }
  async addReference(reference: ReaderReference): Promise<void> {
    const key = this.draftKey(); let frozen = validateReference(reference);
    if (frozen.kind === 'chat') {
      if (!frozen.conversationId) throw new ReaderError('INVALID_REQUEST', 'Choose a saved chat snapshot.');
      frozen = validateReference(await (await this.getWorkspace()).snapshotChat(frozen.conversationId, frozen.messageIds));
    }
    if (key !== this.draftKey()) throw new ReaderError('INVALID_REQUEST', 'The chat changed while adding this reference. Choose it again.');
    if (this.state.draft.references.some(item => item.id === frozen.id)) return;
    if (this.state.draft.references.length >= 16) throw new ReaderError('PAYLOAD_TOO_LARGE', 'Choose at most 16 references for a message.');
    this.changeDraft({ ...this.state.draft, references: [...this.state.draft.references, frozen] });
  }
  removeReference(id: string): Promise<void> { this.changeDraft({ ...this.state.draft, references: this.state.draft.references.filter(reference => reference.id !== id) }); return Promise.resolve(); }
  setReferenceRange(id: string, range: [number, number] | null): Promise<void> {
    const reference = this.state.draft.references.find(reference => reference.id === id);
    if (!reference || reference.kind !== 'article') throw new ReaderError('NOT_FOUND', 'Choose an attached article before setting its page range.');
    const next = { ...reference }; if (range) next.range = [...range]; else delete next.range;
    const checked = validateReference(next);
    this.changeDraft({ ...this.state.draft, references: this.state.draft.references.map(reference => reference.id === id ? checked : reference) });
    return Promise.resolve();
  }
  async selectSkill(id: string | null): Promise<void> {
    await this.loadLocal();
    if (id !== null) { const skill = this.state.workspace?.skills.find(skill => skill.id === id); if (!skill || !skill.enabled || skill.unsupportedDependencies.length) throw new ReaderError('UNSUPPORTED_INTERACTION', 'Choose an enabled skill with supported dependencies.'); }
    this.changeDraft({ ...this.state.draft, skillId: id });
  }
  /**
   * Test-only surface, kept deliberately (plan §H R8): the sidebar preferences/workspace/profile
   * editor that used to call these was removed, and production now writes preferences, appearance,
   * profiles and skills through Zotero's own Preferences window and the workspace store. They stay
   * until the behavior-level tests that drive them are replaced, so no covered behavior is dropped
   * just because its old UI is gone.
   */
  async selectProfile(id: string | null): Promise<void> {
    await this.loadLocal(); if (id !== null && !this.state.workspace?.profiles.some(profile => profile.id === id)) throw new ReaderError('NOT_FOUND', 'This research profile is unavailable.');
    this.changeDraft({ ...this.state.draft, profileId: id });
  }
  /**
   * Per-chat answer overrides were removed from the sidebar. A draft saved before that removal still
   * carries the field and keeps applying at send time, so the data model is intentionally unchanged.
   */
  private async editWorkspace(edit: (settings: WorkspaceSettings) => WorkspaceSettings): Promise<void> {
    const workspace = await this.getWorkspace(); const settings = await workspace.settings(); await workspace.saveSettings(edit(settings));
    this.update({ workspace: await workspace.settings() });
  }
  savePreferences(preferences: Personalization): Promise<void> { return this.editWorkspace(settings => ({ ...settings, preferences: { ...settings.preferences, ...validatePreferences(preferences) } })); }
  saveAppearance(value: { uiLanguage?: 'en' | 'zh'; textScale?: number }): Promise<void> {
    if (value.uiLanguage !== undefined && value.uiLanguage !== 'en' && value.uiLanguage !== 'zh') return Promise.reject(new ReaderError('INVALID_REQUEST', 'Choose a supported interface language.'));
    if (value.textScale !== undefined && (!Number.isFinite(value.textScale) || value.textScale < 0.5 || value.textScale > 3)) return Promise.reject(new ReaderError('INVALID_REQUEST', 'Choose a chat text scale from 0.5 to 3.'));
    return this.editWorkspace(settings => ({ ...settings, ...value }));
  }
  async saveProfile(value: { id: string | null; name: string; preferences: Partial<Personalization> }): Promise<ResearchProfile> {
    const profile = { id: value.id ?? `profile-${this.services.uuid()}`, name: value.name.trim(), preferences: validatePreferences(value.preferences) };
    if (!profile.name) throw new ReaderError('INVALID_REQUEST', 'Name this research profile.');
    await this.editWorkspace(settings => ({ ...settings, profiles: [...settings.profiles.filter(item => item.id !== profile.id), profile] })); return clone(profile);
  }
  async deleteProfile(id: string): Promise<void> {
    await this.editWorkspace(settings => ({ ...settings, profiles: settings.profiles.filter(profile => profile.id !== id) }));
    if (this.state.draft.profileId === id) await this.selectProfile(null);
  }
  async saveSkill(edit: PresenterSkillEdit): Promise<ReaderSkill> {
    const workspace = await this.getWorkspace(); const settings = await workspace.settings();
    const prior = edit.id ? settings.skills.find(skill => skill.id === edit.id) : undefined;
    if (edit.id && !prior) throw new ReaderError('NOT_FOUND', 'The skill is no longer installed.');
    const visible = edit.id ? this.state.workspace?.skills.find(skill => skill.id === edit.id) : undefined;
    if (prior && (edit.revision ?? visible?.revision) !== prior.revision) throw new ReaderError('REQUEST_CONFLICT', 'This skill changed after editing began. Reopen it before saving.');
    const id = prior?.id ?? `user-${this.services.uuid()}`;
    const saved = await workspace.saveSkill({ ...(prior ?? { id, revision: '', origin: 'user' as const, permissions: [], unsupportedDependencies: [] }), ...edit, id, description: edit.description.trim() || edit.name });
    this.update({ workspace: await workspace.settings() }); return saved;
  }
  /**
   * One or more explicitly chosen local files, already routed and bounded by the host port: text-like
   * files arrive as reference text and image files arrive as validated image attachments. Nothing
   * else is done here, so the picker's caps are the only caps, and a file that arrives attached is a
   * file the owner chose — the composer never asks the host for a path of its own.
   */
  async pickFile(): Promise<void> {
    if (!this.services.library?.pickFile) throw new ReaderError('UNSUPPORTED_INTERACTION', 'Attaching a file is unavailable.');
    const key = this.draftKey(); const picked = await this.services.library.pickFile();
    if (key !== this.draftKey()) throw new ReaderError('INVALID_REQUEST', 'The chat changed while choosing a file. Choose it again.');
    if (this.state.draft.images.length + picked.images.length > LIMITS.imagesPerRequest) throw new ReaderError('PAYLOAD_TOO_LARGE', `Attach at most ${LIMITS.imagesPerRequest} images per message.`);
    for (const image of picked.images) this.addImage(image);
    for (const reference of picked.references) await this.addReference(reference);
  }
  /**
   * Clipboard images for the reader composer, with the reason a gesture that carried image bytes
   * attached nothing. The chat is mounted into the reader window, so the paste event and a reader
   * window that answers `hasDataMatchingFlavors` both lie outside this realm; only here, in the
   * plugin realm, is the privileged pasteboard readable (a macOS screenshot is TIFF there and is
   * asked for as `image/png`). An empty pasteboard returns no images and no refusal, so a plain
   * Cmd+V with nothing on the pasteboard never invents an attachment or a complaint.
   */
  clipboardImage(): Promise<ClipboardImageRead> {
    if (this.services.readClipboardImage) return Promise.resolve(this.services.readClipboardImage());
    return Promise.resolve(readGeckoClipboardImage(pluginClipboardAccess(), () => this.services.uuid()));
  }
  async collections(): Promise<Array<NativeCollectionTarget & { name: string }>> {
    if (!this.services.library?.collections) throw new ReaderError('UNSUPPORTED_INTERACTION', 'Native collection selection is unavailable.');
    const options = await this.services.library.collections(); this.rememberCollectionOptions(options); return clone(options);
  }
  private rememberCollectionOptions(options: Array<NativeCollectionTarget & { name: string }>): void {
    const identity = (target: NativeCollectionTarget) => `${target.clientId}:${target.libraryId}:${target.collectionKey}`;
    const merged = new Map(this.state.collectionOptions.map(option => [identity(option), clone(option)]));
    for (const option of options) merged.set(identity(option), clone(option));
    this.update({ collectionOptions: [...merged.values()] });
  }
  setAcquisitionTarget(target: NativeCollectionTarget | null): void {
    if (target && !this.state.collectionOptions.some(option => option.clientId === target.clientId && option.libraryId === target.libraryId && option.collectionKey === target.collectionKey)) throw new ReaderError('INVALID_REQUEST', 'Choose an editable collection from this Zotero profile.');
    this.update({ acquisitionTarget: target ? clone(target) : null });
  }
  private getTasks(): Promise<ActionTasks> {
    if (this.taskPort) return Promise.resolve(this.taskPort);
    if (!this.services.agent) return Promise.reject(new ReaderError('UNSUPPORTED_INTERACTION', 'Native task review is unavailable.'));
    if (!this.taskFlight) { traceMode('[agent-runtime] acquiring task capability'); this.taskFlight = this.services.agent.tasks().then(tasks => { this.taskPort = tasks; this.untasks = tasks.subscribe(task => this.acceptTask(task)); return tasks; }).catch(error => { this.taskFlight = null; throw error; }); }
    return this.taskFlight;
  }
  private acceptTask(task: ActionTaskRecord): void {
    if (this.disposed || task.conversationId !== this.state.conversation?.id) return;
    const prior = this.state.tasks.find(item => item.id === task.id); if (prior && prior.revision > task.revision) return;
    this.update({ tasks: [...this.state.tasks.filter(item => item.id !== task.id), clone(task)].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) });
  }
  private async getReading(client?: ReaderClient): Promise<PresenterReading> {
    if (this.readingPort && this.readingClient === (client ?? null)) return this.readingPort;
    if (!this.services.agent) throw new ReaderError('UNSUPPORTED_INTERACTION', 'Multi-pass reading is unavailable in this runtime. Nothing was sent.');
    traceMode('[agent-runtime] acquiring reading capability');
    const reading = await this.services.agent.reading(client); this.unreading?.(); this.readingPort = reading; this.readingClient = client ?? null;
    this.unreading = reading.subscribe(job => this.acceptReading(job)); return reading;
  }
  private acceptReading(job: ReadingJob): void {
    if (this.disposed || job.conversationId !== this.state.conversation?.id) return;
    const prior = this.state.readingJobs.find(item => item.id === job.id); if (prior && prior.revision > job.revision) return;
    this.update({ readingJobs: [...this.state.readingJobs.filter(item => item.id !== job.id), clone(job)].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) });
  }
  private async refreshTaskState(): Promise<void> {
    // Agent infrastructure is Agent-Mode-only. A refresh while the composer is in Chat Mode must not
    // acquire the task port or the reading coordinator: doing so would subscribe to Agent state just
    // by using Chat Mode. `setMode('agent')` and Agent sends hydrate instead.
    if (this.state.mode !== 'agent' || !this.services.agent) return;
    const id = this.state.conversation?.id; if (!id) return;
    const tasks = await (await this.getTasks()).list(id); if (this.state.conversation?.id === id) this.update({ tasks });
    const jobs = await (await this.getReading(this.client ?? undefined)).list(id); if (this.state.conversation?.id === id) this.update({ readingJobs: jobs });
  }
  private async hydrateAgentState(): Promise<void> {
    if (this.state.mode !== 'agent') return;
    await this.services.ensureAgent();
    const conversation = this.state.conversation;
    if (conversation) await this.recoverActionPlans(conversation);
    await this.refreshTaskState();
  }
  async approveTask(id: string, selected: string[], choices: ActionTaskChoices = {}): Promise<void> { this.acceptTask(await (await this.getTasks()).approve(id, [...selected], clone(choices))); }
  async cancelTask(id: string): Promise<void> { this.acceptTask(await (await this.getTasks()).cancel(id)); }
  async reconcileTask(id: string): Promise<void> { this.acceptTask(await (await this.getTasks()).reconcile(id)); }
  async undoTask(id: string): Promise<void> { this.acceptTask(await (await this.getTasks()).undo(id)); }
  private async planReturnedActions(requestId: string, conversation = this.state.conversation): Promise<void> {
    if (!conversation || paperId(conversation.paper) !== paperId(this.paper)) return;
    const key = `${conversation.id}:${requestId}`;
    if (!this.services.agent || this.planningActions.has(key)) return;
    const user = conversation.messages.find(message => message.requestId === requestId && message.role === 'user');
    if (!user) return;
    // Chat mode never reaches Agent infrastructure. A request recorded before the mode field existed
    // has no mode; its non-read workflow is still the only signal, so the legacy read is kept rather
    // than retroactively reclassifying stored Agent work as chat.
    const workflow = user.workflow?.skill?.workflow;
    if (user.mode === 'chat' || (workflow !== 'annotate' && workflow !== 'organize') || user.batch?.phase === 'map') return;
    if (workflow === 'organize' && user.organization) this.rememberCollectionOptions(user.organization.collections);
    const answer = conversation.messages.filter(message => message.requestId === requestId && message.role === 'assistant' && message.status === 'completed' && message.phase !== 'commentary').at(-1);
    if (!answer?.text.trim()) return;
    this.planningActions.add(key);
    try {
      const tasks = await this.getTasks();
      const kind = workflow === 'annotate' ? 'annotations' : 'organization';
      if ((await tasks.list(conversation.id)).some(task => task.kind === kind && task.modelRequestId === requestId)) return;
      if (workflow === 'annotate') {
        const origin = user.document ?? (user.batch ? conversation.messages.find(message => message.role === 'user' && message.batch?.id === user.batch?.id && message.document)?.document : undefined);
        if (!origin) throw new ReaderError('INVALID_REQUEST', 'Annotation proposals have no frozen PDF version. Prepare the PDF and try again.');
        const candidates = parseAnnotationCandidates(answer.text);
        this.acceptTask(await tasks.planAnnotations({ conversationId: conversation.id, paper: clone(conversation.paper), revision: clone(origin.revision), question: user.batch?.question ?? user.text, candidates, modelRequestId: requestId }));
      } else {
        if (!user.organization) throw new ReaderError('INVALID_REQUEST', 'Organization proposals have no frozen Zotero selection. Select the items and try again.');
        const proposals = parseOrganizationProposals(answer.text);
        // Collection names are model-facing labels in the frozen request. The task controller accepts
        // only native identity fields, so project at this trust boundary instead of weakening its
        // strict record validator to admit display metadata.
        const collections = user.organization.collections.map(({ clientId, libraryId, collectionKey }) => ({ clientId, libraryId, collectionKey }));
        this.acceptTask(await tasks.planOrganization({ conversationId: conversation.id, question: user.text, modelRequestId: requestId, selection: clone(user.organization.selection), collections, proposals }));
      }
    } finally { this.planningActions.delete(key); }
  }
  private async recoverActionPlans(conversation: Conversation): Promise<void> {
    if (!this.services.agent || !this.client || this.disposed) return;
    const requests = new Set(conversation.messages.filter(message => message.role === 'user' && message.mode !== 'chat' && ['annotate', 'organize'].includes(message.workflow?.skill?.workflow ?? '') && message.batch?.phase !== 'map').map(message => message.requestId));
    for (const requestId of requests) {
      if (conversation.activeRequestId === requestId || !conversation.messages.some(message => message.requestId === requestId && message.role === 'assistant' && message.status === 'completed')) continue;
      try {
        if ((await this.client.request(conversation.id, requestId)).state !== 'completed') continue;
        await this.planReturnedActions(requestId, conversation);
      } catch (error) {
        if (error instanceof ReaderError && error.code === 'NOT_FOUND') continue;
        if (this.state.conversation?.id === conversation.id) this.reportError(this.errorText(error));
      }
    }
  }
  async openTaskSource(id: string, itemId: string): Promise<void> {
    if (!this.services.openCitation) throw new ReaderError('UNSUPPORTED_INTERACTION', 'Native source navigation is unavailable.');
    const task = await (await this.getTasks()).get(id); const item = task.items.find(item => item.id === itemId);
    if (task.kind !== 'annotations' || item?.kind !== 'annotation' || item.resolution?.status !== 'resolved') throw new ReaderError('NOT_FOUND', 'This candidate has no resolved source.');
    await this.services.openCitation(citationFromAnnotation({
      paper: task.paper,
      documentRevision: task.documentRevision,
      candidate: item.resolution.candidate,
      title: paperId(task.paper) === paperId(this.paper) ? this.identity.title : task.paper.attachmentKey,
      clock: { uuid: () => this.services.uuid(), now: () => this.services.now() },
    }));
  }
  async openTaskOutput(id: string, itemId: string): Promise<void> {
    const task = await (await this.getTasks()).get(id); const item = task.items.find(item => item.id === itemId);
    if (!item || item.status === 'undone') throw new ReaderError('NOT_FOUND', 'This task has no available recorded output.');
    if (item.kind === 'annotation' && item.annotation) { await this.openTaskSource(id, itemId); return; }
    if (item.kind === 'acquisition' && item.item) {
      if (item.acquisition?.status === 'attached' && !item.attachmentUndone && this.services.library) {
        const attachment = item.acquisition.attachment; await this.services.library.open({ clientId: attachment.clientId, libraryId: attachment.libraryId, attachmentKey: attachment.key }); return;
      }
      if (!this.services.openItem) throw new ReaderError('UNSUPPORTED_INTERACTION', 'Native item navigation is unavailable.');
      await this.services.openItem({ clientId: item.item.clientId, libraryId: item.item.libraryId, key: item.item.key }); return;
    }
    throw new ReaderError('NOT_FOUND', 'No native output was recorded for this item.');
  }
  async cancelReading(id: string): Promise<void> { const reading = await this.getReading(await this.connect()); this.acceptReading(await reading.cancel(id)); }
  async reconcileReading(id: string): Promise<void> { const reading = await this.getReading(await this.connect()); this.acceptReading(await reading.reconcile(id)); await this.sync(); }
  async openReadingOutput(id: string, stepIndex: number): Promise<void> {
    const job = await (await this.getReading(await this.connect())).get(id); const result = job.steps.find(step => step.index === stepIndex)?.result;
    if (!result?.messageIds.length) throw new ReaderError('NOT_FOUND', 'This reading pass has no stored answer.');
    if (job.conversationId !== this.state.conversation?.id) await this.openHistoryEntry(job.conversationId);
    await this.sync(); const messageId = result.messageIds.find(id => this.state.conversation?.messages.some(message => message.id === id));
    if (!messageId) throw new ReaderError('NOT_FOUND', 'The stored answer could not be located in this chat.');
    this.update({ messageFocus: { messageId, token: (this.state.messageFocus?.token ?? 0) + 1 } });
  }
  async describeReading(id: string): Promise<{ question: string; scopeLabel: string } | null> {
    const saved = this.readingDescriptions.get(id); if (saved) return clone(saved);
    const job = this.state.readingJobs.find(job => job.id === id); if (!job) return null;
    const conversation = job.conversationId === this.state.conversation?.id ? this.state.conversation : this.services.getWorkspace ? await (await this.getWorkspace()).readConversation(job.conversationId) : null;
    const user = conversation?.messages.find(message => message.role === 'user' && message.requestId === job.id); if (!user) return null;
    return { question: user.batch?.question ?? user.text, scopeLabel: [user.document ? user.paper?.title || this.identity.title : '', ...(user.references ?? []).map(reference => reference.label)].filter(Boolean).join(' · ') || 'Recorded source scope is shown by the completed passes.' };
  }
  private contextOptions(): RequestContext {
    // Recheck the shared opt-out at the request boundary, including an already-open second view.
    const enabled = this.state.document.enabled && (this.services.document?.readEnabled() ?? false);
    if (enabled !== this.state.document.enabled) this.update({ document: { ...this.state.document, enabled } });
    return { enabled, range: clone(this.state.document.range), acquisitionTarget: this.state.acquisitionTarget ? clone(this.state.acquisitionTarget) : null };
  }
  private organizationRequested(draft: WorkspaceDraft, mode: RequestMode): boolean {
    if (mode !== 'agent') return false;
    if (!draft.skillId) return requestsSelectionOrganization(draft.question);
    return this.state.workspace?.skills.find(skill => skill.id === draft.skillId && skill.enabled)?.workflow === 'organize';
  }
  private async freezeOrganizationContext(): Promise<OrganizationContext> {
    const library = this.services.library;
    if (!library?.selectedItems || !library.collections) throw new ReaderError('UNSUPPORTED_INTERACTION', 'Native Zotero selection organization is unavailable.');
    // Both host reads start together. selectedItems copies every native identity before its first
    // await, so a later focus or selection change cannot retarget this request.
    const [selection, available] = await Promise.all([library.selectedItems(), library.collections()]);
    if (!selection.length) throw new ReaderError('INVALID_REQUEST', 'Select one or more Zotero items before organizing them.');
    const first = selection[0]!;
    const collections = available.filter(collection => collection.clientId === first.clientId && collection.libraryId === first.libraryId);
    this.rememberCollectionOptions(collections);
    return { selection: clone(selection), collections: clone(collections) };
  }
  private prepareOrganizationContext(draft: WorkspaceDraft, mode: RequestMode): Promise<FrozenOrganizationResult> | null {
    if (!this.organizationRequested(draft, mode)) return null;
    return this.freezeOrganizationContext().then(
      value => ({ ok: true as const, value }),
      (error: unknown) => { this.reportError(this.errorText(error)); return { ok: false as const, error }; },
    );
  }
  /** Draft only: never edits an in-flight or already-submitted message snapshot. */
  setSettings(settings: GenerationSettings): void {
    const models = this.state.runtime?.models ?? [];
    const allowedIds = enforcedAllowedModelIds(this.state.workspace?.allowedModels);
    const next = models.length ? alignSettings(models, settings, allowedIds) : { model: settings.model, serviceTier: settings.serviceTier, effort: settings.effort };
    this.changeDraft({ ...this.state.draft, settings: next });
  }
  // ---- runtime ----------------------------------------------------------------------------------
  async activate(): Promise<void> {
    try { await this.loadLocal(); } catch { /* Preserve unreadable records and report the local failure. */ }
    // The local PDF read is what a native Chat request needs as context. When the host hosts Chat
    // itself, Chat mode sends nothing from here, so the read waits for Agent mode (which prepares
    // the same shared document through its own send path) instead of running for an unused surface.
    const chatNeedsDocument = !this.services.chatHostedExternally || this.state.mode === 'agent';
    if (chatNeedsDocument && this.state.document.enabled && this.state.document.phase === 'idle') void this.prepareContext().catch(() => {});
    // Opening the sidebar restores local chats only. The Codex-backed catalog is not a precondition
    // for showing the reader's own history, and nothing here starts Codex.
    try {
      await this.connect();
      await this.adoptCurrent(); await this.sync(); await this.refreshList(); await this.pruneEmptyConversations();
    } catch (error) { this.update({ connection: 'error', message: this.errorText(error) }); }
    // Agent mode is the one composer state that needs Codex (for the model picker). Activating into
    // Chat never reaches this, so a reader who never leaves Chat starts no Agent runtime.
    if (this.state.mode === 'agent') await this.hydrateAgentState().catch(error => this.reportError(this.errorText(error)));
    // Adopting the saved chat clears `message`. If local preparation already failed, that would erase
    // the only signal the owner has — the panel that used to render preparation state is gone — so a
    // failure that landed before the restore is re-announced here. A later failure sets it itself.
    if (this.state.document.phase === 'error' && this.state.document.error && !this.state.message) this.update({ message: this.state.document.error });
  }
  /**
   * Test-only surface, kept deliberately (plan §H R8): the reader-opt-in and page-range controls that
   * called these were removed from the sidebar, and the document port is now driven by Zotero's own
   * reader state. Kept until the tests driving them are replaced, not deleted ahead of them.
   */
  setDocumentEnabled(enabled: boolean): void {
    this.services.document?.writeEnabled(enabled);
    this.update({ document: { ...this.state.document, enabled } });
    if (!enabled && !this.submitting) this.documentJob?.controller.abort();
    if (enabled && !this.submitting) void this.prepareContext().catch(() => {});
  }
  setDocumentRange(first: number | null, last: number | null): void {
    const bound = (value: number | null) => value !== null && Number.isFinite(value) && value >= 1 ? Math.floor(value) : null;
    const low = bound(first); const high = bound(last);
    const range: [number, number] | null = low === null && high === null ? null
      : low === null ? [high!, high!] : high === null ? [low, low] : low <= high ? [low, high] : [high, low];
    this.update({ document: { ...this.state.document, range, prepared: null, phase: 'idle', error: null } });
    this.draftVersion++; this.stageDraft();
    if (!this.submitting) { this.documentJob?.controller.abort(); if (this.state.document.enabled) void this.prepareContext().catch(() => {}); }
  }
  acknowledgeContext(): void {
    this.services.document?.acknowledge?.();
    this.update({ document: { ...this.state.document, disclosure: false } });
    const pending = this.state.pendingExplain;
    if (pending) { const mode = this.pendingExplainMode; this.pendingExplainMode = null; this.update({ pendingExplain: null }); if (mode === this.state.mode) void this.explain(pending); else this.changeDraft(addCitation(this.state.draft, pending)); }
  }
  prepareContext(): Promise<DocumentContext> { return this.prepareDocument(this.state.document.range); }
  /**
   * The current paper as clipboard text, for Chat mode's hosted application. The web app owns its own
   * conversation and this host has no supported way to inject context into it. This compatibility
   * method returns only the bibliography and stored abstract; it never prepares or reads PDF pages.
   */
  async exportDocumentBrief(): Promise<DocumentBriefResult> {
    const context = await this.exportPaperContext();
    if (!context.ok) return { ok: false, reason: context.reason === 'no-info' ? 'no-text' : 'failed' };
    return { ok: true, text: context.text, pages: 0, totalPages: 0, truncated: false };
  }
  /**
   * The paper's bibliographic context as clipboard text: title, authors, publication, year, DOI and
   * the stored abstract. This is also the exact compact paper context automatically included by
   * Chat; neither path reads PDF body text.
   *
   * The scope is frozen before the await and any optional re-read is addressed by that frozen scope,
   * so a slower read for paper A can never return while the reader shows B and paste A's title with
   * B's abstract. It starts no model, no task and no connection: it is a local metadata read.
   */
  async exportPaperContext(): Promise<PaperContextResult> {
    const frozen = clone(this.paper);
    const frozenIdentity = clone(this.identity);
    let identity = frozenIdentity;
    if (this.services.readPaperIdentity) {
      try {
        const read = await this.services.readPaperIdentity(frozen);
        // A null answer means the item or its parent is gone: keep the frozen identity rather than
        // borrowing metadata from whatever the reader happens to show now.
        if (read) identity = read;
      } catch { return { ok: false, reason: 'failed' }; }
    }
    const context = paperContext(identity);
    if (!context) return { ok: false, reason: 'no-info' };
    return { ok: true, text: context.text, hasAbstract: context.hasAbstract };
  }
  private prepareDocument(range: readonly [number, number] | null): Promise<DocumentContext> {
    const key = JSON.stringify(range);
    if (this.documentJob?.range === key && !this.documentJob.controller.signal.aborted) return this.documentJob.promise;
    const controller = new AbortController();
    const job = { controller, range: key, promise: Promise.resolve(null as unknown as DocumentContext), consumers: 0 };
    this.documentJob = job;
    this.update({ document: { ...this.state.document, phase: 'preparing', error: null, progress: { done: 0, total: 0 } } });
    job.promise = Promise.resolve().then(async () => {
      if (controller.signal.aborted) throw new Error('PDF preparation cancelled. Your question is kept.');
      const service = this.services.document;
      if (!service) throw new Error('Current PDF context is unavailable.');
      const document = await service.prepare(controller.signal, progress => {
        if (this.documentJob === job) this.update({ document: { ...this.state.document, progress } });
      }, range ?? undefined);
      if (controller.signal.aborted) throw new Error('PDF preparation cancelled. Your question is kept.');
      await service.validate(document);
      if (controller.signal.aborted) throw new Error('PDF preparation cancelled. Your question is kept.');
      if (this.documentJob === job) this.update({ document: { ...this.state.document, prepared: document, phase: 'ready', error: null } });
      return document;
    }).catch(error => {
      if (this.documentJob === job) {
        // The removed panel was the only surface that rendered preparation state, so a background
        // failure used to be completely silent: the owner got no reading and no reason. Report it on
        // the composer's existing coded-error alert, except when the user themselves stopped it by
        // opting out or changing the range, which is not an error to announce.
        this.update({ document: { ...this.state.document, phase: 'error', error: this.errorText(error) }, ...(controller.signal.aborted ? {} : { message: this.errorText(error) }) });
      }
      throw error;
    }).finally(() => { if (this.documentJob === job) this.documentJob = null; });
    return job.promise;
  }
  private async requestDocument(range: readonly [number, number] | null, signal: AbortSignal): Promise<DocumentContext> {
    const prepared = this.prepareDocument(range); const job = this.documentJob;
    if (job) job.consumers++;
    try { return await waitPreparation(prepared, signal); }
    finally { if (job) { job.consumers--; if (signal.aborted && job.consumers === 0) job.controller.abort(); } }
  }
  /**
   * Explicit retry after a Codex failure. It is an Agent action: the shared client stays the same,
   * but its dead channel is replaced and the account/catalog are re-read.
   */
  async retry(): Promise<void> {
    if (this.state.persistence === 'error') this.localFlight = null;
    this.reopenActiveOnly();
    try {
      const client = await this.connect();
      if (client.reconnect) await client.reconnect(); else await this.services.ensureAgent();
    } catch (error) { this.update({ connection: 'error', message: this.errorText(error) }); return; }
    await this.activate();
  }
  /**
   * The shared client. It is created once per plugin lifetime and its construction does not touch
   * Codex; obtaining it here is what lets the sidebar render local chats with zero Agent work.
   */
  private connect(): Promise<ReaderClient> {
    if (this.client) return Promise.resolve(this.client);
    if (this.connecting) return this.connecting;
    this.connecting = this.services.client().then(client => {
      this.client = client;
      this.unobserve?.(); this.unobserve = client.observe(snapshot => this.onRuntime(snapshot));
      this.update({ chatUnavailable: this.services.chatUnavailableReason() });
      return client;
    }).finally(() => { this.connecting = null; });
    return this.connecting;
  }
  private onRuntime(snapshot: RuntimeSnapshot): void {
    if (this.disposed) return;
    let draft = this.state.draft;
    if (snapshot.models.length && draft.settings) {
      const aligned = alignSettings(snapshot.models, draft.settings, enforcedAllowedModelIds(this.state.workspace?.allowedModels));
      if (aligned.model !== draft.settings.model || aligned.serviceTier !== draft.settings.serviceTier || aligned.effort !== draft.settings.effort) {
        draft = { ...draft, settings: aligned };
      }
    }
    this.update({ runtime: snapshot, draft, connection: snapshot.runtime === 'ready' ? 'ready' : 'error', message: snapshot.error ?? this.state.message });
    if (this.signedIn() && !this.continuing) { this.continuing = true; void this.continueAfterLogin().finally(() => { this.continuing = false; }); }
  }
  /** After a login the conversation is loaded; a single pending More details resumes exactly once. */
  private async continueAfterLogin(): Promise<void> {
    try {
      await this.adoptCurrent();
      const pending = this.state.pendingExplain;
      if (pending && this.pendingExplainMode === 'agent' && this.state.mode === 'agent' && !this.state.document.disclosure) {
        // Only a resumed explain needs a chat; a plain login opens no chat of its own.
        const conversation = await this.ensureConversation();
        this.pendingExplainMode = null; this.update({ pendingExplain: null });
        // A pending More details is always the Agent explain that queued it, so it resumes as Agent.
        await this.submit(conversation, makeExplain(pending, conversation.id, this.services.uuid(), this.currentSettings() ?? conversation.settings, this.paperIdentity()), this.contextOptions(), { ...clone(this.state.draft), skillId: null, references: [] }, await this.captureWorkspace(), false, 'agent');
      }
    } catch (error) { this.update({ message: this.errorText(error) }); }
  }
  /**
   * Show the attachment's stored current chat, if there is one. Nothing is created: with no stored
   * chat the reader stays in its new-chat state and the first question creates the record.
   */
  private async adoptCurrent(): Promise<Conversation | null> {
    const client = await this.connect();
    if (this.state.conversation) return this.state.conversation;
    if (this.selectionCleared) return null;
    const conversation = await client.peekCurrent(this.paper);
    if (!conversation || this.state.conversation || this.selectionCleared) return this.state.conversation;
    const message = await this.isolationNote(client, conversation);
    if (this.state.conversation || this.selectionCleared) return this.state.conversation;
    // A click made while the unbound pane was loading belongs to the pane the owner can see when the
    // load settles. Absence still means the product default Chat mode.
    this.transferUnboundMode(conversation.id);
    this.update({ conversation, openConversations: this.withOpen(conversation), draft: { ...this.state.draft, settings: this.state.draft.settings ?? conversation.settings }, connection: 'ready', message });
    return conversation;
  }
  /** The chat a request goes to: the one on screen, else the stored current one, else a new record. */
  private async ensureConversation(): Promise<Conversation> {
    const client = await this.connect();
    if (this.state.conversation) return this.state.conversation;
    const adopted = await this.adoptCurrent();
    if (adopted) { await this.sync(); await this.refreshList(); return adopted; }
    // The new-chat state (after `+` or a close) is the honest equivalent of starting over: the first
    // question creates the record instead of re-adopting the chat that was just left.
    const conversation = await client.newConversation(this.paper, this.identity.title, this.currentSettings() ?? undefined);
    this.selectionCleared = false;
    // The New chat tab's draft lives under `unbound` until this first send creates a record. Its
    // selected mode moves onto the new id with the draft, so the frozen mode matches the composer.
    const mode = this.modes.get('unbound') ?? this.state.mode;
    this.modes.delete('unbound'); this.modes.set(conversation.id, mode);
    this.drafts.delete('unbound'); this.positions.delete('unbound'); this.pendingSaves.delete('unbound');
    this.update({ conversation, openConversations: this.withOpen(conversation), newChatOpen: false, draft: { ...this.state.draft, settings: this.state.draft.settings ?? conversation.settings }, connection: 'ready', message: await this.isolationNote(client, conversation) });
    await this.sync();
    await this.refreshList();
    return conversation;
  }
  /**
   * Records with nothing in them — no message, no request, no saved draft, not open in this reader —
   * are leftovers (a send that failed before its first message, or chats an older build created on
   * open). They are removed so the history and any same-name numbering only ever reflect chats the
   * owner can see. Best effort: a chat that refuses deletion stays.
   */
  private async pruneEmptyConversations(): Promise<void> {
    const client = this.client; if (!client) return;
    const open = new Set(this.state.openConversations.map(entry => entry.id));
    const workspace = this.services.getWorkspace ? await this.getWorkspace().catch(() => null) : null;
    let pruned = false;
    for (const conversation of this.state.conversations) {
      if (open.has(conversation.id) || conversation.messages.length > 0 || conversation.activeRequestId || conversation.queuedRequestIds?.length) continue;
      const saved = workspace ? await workspace.readDraft(this.paper, conversation.id).catch(() => null) : null;
      if (saved && draftHasContent(saved.draft)) continue;
      try { await client.deleteConversation(conversation.paper, conversation.id); pruned = true; }
      catch { /* a chat that cannot be deleted right now is simply kept */ }
      if (saved && workspace) await workspace.deleteDraft(this.paper, conversation.id).catch(() => {});
    }
    if (pruned) { await this.refreshList(); if (this.state.history.length) await this.searchHistory(this.state.historyQuery).catch(() => {}); }
  }
  private async isolationNote(client: ReaderClient, conversation: Conversation): Promise<string | null> {
    if (conversation.messages.some(entry => entry.status === 'uncertain')) return UNCERTAIN_ISOLATION;
    const ids = new Set<string>();
    for (const entry of conversation.messages) {
      if (entry.status === 'pending' || entry.status === 'streaming') ids.add(entry.requestId);
      else if (entry.role === 'user' && !conversation.messages.some(message => message.requestId === entry.requestId && message.role === 'assistant' && (message.status === 'completed' || message.status === 'cancelled' || message.status === 'failed'))) {
        ids.add(entry.requestId);
      }
    }
    if (conversation.activeRequestId) ids.add(conversation.activeRequestId);
    for (const requestId of ids) {
      try { if ((await client.request(conversation.id, requestId)).state === 'uncertain') return UNCERTAIN_ISOLATION; }
      catch { /* missing request ids are ignored */ }
    }
    return null;
  }
  private stashDraft(): void {
    const id = this.draftKey(); this.drafts.set(id, clone(this.state.draft));
    this.positions.set(id, { scrollTop: this.state.scrollTop, range: clone(this.state.document.range) });
  }
  /**
   * After a runtime reconnect every chat is re-read from the store, so panes that would render a
   * transcript from the previous runtime are dropped rather than shown stale. The chat on screen
   * re-syncs, and any other chat is still reachable from history.
   */
  private reopenActiveOnly(): void {
    if (this.state.openConversations.length > 1) this.update({ openConversations: this.state.conversation ? [this.state.conversation] : [] });
  }
  /** The open-pane list with `conversation` replacing its entry, or appended as the newest pane. */
  private withOpen(conversation: Conversation, open: Conversation[] = this.state.openConversations): Conversation[] {
    return open.some(entry => entry.id === conversation.id)
      ? open.map(entry => entry.id === conversation.id ? conversation : entry)
      : [...open, conversation];
  }
  /**
   * The state patch that makes `conversation` the active pane. Every per-pane field the panel renders
   * is reset together so a pane never shows the previous pane's tasks, coverage or message focus;
   * `open` lets a caller that just dropped a pane (close, delete) pass the list it computed instead of
   * briefly rendering an open list that still holds the removed chat.
   */
  private panePatch(conversation: Conversation, draft: WorkspaceDraft | null, position: { scrollTop: number } | undefined, open: Conversation[] = this.state.openConversations): Partial<PresenterState> {
    return {
      conversation,
      openConversations: this.withOpen(conversation, open),
      draft: draft ? workspaceDraft(draft) : this.emptyDraft(conversation.settings),
      scrollTop: position?.scrollTop ?? 0,
      message: null, pendingExplain: null, tasks: [], readingJobs: [],
      contextReport: conversation.messages.filter(message => message.role === 'user').at(-1)?.contextReport ?? null,
      messageFocus: null, acquisitionTarget: null,
      document: { ...this.state.document, range: null, prepared: null, phase: 'idle', error: null },
    };
  }
  private async refreshList(): Promise<void> {
    if (!this.client) return;
    this.update({ conversations: await this.client.list(this.paper) });
  }
  // ---- events -----------------------------------------------------------------------------------
  private listen(client: ReaderClient): void {
    // A restarted runtime yields a new per-instance listener set; the old subscription would
    // never deliver another event, so re-subscribe whenever the client identity changes.
    if (this.unsubscribe && this.unsubscribeClient === client) return;
    this.unsubscribe?.(); this.unsubscribe = null;
    this.unsubscribeClient = client;
    this.unsubscribe = client.subscribe(event => {
      // Buffering exists to close the gap between subscribing and reading the snapshot of the one
      // chat `sync()` is reading. Events for any other chat are applied straight to that chat's own
      // copy, which carries its own `lastSeq` and cannot be confused with the chat on screen.
      if (this.state.conversation?.id === event.conversationId && this.syncing) { this.buffered.push(event); return; }
      this.apply(event);
    });
  }
  /** Subscribe first, then read a consistent snapshot, then apply only newer buffered events. */
  private async sync(): Promise<void> {
    const client = this.client; const id = this.state.conversation?.id;
    if (!client || !id) return;
    const generation = ++this.syncGeneration;
    this.listen(client);
    this.syncing = true; this.buffered = [];
    try {
      const conversation = await client.get(id);
      if (generation !== this.syncGeneration) return;
      if (this.state.conversation?.id !== id) { this.syncing = false; this.buffered = []; return; }
      const buffered = this.buffered; this.buffered = []; this.syncing = false;
      this.update({ conversation });
      for (const event of buffered) if (event.seq > conversation.lastSeq) this.apply(event);
      if (this.state.mode === 'agent') await this.recoverActionPlans(conversation);
    } catch (error) { if (generation !== this.syncGeneration) return; this.syncing = false; this.buffered = []; this.update({ message: this.errorText(error) }); }
  }
  /**
   * Apply one event to the chat it belongs to. The chat on screen is advanced in place; an open but
   * inactive chat is advanced in the open list, so its answer is kept ready rather than dropped or
   * written onto the wrong transcript. A chat the reader does not have open never reaches the view;
   * the one thing still read from it is a completed annotate turn, whose task plan is host-side.
   */
  private apply(event: ReaderEvent): void {
    const active = this.state.conversation;
    if (active && event.conversationId === active.id) {
      if (event.seq <= active.lastSeq) return;
      const { conversation, message } = this.advance(active, event);
      // An alert raised by an event only reaches the panel when the chat it belongs to is on screen.
      this.update(message === undefined ? { conversation } : { conversation, message });
      if (event.type === 'completed') void this.planReturnedActions(event.requestId).catch(error => this.reportError(this.errorText(error)));
      return;
    }
    const open = this.state.openConversations.find(entry => entry.id === event.conversationId);
    if (open) {
      if (event.seq <= open.lastSeq) return;
      const { conversation } = this.advance(open, event);
      this.update({ openConversations: this.state.openConversations.map(entry => entry.id === conversation.id ? conversation : entry) });
      if (event.type === 'completed') void this.planStoredCompletion(event.requestId, conversation).catch(error => this.reportError(this.errorText(error)));
      return;
    }
    if (event.type !== 'completed' || !this.services.agent) return;
    const known = this.state.conversations.some(conversation => conversation.id === event.conversationId) || this.drafts.has(event.conversationId);
    if (!known) return;
    void this.client?.get(event.conversationId).then(conversation => {
      if (this.disposed || conversation.id !== event.conversationId || paperId(conversation.paper) !== paperId(this.paper)) return;
      return this.planReturnedActions(event.requestId, conversation);
    }).catch(error => { if (this.state.conversation?.id === event.conversationId) this.reportError(this.errorText(error)); });
  }
  /**
   * Plan the annotations of a completed turn in a chat the reader is not looking at. The pane's own
   * copy is advanced from the events, but planning reads the store's copy of that chat: it is the
   * authority a restart or another view has already written to, exactly like the old path for a chat
   * that was not open at all.
   */
  private async planStoredCompletion(requestId: string, conversation: Conversation): Promise<void> {
    const stored = this.client ? await this.client.get(conversation.id).catch(() => null) : null;
    await this.planReturnedActions(requestId, stored ?? conversation);
  }
  /**
   * Fold one event into a copy of `conversation`. Spread alone keeps the stale timing, which would
   * let a settled request keep ticking: every event advances the honest accept/first-text/settle
   * stamps the view renders. The optional `message` is the alert the event raises, and is only ever
   * shown for the chat on screen.
   */
  private advance(conversation: Conversation, event: ReaderEvent): { conversation: Conversation; message?: string | null } {
    const next: Conversation = { ...conversation, messages: conversation.messages.map(m => ({ ...m })), lastSeq: event.seq, requestTiming: advanceRequestTiming(conversation.requestTiming, event) };
    const settleMessages = (status: Message['status']) => { for (const m of next.messages) if (m.requestId === event.requestId && m.role === 'assistant' && (m.status === 'streaming' || m.status === 'pending')) m.status = status; };
    let message: string | null | undefined;
    switch (event.type) {
      case 'accepted': next.activeRequestId = event.requestId; break;
      case 'delta': {
        let target = next.messages.find(m => m.id === event.messageId);
        if (!target) { target = { id: event.messageId, requestId: event.requestId, role: 'assistant', phase: null, settings: next.settings, text: '', citations: [], status: 'streaming' }; next.messages.push(target); }
        target.text += event.text; break;
      }
      case 'messageCompleted': {
        let target = next.messages.find(m => m.id === event.messageId);
        if (!target) { target = { id: event.messageId, requestId: event.requestId, role: 'assistant', phase: null, settings: next.settings, text: '', citations: [], status: 'streaming' }; next.messages.push(target); }
        target.text = event.finalText; target.phase = event.phase; target.status = 'completed'; break;
      }
      case 'completed': settleMessages('completed'); next.activeRequestId = null; break;
      case 'cancelled': settleMessages('cancelled'); next.activeRequestId = null; break;
      case 'failed': settleMessages('failed'); next.activeRequestId = null; message = event.message; break;
      case 'uncertain': settleMessages('uncertain'); next.activeRequestId = null; message = event.message; break;
      case 'usage': next.usage = clone(event.usage); break;
      case 'image': {
        let target = next.messages.find(item => item.id === event.messageId);
        if (!target) { target = { id: event.messageId, requestId: event.requestId, role: 'assistant', phase: null, settings: next.settings, text: '', citations: [], status: 'streaming' }; next.messages.push(target); }
        const image = validateOutputImage(event.image);
        if (!target.generatedImages?.some(item => item.id === image.id)) target.generatedImages = [...(target.generatedImages ?? []), image];
        break;
      }
    }
    return message === undefined ? { conversation: next } : { conversation: next, message };
  }
  // ---- draft ------------------------------------------------------------------------------------
  addCitation(citation: Citation): void { this.changeDraft(addCitation(this.state.draft, citation)); }
  removeCitation(citationId: string): void { this.changeDraft(removeCitation(this.state.draft, citationId)); }
  addImage(image: ImageAttachment): void { this.changeDraft(addImage(this.state.draft, validateImageAttachment(image))); }
  removeImage(imageId: string): void { this.changeDraft(removeImage(this.state.draft, imageId)); }
  moveImage(id: string, delta: number): void { this.changeDraft(moveImage(this.state.draft, id, delta)); }
  setQuestion(question: string): void {
    if (this.state.draft.question === question) return;
    this.changeDraft({ ...this.state.draft, question });
  }
  // ---- requests ---------------------------------------------------------------------------------
  /** More details: one explain request per click; when signed out the citation waits for the official login. */
  explain(citation: Citation): Promise<void> {
    const key = `${this.draftKey()}:${citation.id}`;
    const existing = this.explainFlights.get(key); if (existing) return existing;
    const mode = this.state.mode;
    const context = this.contextOptions(); const frozenSettings = this.currentSettings();
    const draft = { ...clone(this.state.draft), skillId: null, references: [] }; const workspace = this.captureWorkspace(); const target = this.state.conversation;
    if (mode === 'agent' && context.enabled && this.state.document.disclosure) { this.pendingExplainMode = mode; this.update({ pendingExplain: clone(citation) }); return Promise.resolve(); }
    const flight = (async () => {
      const kept = clone(citation);
      try {
        await this.loadLocal();
        const configuration = await workspace; if (this.disposed) return;
        await this.connect();
        // The host routes the real hosted-Chat selection actions directly to the official page.
        // This method remains the native conversation entry point, so it freezes the mode shown at
        // the click and must never turn a Chat action into a Codex Agent request behind the owner's
        // back. A host without a native Chat transport refuses through prepareMode before sending.
        if (!await this.prepareMode(mode, { pendingExplain: kept, pendingMode: mode })) return;
        const conversation = target ?? await this.ensureConversation();
        await this.submit(conversation, makeExplain(kept, conversation.id, this.services.uuid(), frozenSettings ?? conversation.settings, this.paperIdentity()), context, draft, configuration, false, mode);
      } catch (error) { this.update({ message: this.errorText(error) }); }
    })().finally(() => { this.explainFlights.delete(key); });
    this.explainFlights.set(key, flight);
    return flight;
  }
  send(): Promise<void> {
    const key = this.draftKey(); const existing = this.sendFlights.get(key); if (existing) return existing;
    if (!this.state.draft.question.trim()) { this.update({ message: 'Enter a question first.' }); return Promise.resolve(); }
    const draft = clone(this.state.draft); const version = this.draftVersion;
    const settings = this.currentSettings(); const document = this.contextOptions();
    const workspace = this.captureWorkspace(); const target = this.state.conversation;
    const mode = this.state.mode; const organization = this.prepareOrganizationContext(draft, mode);
    if (document.enabled) { this.services.document?.acknowledge?.(); this.update({ document: { ...this.state.document, disclosure: false } }); }
    const flight = this.sendDraft(draft, version, settings, document, workspace, target, false, mode, organization).finally(() => { this.sendFlights.delete(key); }); this.sendFlights.set(key, flight);
    return flight;
  }
  queueDraft(): Promise<void> {
    if (this.queueFlight) return this.queueFlight;
    if (!this.state.draft.question.trim()) { this.reportError('Enter a question first.'); return Promise.resolve(); }
    const draft = clone(this.state.draft); const version = this.draftVersion; const settings = this.currentSettings(); const document = this.contextOptions();
    const workspace = this.captureWorkspace(); const target = this.state.conversation; const sending = this.sendFlights.get(this.draftKey());
    const mode = this.state.mode; const organization = this.prepareOrganizationContext(draft, mode);
    this.update({ queueing: true });
    this.queueFlight = (async () => { await sending; await this.sendDraft(draft, version, settings, document, workspace, target, true, mode, organization); })().finally(() => { this.queueFlight = null; this.update({ queueing: false }); });
    return this.queueFlight;
  }
  private async sendDraft(draft: WorkspaceDraft, version: number, settings: GenerationSettings | null, document: RequestContext, workspace: Promise<WorkspaceSettings | null>, target: Conversation | null, queued: boolean, mode: RequestMode, organizationFlight: Promise<FrozenOrganizationResult> | null): Promise<void> {
    try {
      // Scope failures win over login/runtime preparation: selection was frozen at the owner's click,
      // and a failed freeze must never start Codex, disappear behind a login message, or retarget a
      // later selection. The settled union also makes an early rejection safe while Queue is waiting.
      let organization: OrganizationContext | undefined;
      if (organizationFlight) { const frozen = await organizationFlight; if (!frozen.ok) throw frozen.error; organization = frozen.value; }
      await this.loadLocal();
      const configuration = await workspace; if (this.disposed) return;
      await this.connect();
      if (!await this.prepareMode(mode)) return;
      const conversation = target ?? await this.ensureConversation();
      const resolved = ConversationPresenter.withoutStaleProfile(draft, configuration);
      const input = makeAsk(resolved.draft, conversation.id, this.services.uuid(), settings ?? conversation.settings, this.paperIdentity());
      if (organization) input.organization = organization;
      await this.submit(conversation, input, document, resolved.draft, configuration, queued, mode);
      // Remember what was sent so Stop can return it to the composer.
      this.submitted.set(conversation.id, clone(resolved.draft));
      const active = this.state.conversation?.id === conversation.id;
      const stored = active ? this.state.draft : this.drafts.get(conversation.id);
      const position = active ? { scrollTop: this.state.scrollTop, range: this.state.document.range } : this.positions.get(conversation.id);
      const unchanged = active && this.draftVersion === version || !!stored && JSON.stringify(stored) === JSON.stringify(draft) && JSON.stringify(position?.range ?? null) === JSON.stringify(document.range);
      if (stored && unchanged) {
        const cleared = { ...stored, question: '', citations: [], images: [], references: [] };
        if (active) this.changeDraft(cleared);
        else {
          this.drafts.set(conversation.id, cleared);
          if (this.services.getWorkspace) {
            this.pendingSaves.set(conversation.id, { schemaVersion: 1, paper: clone(this.paper), conversationId: conversation.id, draft: cleared, scrollTop: position?.scrollTop ?? 0, pageRange: null, updatedAt: this.services.now() });
            if (this.saveTimer) clearTimeout(this.saveTimer);
            this.saveTimer = setTimeout(() => { this.saveTimer = null; void this.flushDraft().catch(() => {}); }, 150);
          }
        }
      }
      // Report the degradation after the post-send draft clear, which would otherwise null it out.
      if (resolved.stale) this.update({ message: STALE_PROFILE_MESSAGE });
    } catch (error) { this.update({ message: this.errorText(error) }); }
  }
  private frozenWorkflow(draft: WorkspaceDraft, settings: WorkspaceSettings | null, mode: RequestMode, question: string): WorkflowSnapshot | undefined {
    if (!settings) return undefined;
    // Global preferences are authoritative. A legacy persisted per-chat profile that no longer
    // resolves must not abort the send — the per-chat profile control is gone, so there would be no
    // way out — and it must not override the global preferences either. Treat it as "no profile";
    // the send path reports the degradation out loud.
    const profile = draft.profileId ? settings.profiles.find(profile => profile.id === draft.profileId) : undefined;
    const inferredAnnotation = !draft.skillId && mode === 'agent' && requestsCurrentPaperAnnotations(question);
    const inferredOrganization = !draft.skillId && mode === 'agent' && !inferredAnnotation && requestsSelectionOrganization(question);
    const skill = draft.skillId
      ? settings.skills.find(skill => skill.id === draft.skillId)
      : inferredAnnotation
        ? settings.skills.find(skill => skill.id === 'builtin-annotate' && skill.enabled)
        : inferredOrganization
          ? settings.skills.find(skill => skill.id === 'builtin-organize' && skill.enabled)
        : null;
    if (draft.skillId && (!skill || !skill.enabled)) throw new ReaderError('UNSUPPORTED_INTERACTION', 'The selected skill is unavailable or disabled.');
    if (inferredAnnotation && !skill) throw new ReaderError('UNSUPPORTED_INTERACTION', 'The built-in annotation workflow is unavailable or disabled. Enable it before asking Agent to highlight the current paper.');
    if (inferredOrganization && !skill) throw new ReaderError('UNSUPPORTED_INTERACTION', 'The built-in organization workflow is unavailable or disabled. Enable it before asking Agent to organize the selected items.');
    return validateWorkflow({ skill: skill ?? null, profileId: profile ? draft.profileId : null, preferences: { ...settings.preferences, ...profile?.preferences, ...draft.overrides } });
  }
  /**
   * Does this draft still point at a research profile that exists? When it does not, the dead
   * reference is dropped so the global preferences apply, and the caller reports it visibly rather
   * than failing an unreachable send or silently changing behaviour.
   */
  private static withoutStaleProfile(draft: WorkspaceDraft, settings: WorkspaceSettings | null): { draft: WorkspaceDraft; stale: boolean } {
    if (!draft.profileId || !settings || settings.profiles.some(profile => profile.id === draft.profileId)) return { draft, stale: false };
    return { draft: { ...draft, profileId: null }, stale: true };
  }
  /**
   * The admission estimate for this request. The host may inject a port; otherwise it delegates to
   * the one core authority (`estimateRequestBudget`), so the chat path cannot plan against a second
   * copy of the reservation policy (R5).
   */
  private estimateBudget(input: SendInput, conversation: Conversation): ContextBudget {
    if (this.services.contextBudget) return this.services.contextBudget(input, conversation);
    const usage = conversation.usage?.model === input.settings.model ? conversation.usage : undefined;
    return estimateRequestBudget({ request: input, messages: conversation.messages, usage });
  }
  private async planInput(input: SendInput, conversation: Conversation): Promise<ContextPlan | null> {
    const documents = [input.document, ...(input.references ?? []).map(reference => reference.document)].filter((document): document is DocumentContext => !!document);
    if (!documents.length) return null;
    const budget = this.estimateBudget(input, conversation);
    const primary = input.document ?? documents[0]!;
    if (budget.accuracy === 'unknown' || budget.textBudgetTokens === null) {
      // No trustworthy window: every locally extracted authorized page is supplied as-is (nothing is
      // silently dropped), the pages the extractor could not read stay reported as gaps, and the
      // unknown capacity means fit is not asserted in either direction.
      input.contextReport = { mode: 'full', capacity: budget.capacity, provenance: budget.provenance, reservedTokens: budget.reservations.total, textBudgetTokens: null, selectedPages: primary.pages.map(page => page.pageIndex), totalPages: primary.totalPages, reason: `All locally extracted authorized text is supplied. Model capacity or retained history is unknown; fit was not asserted.${gapDisclosure(primary)}` }; return null;
    }
    if (!budget.textBudgetTokens) throw new ReaderError('PAYLOAD_TOO_LARGE', 'The context budget leaves no room for PDF text. Start a new chat to reset the retained history.');
    const total = documents.reduce((sum, document) => sum + bytes(document), 0);
    if (total <= budget.textBudgetTokens) {
      input.contextReport = { mode: 'full', capacity: budget.capacity, provenance: budget.provenance, reservedTokens: budget.reservations.total, textBudgetTokens: budget.textBudgetTokens, selectedPages: primary.pages.map(page => page.pageIndex), totalPages: primary.totalPages, reason: `All authorized source pages fit within the conservative estimate. Image costs remain explicit.${gapDisclosure(primary)}` }; return null;
    }
    const perSource = { ...budget, textBudgetTokens: Math.floor(budget.textBudgetTokens / documents.length) };
    const plans = await Promise.all(documents.map(document => planContext({ document, question: input.question, citations: input.citations, budget: perSource })));
    const all = plans.flatMap(plan => plan.documents);
    if (all.length > 256) throw new ReaderError('PAYLOAD_TOO_LARGE', 'This source needs more than 256 reading passes at the current budget. No text was dropped, but the request was not sent.');
    if (plans.every(plan => plan.mode !== 'multi-pass') && all.reduce((sum, document) => sum + bytes(document), 0) <= budget.textBudgetTokens) {
      const substitute = (document: DocumentContext) => all.find(fragment => paperId(fragment.paper) === paperId(document.paper) && (fragment.sourceId ?? fragment.id) === (document.sourceId ?? document.id)) ?? document;
      if (input.document) input.document = substitute(input.document);
      if (input.references) input.references = input.references.map(reference => reference.document ? { ...reference, document: substitute(reference.document) } : reference);
      const selected = input.document ?? all[0]!;
      // The plan that produced the fragment we report on owns the explanation: it names the local
      // selection rule, the pages it left out and every recorded gap. Its mode is the honest one.
      const selectedPlan = plans.find(plan => plan.documents.some(fragment => fragment.id === selected.id)) ?? plans[0]!;
      input.contextReport = { mode: selectedPlan.mode, capacity: budget.capacity, provenance: budget.provenance, reservedTokens: budget.reservations.total, textBudgetTokens: budget.textBudgetTokens, selectedPages: selected.pages.map(page => page.pageIndex), totalPages: selected.totalPages, reason: selectedPlan.coverage.reason }; return null;
    }
    const first = plans[0]!;
    // Each authorized source is planned separately, and each plan explains its own page coverage. The
    // first plan alone would drop the other sources' gaps and exclusions, so every distinct reason is
    // carried into the aggregate report; identical reasons collapse rather than repeat.
    const reasons = [...new Set(plans.map(plan => plan.coverage.reason.trim()))];
    const plan: ContextPlan = { mode: 'multi-pass', documents: all, budget, coverage: { ...first.coverage, reason: `The authorized sources require ${all.length} reading passes followed by synthesis. ${reasons.join(' ')}` } };
    input.contextReport = { mode: 'multi-pass', capacity: budget.capacity, provenance: budget.provenance, reservedTokens: budget.reservations.total, textBudgetTokens: budget.textBudgetTokens, selectedPages: first.coverage.selectedPages, totalPages: first.coverage.totalPages, reason: plan.coverage.reason }; return plan;
  }
  private async submit(conversation: Conversation, input: SendInput, context: RequestContext, draft: WorkspaceDraft, configuration: WorkspaceSettings | null, queued = false, mode: RequestMode = 'chat'): Promise<void> {
    if (this.submissions.has(conversation.id)) throw new ReaderError('BUSY', 'This chat is already preparing a request.');
    const client = await this.connect();
    if (queued && !client.enqueue) throw new ReaderError('UNSUPPORTED_INTERACTION', 'Durable request queuing is unavailable. Your draft is kept.');
    const current = await client.get(conversation.id);
    if (current.id !== conversation.id || paperId(current.paper) !== paperId(this.paper)) throw new ReaderError('INVALID_REQUEST', 'The request conversation changed.');
    if (!queued && (current.activeRequestId || current.queuedRequestIds?.length)) throw new ReaderError('BUSY', 'This conversation is still answering. Use Queue or start a new chat.');
    const controller = new AbortController(); this.submissions.set(conversation.id, controller); this.update({ message: null });
    try {
      // Last line of defence: no Chat request may reach the shared service without a Chat transport,
      // so Chat can never be routed to Codex by a path that forgot to check.
      if (mode === 'chat') { const reason = this.services.chatUnavailableReason(); if (reason) throw new ReaderError('UNSUPPORTED_INTERACTION', reason); }
      // Preferences can change after the visible composer was rendered. Constrain the frozen request
      // against the fresh settings snapshot, without rewriting the stored conversation snapshot.
      const models = this.state.runtime?.models ?? [];
      const workspaceSettings = configuration ?? this.state.workspace;
      if (models.length) input.settings = alignSettings(models, input.settings, enforcedAllowedModelIds(workspaceSettings?.allowedModels));
      const workflow = this.frozenWorkflow(draft, workspaceSettings, mode, input.question);
      if (workflow) input.workflow = workflow;
      const skillWorkflow = workflow?.skill?.workflow ?? null;
      // Stage 6/8: the composer's mode control is the single authority for `mode`; `workflow` never
      // infers it. `submit` is a thin dispatcher on the frozen mode: the Chat path
      // (`executeChatSend`) can only read context and deliver one request, while the Agent path
      // (`executeAgentSend`) is the only one that can plan a task or start a reading job.
      if (skillWorkflow === 'acquire') {
        if (mode === 'chat') refuseChatWorkflow('acquire');
        if (queued) throw new ReaderError('UNSUPPORTED_INTERACTION', 'Acquisition previews use task review, not the model request queue. Your draft is kept.');
        if (!context.acquisitionTarget) throw new ReaderError('INVALID_REQUEST', 'Choose a target collection before acquiring articles.');
        const identifiers = [...new Set((input.question.match(/https?:\/\/[^\s<>"']+|\b10\.\d{4,9}\/[^\s<>"']+/giu) ?? []).map(value => value.replace(/[.,;，。；]+$/u, '')))];
        if (!identifiers.length) throw new ReaderError('INVALID_REQUEST', 'Provide explicit DOI identifiers or article URLs for acquisition.');
        await executeAgentSend(this.agentSendContext(client, conversation, input, null, queued, { target: clone(context.acquisitionTarget), identifiers }));
        return;
      }
      if (skillWorkflow === 'organize' && !input.organization) throw new ReaderError('INVALID_REQUEST', 'The selected Zotero items were not frozen for this request. Select them again and retry.');
      if (skillWorkflow === 'diagram' && this.state.runtime?.capabilities?.imageGeneration !== true) throw new ReaderError('UNSUPPORTED_INTERACTION', 'Image generation is unavailable in this runtime.');
      if (mode === 'chat') {
        // Chat is read context + reason + answer: an Agent-only skill or a plainly imperative
        // library/PDF mutation is refused before the document is even prepared.
        refuseChatWorkflow(skillWorkflow);
        refuseChatAction(input.question);
      }
      if (context.enabled && skillWorkflow !== 'organize') input.document = await this.requestDocument(context.range, controller.signal);
      const references: ReferenceInput[] = [];
      for (const reference of draft.references) {
        aborted(controller.signal);
        references.push(reference.kind === 'chat' ? validateReference(reference) : await this.previewReference(reference, controller.signal));
      }
      if (references.length) input.references = references;
      if (input.document && !input.document.pages.some(page => page.status === 'text') && !input.images?.length) throw new ReaderError('INVALID_REQUEST', 'No extractable text was found in the pages supplied from this PDF. Attach the relevant page image if you want to ask about them.');
      const modalities = this.state.runtime?.models.find(model => model.id === input.settings.model)?.inputModalities;
      if (input.images?.length && modalities && !modalities.includes('image')) throw new ReaderError('MODEL_UNAVAILABLE', 'The selected model does not accept image input.');
      const plan = await this.planInput(input, current); aborted(controller.signal);
      if (this.state.conversation?.id === conversation.id) this.update({ contextReport: input.contextReport ?? null });
      // `mode` is readonly on the contract, so it rides on the request copy handed to the session
      // rather than being assigned back like `workflow`; the hash and the stored message use it.
      const request: SendInput = { ...input, mode };
      if (mode === 'chat') {
        await executeChatSend({ client, request, queued, plan });
      } else {
        const scopeLabel = [input.document ? input.paper?.title || this.identity.title : '', ...(input.references ?? []).map(reference => reference.label)].filter(Boolean).join(' · ');
        await executeAgentSend(this.agentSendContext(client, conversation, request, plan, queued, null, scopeLabel));
      }
      if (this.state.conversation?.id === conversation.id) await this.sync();
      await this.refreshList();
    }
    finally { this.submissions.delete(conversation.id); this.update({}); }
  }
  /**
   * The Agent execution context. Building it acquires the ports lazily through the presenter, so the
   * capability's cache and subscriptions stay owned here, and the Chat path never sees this object.
   */
  private agentSendContext(client: ReaderClient, conversation: Conversation, request: SendInput, plan: ContextPlan | null, queued: boolean, acquisition: { target: NativeCollectionTarget; identifiers: string[] } | null, scopeLabel = ''): AgentSendContext {
    return {
      ports: { tasks: () => this.getTasks(), reading: readingClient => this.getReading(readingClient) },
      client, conversationId: conversation.id, request, plan, queued, acquisition, scopeLabel,
      acceptTask: task => this.acceptTask(task),
      acceptReading: job => this.acceptReading(job),
      describeReading: description => this.readingDescriptions.set(request.requestId, description),
    };
  }
  async cancel(): Promise<void> {
    const client = this.client; const conversation = this.state.conversation;
    const reading = this.state.readingJobs.find(activeReading); if (reading) { await this.cancelReading(reading.id); return; }
    if (!conversation) return;
    if (!conversation.activeRequestId) { this.submissions.get(conversation.id)?.abort(); return; }
    if (!client) { this.reportError('Reconnect before stopping this saved request.'); return; }
    try { await client.cancel(conversation.id, conversation.activeRequestId); this.restoreSubmittedDraft(conversation.id); } catch (error) { this.update({ message: this.errorText(error) }); }
  }
  /**
   * Stop returns the question, citations and images to the composer instead of losing them. Only an
   * empty composer is refilled, so a newer draft the reader typed after sending is never clobbered,
   * and nothing here touches request timing: the transcript keeps the cancelled request as recorded.
   */
  private restoreSubmittedDraft(conversationId: string): void {
    const submitted = this.submitted.get(conversationId);
    if (!submitted || this.state.conversation?.id !== conversationId) return;
    const current = this.state.draft;
    if (current.question.trim() || current.citations.length || current.images.length || current.references.length) return;
    this.changeDraft({ ...current, question: submitted.question, citations: clone(submitted.citations), images: clone(submitted.images) });
    // Once handed back there is nothing left to restore, so the remembered draft is released.
    this.submitted.delete(conversationId);
  }
  async cancelQueuedRequest(requestId: string): Promise<void> {
    const conversation = this.state.conversation; if (!conversation?.queuedRequestIds?.includes(requestId)) throw new ReaderError('NOT_FOUND', 'This request is not queued in the current chat.');
    await (await this.connect()).cancel(conversation.id, requestId); await this.sync();
  }
  /**
   * Open the New chat tab. Nothing is created or written: the tab is the reader's unbound draft, and
   * the first question sent from it creates the record. The chat that was on screen stays open as
   * its own tab. Pressing `+` while the New chat tab is already on screen is a no-op.
   */
  async newConversation(): Promise<void> {
    try {
      await this.loadLocal(); ++this.navigation;
      if (!this.state.conversation) { this.update({ message: null, pendingExplain: null, contextReport: null }); return; }
      this.stageDraft(); this.draftVersion++;
      this.enterNewChat(this.state.openConversations);
      await this.refreshTaskState();
    } catch (error) { this.update({ message: this.errorText(error) }); }
  }
  /** The new-chat state: no active record, the unbound draft, and `open` as the remaining tabs. */
  private enterNewChat(open: Conversation[]): void {
    const position = this.positions.get('unbound');
    const unbound = this.drafts.get('unbound');
    this.selectionCleared = true;
    // The New chat tab inherits the mode on screen, the way it inherits the model settings: a `+`
    // starts a new conversation, not a different mode.
    this.modes.set('unbound', this.modes.get(this.draftKey()) ?? this.state.mode);
    this.update({
      conversation: null,
      openConversations: open,
      newChatOpen: true,
      draft: unbound ? workspaceDraft(unbound) : this.emptyDraft(),
      scrollTop: position?.scrollTop ?? 0,
      message: null, pendingExplain: null, contextReport: null, tasks: [], readingJobs: [],
      acquisitionTarget: null, messageFocus: null,
      document: { ...this.state.document, range: null, prepared: null, phase: 'idle', error: null },
    });
    this.stageDraft();
  }
  /**
   * Does the sidebar still have a chat to list for this attachment once `closingId` is gone?
   * `state.conversations` is `client.list(this.paper)` — the attachment-scoped listing the
   * sidebar's host-list path renders. `state.history` is the workspace listing it renders otherwise;
   * that listing is profile-wide, so it is scoped here by the same paper identity this presenter
   * uses everywhere else. Every chat counts, including a record that carries a legacy `archivedAt`:
   * there is no Archived section any more, so such a record is an ordinary chat the owner can open
   * and therefore a reason to keep the dock open.
   */
  private hasChatForPaper(closingId: string | null): boolean {
    const paper = paperId(this.paper);
    if (this.state.conversations.some(conversation => conversation.id !== closingId && paperId(conversation.paper) === paper)) return true;
    return this.state.history.some(entry => entry.id !== closingId && paperId(entry.paper) === paper);
  }
  /**
   * Close the chat on screen. Kept as the single-pane entry point: the reader cancels the panel or
   * closes the chat's own title chip through it.
   */
  closeConversation(): boolean {
    const id = this.state.conversation?.id ?? null;
    if (id) return this.closePane(id);
    // Closing the New chat tab returns to the last open chat; with no other tab it is a no-op.
    const next = this.state.openConversations.at(-1);
    if (!next || this.disposed) return false;
    this.stageDraft(); this.draftVersion++; this.selectionCleared = false;
    this.update({ ...this.panePatch(next, this.drafts.get(next.id) ?? null, this.positions.get(next.id)), newChatOpen: false });
    this.stageDraft();
    return false;
  }
  /**
   * Leave one open chat without deleting or rewriting anything. The chat stays on disk and in
   * history. When another pane is still open the reader stays on that pane with its own draft and
   * scroll position; only closing the last pane returns the reader to its new-conversation state with
   * the unbound draft. The stored "current" pointer is left alone either way, so an explicit close
   * must stop the adoption paths from silently restoring the closed chat: the next request starts a
   * fresh one instead.
   *
   * Returns true when nothing is left to list for this attachment, i.e. the caller should collapse
   * the reader dock through its own close path rather than leave an empty panel.
   */
  closePane(id: string | null): boolean {
    if (this.disposed || !id) return false;
    const closing = this.state.openConversations.find(entry => entry.id === id);
    if (!closing) return false;
    this.stageDraft();
    const remaining = this.state.openConversations.filter(entry => entry.id !== id);
    // Closing a background pane leaves the chat on screen untouched, including its prepared PDF.
    if (this.state.conversation?.id !== id) {
      this.update({ openConversations: remaining });
      return !this.hasChatForPaper(id);
    }
    this.draftVersion++;
    const next = remaining.at(-1);
    if (next) {
      // Another pane is open: closing one chat keeps the reader on a chat, not on an empty pane.
      this.selectionCleared = false;
      this.update(this.panePatch(next, this.drafts.get(next.id) ?? null, this.positions.get(next.id), remaining));
      this.stageDraft();
      return !this.hasChatForPaper(id);
    }
    this.enterNewChat(remaining);
    return !this.hasChatForPaper(id);
  }
  async deleteConversation(id: string): Promise<void> {
    try {
      const client = await this.connect();
      const target = this.state.conversation?.id === id ? this.state.conversation : this.services.getWorkspace ? await (await this.getWorkspace()).readConversation(id) : await client.get(id);
      if (target.id !== id) throw new ReaderError('NOT_FOUND', 'The selected chat could not be located.');
      // The busy check must not initialize the Agent capability for a chat that never ran Agent work:
      // deleting is reachable straight from the Chat-Mode history row. It runs when the composer is in
      // Agent Mode, or when the conversation's own transcript evidences Agent work. An unfinished
      // native task or reading job always implies such a message, so no real protection is lost, while
      // a pure Chat-Mode delete stays free of task/reading initialization.
      const inspectAgent = this.state.mode === 'agent' || conversationHasAgentWork(target);
      if (this.services.agent && inspectAgent) {
        const tasks = await (await this.getTasks()).list(id);
        if (tasks.some(task => ['preparing', 'review', 'running', 'uncertain'].includes(task.state) || task.items.some(item => ['writing', 'undoing', 'uncertain'].includes(item.status)))) throw new ReaderError('BUSY', 'Cancel or reconcile this chat’s unfinished native tasks before deleting it. Existing native outputs will not be undone.');
      }
      if (this.services.agent && inspectAgent && (await (await this.getReading(client)).list(id)).some(unfinishedReading)) throw new ReaderError('BUSY', 'Cancel or reconcile this chat’s unfinished reading task before deleting it.');
      this.stageDraft(); await this.flushDraft();
      const conversation = await client.deleteConversation(target.paper, id);
      this.drafts.delete(id); this.positions.delete(id); this.pendingSaves.delete(id);
      if (this.services.getWorkspace) await (await this.getWorkspace()).deleteDraft(target.paper, id);
      const remaining = this.state.openConversations.filter(entry => entry.id !== id);
      if (this.state.conversation?.id === id) {
        // Prefer a chat the reader still has open to the store's own fallback pointer, so deleting one
        // pane does not silently jump to an unrelated chat. With nothing left at all, the reader is in
        // its new-chat state: no replacement record is created.
        const next = remaining.at(-1);
        if (next) { this.draftVersion++; this.update(this.panePatch(next, this.drafts.get(next.id) ?? null, this.positions.get(next.id), remaining)); this.stageDraft(); }
        else if (conversation) await this.restoreConversation(conversation, false);
        else { this.draftVersion++; this.enterNewChat(remaining); }
      } else this.update({ openConversations: remaining });
      await this.sync();
      await this.refreshList(); await this.refreshTaskState();
      // The history listing is a store read of its own, so a deletion must also re-read it: a
      // workspace row (another paper's chat) is not in `conversations` and would otherwise linger.
      if (this.state.history.length || this.state.historyQuery) await this.searchHistory(this.state.historyQuery);
    } catch (error) { this.update({ message: this.errorText(error) }); }
  }
  async openConversation(id: string): Promise<void> {
    if (this.state.conversation?.id === id) return;
    const modeIntentRevision = this.modeIntentRevision;
    try {
      await this.loadLocal(); const navigation = ++this.navigation; this.stageDraft();
      const client = this.client;
      const conversation = client && this.state.connection === 'ready' ? await client.select(this.paper, id) : this.services.getWorkspace ? await (await this.getWorkspace()).readConversation(id) : await (await this.connect()).select(this.paper, id);
      if (navigation !== this.navigation) return;
      if (paperId(conversation.paper) !== paperId(this.paper)) { await this.openHistoryEntry(id); return; }
      await this.restoreConversation(conversation, true, undefined, modeIntentRevision); if (this.state.connection === 'ready') await this.sync();
      await this.refreshList(); await this.refreshTaskState();
    } catch (error) { this.update({ message: this.errorText(error) }); }
  }
  private async restoreConversation(conversation: Conversation, stash = true, override?: WorkspaceDraft, modeIntentRevision?: number): Promise<void> {
    // A chat is active again, so a previous Close no longer governs adoption.
    this.selectionCleared = false;
    let draft = override ?? this.drafts.get(conversation.id); let position = this.positions.get(conversation.id);
    if (!draft && this.services.getWorkspace) {
      const saved = await (await this.getWorkspace()).readDraft(this.paper, conversation.id);
      if (saved) { draft = saved.draft; position = { scrollTop: saved.scrollTop, range: null }; }
    }
    if (stash) this.stageDraft(); this.draftVersion++;
    if (modeIntentRevision !== undefined && this.modeIntentRevision !== modeIntentRevision) this.modes.set(conversation.id, this.state.mode);
    this.update(this.panePatch(conversation, draft ?? null, position));
    if (this.client) this.update({ message: await this.isolationNote(this.client, conversation) });
    this.stageDraft();
  }
  async renameConversation(id: string, title: string): Promise<void> {
    const client = await this.connect(); if (!client.renameConversation) throw new ReaderError('UNSUPPORTED_INTERACTION', 'Chat renaming is unavailable.');
    const renamed = await client.renameConversation(id, title.trim());
    if (this.state.conversation?.id === id) this.update({ conversation: renamed });
    await this.refreshList(); await this.searchHistory('');
  }
  async branchConversation(messageId: string, question?: string): Promise<void> {
    const original = this.state.conversation; if (!original) throw new ReaderError('NOT_FOUND', 'Open a chat before editing a previous message.');
    const anchor = original.messages.find(message => message.id === messageId);
    const user = anchor?.role === 'user' ? anchor : original.messages.find(message => message.role === 'user' && message.requestId === anchor?.requestId);
    if (!user) throw new ReaderError('NOT_FOUND', 'The original question could not be found.');
    const client = await this.connect(); if (!client.branchConversation) throw new ReaderError('UNSUPPORTED_INTERACTION', 'Branching chat history is unavailable.');
    const navigation = ++this.navigation; this.stageDraft(); await this.flushDraft();
    const branch = await client.branchConversation(original.id, messageId);
    if (branch.id === original.id || paperId(branch.paper) !== paperId(this.paper)) throw new ReaderError('INVALID_REQUEST', 'The core did not create an independent chat branch.');
    if (navigation !== this.navigation) return;
    const draft: WorkspaceDraft = { ...this.emptyDraft(user.settings), question: question ?? user.text, citations: clone(user.citations), images: clone(user.images ?? []), references: clone(user.references ?? []), skillId: user.workflow?.skill?.id ?? null, profileId: user.workflow?.profileId ?? null, overrides: {} };
    await this.restoreConversation(branch, true, draft); this.focusInput(); await this.refreshList(); await this.refreshTaskState();
  }
  // ---- account ----------------------------------------------------------------------------------
  async login(): Promise<void> {
    try {
      // Login is Agent-only by definition: it opens the Codex channel that holds the ChatGPT session.
      const client = await this.connect();
      await this.services.ensureAgent();
      if (client.snapshot().account.state === 'signedIn') return;
      const flow = await client.startLogin();
      const url = new URL(flow.authorizationUrl);
      if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !LOGIN_HOSTS.includes(url.hostname)) throw new Error('Codex returned an unsupported login address.');
      this.services.openAuthorization(url.href);
    } catch (error) { this.update({ message: this.errorText(error) }); }
  }
  async cancelLogin(): Promise<void> { try { await this.client?.cancelLogin(); } catch (error) { this.update({ message: this.errorText(error) }); } }
  /**
   * Copies whitelist JSON only. The view uses the host clipboard hook; this method never reads files.
   * Test-only surface, kept deliberately (plan §H R8): the diagnostics panel that called it is not
   * mounted in production, and the tests that drive it stay until that panel returns or they move.
   */
  async copyDiagnostics(): Promise<string | null> {
    try {
      const client = await this.connect();
      const id = this.state.conversation?.id;
      if (!id) { this.update({ message: 'There is no shareable conversation diagnostic.' }); return null; }
      const text = JSON.stringify(await client.diagnostics(id));
      this.update({ message: 'Copied shareable diagnostics. They do not include paper text, account details, or paths.' });
      return text;
    } catch (error) { this.update({ message: this.errorText(error) }); return null; }
  }
  dispose(): void {
    if (this.disposed) return;
    this.stageDraft(); void this.flushDraft().catch(() => {}); this.disposed = true;
    this.documentJob?.controller.abort(); for (const controller of this.submissions.values()) controller.abort();
    this.renders.clear(); this.unsubscribe?.(); this.unsubscribe = null; this.unsubscribeClient = null; this.unobserve?.(); this.unobserve = null; this.untasks?.(); this.unreading?.();
    this.historyUnsubscribe?.(); this.historyUnsubscribe = null; this.historySubscribed = null;
  }
}
