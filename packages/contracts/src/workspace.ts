import type { DocumentContext, DocumentRevision, Draft, ImageAttachment, PaperIdentity, PaperScope, Rect } from './index.ts';

export type WorkflowKind = 'read' | 'annotate' | 'acquire' | 'organize' | 'diagram';
export interface Personalization {
  language: string;
  detail: 'brief' | 'standard' | 'detailed';
  mathematics: 'auto' | 'intuition-first' | 'formal';
  background: string;
  citationStyle: string;
  annotationStyle: string;
}
export interface ResearchProfile { id: string; name: string; preferences: Partial<Personalization> }
/**
 * One model the composer may offer. `id` is the exact runtime model id; `name` is a local display
 * label derived from that id (the pinned catalog carries no display names), never a live entitlement
 * report. See `core/workspace/allowed-models.ts` for the default set and the resolver.
 */
export interface AllowedModel { id: string; name: string }
export interface ReaderSkill {
  id: string; name: string; description: string; version: string; revision: string;
  markdown: string; origin: 'builtin' | 'user' | 'imported'; enabled: boolean;
  workflow: WorkflowKind; permissions: string[]; unsupportedDependencies: string[];
}
export interface WorkspaceSettings {
  schemaVersion: 1;
  preferences: Personalization;
  profiles: ResearchProfile[];
  skills: ReaderSkill[];
  uiLanguage: 'en' | 'zh';
  textScale: number;
  /**
   * The models the composer may offer. Absent in records written before this setting existed and then
   * treated as `defaultAllowedModels()` by the store and the pane; the store refuses to persist or
   * load an explicitly empty list, so the picker can never be emptied. Additive to schemaVersion 1:
   * older builds already safe-reject a settings file that carries an unknown key.
   */
  allowedModels?: AllowedModel[];
}
/**
 * References contain a bounded snapshot, never recursively nested conversations. `file` is one local
 * file the owner attached explicitly through the native picker: `label` is the bare file name and
 * `text` is the decoded UTF-8 body. The local path is deliberately never part of a reference, so
 * nothing downstream (including the request sent to the model) can name a filesystem location, and
 * the body is data the model may read, never an instruction it may follow.
 */
export interface ReaderReference {
  id: string;
  kind: 'article' | 'chat' | 'collection' | 'note' | 'annotation' | 'file';
  label: string;
  paper?: PaperScope;
  identity?: PaperIdentity;
  conversationId?: string;
  messageIds?: string[];
  text?: string;
  range?: [number, number];
  capturedAt: string;
}
/**
 * What one explicit native file pick produced. The route is decided by the file itself: a text-like
 * file becomes reference text, an image file becomes image input. `references` carry the bare name
 * and the decoded text only — never the chosen path — and `images` are the same validated
 * attachments the image picker produces, so every existing cap still applies.
 */
export interface PickedFile { references: ReaderReference[]; images: ImageAttachment[] }
export interface WorkflowSnapshot {
  skill: ReaderSkill | null;
  preferences: Personalization;
  profileId: string | null;
  /** Present only on new, explicitly sent Agent annotate requests; old requests stay review-only. */
  autoApplyAnnotations?: true;
}
export interface ReferenceInput extends ReaderReference { document?: DocumentContext }
export interface WorkspaceDraft extends Draft {
  references: ReaderReference[];
  skillId: string | null;
  profileId: string | null;
  overrides: Partial<Personalization>;
}
export interface SavedDraft {
  schemaVersion: 1; paper: PaperScope; conversationId: string | null;
  draft: WorkspaceDraft; scrollTop: number; pageRange: [number, number] | null; updatedAt: string;
}
export interface HistoryEntry {
  id: string; paper: PaperScope; title: string; identity: PaperIdentity;
  updatedAt: string; createdAt: string; messageCount: number; preview: string;
  hasDraft: boolean; activeRequestId: string | null;
  taskCount?: number;
  /**
   * True while the chat owns an in-flight or queued answer, or an unfinished native task. The
   * Preferences pane refuses to delete such a chat for the same reason the sidebar does.
   */
  unfinishedWork?: boolean;
  /**
   * Present on a chat archived by an older build. Archive is no longer offered anywhere, so this is
   * read-only legacy data: such a chat lists and behaves as an ordinary chat and the field is never
   * rewritten. Echoes {@link import('./index.ts').Conversation.archivedAt}.
   */
  archivedAt?: string;
}
/**
 * `history` partitions every listed chat into exactly one scope. The default scope is unarchived;
 * `{ archived: true }` returns only archived chats. A chat that appears in one never appears in the
 * other. An empty query lists everything in that scope.
 */
export interface HistoryScope { archived?: boolean }
/** The scope switch the History management UI offers, including "no scope filter". */
export type HistoryFilterScope = 'all' | 'active' | 'archived';
export interface HistoryFilter { scope: HistoryFilterScope; paperId: string | null }
/** A distinct paper among listed chats, used to build the paper filter without a second query. */
export interface HistoryPaperOption { id: string; label: string; paper: PaperScope }
/** One chat that could not be changed or confirmed, with the reason shown to the owner. */
export interface HistoryFailed { id: string; message: string }
/**
 * What the History section renders. Counts are for `entries` (the current query), so filtering
 * narrows the list and the counts together instead of reporting a total the list does not show.
 */
export interface HistoryListing { entries: HistoryEntry[]; activeCount: number; archivedCount: number }
export type HistoryAction = 'delete';
/**
 * The honest outcome of a History mutation. `changed` lists exactly the chats the store confirmed;
 * `failed` names every chat that was not changed and why; `warnings` records non-fatal surprises
 * (for example a mutation that succeeded but whose re-verification could not be read). `partial` is
 * true whenever fewer chats changed than were requested.
 */
export interface HistoryMutationReport {
  action: HistoryAction; requested: number; changed: string[]; failed: HistoryFailed[]; warnings: string[]; partial: boolean;
}
/**
 * The subset of the workspace the History management logic needs. `ReaderWorkspace` satisfies it.
 * The mutator is optional: a build whose store cannot change stored chats omits it and the
 * Preferences pane degrades to listing and filtering only.
 */
export interface HistorySource {
  history(query?: string, scope?: HistoryScope): Promise<HistoryEntry[]>;
  removeConversation?(paper: PaperScope, id: string): Promise<void>;
}
/**
 * One committed change to the local chat store, published after the files are updated so no view can
 * act on it early. `removed` lists the chat ids that are gone from disk for that paper scope.
 */
export interface HistoryChange {
  paper: PaperScope;
  removed: string[];
}
export interface ReaderWorkspace {
  settings(): Promise<WorkspaceSettings>;
  saveSettings(value: WorkspaceSettings): Promise<void>;
  saveSkill(value: ReaderSkill): Promise<ReaderSkill>;
  importSkill(markdown: string): Promise<ReaderSkill>;
  deleteSkill(id: string): Promise<void>;
  saveDraft(value: SavedDraft): Promise<void>;
  readDraft(paper: PaperScope, conversationId: string | null): Promise<SavedDraft | null>;
  deleteDraft(paper: PaperScope, conversationId: string | null): Promise<void>;
  history(query?: string, scope?: HistoryScope): Promise<HistoryEntry[]>;
  readConversation(id: string): Promise<import('./index.ts').Conversation>;
  currentConversation(paper: PaperScope): Promise<import('./index.ts').Conversation | null>;
  snapshotChat(conversationId: string, messageIds?: string[]): Promise<ReaderReference>;
  /**
   * Explicit removal of one stored chat and its bound draft, leaving shared assets and native task
   * ledgers in place. Optional so older stores stay source-compatible; never invoked implicitly.
   */
  removeConversation?(paper: PaperScope, id: string): Promise<void>;
  /**
   * Pushes one committed {@link HistoryChange} to every subscriber, after the removal has reached the
   * store. Optional: a store without it simply cannot invalidate an already-open listing, and callers
   * that only read follow their own re-read path. Subscribers must unsubscribe on dispose.
   */
  subscribeHistory?(listener: (change: HistoryChange) => void): () => void;
}
export interface LibraryReferencePort {
  collections?(): Promise<Array<import('./native.ts').NativeCollectionTarget & { name: string }>>;
  /** Frozen from the active Zotero library pane at the moment the user starts an organization task. */
  selectedItems?(): Promise<import('./native.ts').NativeOrganizationItemSnapshot[]>;
  search(query: string): Promise<ReaderReference[]>;
  read(reference: ReaderReference, signal: AbortSignal): Promise<ReferenceInput>;
  open(paper: PaperScope): Promise<void>;
  /**
   * One or more explicitly chosen local files, read through the host's own file port. Text-like files
   * become reference text and image files become image input; an unsupported or oversized file is
   * refused with a message instead of being truncated or guessed at.
   */
  pickFile?(): Promise<PickedFile>;
  capturePage?(paper: PaperScope, pageIndex: number): Promise<ImageAttachment | null>;
  /** A single-page PDF region explicitly selected by the user in the matching Reader. */
  captureRegion?(selection: FigureRegionSelection, signal?: AbortSignal): Promise<ImageAttachment>;
  exportImage?(image: ImageAttachment): Promise<void>;
}

/** Frozen geometry for one user-selected PDF figure/region; coordinates are native PDF points. */
export interface FigureRegionSelection {
  paper: PaperScope;
  revision: DocumentRevision;
  pageIndex: number;
  rect: Rect;
}
