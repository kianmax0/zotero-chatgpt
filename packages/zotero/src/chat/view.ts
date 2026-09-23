import { requestProgress, type Citation, type ContextReport, type Conversation, type ImageAttachment, type Message, type RequestMode, type RequestTiming } from '../../../contracts/src/index.ts';
import type { HistoryEntry } from '../../../contracts/src/workspace.ts';
import { currentContextUsage, mountContextRing } from './context-view.ts';
import { mountWorkspaceView } from './workspace-view.ts';
import { mountTaskView } from './task-view.ts';
import { mountUILocale } from './ui-locale.ts';
import { EXPLAIN_QUESTION } from '../../../core/src/codex/reader-policy.ts';
import { hasBibliographicIdentity } from '../../../core/src/chat/paper-context.ts';
import type { ConversationPresenter, PresenterState } from './presenter.ts';
import {
  alignSettings, applyComposerChoice, composerControls, effortLabel, modelChipLabel, resolveFastTier, settingsCaption,
} from './generation-settings.ts';
import { enforcedAllowedModelIds } from '../../../core/src/workspace/allowed-models.ts';
import { copyableAnswerText, followAnswerScroll, renderAnswer } from './render-answer.ts';
import { messageTimeLabel } from './message-time.ts';
import { answerSources, linkAnswerSources, type AnswerSource, type DocumentPageTarget } from './source-links.ts';
import type { SourceOpenOutcome } from '../reader/source-highlight.ts';
import { applyChatTextScale, bindUnifiedReaderZoom, type ReaderZoomHost } from './text-scale.ts';
import { attachmentsFromClipboard, clipboardHasImage, clipboardHasText, readGeckoClipboardImage, resolveGeckoClipboardAccess, type ClipboardImageRead, type ClipboardImageRefusal, type ClipboardLike, type GeckoClipboardAccess } from './pick-images.ts';
import { activeCitation, type AttachmentIdentity } from '../reader/context.ts';
/** Re-exported so the reader shell and its callers keep naming the attachment the one reader context names. */
export type { AttachmentIdentity };
/**
 * Chat mode's surface. When the host supplies one, Chat mode is the real ChatGPT web application:
 * this view renders a mode bar and an empty slot, and the host paints the web surface over that
 * slot. The native transcript, composer, history and model picker are Agent-mode chrome then, so
 * ChatGPT's own UI is not duplicated (see `./embed.ts` for why the surface is a chrome browser).
 */
/**
 * What one paper action in the toolbar did. The hosted application owns its own conversation and
 * this host cannot put context into it, so an action's answer is always "this is on your clipboard
 * now, paste it in" or an honest statement of why nothing was. `no-info` is its own answer: the
 * item proved no bibliographic fact, so there was nothing true to copy.
 */
export type EmbedClipboardOutcome =
  /** The paper's local bibliographic context is on the clipboard. */
  | { copied: true; kind: 'paper' }
  /** The real PDF file is on the clipboard, for the application's own paste-to-attach path. */
  | { copied: true; kind: 'file' }
  | { copied: false; reason: 'no-info' | 'no-file' | 'unavailable' | 'failed' };

export interface ChatEmbedHook {
  /** Paint the hosted application over `anchor`, which is this view's slot element. */
  show(anchor: HTMLElement): void;
  /** Stop painting without unloading the application, keeping its session and conversation. */
  hide(): void;
  /** Navigate the application document again; used by the toolbar's More menu. */
  reload?(): void;
  /** Put the current paper's bibliographic context on the clipboard for the owner to paste in. */
  copyPaperContext?(): Promise<EmbedClipboardOutcome>;
  /** Put the current PDF file itself on the clipboard, for the application's paste-to-attach path. */
  copyPdfFile?(): Promise<EmbedClipboardOutcome>;
}
export interface ChatViewHooks {
  openCitation?(citation: Citation): Promise<void>;
  openDocumentPage?(document: DocumentPageTarget, pageIndex: number, quote?: string | null): Promise<SourceOpenOutcome | void>;
  copyText?(text: string): void;
  exportImage?(image: ImageAttachment): Promise<void>;
  openLink?(url: string): void;
  readTextScale?(): number;
  zoomTargets?: Array<Document | HTMLElement>;
  readerZoom?: ReaderZoomHost;
  /**
   * Collapse the reader dock through the reader's own close path (the same one the toolbar toggle
   * and native pane action use). The view calls it only when closing the last chat for this
   * attachment leaves nothing to display; without it — as in a bare view test — the pane just stays
   * open in its new-chat state.
   */
  closeDock?(): void;
  uuid?(): string;
  /** Present when Chat mode hosts the real ChatGPT web application instead of the native composer. */
  chatEmbed?: ChatEmbedHook;
}
const HTML = 'http://www.w3.org/1999/xhtml';
const SVG = 'http://www.w3.org/2000/svg';
let viewSerial = 0;
const COPY = {
  paneLabel: 'Codex',
  login: 'Sign in with ChatGPT',
  cancelLogin: 'Cancel sign-in',
  retry: 'Reconnect',
  newChat: 'New chat',
  // Agent sessions are Codex work, so the unbound Agent session says so instead of borrowing the
  // Chat name. The label follows the selected mode; it never rewrites a stored conversation title.
  newAgent: 'New agent',
  openChats: 'Open chats',
  untitled: 'Untitled',
  history: 'Chat history',
  searchChats: 'Search chats…',
  closeChat: 'Close chat',
  deleteChat: 'Delete chat',
  newContent: 'New content',
  // Chat / Agent routing mode (Stage 6). The selector is per chat and names the mode the next
  // request will be frozen with, not the mode of any request already in the transcript.
  mode: 'Mode',
  modeChat: 'Chat',
  modeAgent: 'Agent',
  askPlaceholder: 'Ask a question…',
  // A disabled send/picker states why, so a grey arrow or an unlabeled dot is never the only signal.
  sendNeedsQuestion: 'Enter a question to send.',
  sendNeedsSignIn: 'Sign in with ChatGPT to send.',
  sendNeedsConnection: 'Codex is not connected yet.',
  settingsNeedsSignIn: 'Model and generation settings (sign in to Codex to change them)',
  inputKeys: 'Enter to send · Shift+Enter for a new line',
  question: 'Question',
  send: 'Send',
  stop: 'Stop',
  renameChat: 'Rename chat',
  saveName: 'Save name',
  chatName: 'Chat name',
  accountUsage: 'Account usage',
  returnToSource: 'Return to source',
  remove: 'Remove',
  you: 'You',
  assistant: 'Codex',
  copy: 'Copy',
  settings: 'Model and generation settings',
  effort: 'Effort',
  options: 'Options',
  fast: 'Fast',
  model: 'Model',
  today: 'Today',
  yesterday: 'Yesterday',
  previous7Days: 'Previous 7 days',
  older: 'Older',
  noSavedChats: 'No saved chats match this search.',
  page: (label: string) => `p. ${label}`,
  copied: 'Copied',
  copyFailed: 'The answer could not be copied.',
  actionFailed: 'This action could not be completed.',
  sourceOpenFailed: 'The source could not be opened.',
  attach: 'Add images or context',
  // One or more local files the owner picks explicitly. Text files arrive as text context for the
  // model and image files as image input; the copy says so instead of promising a general file upload.
  attachFile: 'Attach file…',
  attachFileHint: 'Text or image from your computer',
  addReference: 'Add references',
  addSkill: 'Add a skill',
  attachHeading: 'Attach',
  referenceHeading: 'Reference',
  skillHeading: 'Skill',
  addReferenceHint: 'Saved chats and articles',
  addSkillHint: 'Installed skills for this chat',
  // Local reading status. The sidebar used to render preparation state in a panel that was removed,
  // which made a successful whole-PDF read invisible: nothing on screen changed, so an owner could
  // not tell that their article had been read. These lines report the read that actually happened,
  // including the honest case where only some pages carried text.
  documentReading: 'Reading this PDF…',
  documentReadingPages: (done: number, total: number) => `Reading this PDF… ${done} of ${total} pages`,
  documentReadAll: (total: number) => `Read all ${total} pages locally`,
  documentReadSome: (read: number, total: number) => `Read ${read} of ${total} pages locally`,
  documentReadNone: 'No text could be read from this PDF locally',
  // One-line context summary in the common shell (UI-02/UI-03). Chat names its bibliography and
  // abstract scope; Agent names the locally read PDF pages. Acceptance and answers stay with their
  // own request status rather than being inferred from this next-send description.
  contextLineSelected: (pageLabel: string) => `Selected text · page ${pageLabel}`,
  contextLineSelectedOff: 'Selected text · automatic PDF context off',
  contextLineChatSelected: (pageLabel: string) => `Selected text · page ${pageLabel} · paper details and abstract when available`,
  contextLineChatSelectedOff: (pageLabel: string) => `Selected text · page ${pageLabel} · automatic paper context off`,
  contextLineChatMetadata: 'Paper details and stored abstract will be included when available · no PDF body text',
  contextLineChatOff: 'Automatic paper context is off',
  contextLineOff: 'Automatic PDF context is off',
  contextLinePreparing: 'Preparing current PDF text…',
  contextLinePreparingPages: (done: number, total: number) => `Preparing current PDF text… ${done} of ${total} pages`,
  contextLineReadyAll: (total: number) => `Current PDF · all ${total} pages read locally`,
  contextLineReadySome: (read: number, total: number) => `Current PDF · excerpts from ${read} of ${total} pages`,
  contextLineUnavailable: 'PDF text unavailable',
  contextLineUnprepared: 'Current PDF · text not prepared yet',
  contextLineNone: 'No PDF context',
  contextPanelTitle: 'Context for the next message',
  contextPanelSource: 'Source',
  contextPanelNextSend: 'Next send',
  contextPanelLocalRead: 'Read locally',
  contextPanelLocalReadValue: (read: number, total: number) => `${read} of ${total} pages have text`,
  contextPanelAutomatic: 'Automatic PDF context',
  contextPanelAutomaticChat: 'Automatic paper details and abstract',
  contextPanelAutomaticAgent: 'Automatic PDF text',
  contextPanelChatScope: 'Chat sends available bibliography and stored abstract. PDF body text is excluded; explicitly selected text is included separately.',
  contextPanelChatNoReport: 'Chat does not send PDF body text. Paper details and the stored abstract are included when available.',
  contextPanelAutomaticOn: 'On',
  contextPanelAutomaticOff: 'Off',
  contextPanelNoReport: 'The last request did not record a coverage report.',
  reReadPdf: 'Re-read current PDF',
  closeContextPanel: 'Close context details',
  // Agent empty state (UI-05). Purpose copy plus three lightweight entries that only prepare a draft
  // or open the scope the task needs; none of them sends, connects to a model, downloads or writes.
  agentEmptyTitle: 'Ask Codex about this paper',
  agentEmptyBody: 'Answers stay in this sidebar. Highlighting, article retrieval and library organization only run after you review and approve a proposed task.',
  agentEmptyHighlight: 'Highlight key points',
  agentEmptyHighlightHint: 'Draft a request for the current PDF',
  agentEmptyAcquire: 'Get an article',
  agentEmptyAcquireHint: 'Draft a request for a DOI or public URL',
  agentEmptyOrganize: 'Organize selected items',
  agentEmptyOrganizeHint: 'Uses the selection in the Zotero main window',
  agentEmptyHighlightMissing: 'Open a PDF in the reader before asking for highlights.',
  agentEmptyOrganizeMissing: 'Select items in the Zotero main window first.',
  agentEmptyDraftReady: 'Draft prepared below. Nothing has been sent.',
  imageSaveFailed: 'The image could not be saved.',
  imageClipboardFailed: 'The clipboard image could not be attached.',
  // An image really was on the pasteboard or in the drop; these name why it was refused. They are
  // deliberately about the image, not about the gesture, so the paste and drop routes share them.
  imageTooLarge: 'That image is larger than the 2 MB limit, so it was not attached.',
  imageUnsupported: 'That image format cannot be attached. Use PNG, JPEG, GIF or WebP.',
  imageDropFailed: 'The dropped image could not be attached.',
  collectionsFailed: 'Collections could not be loaded.',
  /** Shown when a live request has no readable timing: an honest unknown, never an invented duration. */
  elapsedUnknown: 'Elapsed time unavailable',
  /**
   * Chat mode's own status. Chat's backend is an unresolved platform boundary in this build, so the
   * line names that instead of borrowing the Agent sign-in state.
   */
  chatUnavailable: 'Chat is unavailable in this build. Use Agent mode.',
  // Chat mode's only native chrome when the host hosts the real ChatGPT application. The application
  // owns its own conversation, transcript and model picker, so nothing of that is duplicated here;
  // the bar only carries what the web app cannot know about this host, which is the paper it has open.
  embedLabel: 'Reload ChatGPT',
  /**
   * The two paper actions. Both are icon controls with a title + explanation tooltip; the copy that
   * completes in one click carries no ellipsis, and neither action uploads anything. The paper action
   * copies local bibliography only — the PDF action puts the actual file on the clipboard for the
   * application's own paste-to-attach step.
   */
  copyPaperContext: 'Copy paper context',
  copyPaperContextHint: 'Copy title, authors, publication, year, DOI and abstract as text. Does not include PDF full text.',
  copyPdfFile: 'Copy PDF file',
  copyPdfFileHint: 'Copy the current PDF file to the clipboard. Paste it into ChatGPT to attach it.',
  copyPaperDone: 'Paper details copied',
  copyPaperNoInfo: 'This item has no bibliographic information to copy.',
  copyPaperFailed: 'The paper details could not be read.',
  copyPdfDone: 'PDF copied — paste to attach',
  embedFileUnavailable: 'Copying the PDF file is unavailable here.',
  embedFileMissing: 'This attachment has no local PDF file to copy.',
  embedFileFailed: 'The PDF file could not be copied.',
  moreActions: 'More actions',
  paperDetails: 'Paper & context details',
  embedAutomaticDisclosure: 'When you send in official ChatGPT, the paper title, authors, publication, year, DOI and stored abstract are added when available. PDF body text is not added. A passage you explicitly select is included separately. Opening the sidebar sends nothing. You can turn automatic paper context off in Zotero Preferences.',
  /** Agent's existing first-send scope approval remains separate from the hosted Chat notice. */
  sendScope: 'When you send in Agent, extracted text from this PDF, your selected text and attached images go to Codex through your ChatGPT account. Opening this sidebar only prepares local text. You can turn automatic PDF text off in Zotero Preferences.',
  allowAndSend: 'Allow PDF context and send',
  /** History row actions. The menu states the real scope; one confirmation precedes the removal. */
  historyRowActions: 'Conversation actions',
  deleteLocalConversation: 'Delete local conversation…',
  deleteLocalConfirm: 'Delete this local conversation? Its messages and unsent draft are removed from this computer. The official ChatGPT conversation, the paper and native annotations are not touched.',
  deleteLocalConfirmAction: 'Delete locally',
  cancelDeleteLocal: 'Keep it',
  // Context coverage disclosure on the composer ring. Every string here is user-facing copy awaiting
  // unification into `ui-locale.ts`; the static ones carry `data-zchatgpt-ui="true"` so `mountUILocale`
  // picks them up the moment the keys exist. The dynamic ones are listed for the coordinator too.
  contextDetail: 'Context supplied to the last request',
  contextDetailMode: 'Mode',
  contextDetailModeFull: 'Whole source',
  contextDetailModeFocused: 'Question-focused selection',
  contextDetailModeMultiPass: 'Multi-pass reading',
  contextDetailPages: 'Pages supplied',
  contextDetailPageSet: 'Page numbers',
  contextDetailWindow: 'Model window',
  contextDetailWindowUnknown: 'unknown',
  contextDetailAllowance: 'Text allowance',
  contextDetailAllowanceUnknown: 'not asserted',
  contextDetailNoFit: 'Fit was not asserted: model capacity or retained history is unknown.',
  contextDetailCoverage: 'What was supplied and what was not',
  contextDetailPagesValue: (supplied: number, total: number) => `${supplied} of ${total} pages`,
  contextDetailWindowValue: (tokens: number, provenance: 'runtime-reported' | 'pinned-catalog') => `${tokens.toLocaleString('en-US')} tokens (${provenance === 'runtime-reported' ? 'runtime reported' : 'bundled catalog estimate'})`,
  contextDetailAllowanceValue: (tokens: number) => `${tokens.toLocaleString('en-US')} tokens`,
  contextDetailMore: (count: number) => `and ${count} more`,
} as const;
const VIEW_ACTION_FAILED = COPY.actionFailed;
/** Stable English section labels; `mountUILocale` translates the rendered heading text. */
const HISTORY_BUCKET_LABELS: Record<HistoryBucket, string> = { Today: COPY.today, Yesterday: COPY.yesterday, 'Previous 7 days': COPY.previous7Days, Older: COPY.older };
const ICONS = {
  send: 'M8 13V3M4.5 6.5 8 3l3.5 3.5',
  stop: 'M5 5h6v6H5z',
  plus: 'M8 3v10M3 8h10',
  more: 'M3.25 8a.85.85 0 1 1 1.7 0 .85.85 0 0 1-1.7 0Zm3.9 0a.85.85 0 1 1 1.7 0 .85.85 0 0 1-1.7 0Zm3.9 0a.85.85 0 1 1 1.7 0 .85.85 0 0 1-1.7 0Z',
  clock: 'M8 2.75a5.25 5.25 0 1 1 0 10.5 5.25 5.25 0 0 1 0-10.5ZM8 5.25V8.2l2.15 1.25',
  copy: 'M6 6h7v7H6zM3 3h7v2',
  source: 'M8 3v8M5 8l3 3 3-3',
  remove: 'M4 4l8 8M12 4l-8 8',
  check: 'M3.5 8.25 6.5 11.25 12.5 4.75',
  historyDraft: 'M3.5 12.5 4 10.1 10.8 3.3a1.15 1.15 0 0 1 1.62 0l.28.28a1.15 1.15 0 0 1 0 1.62L6 12l-2.5.5ZM9.9 4.2l1.9 1.9',
  reload: 'M13.1 8a5.1 5.1 0 1 1-1.5-3.6M13.1 2.4v2.5h-2.5',
  chevron: 'M4 6.5 8 10.5l4-4',
  // Clipboard with ruled text: the paper-context copy. The clip on top is what keeps it unmistakably
  // different from the folded page used for the file copy.
  clipboardText: 'M9.5 5.5h1.75c.41 0 .75.34.75.75v6.5c0 .41-.34.75-.75.75h-6.5a.75.75 0 0 1-.75-.75v-6.5c0-.41.34-.75.75-.75H6.5M9.5 5.5v-.75c0-.41-.34-.75-.75-.75h-1.5a.75.75 0 0 0-.75.75v.75M6 8.25h4M6 10.5h4',
  // Folded-corner page: the PDF-file copy.
  pdfFile: 'M9.25 2.5H6.25A1.25 1.25 0 0 0 5 3.75v8.5c0 .69.56 1.25 1.25 1.25h5.5c.69 0 1.25-.56 1.25-1.25V6.75ZM9.25 2.5v3.5c0 .41.34.75.75.75h3M7 11h4',
  // A plain filled dot: the calm marker for a finished local record, never a completion badge.
  dot: 'M8 6.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z',
} as const;
/** The unbound composer tab. It is not a stored conversation id; the first send creates the record. */
const NEW_CHAT_TAB_ID = 'new-chat';
/**
 * The canonical "available to assistive technology, invisible on screen" box. It is applied to the
 * toolbar hints both as `.zchatgpt-visually-hidden` and as inline declarations: the normal header must
 * never print an explanation because one rule went missing, and a reader document can legitimately
 * still hold the stylesheet text injected by an earlier add-on version (see `injectReaderStyles`).
 */
const VISUALLY_HIDDEN = {
  position: 'absolute', width: '1px', height: '1px', margin: '-1px', padding: '0',
  overflow: 'hidden', 'clip-path': 'inset(50%)', 'white-space': 'nowrap', border: '0',
} as const;
const STATUS_LINE = {
  idle: 'Open the Codex sidebar to connect.',
  starting: 'Starting Codex…',
  error: 'Codex is unavailable',
  pendingLogin: 'Finish signing in to ChatGPT in your browser.',
  signedOut: 'Sign in with ChatGPT to ask a question.',
  generating: 'Responding…',
} as const;
const STATUS_LABEL: Record<Message['status'], string> = {
  pending: 'Recorded',
  streaming: 'Responding…',
  completed: '',
  cancelled: 'Stopped',
  failed: 'Failed',
  uncertain: 'Unconfirmed: the connection was interrupted. The request was not sent again.',
};
function pageLabel(citation: Citation): string {
  return citation.pageLabel || String(citation.positions[0]!.pageIndex + 1);
}
/** Keep source titles intact; the compact header truncates only their visual presentation. */
export function compactPaperTitle(title: string): string {
  return title.trim();
}
function conversationTitle(conversation: Pick<Conversation, 'title'>): string {
  return compactPaperTitle(conversation.title) || COPY.untitled;
}
/** Paper title first; same-name chats get a short sequence. Default stored title remains the paper name. */
export function conversationLabel(conversation: Pick<Conversation, 'id' | 'title' | 'createdAt'>, siblings: ReadonlyArray<Pick<Conversation, 'id' | 'title' | 'createdAt'>>): string {
  const title = conversationTitle(conversation);
  const same = siblings.filter(entry => conversationTitle(entry) === title).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  if (same.length < 2) return title;
  const index = same.findIndex(entry => entry.id === conversation.id) + 1;
  return index > 1 ? `${title} · ${index}` : title;
}
export type HistoryBucket = 'Today' | 'Yesterday' | 'Previous 7 days' | 'Older';
/** Render order for the time-grouped history sections. */
export const HISTORY_BUCKETS: readonly HistoryBucket[] = ['Today', 'Yesterday', 'Previous 7 days', 'Older'];
/**
 * Calendar bucketing that keeps the reference's Today / Yesterday / Previous 7 days shape without
 * silently hiding older chats: everything past the seven days before yesterday lands in `Older`.
 * An unparseable timestamp is shown under Today rather than dropped. All arithmetic is on local
 * midnight, matching how a reader reads "yesterday".
 */
export function historyGroup(iso: string, now = Date.now()): HistoryBucket {
  const date = Date.parse(iso);
  if (!Number.isFinite(date)) return 'Today';
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const today = start.getTime();
  if (date >= today) return 'Today';
  if (date >= today - 86_400_000) return 'Yesterday';
  if (date >= today - 7 * 86_400_000) return 'Previous 7 days';
  return 'Older';
}
/**
 * Assign every item to exactly one bucket, in render order, dropping empty sections only. Callers
 * can flatten the result to prove that no item was lost.
 */
export function groupHistory<T>(items: readonly T[], updatedAt: (item: T) => string, now = Date.now()): Array<{ bucket: HistoryBucket; items: T[] }> {
  const buckets = new Map<HistoryBucket, T[]>(HISTORY_BUCKETS.map(bucket => [bucket, []]));
  for (const item of items) buckets.get(historyGroup(updatedAt(item), now))!.push(item);
  return HISTORY_BUCKETS.flatMap(bucket => { const group = buckets.get(bucket)!; return group.length ? [{ bucket, items: group }] : []; });
}
/** How far the dropped preview line is echoed into `aria-label`/`title` before it is truncated. */
const HISTORY_DESCRIPTION_LIMIT = 240;
/**
 * The single visible line is the chat title. The paper title and the old second-line preview move
 * into the accessible name and hover tooltip so they are not silently lost.
 */
export function historyRowDescription(row: { title: string; paperTitle?: string; preview?: string }): string {
  const parts = [row.title.trim() || row.title];
  const paper = row.paperTitle?.trim();
  if (paper && paper !== row.title) parts.push(paper);
  const preview = row.preview?.trim();
  if (preview && preview !== row.title) parts.push([...preview].slice(0, HISTORY_DESCRIPTION_LIMIT).join(''));
  return parts.join(' · ');
}
/** Newest first, then by id, so rebuilt lists keep a stable order inside every bucket. */
function newestFirst<T extends { id: string; updatedAt: string; createdAt: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt) || a.id.localeCompare(b.id));
}
function hiddenExplainText(message: Message): boolean {
  return message.role === 'user' && (message.action === 'explain' || message.text === EXPLAIN_QUESTION);
}
export type HistoryStatus = 'draft' | 'active' | 'done';
/**
 * Works for both a full Conversation (`messages`) and a workspace HistoryEntry (`messageCount`).
 * A live request reads as in progress even before its first answer; an empty chat is a draft.
 */
export function historyStatus(entry: { activeRequestId: string | null; messages?: readonly unknown[]; messageCount?: number }): HistoryStatus {
  if (entry.activeRequestId) return 'active';
  const count = entry.messageCount ?? entry.messages?.length ?? 0;
  return count === 0 ? 'draft' : 'done';
}
/**
 * Page indexes are 0-based in the contract and 1-based in front of a reader, so each supplied index
 * is shown as `index + 1`. Contiguous runs collapse into ranges and a long set is truncated with its
 * remainder counted, so nothing is silently dropped without saying so.
 */
function pageSetLabel(indexes: number[]): string {
  const numbers = [...new Set(indexes.map(index => index + 1))].sort((a, b) => a - b);
  if (!numbers.length) return '—';
  const parts: string[] = [];
  let start = numbers[0]!; let end = start;
  for (const value of numbers.slice(1)) {
    if (value === end + 1) { end = value; continue; }
    parts.push(start === end ? String(start) : `${start}–${end}`); start = value; end = value;
  }
  parts.push(start === end ? String(start) : `${start}–${end}`);
  return parts.length <= 12 ? parts.join(', ') : `${parts.slice(0, 12).join(', ')}, ${COPY.contextDetailMore(parts.length - 12)}`;
}
/**
 * The last request's concrete context report, rendered for the ring's hover/focus disclosure. Every
 * field comes from {@link ContextReport} exactly as the planner recorded it: nothing is re-derived,
 * and a field the report leaves unknown is shown as unknown rather than guessed. Every label and
 * value carries `data-zchatgpt-ui="true"` so `mountUILocale` translates the phrasing: the labels have
 * `ui-locale.ts` keys, and the value templates that embed counts have `progress()` patterns that
 * carry the numbers through verbatim. The reason line is deliberately unmarked — it is the planner's
 * recorded explanation, i.e. data, and is never rewritten on screen.
 */
function contextDetailNodes(doc: Document, report: ContextReport): HTMLElement {
  const node = (tag: string, className: string, text = ''): HTMLElement => {
    const element = doc.createElementNS(HTML, tag);
    element.className = className; if (text) element.textContent = text;
    return element;
  };
  const line = (label: string, value: string) => {
    const row = node('p', 'zchatgpt-context-detail');
    const name = node('span', 'zchatgpt-context-detail-label', label); name.setAttribute('data-zchatgpt-ui', 'true');
    const text = node('span', 'zchatgpt-context-detail-value', value); text.setAttribute('data-zchatgpt-ui', 'true');
    row.append(name, doc.createTextNode(' '), text);
    return row;
  };
  const body = node('div', 'zchatgpt-context-details-body');
  const title = node('p', 'zchatgpt-context-details-title', COPY.contextDetail); title.setAttribute('data-zchatgpt-ui', 'true');
  const mode = report.mode === 'full' ? COPY.contextDetailModeFull : report.mode === 'focused' ? COPY.contextDetailModeFocused : COPY.contextDetailModeMultiPass;
  const windowKnown = report.capacity !== null;
  const allowanceKnown = report.textBudgetTokens !== null;
  body.append(title, line(COPY.contextDetailMode, mode));
  body.append(line(COPY.contextDetailPages, COPY.contextDetailPagesValue(report.selectedPages.length, report.totalPages)));
  if (report.selectedPages.length < report.totalPages) body.append(line(COPY.contextDetailPageSet, pageSetLabel(report.selectedPages)));
  body.append(line(COPY.contextDetailWindow, windowKnown ? COPY.contextDetailWindowValue(report.capacity!, report.provenance === 'pinned-catalog' ? 'pinned-catalog' : 'runtime-reported') : COPY.contextDetailWindowUnknown));
  body.append(line(COPY.contextDetailAllowance, allowanceKnown ? COPY.contextDetailAllowanceValue(report.textBudgetTokens!) : COPY.contextDetailAllowanceUnknown));
  if (!allowanceKnown || report.provenance === 'unknown') { const noFit = node('p', 'zchatgpt-context-detail zchatgpt-context-detail-nofit', COPY.contextDetailNoFit); noFit.setAttribute('data-zchatgpt-ui', 'true'); body.append(noFit); }
  const coverage = node('p', 'zchatgpt-context-detail-label', COPY.contextDetailCoverage); coverage.setAttribute('data-zchatgpt-ui', 'true');
  body.append(coverage, node('p', 'zchatgpt-context-detail-reason', report.reason));
  return body;
}
interface HistoryRowSource {
  id: string;
  /** The one visible line. */
  title: string;
  paperTitle: string;
  preview: string;
  status: HistoryStatus;
  updatedAt: string;
  current: boolean;
  /** A source label that can be proven from the record; absent means the row shows no source. */
  source?: string;
  open(): void;
  /** Present only where the row can be deleted; the workspace history port owns no delete today. */
  remove?: () => void;
}
/**
 * A provable source label for a stored conversation, or undefined. Only a record whose messages all
 * carry one mode can be labelled: a `chat` message is the legacy Codex read-only path, never an
 * official web conversation, so it is named that way instead of being promoted to `Chat`.
 */
export function conversationSource(conversation: Pick<Conversation, 'messages'>): string | undefined {
  const modes = conversation.messages.map(message => message.mode).filter((mode): mode is RequestMode => !!mode);
  if (!modes.length) return undefined;
  const unique = new Set(modes);
  if (unique.size > 1) return 'Mixed';
  return unique.has('agent') ? 'Agent' : 'Legacy';
}
export function renderReaderShell(body: HTMLElement, identity: AttachmentIdentity): HTMLElement {
  const doc = body.ownerDocument;
  const element = (tag: string, text: string, className?: string) => {
    const node = doc.createElementNS(HTML, tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const root = element('section', '', 'zchatgpt-sidebar zchatgpt-paper');
  root.dataset.zchatgptSidebar = '';
  root.setAttribute('aria-label', COPY.paneLabel);
  root.dataset.attachmentKey = identity.key;
  root.dataset.libraryId = String(identity.libraryID);
  body.replaceChildren(root);
  return root;
}
/** Conversation view: assistant Markdown is sanitized; user text stays textContent. */
export function mountChatView(root: HTMLElement, presenter: ConversationPresenter, hooks: ChatViewHooks = {}): () => void {
  const doc = root.ownerDocument;
  let latestViewState = presenter.snapshot();
  /** Set by the returned cleanup so an in-flight clipboard promise cannot touch a destroyed view. */
  let disposedView = false;
  // View actions own a slot separate from `state.message`: a presenter update must not erase a
  // view failure, and a view failure must never be reported as conversation state.
  const reportViewMessage = (message: string) => {
    const status = root.querySelector<HTMLElement>('[data-zchatgpt-view-error]');
    if (status) { status.textContent = message; status.hidden = false; }
  };
  /**
   * A failed view action shows the presenter's own sentence when it carries a coded error, because
   * those messages are written for this UI (for example 'Saved chats could not be searched.').
   * Anything else stays the constant, so host paths and raw internal text never reach the pane.
   */
  const actionFailure = (error: unknown): string => {
    if (error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
      && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
      const message = (error as { message: string }).message.trim();
      if (message) return message;
    }
    return VIEW_ACTION_FAILED;
  };
  const reportViewError = (error?: unknown) => reportViewMessage(actionFailure(error));
  const viewId = `zchatgpt-chat-${++viewSerial}`;
  // A cited page re-opens through the same frozen-revision navigation as the PDF context panel.
  // Without an opener, bound citations stay inert (no external launch) and surface a constant status.
  const openAnswerSource = async (source: AnswerSource, pageIndex: number, quote: string | null): Promise<SourceOpenOutcome> => {
    if (!hooks.openDocumentPage) throw new Error('The source could not be opened.');
    return (await hooks.openDocumentPage({ paper: source.paper, revision: source.revision }, pageIndex, quote)) ?? 'opened';
  };
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => { const node = doc.createElementNS(HTML, tag) as HTMLElementTagNameMap[K]; if (className) node.className = className; if (text) node.textContent = text; return node; };
  const icon = (name: keyof typeof ICONS) => {
    const svg = doc.createElementNS(SVG, 'svg');
    svg.setAttribute('width', '20'); svg.setAttribute('height', '20'); svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    const path = doc.createElementNS(SVG, 'path');
    path.setAttribute('d', ICONS[name]);
    path.setAttribute('fill', name === 'stop' || name === 'more' || name === 'dot' ? 'currentColor' : 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.25');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
    return svg;
  };
  const button = (label: string, action: string, onClick: () => void, glyph?: keyof typeof ICONS, className?: string) => {
    // The explicit class wins; otherwise a glyph button is an icon button and a text button gets the
    // shared button skin. (The caller's class used to be dropped for text buttons, which left the
    // Chat/Agent options without `.zchatgpt-mode-option` — no pressed fill and no segmented layout.)
    const node = el('button', className ?? (glyph ? 'zchatgpt-icon-button' : 'zchatgpt-button'), glyph ? '' : label);
    node.type = 'button'; node.dataset.zchatgptAction = action;
    node.setAttribute('aria-label', label); node.title = label;
    if (glyph) node.append(icon(glyph));
    node.addEventListener('click', onClick);
    return node;
  };
  // Clipboard writes go through the host hook when provided; a copy must always confirm visibly.
  const copyTimers = new WeakMap<HTMLButtonElement, number>();
  const confirmCopy = (trigger: HTMLButtonElement) => {
    const view = doc.defaultView;
    const previous = copyTimers.get(trigger);
    if (previous !== undefined) view?.clearTimeout(previous);
    trigger.dataset.zchatgptCopied = 'true';
    trigger.setAttribute('aria-label', COPY.copied); trigger.title = COPY.copied;
    const label = trigger.querySelector<HTMLElement>('[data-zchatgpt-copy-label]');
    if (label) label.textContent = COPY.copied;
    if (!view) return;
    copyTimers.set(trigger, view.setTimeout(() => {
      copyTimers.delete(trigger);
      delete trigger.dataset.zchatgptCopied;
      trigger.setAttribute('aria-label', COPY.copy); trigger.title = COPY.copy;
      if (label) label.textContent = COPY.copy;
    }, 1600));
  };
  const copyText = (source: string, trigger: HTMLButtonElement) => {
    if (hooks.copyText) hooks.copyText(source);
    else void doc.defaultView?.navigator.clipboard?.writeText(source).catch(() => reportViewMessage(COPY.copyFailed));
    confirmCopy(trigger);
  };
  // Each fenced block and table gets its own wrapper so wide content scrolls locally and the
  // copy affordance never scrolls away with the code.
  const enhanceCodeBlocks = (host: HTMLElement) => {
    for (const pre of [...host.querySelectorAll('pre')]) {
      const wrapper = el('div', 'zchatgpt-code-block');
      pre.replaceWith(wrapper); wrapper.append(pre);
      const source = pre.querySelector('code')?.textContent ?? pre.textContent ?? '';
      const copy = button(COPY.copy, 'copy-code', () => copyText(source, copy));
      copy.classList.add('zchatgpt-code-copy');
      wrapper.prepend(copy);
    }
    for (const table of [...host.querySelectorAll('table')]) {
      if (table.parentElement?.classList.contains('zchatgpt-table-block')) continue;
      const wrapper = el('div', 'zchatgpt-table-block');
      table.replaceWith(wrapper); wrapper.append(table);
    }
  };
  root.querySelector('[data-zchatgpt-chat]')?.remove();
  /**
   * One common shell for both modes (UI-01/UI-02): a single toolbar with the fixed mode switch at its
   * start, then one context summary line. The two surfaces only swap what is below it, so the switch
   * never moves between a composer and the hosted Chat bar.
   */
  const shell = el('div', 'zchatgpt-shell'); shell.dataset.zchatgptShell = '';
  const chat = el('section', 'zchatgpt-chat'); chat.dataset.zchatgptChat = '';
  const chrome = el('div', 'zchatgpt-chrome'); chrome.dataset.zchatgptShellBar = '';
  /**
   * Cursor-style agent tabs live in the toolbar: every open chat is a named tab, the unbound composer
   * is a tab, and the selected tab carries the close cross. On first open — no named tab yet — that
   * unbound tab shows the article title immediately, before a conversation is restored or created.
   * Pressing `+` beside an already-open named chat is the New chat copy. `+` and history stay on the
   * trailing edge. Closing leaves the chat on disk and in history and asks no confirmation; the
   * destructive remove lives on the history rows. When the close leaves no chat at all for this
   * attachment, the reader collapses its whole dock through the reader's own close path.
   */
  const panes = el('div', 'zchatgpt-panes');
  panes.dataset.zchatgptPanes = '';
  panes.setAttribute('role', 'tablist');
  panes.setAttribute('aria-label', COPY.openChats);
  /** The single-line local binding shown while the official web surface owns the conversation. */
  const shellTitle = el('span', 'zchatgpt-shell-title'); shellTitle.dataset.zchatgptShellTitle = ''; shellTitle.hidden = true;
  const paneNodes = new Map<string, HTMLElement>();
  /** The selected tab's title control; the rename popover hangs off it. */
  let renameTrigger: HTMLElement | null = null;
  // The active citation's own line. It lives in the context panel now: the shell summary states the
  // next send in one line, and the citation's page and its back-to-source control sit in the details.
  const contextSource = el('div', 'zchatgpt-chrome-source');
  contextSource.dataset.zchatgptContextSource = '';
  contextSource.hidden = true;
  // Agent's first outbound scope notice gates a pending explanation until the owner approves. The
  // hosted Chat has a separate informational notice and never asks for sidebar confirmation.
  const scopeNotice = el('div', 'zchatgpt-context-disclosure');
  scopeNotice.dataset.zchatgptContextDisclosure = '';
  const scopeNoticeCopy = el('p', '', COPY.sendScope);
  const acknowledgeScope = button(COPY.allowAndSend, 'acknowledge-context', () => { presenter.acknowledgeContext(); });
  scopeNotice.append(scopeNoticeCopy, acknowledgeScope);
  scopeNotice.hidden = true; acknowledgeScope.hidden = true;
  const actions = el('div', 'zchatgpt-chrome-actions');
  const fresh = button(COPY.newChat, 'new-conversation', () => { void presenter.newConversation(); }, 'plus');
  const historyBtn = button(COPY.history, 'history', () => { toggleHistory(); }, 'clock');
  historyBtn.setAttribute('aria-haspopup', 'dialog');
  historyBtn.setAttribute('aria-expanded', 'false');
  historyBtn.setAttribute('aria-controls', `${viewId}-history`);
  /**
   * The two paper actions. They live in the common toolbar, in the same order in both modes, and
   * they never read the history row or the open pane: the source is always the current reader's
   * attachment. Each is an icon button whose tooltip carries the action name and the explanation,
   * and whose `aria-describedby` points at that same explanation so keyboard and assistive users
   * get it too. The copy is done when the click returns, so no ellipsis is used.
   */
  let hintSerial = 0;
  /**
   * The explanation for one toolbar action. It lives beside the button so `aria-describedby` can point
   * at it, and it hides itself: the class carries the intent, and the inline declarations make "one
   * 1 px clipped box" a property of this element rather than of whichever stylesheet revision the
   * document happens to hold. Nothing here is measured or shown as part of the toolbar row.
   */
  const describedHint = (hint: string) => {
    const node = el('span', 'zchatgpt-visually-hidden', hint);
    node.id = `${viewId}-hint-${++hintSerial}`;
    node.setAttribute('data-zchatgpt-ui', 'true');
    for (const [property, value] of Object.entries(VISUALLY_HIDDEN)) node.style.setProperty(property, value);
    return node;
  };
  const copyPaperHint = describedHint(COPY.copyPaperContextHint);
  const copyPdfHint = describedHint(COPY.copyPdfFileHint);
  const toolbarAction = (title: string, hint: HTMLElement, action: string, glyph: keyof typeof ICONS) => {
    const node = button(`${title}\n${hint.textContent}`, action, () => { void runToolbarCopy(node); }, glyph);
    node.dataset.zchatgptToolbarAction = action;
    node.setAttribute('aria-label', title);
    node.setAttribute('aria-describedby', hint.id);
    return node;
  };
  const copyPaper = toolbarAction(COPY.copyPaperContext, copyPaperHint, 'copy-paper-context', 'clipboardText');
  const copyPdf = toolbarAction(COPY.copyPdfFile, copyPdfHint, 'copy-pdf-file', 'pdfFile');
  const paperActions = el('div', 'zchatgpt-paper-actions');
  paperActions.dataset.zchatgptPaperActions = '';
  // The explanations live beside the buttons, never inside them: the controls stay icon-only, while
  // `aria-describedby` still reads the explanation to keyboard and assistive users.
  paperActions.append(copyPaper, copyPaperHint, copyPdfHint, copyPdf);
  /**
   * The More menu. It holds the paper/context details the normal header no longer shows, plus the
   * hosted page's reload control. Only entries that really do something are rendered.
   */
  const more = button(COPY.moreActions, 'more-actions', () => { toggleMore(); }, 'more');
  more.dataset.zchatgptMore = '';
  more.setAttribute('aria-haspopup', 'dialog');
  more.setAttribute('aria-expanded', 'false');
  more.setAttribute('aria-controls', `${viewId}-more`);
  const moreMenu = el('div', 'zchatgpt-more-menu');
  moreMenu.id = `${viewId}-more`;
  moreMenu.dataset.zchatgptMoreMenu = '';
  moreMenu.hidden = true;
  moreMenu.setAttribute('role', 'dialog');
  moreMenu.setAttribute('aria-label', COPY.moreActions);
  const moreRow = (title: string, action: string, onClick: () => void) => {
    const node = el('button', 'zchatgpt-more-row');
    node.type = 'button';
    node.dataset.zchatgptAction = action;
    node.textContent = title;
    node.setAttribute('data-zchatgpt-ui', 'true');
    node.addEventListener('click', () => { toggleMore(false); onClick(); });
    return node;
  };
  const detailsRow = moreRow(COPY.paperDetails, 'open-paper-details', () => toggleContext(true));
  const reloadRow = moreRow(COPY.embedLabel, 'reload-chat', () => { hooks.chatEmbed?.reload?.(); });
  reloadRow.hidden = true;
  moreMenu.append(detailsRow, reloadRow);
  actions.append(paperActions, fresh, historyBtn, more);
  /**
   * The one-line answer to what the next message carries is shown in the details, not in a permanent
   * header row. This element is only visible while something the owner must act on is outstanding.
   */
  const feedback = el('p', 'zchatgpt-shell-feedback');
  feedback.dataset.zchatgptShellFeedback = '';
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-live', 'polite');
  feedback.hidden = true;
  let feedbackTimer: number | null = null;
  const say = (text: string, options: { sticky?: boolean } = {}) => {
    const view = doc.defaultView;
    if (feedbackTimer !== null) { view?.clearTimeout(feedbackTimer); feedbackTimer = null; }
    feedback.textContent = text;
    feedback.hidden = !text;
    if (text && !options.sticky && view) feedbackTimer = view.setTimeout(() => { feedbackTimer = null; feedback.textContent = ''; feedback.hidden = true; }, 3200);
  };
  /**
   * The routing mode for the next request. Per chat: the selected state is painted from presenter
   * state, so a switch is shown only once the presenter accepted it, and it never rewrites an
   * already recorded request. It is created once, appended once, and never reparented: the one copy
   * of this control is what keeps the switch in the same place in both modes.
   */
  const modeSwitch = el('div', 'zchatgpt-mode-switch');
  modeSwitch.dataset.zchatgptModeSwitch = '';
  modeSwitch.setAttribute('role', 'group');
  modeSwitch.setAttribute('aria-label', COPY.mode);
  modeSwitch.dataset.zchatgptUi = 'true';
  const modeButtons: Array<{ mode: RequestMode; node: HTMLButtonElement }> = (['chat', 'agent'] as const).map(mode => {
    const node = button(mode === 'chat' ? COPY.modeChat : COPY.modeAgent, `mode-${mode}`, () => presenter.setMode(mode), undefined, 'zchatgpt-mode-option');
    node.setAttribute('aria-pressed', String(mode === 'chat'));
    return { mode, node };
  });
  modeSwitch.append(...modeButtons.map(entry => entry.node));
  chrome.append(modeSwitch, panes, shellTitle, actions, feedback, moreMenu);
  const contextPanel = el('div', 'zchatgpt-context-panel');
  contextPanel.id = `${viewId}-context`;
  contextPanel.dataset.zchatgptContextPanel = '';
  contextPanel.setAttribute('role', 'dialog');
  contextPanel.setAttribute('aria-label', COPY.contextPanelTitle);
  contextPanel.hidden = true;
  const contextPanelBody = el('div', 'zchatgpt-context-panel-body');
  // The active citation's own line is owned by the panel from the start (hidden until a selection
  // exists) so its page + return-to-source contract is stable whether or not the panel is expanded.
  contextPanelBody.append(contextSource);
  // A local, assertive live region rather than `role="alert"`: it belongs to the panel, and it must
  // not be mistaken for the presenter's own error alert elsewhere in the sidebar.
  const contextPanelError = el('p', 'zchatgpt-context-panel-error'); contextPanelError.setAttribute('aria-live', 'assertive'); contextPanelError.hidden = true;
  const contextPanelStatus = el('p', 'zchatgpt-context-panel-status');
  contextPanelStatus.setAttribute('role', 'status');
  contextPanelStatus.setAttribute('aria-live', 'polite');
  contextPanelStatus.hidden = true;
  contextPanel.append(contextPanelBody, contextPanelStatus, contextPanelError);
  shell.append(chrome, contextPanel);
  root.append(shell);
  // Renaming hangs off the selected tab's title, the same place the owner already looks for the
  // chat's name. The form is a small popover under the chrome.
  const renameForm = el('div', 'zchatgpt-rename-form'); renameForm.dataset.zchatgptRenameForm = ''; renameForm.hidden = true;
  renameForm.id = `${viewId}-rename`;
  renameForm.setAttribute('role', 'dialog');
  renameForm.setAttribute('aria-label', COPY.renameChat);
  const renameInput = el('input'); renameInput.type = 'text'; renameInput.maxLength = 1024;
  renameInput.setAttribute('aria-label', COPY.chatName);
  const saveName = button(COPY.saveName, 'save-conversation-name', () => {
    const id = presenter.snapshot().conversation?.id;
    if (!id) return;
    void presenter.renameConversation(id, renameInput.value).then(() => { toggleRename(false); renameTrigger?.focus(); }).catch(reportViewError);
  });
  renameForm.append(renameInput, saveName);
  const historyPanel = el('div', 'zchatgpt-history-panel');
  historyPanel.id = `${viewId}-history`;
  historyPanel.dataset.zchatgptHistory = '';
  historyPanel.hidden = true;
  historyPanel.setAttribute('role', 'dialog');
  historyPanel.setAttribute('aria-label', COPY.history);
  const historySearch = el('input', 'zchatgpt-history-search');
  historySearch.type = 'search';
  historySearch.dataset.zchatgptHistorySearch = '';
  historySearch.placeholder = COPY.searchChats;
  historySearch.setAttribute('aria-label', COPY.history);
  const historyList = el('div', 'zchatgpt-history-list');
  historyList.setAttribute('role', 'list');
  historyPanel.append(historySearch, historyList);
  const status = el('p', 'zchatgpt-status-line'); status.setAttribute('role', 'status');
  // Honest elapsed time. The counter ticks only while a request is unsettled, freezes at the first
  // delivered text, and stops at the settle stamp. Missing timing shows an explicit unknown rather
  // than an invented duration: an idle local counter would wrongly imply this app is the wait when
  // the real delay can be upstream quota or queueing.
  const requestTiming = el('p', 'zchatgpt-request-timing'); requestTiming.dataset.zchatgptRequestTiming = ''; requestTiming.setAttribute('role', 'status'); requestTiming.hidden = true;
  const requestTimingGlyph = el('span', 'zchatgpt-request-timing-glyph'); requestTimingGlyph.setAttribute('aria-hidden', 'true'); requestTimingGlyph.append(icon('clock'));
  const requestTimingText = el('span', 'zchatgpt-request-timing-text'); requestTimingText.dataset.zchatgptRequestTimingText = '';
  requestTiming.append(requestTimingGlyph, requestTimingText);
  let timingInterval: number | null = null;
  let paintedTiming = '';
  const clearTimingInterval = () => { const id = timingInterval; timingInterval = null; if (id !== null) doc.defaultView?.clearInterval(id); };
  const describeTiming = (state: PresenterState, now: number): { text: string; ticking: boolean } | null => {
    const conversation = state.conversation;
    const timings = conversation?.requestTiming ?? [];
    const activeId = conversation?.activeRequestId ?? null;
    let timing: RequestTiming | null;
    if (activeId) {
      timing = timings.find(entry => entry.requestId === activeId) ?? null;
      if (!timing) return { text: COPY.elapsedUnknown, ticking: false };
    } else {
      const last = timings.at(-1);
      if (!last || last.settledAt === null) return null;
      timing = last;
    }
    const progress = requestProgress(timing, now);
    if (progress.settled) return { text: progress.elapsedSeconds === null ? COPY.elapsedUnknown : `Answered in ${progress.elapsedSeconds}s`, ticking: false };
    const seconds = progress.firstTextSeconds ?? progress.elapsedSeconds;
    if (seconds === null) return { text: COPY.elapsedUnknown, ticking: false };
    // Before the first text the count is live; after it, the value freezes at the first-text mark.
    return { text: `Waiting ${seconds}s`, ticking: true };
  };
  const paintTiming = (state: PresenterState) => {
    const described = describeTiming(state, Date.now());
    if (!described) { requestTiming.hidden = true; if (paintedTiming) { paintedTiming = ''; requestTimingText.textContent = ''; } clearTimingInterval(); return; }
    requestTiming.hidden = false;
    if (paintedTiming !== described.text) { paintedTiming = described.text; requestTimingText.textContent = described.text; }
    if (described.ticking) { if (timingInterval === null) timingInterval = doc.defaultView?.setInterval(() => paintTiming(latestViewState), 1000) ?? null; }
    else clearTimingInterval();
  };
  const auth = el('div', 'zchatgpt-auth');
  const login = button(COPY.login, 'login', () => { void presenter.login(); });
  const cancelLogin = button(COPY.cancelLogin, 'cancel-login', () => { void presenter.cancelLogin(); });
  const retry = button(COPY.retry, 'retry', () => { void presenter.retry(); });
  auth.append(login, cancelLogin, retry);
  const alert = el('p', 'zchatgpt-error'); alert.setAttribute('role', 'alert'); alert.hidden = true;
  const viewError = el('p', 'zchatgpt-error zchatgpt-view-error'); viewError.dataset.zchatgptViewError = ''; viewError.setAttribute('role', 'alert'); viewError.hidden = true;
  const transcript = el('div', 'zchatgpt-transcript');
  transcript.dataset.zchatgptTranscript = '';
  const messages = el('div', 'zchatgpt-messages'); messages.dataset.zchatgptMessages = '';
  const taskPanel = el('div', 'zchatgpt-tasks'); taskPanel.dataset.zchatgptTasks = '';
  const taskView = mountTaskView(taskPanel, {
    approveSelected: (id, selected, choices) => presenter.approveTask(id, selected, choices),
    cancel: id => presenter.cancelTask(id), reconcile: id => presenter.reconcileTask(id), undo: id => presenter.undoTask(id),
    openSource: (id, itemId) => presenter.openTaskSource(id, itemId), openOutput: (id, itemId) => presenter.openTaskOutput(id, itemId),
    cancelReading: id => presenter.cancelReading(id), reconcileReading: id => presenter.reconcileReading(id), openReadingOutput: (id, step) => presenter.openReadingOutput(id, step),
    describeReading: id => presenter.describeReading(id),
    collectionLabel: target => latestViewState.collectionOptions.find(item => item.clientId === target.clientId && item.libraryId === target.libraryId && item.collectionKey === target.collectionKey)?.name ?? `Library ${target.libraryId} · ${target.collectionKey}`,
  });
  const isNearBottom = () => messages.scrollHeight - messages.scrollTop - messages.clientHeight < 48;
  let hasNewContent = false;
  /** Whether the transcript was pinned to the newest answer at the last render. */
  let sticking = true;
  const newContent = button(COPY.newContent, 'new-content', () => { hasNewContent = false; messages.scrollTop = messages.scrollHeight; newContent.hidden = true; });
  newContent.hidden = true;
  newContent.classList.add('zchatgpt-new-content');
  messages.addEventListener('scroll', () => {
    if (isNearBottom()) { hasNewContent = false; newContent.hidden = true; }
    presenter.setScrollTop(messages.scrollTop);
  });
  transcript.append(messages, newContent);
  /**
   * Agent's empty state (UI-05). Compact and explanatory, not a marketing hero: a short title, one
   * purpose line, and three lightweight entries. Each entry only prepares a draft for the owner to
   * edit and send — none of them connects a model, downloads, writes, or submits anything.
   */
  const empty = el('div', 'zchatgpt-agent-empty'); empty.dataset.zchatgptAgentEmpty = ''; empty.hidden = true;
  const emptyCard = el('div', 'zchatgpt-agent-empty-card');
  const emptyTitle = el('div', 'zchatgpt-agent-empty-title', COPY.agentEmptyTitle);
  const emptyBody = el('p', 'zchatgpt-agent-empty-body', COPY.agentEmptyBody);
  const emptyActions = el('div', 'zchatgpt-agent-empty-actions');
  const emptyNote = el('p', 'zchatgpt-agent-empty-note'); emptyNote.setAttribute('role', 'status'); emptyNote.hidden = true;
  const emptyAction = (title: string, hint: string, question: string, action: string) => {
    const node = el('button', 'zchatgpt-agent-empty-action');
    node.type = 'button'; node.dataset.zchatgptAction = action;
    node.append(el('span', 'zchatgpt-agent-empty-action-title', title), el('span', 'zchatgpt-agent-empty-action-hint', hint));
    node.addEventListener('click', () => {
      // Prepare the draft only. The owner still edits and sends it; nothing is submitted here.
      presenter.setQuestion(question);
      emptyNote.textContent = COPY.agentEmptyDraftReady; emptyNote.hidden = false;
      presenter.focusInput();
    });
    return node;
  };
  emptyActions.append(
    emptyAction(COPY.agentEmptyHighlight, COPY.agentEmptyHighlightHint, 'Highlight the most important passages in the current PDF and explain each one briefly.', 'empty-highlight'),
    emptyAction(COPY.agentEmptyAcquire, COPY.agentEmptyAcquireHint, 'Save this article to a collection and download an available PDF: ', 'empty-acquire'),
    emptyAction(COPY.agentEmptyOrganize, COPY.agentEmptyOrganizeHint, 'Tag the items I selected in the Zotero window and add them to suitable existing collections.', 'empty-organize'),
  );
  emptyCard.append(emptyTitle, emptyBody, emptyActions, emptyNote);
  empty.append(emptyCard);
  transcript.append(empty);
  const draft = el('div', 'zchatgpt-draft');
  const draftCitations = el('div', 'zchatgpt-draft-citations'); draftCitations.dataset.zchatgptDraftCitations = '';
  const draftImages = el('div', 'zchatgpt-draft-images'); draftImages.dataset.zchatgptDraftImages = '';
  const composer = el('div', 'zchatgpt-composer'); composer.dataset.zchatgptComposer = '';
  const composerContext = el('div', 'zchatgpt-composer-context'); composerContext.dataset.zchatgptComposerContext = '';
  composerContext.append(draftCitations, draftImages);
  const input = el('textarea', 'zchatgpt-input'); input.rows = 2; input.placeholder = COPY.askPlaceholder; input.setAttribute('aria-label', COPY.question); input.dataset.zchatgptInput = '';
  const bar = el('div', 'zchatgpt-composer-bar');
  const leading = el('div', 'zchatgpt-composer-leading'); leading.dataset.zchatgptComposerLeading = '';
  const trailing = el('div', 'zchatgpt-composer-trailing');
  const picker = el('button', 'zchatgpt-picker');
  picker.type = 'button';
  picker.dataset.zchatgptAction = 'picker';
  picker.dataset.zchatgptPicker = '';
  picker.setAttribute('aria-label', COPY.settings);
  picker.title = COPY.settings;
  picker.setAttribute('aria-haspopup', 'menu');
  picker.setAttribute('aria-expanded', 'false');
  picker.setAttribute('aria-controls', `${viewId}-models`);
  picker.addEventListener('click', () => { togglePicker(); });
  const send = button(COPY.send, 'send', () => { void presenter.send(); }, 'send', 'zchatgpt-icon-button zchatgpt-send');
  const stop = button(COPY.stop, 'stop', () => { void presenter.cancel(); }, 'stop', 'zchatgpt-icon-button zchatgpt-send');
  const queue = button('Queue question', 'queue', () => { void presenter.queueDraft(); }, 'plus'); queue.hidden = true;
  const contextRing = mountContextRing(trailing);
  trailing.append(picker, queue, send, stop);
  bar.append(leading, trailing);
  const menu = el('div', 'zchatgpt-picker-menu'); menu.dataset.zchatgptPickerMenu = ''; menu.hidden = true; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', COPY.settings);
  menu.id = `${viewId}-models`;
  // The ring's coverage disclosure sits with the other composer popovers: anchored above the card,
  // hidden until hover or focus, and carrying no interactive content.
  composer.append(composerContext, input, bar, menu, contextRing.details);
  draft.append(composer);
  const main = el('div', 'zchatgpt-chat-main');
  main.append(historyPanel, status, requestTiming, auth, alert, viewError, transcript, draft);
  /**
   * One transcript fills the remaining dock height. Cursor-style tabs switch chats; the dock never
   * splits into two transcripts side by side.
   */
  const columns = el('div', 'zchatgpt-columns');
  columns.append(main);
  // `renameForm` hangs off the toolbar, so it belongs to the shell; the context citation line lives
  // inside the context panel; the native surface keeps only the consent state and the columns.
  shell.append(renameForm);
  chat.append(scopeNotice, columns); root.append(chat);
  /**
   * Chat mode's chrome when the host hosts the real ChatGPT application. It holds the one mode
   * control (so Agent stays reachable) and the slot the host paints the web surface over; ChatGPT's
   * own conversation list, composer, model picker and streaming renderer are the application's, so
   * none of them is rebuilt here. The native chrome above stays mounted while Chat is shown, which
   * is what lets `Chat -> Agent -> Chat` switch without rebuilding a transcript or dropping a draft.
   */
  const embedSection = hooks.chatEmbed ? el('section', 'zchatgpt-embed') : null;
  const embedSlot = embedSection ? el('div', 'zchatgpt-embed-slot') : null;
  /**
   * The one notice strip. It is empty in the normal state, so the header stays a single row: the
   * strip only takes space while the first outbound disclosure is owed, or while the host reports
   * that the official page could not be shown at all. The automatic-PDF state itself lives in the
   * details, not here.
   */
  const embedNotice = embedSection ? el('div', 'zchatgpt-embed-notice') : null;
  /** Actor/readiness/submission lifecycle, written by the host when it cannot show the page. */
  const embedBridgeStatus = embedSection ? el('span', 'zchatgpt-embed-bridge-status') : null;
  const embedContextNotice = embedSection ? el('p', 'zchatgpt-embed-context-notice') : null;
  if (embedSection && embedSlot && embedNotice && embedBridgeStatus && embedContextNotice) {
    embedSection.dataset.zchatgptEmbed = '';
    embedSlot.dataset.zchatgptEmbedSlot = '';
    embedNotice.dataset.zchatgptEmbedNotice = '';
    embedNotice.hidden = true;
    embedBridgeStatus.dataset.zchatgptBridgeStatusLine = '';
    embedBridgeStatus.hidden = true;
    embedContextNotice.dataset.zchatgptEmbedContextNotice = '';
    embedContextNotice.setAttribute('data-zchatgpt-ui', 'true');
    embedContextNotice.textContent = COPY.embedAutomaticDisclosure;
    embedContextNotice.hidden = true;
    embedNotice.append(embedContextNotice, embedBridgeStatus);
    embedSection.append(embedNotice, embedSlot);
    root.append(embedSection);
  }
  const localizer = mountUILocale(root);
  let lastLanguage: 'en' | 'zh' | null = null;
  /** JSON key of the rendered context report, so the ring's details rebuild only when it changes. */
  let contextReportKey: string | null = null;
  let workspaceView: ReturnType<typeof mountWorkspaceView> | null = null;
  let lastWorkspace: PresenterState['workspace'] = null; let workspaceDraftKey = ''; let tasksKey = '';
  // Codex keeps exactly one plus button at the composer's bottom-left. Every attachment route
  // lives behind it; the reference/skill chooser stays reachable by typing '@' or '/'.
  const plus = button(COPY.attach, 'composer-plus', () => { togglePlus(); }, 'plus', 'zchatgpt-icon-button zchatgpt-plus');
  plus.dataset.zchatgptPlus = '';
  plus.setAttribute('aria-haspopup', 'dialog'); plus.setAttribute('aria-expanded', 'false'); plus.setAttribute('aria-controls', `${viewId}-plus`);
  // A labelled, non-modal dialog rather than `role="menu"`: the popover holds plain action rows, and
  // neither plain buttons nor an `<input>` are valid children of a menu.
  const plusMenu = el('div', 'zchatgpt-plus-menu'); plusMenu.dataset.zchatgptPlusMenu = ''; plusMenu.id = `${viewId}-plus`; plusMenu.hidden = true; plusMenu.setAttribute('role', 'dialog'); plusMenu.setAttribute('aria-label', COPY.attach);
  // Codex-style grouped rows: a small heading, a title and a supporting description. The accessible
  // name stays the title, never the description.
  const plusRow = (title: string, description: string, action: string, onClick: () => void) => {
    const row = el('button', 'zchatgpt-plus-row');
    row.type = 'button'; row.dataset.zchatgptAction = action;
    row.append(el('span', 'zchatgpt-plus-row-title', title), el('span', 'zchatgpt-plus-row-description', description));
    row.setAttribute('aria-label', title); row.title = title;
    row.addEventListener('click', onClick);
    return row;
  };
  // The dialog holds plain action rows only: a page-number field would be an invalid child, and the
  // owner removed the one-page capture route that needed it.
  const attachGroup = el('div', 'zchatgpt-plus-group');
  attachGroup.append(
    el('div', 'zchatgpt-plus-heading', COPY.attachHeading),
    plusRow(COPY.attachFile, COPY.attachFileHint, 'pick-file', () => { togglePlus(false); void presenter.pickFile().catch(reportViewError); }),
  );
  const referenceGroup = el('div', 'zchatgpt-plus-group');
  referenceGroup.append(
    el('div', 'zchatgpt-plus-heading', COPY.referenceHeading),
    plusRow(COPY.addReference, COPY.addReferenceHint, 'composer-references', () => { togglePlus(false); workspaceView?.openCommands(); }),
  );
  // References and skills are two different affordances, so they get two headings and two rows: the
  // reference row opens the '@' chooser and the skill row opens the '/' chooser.
  const skillGroup = el('div', 'zchatgpt-plus-group');
  skillGroup.append(
    el('div', 'zchatgpt-plus-heading', COPY.skillHeading),
    plusRow(COPY.addSkill, COPY.addSkillHint, 'composer-skill', () => { togglePlus(false); workspaceView?.openSkills(); }),
  );
  plusMenu.append(attachGroup, referenceGroup, skillGroup);
  composer.append(plusMenu);
  // Agent keeps only the attachment `+` at the composer's start: the one Chat/Agent switch lives in
  // the common shell above, never here and never twice.
  leading.append(plus);
  const acquisition = el('label', 'zchatgpt-acquisition-target', 'Save literature to'); acquisition.hidden = true;
  const collection = el('select'); collection.dataset.zchatgptCollectionTarget = ''; collection.setAttribute('aria-label', 'Target collection'); acquisition.append(collection); composerContext.append(acquisition);
  collection.addEventListener('change', () => { const selected = presenter.snapshot().collectionOptions.find(item => `${item.libraryId}:${item.collectionKey}` === collection.value); if (selected) presenter.setAcquisitionTarget({ clientId: selected.clientId, libraryId: selected.libraryId, collectionKey: selected.collectionKey }); else presenter.setAcquisitionTarget(null); });
  let requestedCollections = false;
  const imagePreview = el('div', 'zchatgpt-image-preview'); imagePreview.dataset.zchatgptImagePreview = ''; imagePreview.hidden = true;
  imagePreview.setAttribute('role', 'dialog'); imagePreview.setAttribute('aria-modal', 'true'); imagePreview.setAttribute('aria-label', 'Image preview');
  chat.append(imagePreview);
  let imageTrigger: HTMLElement | null = null;
  const closeImage = () => { imagePreview.hidden = true; imagePreview.replaceChildren(); imageTrigger?.focus(); };
  const previewImage = (image: ImageAttachment, trigger?: HTMLElement) => {
    imageTrigger = trigger ?? doc.activeElement as HTMLElement | null;
    const header = el('div', 'zchatgpt-image-preview-header');
    const caption = image.origin?.kind === 'generated' ? `Generated image${image.origin.model ? ` · requested with ${image.origin.model}` : ''}` : image.name;
    const close = button('Close image preview', 'close-image-preview', closeImage, 'remove');
    header.append(el('span', '', caption), close);
    const full = el('img'); full.src = image.dataUrl; full.alt = caption;
    const exportButton = button('Save image…', 'export-image', () => {
      if (hooks.exportImage) void hooks.exportImage(image).catch(() => reportViewMessage(COPY.imageSaveFailed));
    });
    exportButton.hidden = !hooks.exportImage;
    imagePreview.replaceChildren(header, full, exportButton); imagePreview.hidden = false; close.focus();
  };
  imagePreview.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeImage(); }
    if (event.key === 'Tab') {
      const buttons = [...imagePreview.querySelectorAll<HTMLButtonElement>('button:not([hidden])')];
      if (!buttons.length) return;
      const current = buttons.indexOf(doc.activeElement as HTMLButtonElement);
      event.preventDefault(); buttons[(current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    }
  });
  const imageCard = (image: ImageAttachment) => {
    const card = el('figure', 'zchatgpt-image-card'); card.dataset.zchatgptImage = image.id;
    const thumbnail = el('img'); thumbnail.src = image.dataUrl; thumbnail.alt = image.name; thumbnail.loading = 'lazy';
    const open = button('Preview image', 'preview-image', () => previewImage(image, open));
    // An image grows the transcript after the last render already scrolled: re-pin only if it was pinned.
    thumbnail.addEventListener('load', () => { if (sticking) messages.scrollTop = messages.scrollHeight; });
    open.replaceChildren(thumbnail); card.append(open);
    card.append(el('figcaption', '', image.origin?.kind === 'generated' ? 'Generated image' : image.name));
    return card;
  };
  applyChatTextScale(root, hooks.readTextScale?.());
  const unbindZoom = hooks.readerZoom
    ? bindUnifiedReaderZoom(root, hooks.readerZoom, hooks.zoomTargets ?? [doc, root])
    : (() => {
      applyChatTextScale(root);
      return () => undefined;
    })();
  /**
   * The details panel. It is an inline anchored panel, not a second transcript: opening it never
   * reflows or replaces the conversation, and closing it returns focus to the More trigger so the
   * affordance stays keyboard-reachable. It is opened from the toolbar's More menu, because the
   * normal header no longer carries a permanent context row.
   */
  const toggleContext = (open?: boolean) => {
    const next = open ?? contextPanel.hidden;
    contextPanel.hidden = !next;
    if (next) more.setAttribute('aria-expanded', 'false');
    if (next) {
      contextPanelError.hidden = true; contextPanelStatus.hidden = true;
      togglePicker(false); toggleHistory(false); toggleRename(false); togglePlus(false); toggleMore(false);
      renderContextDetails(latestViewState);
      focusMenu(contextPanel);
    }
  };
  /** The More menu: paper/context details and the hosted page's reload control. */
  const toggleMore = (open?: boolean) => {
    const next = open ?? moreMenu.hidden;
    moreMenu.hidden = !next;
    more.setAttribute('aria-expanded', String(next));
    more.setAttribute('aria-controls', `${viewId}-more`);
    if (next) {
      menu.hidden = true; picker.setAttribute('aria-expanded', 'false');
      historyPanel.hidden = true; historyBtn.setAttribute('aria-expanded', 'false');
      toggleRename(false); togglePlus(false);
      contextPanel.hidden = true;
      focusMenu(moreMenu);
    }
  };
  /**
   * Run one toolbar copy. The button reports busy while the action really is in flight, then a
   * short-lived check with a live-region sentence; a failure keeps the reason on screen and leaves
   * the control armed to retry. Nothing here pastes, sends, switches mode, uploads or starts a model.
   */
  const runToolbarCopy = async (control: HTMLButtonElement) => {
    const reason = control.dataset.zchatgptDisabledReason;
    if (control.getAttribute('aria-disabled') === 'true') {
      // An `aria-disabled` control stays focusable so its reason is discoverable; activation is what
      // is refused, and saying why is the feedback the click produces.
      say(reason ?? VIEW_ACTION_FAILED, { sticky: true });
      return;
    }
    const action = control.dataset.zchatgptToolbarAction;
    const chatEmbed = hooks.chatEmbed;
    const missing = () => Promise.resolve<EmbedClipboardOutcome>({ copied: false, reason: 'unavailable' as const });
    const copyPaperNow = () => chatEmbed?.copyPaperContext?.() ?? missing();
    const copyPdfNow = () => chatEmbed?.copyPdfFile?.() ?? missing();
    const wired = action === 'copy-pdf-file' ? !!chatEmbed?.copyPdfFile : !!chatEmbed?.copyPaperContext;
    if (!wired) { say(COPY.embedFileUnavailable, { sticky: true }); return; }
    if (control.dataset.zchatgptCopyBusy === 'true') return;
    // The previous answer was about the previous action, so it is dropped before this one runs: the
    // owner never reads a stale "copied" line next to a control they just pressed.
    say('');
    control.dataset.zchatgptCopyBusy = 'true';
    control.setAttribute('aria-busy', 'true');
    let outcome: EmbedClipboardOutcome;
    try {
      outcome = action === 'copy-pdf-file' ? await copyPdfNow() : await copyPaperNow();
    } catch {
      outcome = { copied: false, reason: 'failed' };
    }
    delete control.dataset.zchatgptCopyBusy;
    control.removeAttribute('aria-busy');
    if (disposedView) return;
    if (outcome.copied) {
      const label = action === 'copy-pdf-file' ? COPY.copyPdfDone : COPY.copyPaperDone;
      say(label);
      control.dataset.zchatgptCopyState = 'copied';
      const restore = () => { if (control.dataset.zchatgptCopyState === 'copied') delete control.dataset.zchatgptCopyState; };
      const view = doc.defaultView;
      if (view) view.setTimeout(restore, 1600); else restore();
      return;
    }
    delete control.dataset.zchatgptCopyState;
    const failure = outcome.reason === 'no-info' ? COPY.copyPaperNoInfo
      : outcome.reason === 'no-file' ? COPY.embedFileMissing
        : outcome.reason === 'unavailable' ? COPY.embedFileUnavailable
          : action === 'copy-pdf-file' ? COPY.embedFileFailed : COPY.copyPaperFailed;
    say(failure, { sticky: true });
  };
  const togglePicker = (open?: boolean) => {
    const next = open ?? menu.hidden;
    menu.hidden = !next;
    picker.setAttribute('aria-expanded', String(next));
    if (next) { historyPanel.hidden = true; historyBtn.setAttribute('aria-expanded', 'false'); toggleRename(false); togglePlus(false); toggleMore(false); contextPanel.hidden = true; }
  };
  /**
   * The rename popover hangs off the selected tab's title. Opening it fills the field from the live
   * conversation and selects the text; closing it returns focus to that title, so the affordance is
   * keyboard-reachable without a menu trigger.
   */
  const toggleRename = (open?: boolean) => {
    if ((open ?? renameForm.hidden) && !presenter.snapshot().conversation) return;
    const next = open ?? renameForm.hidden;
    renameForm.hidden = !next;
    renameTrigger?.setAttribute('aria-expanded', String(next));
    if (next) {
      historyPanel.hidden = true; historyBtn.setAttribute('aria-expanded', 'false');
      menu.hidden = true; picker.setAttribute('aria-expanded', 'false'); togglePlus(false); toggleMore(false);
      renameInput.value = presenter.snapshot().conversation?.title ?? '';
      renameInput.focus(); renameInput.select();
    }
  };
  const toggleHistory = (open?: boolean) => {
    const next = open ?? historyPanel.hidden;
    // The row menu belongs to the panel, so it never outlives it in either direction.
    closeHistoryRowMenu(false);
    historyPanel.hidden = !next;
    historyBtn.setAttribute('aria-expanded', String(next));
    if (next) {
      menu.hidden = true;
      picker.setAttribute('aria-expanded', 'false');
      toggleRename(false);
      togglePlus(false);
      toggleMore(false);
      historySearch.focus();
    }
  };
  /** The composer plus menu; only the picker button, an outside click or Escape closes it. */
  const togglePlus = (open?: boolean) => {
    const next = open ?? plusMenu.hidden;
    plusMenu.hidden = !next;
    plus.setAttribute('aria-expanded', String(next));
    if (next) {
      menu.hidden = true; picker.setAttribute('aria-expanded', 'false');
      toggleRename(false);
      historyPanel.hidden = true; historyBtn.setAttribute('aria-expanded', 'false');
      toggleMore(false);
    }
  };
  const nextImageId = () => hooks.uuid?.() ?? (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`);
  const geckoAccess = (): GeckoClipboardAccess | null => resolveGeckoClipboardAccess(doc.defaultView);
  /**
   * One paste gesture can reach the composer through more than one route: the DOM paste event, the
   * reader window's own clipboard service (this chat is mounted into the reader window, not an
   * iframe), and the plugin realm that owns the privileged pasteboard. Identical bytes already in
   * the draft are skipped so a single Cmd+V can never attach the same image twice.
   */
  const attachClipboardImages = (images: ImageAttachment[]) => {
    const present = new Set(presenter.snapshot().draft.images.map(image => image.dataUrl));
    for (const image of images) { if (present.has(image.dataUrl)) continue; present.add(image.dataUrl); presenter.addImage(image); }
  };
  /** The two refusals are named, so a paste or drop that carried an image is never a silent no-op. */
  const IMAGE_REFUSAL: Record<ClipboardImageRefusal, string> = { 'too-large': COPY.imageTooLarge, unsupported: COPY.imageUnsupported };
  /**
   * Reads one route and moves on when it produced nothing. A route that throws (the reader window's
   * nsIClipboard can claim an image family it cannot hand over) must not consume the paste: later
   * routes, including the privileged plugin realm, still run. A route that really found bytes it had
   * to refuse is remembered, but a later route that attaches those bytes wins and the refusal is not
   * shown. Routes are tried in order of fidelity.
   */
  const readClipboardRoutes = async (clipboard: ClipboardLike | null | undefined, routes: Array<() => Promise<ClipboardImageRead>>): Promise<void> => {
    let refusal: ClipboardImageRefusal | undefined;
    let attached = false;
    let throws = 0;
    for (const route of routes) {
      let read: ClipboardImageRead;
      try { read = await route(); } catch { throws += 1; continue; }
      attachClipboardImages(read.images);
      if (read.images.length) { attached = true; break; }
      refusal ??= read.refused;
    }
    if (attached) return;
    if (refusal) reportViewMessage(IMAGE_REFUSAL[refusal]);
    else if (routes.length > 0 && throws === routes.length) reportViewMessage(COPY.imageClipboardFailed);
  };
  const pluginClipboardRead = async (): Promise<ClipboardImageRead> => await presenter.clipboardImage();
  /** The routes the current paste gesture can reach, most faithful first. */
  const pasteRoutes = (clipboard: ClipboardLike | null | undefined): Array<() => Promise<ClipboardImageRead>> => {
    const host = geckoAccess();
    const geckoRead = (): Promise<ClipboardImageRead> => {
      try { return Promise.resolve(readGeckoClipboardImage(host, nextImageId)); }
      catch { return Promise.resolve({ images: [] }); }
    };
    return [
      ...(clipboardHasImage(clipboard) ? [() => attachmentsFromClipboard(clipboard, nextImageId)] : []),
      ...(host ? [geckoRead] : []),
      pluginClipboardRead,
    ];
  };
  const seenPaste = new WeakSet<Event>();
  /**
   * True once this paste gesture produced a paste event anywhere in this window. The keydown
   * fallback below only exists for the case where the reader routes Cmd+V to its own chrome and no
   * paste event reaches this document at all; when one did, that event already tried every route
   * (including the plugin realm), so reading the pasteboard a second time would be redundant.
   */
  let pasteEventSeen = false;
  const onPaste = (event: Event) => {
    const target = event.target as Node | null;
    const inComposer = !!target && 'nodeType' in target && composer.contains(target);
    // Gecko can dispatch paste at the chrome document. Accept that route only
    // while this composer owns focus; another editor's event stays untouched.
    const documentTarget = !target || !('nodeType' in target) || target.nodeType === 9;
    if (!inComposer && !(documentTarget && doc.hasFocus() && composer.contains(doc.activeElement))) return;
    if (seenPaste.has(event)) return;
    seenPaste.add(event);
    pasteEventSeen = true;
    const clipboard = (event as ClipboardEvent).clipboardData;
    // A paste that carries text is left entirely to the textarea; only a gesture with no text and
    // no image data of its own falls through to the privileged pasteboard.
    if (!clipboardHasImage(clipboard) && clipboardHasText(clipboard)) return;
    event.preventDefault();
    void readClipboardRoutes(clipboard, pasteRoutes(clipboard));
  };
  composer.addEventListener('dragover', event => { if (clipboardHasImage(event.dataTransfer)) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; } });
  composer.addEventListener('drop', event => {
    if (!clipboardHasImage(event.dataTransfer)) return;
    event.preventDefault();
    // A drop is the same validated route as a paste: the dropped bytes are attached, and a drop
    // that could not be attached names its reason (size or format) instead of doing nothing.
    void attachmentsFromClipboard(event.dataTransfer, nextImageId).then(read => {
      for (const image of read.images) presenter.addImage(image);
      if (read.refused) reportViewMessage(IMAGE_REFUSAL[read.refused]);
    }).catch(() => reportViewMessage(COPY.imageDropFailed));
  });
  composer.addEventListener('paste', onPaste);
  input.addEventListener('paste', onPaste);
  chat.addEventListener('paste', onPaste);
  const pasteDocuments = new Set<Document>([doc]);
  for (const target of hooks.zoomTargets ?? []) {
    const next = 'nodeType' in target && target.nodeType === 9 ? target as Document : target.ownerDocument;
    if (next) pasteDocuments.add(next);
  }
  for (const target of pasteDocuments) target.addEventListener('paste', onPaste, true);
  const pasteWindow = doc.defaultView;
  pasteWindow?.addEventListener('paste', onPaste, true);
  let composing = false;
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; });
  const resizeInput = () => {
    input.style.height = 'auto';
    if (input.scrollHeight > 0) input.style.height = `${input.scrollHeight}px`;
  };
  input.addEventListener('input', () => { presenter.setQuestion(input.value); resizeInput(); });
  const isComposing = (event: KeyboardEvent) => composing || event.isComposing || event.keyCode === 229;
  input.addEventListener('keydown', event => {
    // Cmd/Ctrl+V: Zotero's reader may route the pasteboard to its own chrome, and a macOS
    // screenshot is TIFF there, which this realm cannot read. The privileged plugin clipboard is
    // read only as a fallback for a keypress whose paste event never arrives here; a paste event
    // that does arrive already tries every route itself, and identical bytes never attach twice.
    // Text pastes are untouched because nothing is prevented here.
    if (!isComposing(event) && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'v') {
      pasteEventSeen = false;
      // The keypress default action and its paste event run before timers, so a real paste wins.
      setTimeout(() => { if (!pasteEventSeen) void readClipboardRoutes(null, pasteRoutes(null)); }, 0);
    }
  });
  input.addEventListener('keydown', event => {
    if (isComposing(event)) return;
    if (event.key === 'Escape' && !renameForm.hidden) { event.preventDefault(); toggleRename(false); renameTrigger?.focus(); return; }
    if (event.key === 'Escape' && !menu.hidden) { event.preventDefault(); togglePicker(false); return; }
    if (event.key !== 'Enter' || event.shiftKey) return;
    // An open chooser owns Enter. Closing it must never submit the draft.
    if (!menu.hidden || !renameForm.hidden || !historyPanel.hidden) {
      event.preventDefault(); togglePicker(false); toggleRename(false); toggleHistory(false); return;
    }
    event.preventDefault(); void presenter.send();
  });
  const menuItems = (panel: HTMLElement) => [...panel.querySelectorAll<HTMLElement>('button:not(:disabled):not([hidden]), input:not(:disabled):not([hidden])')]
    .filter(node => !node.closest('[hidden]'));
  const focusMenu = (panel: HTMLElement, last = false) => {
    const items = menuItems(panel);
    (last ? items.at(-1) : items[0])?.focus();
  };
  const bindMenuKeys = (panel: HTMLElement, trigger: { focus(): void }, close: () => void) => {
    panel.addEventListener('keydown', event => {
      if (isComposing(event)) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); close(); trigger.focus(); return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      // Home/End continue editing text in the history search field.
      if (event.target === historySearch && (event.key === 'Home' || event.key === 'End')) return;
      const target = event.target as Element | null;
      if (target !== historySearch && target?.matches('input, textarea, select')) return;
      const items = menuItems(panel); if (!items.length) return;
      const current = items.indexOf(doc.activeElement as HTMLElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      event.preventDefault(); items[next]?.focus();
    });
  };
  bindMenuKeys(menu, picker, () => togglePicker(false));
  bindMenuKeys(renameForm, { focus() { renameTrigger?.focus(); } }, () => toggleRename(false));
  bindMenuKeys(historyPanel, historyBtn, () => toggleHistory(false));
  bindMenuKeys(plusMenu, plus, () => togglePlus(false));
  bindMenuKeys(contextPanel, more, () => toggleContext(false));
  bindMenuKeys(moreMenu, more, () => toggleMore(false));
  for (const [trigger, panel, open] of [
    [picker, menu, () => togglePicker(true)],
    [historyBtn, historyPanel, () => toggleHistory(true)],
    [plus, plusMenu, () => togglePlus(true)],
    [more, moreMenu, () => toggleMore(true)],
  ] as const) trigger.addEventListener('keydown', event => {
    if (isComposing(event) || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    event.preventDefault(); open(); focusMenu(panel, event.key === 'ArrowUp');
  });
  // The open-chat strip is a tablist with one tab stop, so the arrows and Home/End move the focus
  // between the open chats without activating one: browsing the strip must never change what the
  // composer is editing. Enter or Space activates the focused chip through the same path as a click.
  panes.addEventListener('keydown', event => {
    if (isComposing(event)) return;
    const items = [...panes.querySelectorAll<HTMLElement>('[data-zchatgpt-pane-tab]')];
    if (!items.length) return;
    const current = items.findIndex(tab => tab === doc.activeElement || tab.contains(doc.activeElement));
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : (Math.max(current, 0) + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
      event.preventDefault(); items[next]?.focus();
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if ((event.target as Element | null)?.closest?.('[data-zchatgpt-pane-close]')) return;
    const tab = items[Math.max(current, 0)];
    if (!tab) return;
    event.preventDefault();
    tab.click();
  });
  historySearch.addEventListener('input', () => {
    if (presenter.snapshot().workspace) void presenter.searchHistory(historySearch.value).catch(reportViewError); else applyHistoryFilter();
  });
  const onDocumentClick = (event: Event) => {
    const target = event.target as Node | null;
    // A menu row can re-render its own menu, detaching the clicked node before this document
    // listener runs; a detached target was inside the pane, so it is never an outside click.
    if (!target || !target.isConnected) return;
    if (!menu.hidden && !menu.contains(target) && !picker.contains(target)) togglePicker(false);
    if (!historyPanel.hidden && !historyPanel.contains(target) && !historyBtn.contains(target)) toggleHistory(false);
    if (!renameForm.hidden && !renameForm.contains(target) && !renameTrigger?.contains(target)) toggleRename(false);
    if (!plusMenu.hidden && !plusMenu.contains(target) && !plus.contains(target)) togglePlus(false);
    if (!contextPanel.hidden && !contextPanel.contains(target) && !more.contains(target) && !moreMenu.contains(target)) toggleContext(false);
    if (!moreMenu.hidden && !moreMenu.contains(target) && !more.contains(target) && !historyMenu.contains(target)) toggleMore(false);
    if (!historyMenu.hidden && !historyMenu.contains(target) && !(historyMenuTarget?.trigger.contains(target) ?? false)) closeHistoryRowMenu(false);
  };
  const onDocumentKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || isComposing(event) || !root.contains(event.target as Node | null)) return;
    if (!historyMenu.hidden) { event.preventDefault(); closeHistoryRowMenu(true); return; }
    if (!moreMenu.hidden) { event.preventDefault(); toggleMore(false); more.focus(); }
    else if (!contextPanel.hidden) { event.preventDefault(); toggleContext(false); more.focus(); }
    else if (!plusMenu.hidden) { event.preventDefault(); togglePlus(false); plus.focus(); }
    else if (!menu.hidden) { event.preventDefault(); togglePicker(false); picker.focus(); }
    else if (!renameForm.hidden) { event.preventDefault(); toggleRename(false); renameTrigger?.focus(); }
    else if (!historyPanel.hidden) { event.preventDefault(); toggleHistory(false); historyBtn.focus(); }
  };
  doc.addEventListener('click', onDocumentClick);
  doc.addEventListener('keydown', onDocumentKey);
  const applyHistoryFilter = () => {
    const query = historySearch.value.trim().toLowerCase();
    const filterRows = (rows: Iterable<HTMLElement>) => {
      let visible = 0;
      for (const row of rows) {
        const hay = row.dataset.zchatgptHistoryLabel ?? '';
        const show = !query || hay.toLowerCase().includes(query);
        row.hidden = !show;
        if (show) visible++;
      }
      return visible;
    };
    for (const group of historyList.querySelectorAll<HTMLElement>('[data-zchatgpt-history-group]')) {
      group.hidden = filterRows(group.querySelectorAll<HTMLElement>('.zchatgpt-history-row')) === 0;
    }
  };
  const citationCard = (citation: Citation, removable: boolean) => {
    const card = el('div', 'zchatgpt-citation'); card.dataset.zchatgptCitation = citation.id;
    const quote = el('blockquote', 'zchatgpt-citation-text', citation.text.length > 240 ? `${[...citation.text].slice(0, 240).join('')}…` : citation.text);
    const meta = el('div', 'zchatgpt-citation-meta');
    meta.append(el('span', '', COPY.page(pageLabel(citation))));
    if (hooks.openCitation) meta.append(button(COPY.returnToSource, 'open-citation', () => { void hooks.openCitation?.(citation).catch(() => reportViewMessage(COPY.sourceOpenFailed)); }, 'source'));
    if (removable) meta.append(button(COPY.remove, 'remove-citation', () => { presenter.removeCitation(citation.id); }, 'remove'));
    card.append(quote, meta); return card;
  };
  /** One transcript message: text, attachments, and the hover/focus actions for the chat on screen. */
  const messageNode = (message: Message) => {
    const article = el('article', 'zchatgpt-message'); article.dataset.zchatgptMessage = message.id; article.dataset.role = message.role;
    if (message.action) article.dataset.action = message.action;
    // Codex-like shape: the body holds the text bubble, the attachments and the hover/focus actions;
    // the author is implied by alignment, so there is no labelled header row.
    const body = el('div', 'zchatgpt-message-body');
    const text = el('div', 'zchatgpt-message-text'); text.dataset.zchatgptText = '';
    text.addEventListener('click', event => {
      const target = event.target as Element | null;
      const link = target?.closest?.('a[href]');
      if (!link) return;
      event.preventDefault();
      const href = link.getAttribute('href'); if (href) hooks.openLink?.(href);
    });
    const attachments = el('div', 'zchatgpt-message-attachments'); attachments.dataset.zchatgptMessageAttachments = '';
    const taskSummary = button('Review annotation suggestions', 'review-annotations', () => {
      const task = latestViewState.tasks.find(task => task.kind === 'annotations' && task.modelRequestId === message.requestId);
      const card = task && [...taskPanel.querySelectorAll<HTMLDetailsElement>('[data-zchatgpt-task-id]')].find(card => card.dataset.zchatgptTaskId === task.id);
      if (card) { card.open = true; card.scrollIntoView?.({ block: 'nearest' }); }
    }); taskSummary.hidden = true;
    const actions = el('div', 'zchatgpt-message-actions');
    if (message.role === 'assistant') {
      const copyAnswer = button(COPY.copy, 'copy-answer', () => {
        const latest = presenter.snapshot().conversation?.messages.find(entry => entry.id === message.id);
        copyText(copyableAnswerText(latest?.text ?? message.text), copyAnswer);
      });
      copyAnswer.classList.add('zchatgpt-copy-answer');
      const copyLabel = el('span', 'zchatgpt-copy-label', COPY.copy);
      copyLabel.dataset.zchatgptCopyLabel = '';
      copyAnswer.replaceChildren(icon('copy'), copyLabel);
      actions.append(copyAnswer);
    }
    const branch = button(message.role === 'assistant' ? 'Regenerate in new chat' : 'Edit in new chat', 'branch-message', () => {
      const previous = presenter.snapshot().conversation?.id;
      void presenter.branchConversation(message.id).then(async () => {
        if (message.role === 'assistant' && presenter.snapshot().conversation?.id !== previous) await presenter.send();
      }).catch(reportViewError);
    });
    branch.classList.add('zchatgpt-message-action'); actions.append(branch);
    if (message.role === 'user') { const cancelQueued = button('Cancel queued question', 'cancel-queued', () => { void presenter.cancelQueuedRequest(message.requestId).catch(reportViewError); }); cancelQueued.hidden = true; actions.append(cancelQueued); }
    body.append(text, taskSummary, attachments, actions);
    const meta = el('div', 'zchatgpt-message-meta'); meta.dataset.zchatgptMeta = '';
    article.append(body, meta); return article;
  };
  let renderedConversationId: string | null = null;
  const messageNodes = new Map<string, HTMLElement>();
  const renderedMessages = new Map<string, { text: string; status: Message['status']; action: Message['action'] }>();
  /** One message node's painted state, so a streamed delta repaints only the node it belongs to. */
  type RenderRecord = Map<string, { text: string; status: Message['status']; action: Message['action'] }>;
  interface RenderView {
    /** The chat that owns the message, which is what answer citations resolve against. */
    conversation: Conversation | null;
    models: NonNullable<PresenterState['runtime']>['models'];
    tasks: PresenterState['tasks'];
    /** Request ids a queued send covers, or null for a transcript that cannot queue. */
    queued: ReadonlySet<string> | null;
  }
  /** The text and attachments of one message in the chat on screen. */
  const paintBody = (node: HTMLElement, message: Message, rendered: RenderRecord, view: RenderView) => {
    const annotationTask = message.role === 'assistant' ? view.tasks.find(task => task.kind === 'annotations' && task.modelRequestId === message.requestId) : undefined;
    const text = node.querySelector<HTMLElement>('[data-zchatgpt-text]')!;
    const previous = rendered.get(message.id);
    if (!previous || previous.text !== message.text || previous.status !== message.status || previous.action !== message.action) {
      rendered.set(message.id, { text: message.text, status: message.status, action: message.action });
      if (message.role === 'assistant' && message.text) {
        text.classList.add('zchatgpt-rendered');
        const fragment = renderAnswer(doc, message.text, { deferMath: message.status === 'streaming' || message.status === 'pending' });
        // Always run the pass, even with no sources: reserved citation links must be neutralized
        // rather than left as external `zchatgpt.invalid` URLs for the generic link handler to launch.
        linkAnswerSources(fragment, view.conversation ? answerSources(view.conversation, message) : [], openAnswerSource);
        text.replaceChildren(fragment);
        enhanceCodeBlocks(text);
      } else if (hiddenExplainText(message)) {
        text.classList.remove('zchatgpt-rendered');
        text.textContent = '';
      } else {
        text.classList.remove('zchatgpt-rendered');
        text.textContent = message.text;
      }
    }
    text.hidden = hiddenExplainText(message) || !!annotationTask;
    const attachments = node.querySelector<HTMLElement>('[data-zchatgpt-message-attachments]')!;
    const attachmentKey = [...message.citations.map(citation => citation.id), ...(message.images ?? []).map(image => image.id), ...(message.generatedImages ?? []).map(image => image.id), message.workflow?.skill?.revision ?? '', ...(message.references ?? []).map(reference => reference.id)].join(':');
    if (attachments.dataset.rendered !== attachmentKey) {
      attachments.dataset.rendered = attachmentKey;
      attachments.replaceChildren(...message.citations.map(citation => citationCard(citation, false)), ...[...(message.images ?? []), ...(message.generatedImages ?? [])].map(image => imageCard(image)));
      if (message.workflow?.skill) attachments.append(el('span', 'zchatgpt-message-reference', `/${message.workflow.skill.name} · v${message.workflow.skill.version}`));
      for (const reference of message.references ?? []) attachments.append(el('span', 'zchatgpt-message-reference', `${reference.kind === 'chat' ? '@chat' : reference.kind === 'file' ? '@file' : '@article'} · ${reference.label}`));
    }
  };
  /**
   * The parts of a node that only exist in the chat being edited: the queued-send cancel, the
   * annotation review and the status caption. It is only ever called for the editable pane, where
   * those nodes really are present.
   */
  const paintActions = (node: HTMLElement, message: Message, view: RenderView) => {
    const queued = view.queued?.has(message.requestId) === true;
    const cancelQueued = node.querySelector<HTMLButtonElement>('[data-zchatgpt-action="cancel-queued"]'); if (cancelQueued) cancelQueued.hidden = !queued;
    const annotationTask = message.role === 'assistant' ? view.tasks.find(task => task.kind === 'annotations' && task.modelRequestId === message.requestId) : undefined;
    const taskSummary = node.querySelector<HTMLButtonElement>('[data-zchatgpt-action="review-annotations"]');
    if (taskSummary) {
      taskSummary.hidden = !annotationTask;
      if (annotationTask) taskSummary.textContent = `Review ${annotationTask.items.length} annotation suggestions`;
    }
    const meta = node.querySelector<HTMLElement>('[data-zchatgpt-meta]'); if (!meta) return;
    const statusLabel = queued ? 'Queued' : message.role === 'assistant' ? STATUS_LABEL[message.status] : message.status === 'cancelled' ? 'Cancelled before sending' : '';
    const caption = settingsCaption(message.settings, view.models);
    const label = [statusLabel, caption].filter(Boolean).join(' · ');
    if (meta.textContent !== label) meta.textContent = label;
  };
  /**
   * The messages a transcript shows. The map phase of one request is not a conversation turn: its
   * intermediate user messages stay out of the transcript unless one is explicitly focused.
   */
  const transcriptOf = (conversation: Conversation | null, keep: string | null): Message[] => {
    const all = conversation?.messages ?? [];
    const intermediate = new Set(all.filter(message => message.role === 'user' && message.batch?.phase === 'map').map(message => message.requestId));
    return all.filter(message => !intermediate.has(message.requestId) || message.id === keep);
  };
  let focusToken = 0; let contentKey = ''; let chromeKey = ''; let messageTimeKey = '';
  /**
   * The one-line answer to "what will the next message carry" (UI-02/UI-03). Chat reports available
   * bibliography and abstract; Agent reports the local read and the next send. Neither says whether
   * the last page submission was accepted or whether a model answered. Counts come from prepared pages, so
   * "all N" is only said when every page really carried text: a scanned page reported as empty still
   * counts against the total, and a partial read is never rounded up into a full one.
   */
  const contextSummaryText = (state: PresenterState): string => {
    const { enabled, phase, prepared, progress } = state.document;
    // Only the draft's own citation is queued for the next send. A citation recorded on an earlier
    // turn keeps its own return-to-source line in the panel, but it must not be reported as the
    // scope of the next message.
    const pending = state.draft.citations.at(-1) ?? null;
    if (state.mode === 'chat') {
      if (pending) return enabled ? COPY.contextLineChatSelected(pageLabel(pending)) : COPY.contextLineChatSelectedOff(pageLabel(pending));
      return enabled ? COPY.contextLineChatMetadata : COPY.contextLineChatOff;
    }
    if (pending) return enabled ? COPY.contextLineSelected(pageLabel(pending)) : COPY.contextLineSelectedOff;
    if (!enabled) return COPY.contextLineOff;
    if (phase === 'preparing') return progress.total > 0 ? COPY.contextLinePreparingPages(progress.done, progress.total) : COPY.contextLinePreparing;
    if (phase === 'error') return COPY.contextLineUnavailable;
    if (prepared) {
      const read = prepared.pages.filter(page => page.status === 'text' && page.text.length > 0).length;
      if (read === 0) return COPY.contextLineUnavailable;
      return read >= prepared.totalPages ? COPY.contextLineReadyAll(prepared.totalPages) : COPY.contextLineReadySome(read, prepared.totalPages);
    }
    return phase === 'ready' ? COPY.contextLineUnavailable : COPY.contextLineUnprepared;
  };
  /**
   * The details panel behind the summary. It holds only what does not belong on a permanent row:
   * Agent's concrete read coverage or Chat's metadata-only scope, the automatic-source state (shown, never a fake
   * toggle), the clipboard/primary-source actions the owner asked for, and the planner's own
   * coverage report when one exists. It is rebuilt only while it is open.
   */
  const renderContextPanel = (state: PresenterState, summary: string) => {
    const citation = activeCitation(state.draft.citations, state.conversation?.messages ?? []);
    const { enabled, prepared, phase } = state.document;
    const isAgent = state.mode === 'agent';
    const read = prepared ? prepared.pages.filter(page => page.status === 'text' && page.text.length > 0).length : 0;
    const row = (label: string, value: string, content = false, attribute?: string): HTMLElement => {
      const line = el('p', 'zchatgpt-context-row');
      const name = el('span', 'zchatgpt-context-row-label', label); name.setAttribute('data-zchatgpt-ui', 'true');
      const text = el('span', 'zchatgpt-context-row-value', value);
      if (attribute) text.dataset[attribute] = '';
      if (content) text.dataset.zchatgptUi = 'false'; else text.setAttribute('data-zchatgpt-ui', 'true');
      line.append(name, doc.createTextNode(' '), text);
      return line;
    };
    const nodes: HTMLElement[] = [];
    const head = el('div', 'zchatgpt-context-panel-head');
    const title = el('span', 'zchatgpt-context-panel-title', COPY.contextPanelTitle); title.setAttribute('data-zchatgpt-ui', 'true');
    const close = button(COPY.closeContextPanel, 'close-context-panel', () => toggleContext(false), 'remove');
    head.append(title, close);
    nodes.push(head);
    nodes.push(row(COPY.contextPanelSource, state.document.identity.title || state.document.attachment.title, true));
    nodes.push(row(COPY.contextPanelNextSend, summary, false, 'zchatgptContextSummary'));
    if (isAgent && prepared) nodes.push(row(COPY.contextPanelLocalRead, COPY.contextPanelLocalReadValue(read, prepared.totalPages)));
    nodes.push(row(isAgent ? COPY.contextPanelAutomaticAgent : COPY.contextPanelAutomaticChat, enabled ? COPY.contextPanelAutomaticOn : COPY.contextPanelAutomaticOff));
    if (!isAgent) nodes.push(el('p', 'zchatgpt-context-panel-note', COPY.contextPanelChatScope));
    // The active citation's page and its back-to-source control keep their own node so the reader
    // navigation contract is unchanged; it is hidden whenever the draft carries no selection.
    nodes.push(contextSource);
    if (phase === 'error' && state.document.error) nodes.push(el('p', 'zchatgpt-context-panel-error', state.document.error));
    const actionsRow = el('div', 'zchatgpt-context-panel-actions');
    if (isAgent) {
      actionsRow.append(button(COPY.reReadPdf, 're-read-pdf', () => {
        contextPanelError.hidden = true;
        void presenter.prepareContext().catch(error => { contextPanelError.textContent = actionFailure(error); contextPanelError.hidden = false; });
      }));
      nodes.push(actionsRow);
      if (state.contextReport) nodes.push(contextDetailNodes(doc, state.contextReport));
      else { const note = el('p', 'zchatgpt-context-panel-note', COPY.contextPanelNoReport); note.setAttribute('data-zchatgpt-ui', 'true'); nodes.push(note); }
    } else {
      const note = el('p', 'zchatgpt-context-panel-note', COPY.contextPanelChatNoReport); note.setAttribute('data-zchatgpt-ui', 'true'); nodes.push(note);
    }
    contextPanelBody.replaceChildren(...nodes);
    contextSource.hidden = !citation;
  };
  /**
   * Paint the details while they are open. The one-line summary answers "what will the next message
   * carry"; it is shown inside the panel, never as a permanent header row. Its own content key keeps
   * the DOM still — and keyboard focus with it — while nothing the panel shows has changed.
   */
  let contextPanelKey: string | null = null;
  const renderContextDetails = (state: PresenterState) => {
    if (contextPanel.hidden) { contextPanelKey = null; return; }
    const summary = contextSummaryText(state);
    const key = JSON.stringify([
      summary, state.document.enabled, state.document.error, state.document.disclosure,
      activeCitation(state.draft.citations, state.conversation?.messages ?? [])?.id ?? '',
      state.contextReport ?? null,
    ]);
    if (key === contextPanelKey) return;
    contextPanelKey = key;
    renderContextPanel(state, summary);
  };
  /**
   * Paint the mode the presenter will freeze onto the next request. `aria-pressed` is set from
   * presenter state, never from the button that was clicked, so the control cannot show a mode the
   * send path would not use. Recorded requests and messages keep the mode they were frozen with.
   */
  const renderMode = (state: PresenterState) => {
    for (const entry of modeButtons) entry.node.setAttribute('aria-pressed', String(entry.mode === state.mode));
    modeSwitch.dataset.zchatgptMode = state.mode;
    // New sessions belong to the selected mode's name: the native surface is Agent work, so its
    // unbound session says `New agent`, while the non-embedded Chat stub keeps `New chat`. The
    // control stays icon-only; the mode-specific name is its accessible name and tooltip.
    const freshLabel = state.mode === 'agent' ? COPY.newAgent : COPY.newChat;
    if (fresh.dataset.zchatgptUiCopy !== freshLabel) {
      fresh.dataset.zchatgptUiCopy = freshLabel;
      fresh.setAttribute('aria-label', freshLabel); fresh.title = freshLabel;
    }
  };
  /**
   * The paper actions' availability. The copy buttons exist exactly when the host wired them; the
   * bibliographic one is `aria-disabled` (not `disabled`) for an item with no provable bibliography,
   * so it stays focusable, its title states the reason, and activating it announces that reason
   * instead of silently doing nothing. `Copy PDF file` cannot know the file synchronously without a
   * probe, so it stays armed and reports the real reason when the copy fails.
   */
  const paintPaperActions = (state: PresenterState) => {
    copyPaper.hidden = !hooks.chatEmbed?.copyPaperContext;
    copyPdf.hidden = !hooks.chatEmbed?.copyPdfFile;
    const noInfo = !hasBibliographicIdentity(state.document.identity);
    if (noInfo) {
      copyPaper.setAttribute('aria-disabled', 'true');
      copyPaper.dataset.zchatgptDisabledReason = COPY.copyPaperNoInfo;
      if (copyPaper.title !== COPY.copyPaperNoInfo) copyPaper.title = COPY.copyPaperNoInfo;
    } else {
      copyPaper.removeAttribute('aria-disabled');
      delete copyPaper.dataset.zchatgptDisabledReason;
      const label = `${COPY.copyPaperContext}\n${COPY.copyPaperContextHint}`;
      if (copyPaper.title !== label) copyPaper.title = label;
    }
    if (!hooks.chatEmbed?.copyPaperContext) { copyPaper.removeAttribute('aria-disabled'); delete copyPaper.dataset.zchatgptDisabledReason; }
  };
  const updateContext = (state: PresenterState) => {
    if (!state.conversation && !renameForm.hidden) toggleRename(false);
    const citation = activeCitation(state.draft.citations, state.conversation?.messages ?? []);
    const sourceKey = citation ? `${citation.id}:${pageLabel(citation)}` : '';
    if (contextSource.dataset.rendered !== sourceKey) {
      contextSource.dataset.rendered = sourceKey;
      if (!citation) contextSource.replaceChildren();
      else {
        const line = el('div', 'zchatgpt-context-citation');
        line.append(el('span', '', COPY.page(pageLabel(citation))));
        if (hooks.openCitation) line.append(button(COPY.returnToSource, 'open-citation', () => { void hooks.openCitation?.(citation).catch(() => reportViewMessage(COPY.sourceOpenFailed)); }, 'source'));
        contextSource.replaceChildren(line);
      }
    }
    contextSource.hidden = !citation;
    // The details are only rebuilt while they are open; nothing about the summary is rendered in the
    // header any more, so a closed panel costs nothing and cannot change the toolbar's height.
    renderContextDetails(state);
  };
  /**
   * Reconcile the Cursor-style tab strip. A chip is kept by id instead of rebuilt, so a click or an
   * arrow key lands on a node that is still in the document: switching chats never steals the focus
   * the reader put on the strip. The strip is always visible: a single open chat is still a tab.
   * The unsent tab is the `New chat` copy, not the article title: paper identity comes from the
   * attachment/context system, never from a tab label. `+` beside a named chat is the same copy;
   * that tab is still not a record.
   */
  const renderPanes = (state: PresenterState) => {
    // The hosted Chat page owns its own conversation list, so the native tab strip is not shown
    // beside it; the shell shows the single local binding title instead.
    panes.hidden = root.dataset.zchatgptEmbedActive === 'true';
    const models: Array<{ id: string; label: string; title: string; conversation: Conversation | null; localize: boolean }> = state.openConversations.map(conversation => ({
      id: conversation.id,
      label: conversationLabel(conversation, state.conversations),
      title: conversation.title || conversationLabel(conversation, state.conversations),
      conversation,
      localize: false,
    }));
    // The unbound tab is named for the mode that would run its first send: Agent says `New agent`.
    // A stored conversation titled `New chat` is the owner's data and is never renamed on screen.
    const newTabLabel = state.mode === 'agent' ? COPY.newAgent : COPY.newChat;
    if (state.newChatOpen || !state.conversation) {
      models.push({ id: NEW_CHAT_TAB_ID, label: newTabLabel, title: newTabLabel, conversation: null, localize: true });
    }
    const ids = new Set(models.map(entry => entry.id));
    for (const [id, node] of paneNodes) if (!ids.has(id)) { node.remove(); paneNodes.delete(id); }
    let cursor = panes.firstElementChild;
    let selected: HTMLElement | null = null;
    for (const model of models) {
      let tab = paneNodes.get(model.id);
      if (!tab) {
        tab = el('div', 'zchatgpt-pane-tab');
        tab.setAttribute('role', 'tab');
        tab.dataset.zchatgptPaneTab = '';
        tab.dataset.zchatgptConversationId = model.id;
        tab.id = `${viewId}-pane-${model.id}`;
        const label = el('span', model.localize ? 'zchatgpt-pane-tab-new' : 'zchatgpt-pane-tab-label');
        label.dataset.zchatgptPaneLabel = '';
        const close = button(COPY.closeChat, 'close-conversation', () => {
          if (presenter.closeConversation()) hooks.closeDock?.();
        }, 'remove', 'zchatgpt-current-close');
        close.dataset.zchatgptPaneClose = '';
        tab.append(label, close);
        tab.addEventListener('click', event => {
          if ((event.target as Element | null)?.closest?.('[data-zchatgpt-pane-close]')) return;
          const id = tab!.dataset.zchatgptConversationId ?? '';
          const active = tab!.getAttribute('aria-selected') === 'true';
          if (id === NEW_CHAT_TAB_ID) {
            if (!active) void presenter.newConversation();
            return;
          }
          if (active) toggleRename();
          else void presenter.openConversation(id).catch(reportViewError);
        });
        paneNodes.set(model.id, tab);
      }
      const active = model.id === (state.conversation?.id ?? NEW_CHAT_TAB_ID);
      const label = tab.querySelector<HTMLElement>('[data-zchatgpt-pane-label]')!;
      const close = tab.querySelector<HTMLButtonElement>('[data-zchatgpt-pane-close]')!;
      label.className = model.localize ? 'zchatgpt-pane-tab-new' : 'zchatgpt-pane-tab-label';
      label.dataset.zchatgptPaneLabel = '';
      if (model.localize) {
        if (label.dataset.zchatgptUiCopy !== model.label) { label.dataset.zchatgptUiCopy = model.label; label.textContent = model.label; }
      } else {
        delete label.dataset.zchatgptUiCopy;
        if (label.textContent !== model.label) label.textContent = model.label;
      }
      if (tab.title !== model.title) tab.title = model.title;
      const selectedAttr = String(active);
      if (tab.getAttribute('aria-selected') !== selectedAttr) tab.setAttribute('aria-selected', selectedAttr);
      const stop = active ? 0 : -1;
      if (tab.tabIndex !== stop) tab.tabIndex = stop;
      close.hidden = !active;
      if (active) {
        tab.dataset.zchatgptCurrentTitle = '';
        if (model.conversation) {
          tab.dataset.zchatgptAction = 'rename-conversation';
          tab.setAttribute('aria-haspopup', 'dialog');
          tab.setAttribute('aria-expanded', renameForm.hidden ? 'false' : 'true');
          tab.setAttribute('aria-controls', `${viewId}-rename`);
          tab.setAttribute('aria-label', `${COPY.renameChat}: ${model.label}`);
          selected = tab;
        } else {
          delete tab.dataset.zchatgptAction;
          tab.removeAttribute('aria-haspopup');
          tab.removeAttribute('aria-expanded');
          tab.removeAttribute('aria-controls');
          tab.setAttribute('aria-label', model.label);
          selected = tab;
        }
      } else {
        delete tab.dataset.zchatgptCurrentTitle;
        tab.dataset.zchatgptAction = 'select-pane';
        tab.removeAttribute('aria-haspopup');
        tab.removeAttribute('aria-expanded');
        tab.removeAttribute('aria-controls');
        tab.setAttribute('aria-label', model.label);
      }
      if (tab !== cursor) panes.insertBefore(tab, cursor);
      cursor = tab.nextElementSibling;
    }
    renameTrigger = selected;
    const activeTab = paneNodes.get(state.conversation?.id ?? NEW_CHAT_TAB_ID);
    if (activeTab) { transcript.setAttribute('role', 'tabpanel'); transcript.setAttribute('aria-labelledby', activeTab.id); }
    else { transcript.removeAttribute('role'); transcript.removeAttribute('aria-labelledby'); }
  };
  const historyRow = (source: HistoryRowSource) => {
    const row = el('div', 'zchatgpt-history-row');
    row.setAttribute('role', 'listitem');
    // The local search fallback hides rows by this label, so it keeps title + paper + preview.
    row.dataset.zchatgptHistoryLabel = [source.title, source.paperTitle, source.preview].filter(Boolean).join(' ');
    if (source.current) row.dataset.current = '';
    const choice = el('button', 'zchatgpt-history-item');
    choice.type = 'button';
    choice.dataset.zchatgptConversationId = source.id;
    const mark = el('span', `zchatgpt-history-status zchatgpt-history-status-${source.status}`);
    mark.dataset.zchatgptHistoryStatus = source.status;
    mark.setAttribute('aria-hidden', 'true');
    // A calm glyph, not an animation: a small dot for a finished local record, a pencil for a draft,
    // and the same clock the timing line uses for a live request. A finished row deliberately gets no
    // check mark: a conversation is not a completed task.
    mark.append(icon(source.status === 'done' ? 'dot' : source.status === 'draft' ? 'historyDraft' : 'clock'));
    const title = el('span', 'zchatgpt-history-title', source.title);
    // The second line carries the paper and the last activity, plus a source label only when the
    // record proves one. The time is data (its own span); the source label is copy and is translated.
    const meta = el('span', 'zchatgpt-history-meta');
    const metaText = (text: string, content: boolean) => {
      if (meta.childNodes.length) meta.append(doc.createTextNode(' · '));
      const node = el('span', '', text);
      if (content) node.dataset.zchatgptUi = 'false'; else node.setAttribute('data-zchatgpt-ui', 'true');
      meta.append(node);
    };
    if (source.paperTitle && source.paperTitle !== source.title) metaText(source.paperTitle, true);
    const when = messageTimeLabel(source.updatedAt, Date.now(), 'en');
    if (when) metaText(when, true);
    if (source.source) metaText(source.source, false);
    meta.hidden = meta.childNodes.length === 0;
    const text = el('span', 'zchatgpt-history-text');
    text.append(title, meta);
    choice.append(mark, text);
    const description = historyRowDescription({ title: source.title, paperTitle: source.paperTitle, preview: source.preview });
    choice.setAttribute('aria-label', description);
    choice.title = description;
    choice.addEventListener('click', () => { source.open(); toggleHistory(false); });
    row.append(choice);
    // The trailing action is an ellipsis menu with an explicit, confirmed delete, not a permanent
    // cross that reads as "close". The button keeps its slot at every width, so revealing it on
    // hover or focus never shifts the row.
    if (source.remove) {
      const trigger = button(COPY.historyRowActions, 'history-row-menu', () => { openHistoryRowMenu(source, trigger); }, 'more', 'zchatgpt-icon-button zchatgpt-history-more');
      trigger.dataset.zchatgptConversationId = source.id;
      trigger.setAttribute('aria-haspopup', 'dialog');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.setAttribute('aria-controls', historyMenu.id);
      row.append(trigger);
    }
    return row;
  };
  const workspaceHistoryRow = (entry: HistoryEntry, state: PresenterState): HistoryRowSource => ({
    id: entry.id,
    title: entry.title || COPY.untitled,
    paperTitle: entry.identity.title,
    preview: entry.preview,
    status: historyStatus(entry),
    updatedAt: entry.updatedAt || entry.createdAt,
    current: entry.id === state.conversation?.id,
    open: () => { void presenter.openHistoryEntry(entry.id); },
    remove: () => { void presenter.deleteConversation(entry.id); },
  });
  const conversationHistoryRow = (conversation: Conversation, state: PresenterState): HistoryRowSource => {
    const source = conversationSource(conversation);
    return {
      id: conversation.id,
      title: conversationLabel(conversation, state.conversations),
      paperTitle: conversation.paperIdentity?.title ?? '',
      preview: conversation.messages.at(-1)?.text ?? '',
      status: historyStatus(conversation),
      updatedAt: conversation.updatedAt || conversation.createdAt,
      ...(source !== undefined ? { source } : {}),
      current: conversation.id === state.conversation?.id,
      open: () => { void presenter.openConversation(conversation.id); },
      remove: () => { void presenter.deleteConversation(conversation.id); },
    };
  };
  /**
   * Both history paths render through the same row shape and differ only in their source. Neither
   * partitions any more: a stored `archivedAt` is not a scope, so every chat is an ordinary row.
   */
  /**
   * History rows are rebuilt wholesale, so removing the row that holds focus would otherwise drop
   * the owner's keyboard position to the page body. Snapshot the focused row (and which control on
   * it) before the rebuild, restore the scroll offset, then put focus on the same control of the row
   * that now occupies its slot — or on the search field when the list is empty.
   */
  const historyFocusSnapshot = (): { index: number; action: string | null } | null => {
    const active = doc.activeElement as HTMLElement | null;
    if (!active || !historyList.contains(active)) return null;
    const index = [...historyList.querySelectorAll<HTMLElement>('.zchatgpt-history-row')].findIndex(row => row.contains(active));
    return index < 0 ? null : { index, action: active.dataset.zchatgptAction ?? null };
  };
  const restoreHistoryFocus = (snapshot: { index: number; action: string | null }) => {
    const rows = [...historyList.querySelectorAll<HTMLElement>('.zchatgpt-history-row')];
    const row = rows[Math.min(snapshot.index, rows.length - 1)];
    const control = snapshot.action
      ? row?.querySelector<HTMLElement>(`[data-zchatgpt-action="${snapshot.action}"]`)
      : row?.querySelector<HTMLElement>('.zchatgpt-history-item');
    (control ?? row ?? historySearch).focus();
  };
  const renderHistory = (state: PresenterState) => {
    const scrollTop = historyList.scrollTop;
    const focus = historyFocusSnapshot();
    const rows = state.workspace
      ? newestFirst(state.history).map(entry => workspaceHistoryRow(entry, state))
      : newestFirst(state.conversations).map(conversation => conversationHistoryRow(conversation, state));
    const sections = groupHistory(rows, row => row.updatedAt);
    const nodes: HTMLElement[] = [];
    for (const { bucket, items } of sections) {
      const group = el('div', 'zchatgpt-history-group');
      group.dataset.zchatgptHistoryGroup = bucket;
      group.append(el('div', 'zchatgpt-history-heading', HISTORY_BUCKET_LABELS[bucket]));
      for (const row of items) group.append(historyRow(row));
      nodes.push(group);
    }
    historyList.replaceChildren(...(nodes.length ? nodes : [el('p', 'zchatgpt-history-empty', COPY.noSavedChats)]));
    // A row menu whose row is gone must not survive the rebuild as an orphaned popover.
    if (historyMenuTarget && !historyMenuTarget.trigger.isConnected) closeHistoryRowMenu(false);
    // The presenter already filtered a workspace search (it also matches message text), so the
    // local row-label filter only runs for the host-list fallback.
    if (!state.workspace) applyHistoryFilter();
    historyList.scrollTop = scrollTop;
    if (focus) restoreHistoryFocus(focus);
  };
  /**
   * The row's own actions, in a popover anchored to its ellipsis trigger. One confirmation precedes
   * the removal, so a stray click cannot delete a chat; the copy states that only the local record
   * is removed. Selecting a row and acting on it are separate events: a menu row never opens the
   * conversation, and Escape closes the menu and returns focus to its trigger.
   */
  const historyMenu = el('div', 'zchatgpt-history-menu');
  historyMenu.id = `${viewId}-history-menu`;
  historyMenu.dataset.zchatgptHistoryMenu = '';
  historyMenu.hidden = true;
  historyMenu.setAttribute('role', 'dialog');
  historyMenu.setAttribute('aria-label', COPY.historyRowActions);
  // Escape belongs to the row menu, not to the panel behind it: it closes this popover and returns
  // focus to the trigger that opened it. The event stops here so closing the menu never also closes
  // the History panel.
  historyMenu.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault(); event.stopPropagation();
    closeHistoryRowMenu(true);
  });
  historyPanel.append(historyMenu);
  let historyMenuTarget: { id: string; title: string; trigger: HTMLElement; index: number } | null = null;
  let historyMenuPending = false;
  let historyMenuBusy = false;
  /**
   * Put focus back after the menu's own row left the DOM: the row that took its slot, then the rows
   * above it, then the search field. Focus must never fall to the page body.
   */
  function refocusAfterHistoryDelete(): void {
    const rows = [...historyList.querySelectorAll<HTMLElement>('.zchatgpt-history-row')];
    const start = Math.min(Math.max(historyMenuTarget?.index ?? 0, 0), Math.max(rows.length - 1, 0));
    for (const row of [...rows.slice(start), ...rows.slice(0, start).reverse()]) {
      const button = row.querySelector<HTMLElement>('[data-zchatgpt-action="history-row-menu"]');
      if (button && button.isConnected) { button.focus(); return; }
    }
    historySearch.focus();
  }
  function closeHistoryRowMenu(restoreFocus = false): void {
    if (historyMenu.hidden) return;
    const trigger = historyMenuTarget?.trigger;
    historyMenu.hidden = true;
    historyMenuTarget = null;
    historyMenuPending = false;
    historyMenuBusy = false;
    if (trigger) { trigger.setAttribute('aria-expanded', 'false'); if (restoreFocus && trigger.isConnected) trigger.focus(); }
  }
  function renderHistoryRowMenu(): void {
    const target = historyMenuTarget;
    if (!target) { historyMenu.replaceChildren(); return; }
    if (!historyMenuPending) {
      const remove = el('button', 'zchatgpt-more-row zchatgpt-history-menu-delete');
      remove.type = 'button';
      remove.dataset.zchatgptAction = 'delete-conversation';
      remove.textContent = COPY.deleteLocalConversation;
      remove.setAttribute('data-zchatgpt-ui', 'true');
      remove.disabled = historyMenuBusy;
      remove.addEventListener('click', () => { historyMenuPending = true; renderHistoryRowMenu(); focusMenu(historyMenu); });
      historyMenu.replaceChildren(remove);
      return;
    }
    const text = el('p', 'zchatgpt-history-menu-confirm', COPY.deleteLocalConfirm);
    text.setAttribute('data-zchatgpt-ui', 'true');
    const confirm = el('button', 'zchatgpt-more-row zchatgpt-history-menu-delete');
    confirm.type = 'button';
    confirm.dataset.zchatgptAction = 'confirm-delete-conversation';
    confirm.textContent = COPY.deleteLocalConfirmAction;
    confirm.setAttribute('data-zchatgpt-ui', 'true');
    confirm.disabled = historyMenuBusy;
    const cancel = el('button', 'zchatgpt-more-row');
    cancel.type = 'button';
    cancel.dataset.zchatgptAction = 'cancel-delete-conversation';
    cancel.textContent = COPY.cancelDeleteLocal;
    cancel.setAttribute('data-zchatgpt-ui', 'true');
    cancel.disabled = historyMenuBusy;
    cancel.addEventListener('click', () => { historyMenuPending = false; renderHistoryRowMenu(); focusMenu(historyMenu); });
    confirm.addEventListener('click', () => {
      const id = historyMenuTarget?.id;
      if (!id || historyMenuBusy) return;
      historyMenuBusy = true;
      confirm.disabled = true; cancel.disabled = true;
      // The presenter owns refusal and failure reporting; the row stays on screen until the store
      // really dropped it, and a refused delete keeps the record with its reason.
      void presenter.deleteConversation(id).finally(() => {
        historyMenuBusy = false;
        // The trigger is gone once the store dropped the row, so focus moves to the row that took
        // its place (or the search field); it never falls through to the page body.
        if (historyMenuTarget?.trigger.isConnected) historyMenuTarget.trigger.focus();
        else refocusAfterHistoryDelete();
        closeHistoryRowMenu(false);
      });
    });
    historyMenu.replaceChildren(text, confirm, cancel);
  }
  function openHistoryRowMenu(source: HistoryRowSource, trigger: HTMLElement): void {
    if (!source.remove) return;
    const rows = [...historyList.querySelectorAll<HTMLElement>('.zchatgpt-history-row')];
    historyMenuTarget = { id: source.id, title: source.title, trigger, index: Math.max(rows.indexOf(trigger.closest<HTMLElement>('.zchatgpt-history-row')!), 0) };
    historyMenuPending = false;
    historyMenuBusy = false;
    renderHistoryRowMenu();
    historyMenu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    // Anchor under the trigger, clamped into the panel so a row near the bottom never pushes the
    // menu off the dock.
    const panel = historyPanel.getBoundingClientRect();
    const rect = trigger.getBoundingClientRect();
    const top = Math.max(4, Math.min(rect.bottom - panel.top + 4, panel.height - 12));
    historyMenu.style.top = `${top}px`;
    historyMenu.style.left = `${Math.max(4, rect.left - panel.left)}px`;
    focusMenu(historyMenu);
  }
  const renderPicker = (state: PresenterState, signedIn: boolean) => {
    const models = state.runtime?.models ?? [];
    const selectedSettings = state.draft.settings ?? state.conversation?.settings ?? null;
    const allowedIds = enforcedAllowedModelIds(state.workspace?.allowedModels);
    const current = selectedSettings && models.length ? alignSettings(models, selectedSettings, allowedIds) : selectedSettings;
    const controls = composerControls(models, current, allowedIds);
    const selected = current ? models.find(entry => entry.id === current.model) : undefined;
    const fast = resolveFastTier(selected);
    /**
     * Codex keeps this menu open so effort, speed and model are configured in one visit; only the
     * picker button, an outside click or Escape closes it. The re-render replaces the rows, so the
     * chosen row is focused again to keep keyboard navigation where the owner left it.
     */
    const keepPicker = (field: string, value: string) => {
      const rows = [...menu.querySelectorAll<HTMLButtonElement>(`[data-zchatgpt-setting="${field}"]`)];
      rows.find(row => row.dataset.zchatgptValue === value)?.focus();
    };
    const effortCtl = controls.find(entry => entry.field === 'effort');
    const modelCtl = controls.find(entry => entry.field === 'model');
    const effortValue = current?.effort || selected?.defaultReasoningEffort || '';
    const sections: HTMLElement[] = [];
    const effortSection = el('div', 'zchatgpt-picker-section');
    effortSection.dataset.zchatgptPickerSection = 'effort';
    effortSection.append(el('div', 'zchatgpt-picker-heading', COPY.effort));
    for (const option of effortCtl?.options.filter(entry => entry.value) ?? []) {
      const row = el('button', 'zchatgpt-picker-option');
      row.type = 'button';
      row.dataset.zchatgptSetting = 'effort';
      row.dataset.zchatgptValue = option.value;
      row.setAttribute('role', 'menuitemradio');
      const checked = option.value === effortValue;
      row.setAttribute('aria-checked', String(checked));
      row.append(el('span', 'zchatgpt-picker-option-label', effortLabel(option.value)));
      if (checked) row.append(icon('check'));
      row.disabled = !signedIn || !!effortCtl?.disabled;
      row.addEventListener('click', () => {
        const latest = presenter.snapshot();
        const settings = latest.draft.settings ?? latest.conversation?.settings;
        if (!settings) return;
        presenter.setSettings(applyComposerChoice(latest.runtime?.models ?? [], settings, 'effort', option.value, enforcedAllowedModelIds(latest.workspace?.allowedModels)));
        keepPicker('effort', option.value);
      });
      effortSection.append(row);
    }
    sections.push(effortSection);
    if (fast) {
      const optionsSection = el('div', 'zchatgpt-picker-section');
      optionsSection.dataset.zchatgptPickerSection = 'options';
      optionsSection.append(el('div', 'zchatgpt-picker-heading', COPY.options));
      const row = el('div', 'zchatgpt-picker-toggle-row');
      row.append(el('span', 'zchatgpt-picker-option-label', COPY.fast));
      const toggle = el('button', 'zchatgpt-switch');
      toggle.type = 'button';
      toggle.dataset.zchatgptSetting = 'speed';
      toggle.setAttribute('role', 'switch');
      toggle.setAttribute('aria-label', COPY.fast);
      const on = current?.serviceTier === fast.id;
      toggle.setAttribute('aria-checked', String(on));
      toggle.disabled = !signedIn;
      toggle.addEventListener('click', event => {
        event.stopPropagation();
        const latest = presenter.snapshot();
        const settings = latest.draft.settings ?? latest.conversation?.settings;
        if (!settings) return;
        presenter.setSettings(applyComposerChoice(latest.runtime?.models ?? [], settings, 'speed', on ? '' : fast.id, enforcedAllowedModelIds(latest.workspace?.allowedModels)));
        menu.querySelector<HTMLButtonElement>('[data-zchatgpt-setting="speed"]')?.focus();
      });
      row.append(toggle);
      optionsSection.append(row);
      sections.push(optionsSection);
    }
    const modelSection = el('div', 'zchatgpt-picker-section');
    modelSection.dataset.zchatgptPickerSection = 'model';
    modelSection.append(el('div', 'zchatgpt-picker-heading', COPY.model));
    for (const option of modelCtl?.options ?? []) {
      const row = el('button', 'zchatgpt-picker-option');
      row.type = 'button';
      row.dataset.zchatgptSetting = 'model';
      row.dataset.zchatgptValue = option.value;
      row.setAttribute('role', 'menuitemradio');
      const checked = option.value === (current?.model ?? '');
      row.setAttribute('aria-checked', String(checked));
      row.append(el('span', 'zchatgpt-picker-option-label', option.label));
      if (checked) row.append(icon('check'));
      row.disabled = !signedIn || !!modelCtl?.disabled;
      row.addEventListener('click', () => {
        const latest = presenter.snapshot();
        const settings = latest.draft.settings ?? latest.conversation?.settings;
        if (!settings) return;
        presenter.setSettings(applyComposerChoice(latest.runtime?.models ?? [], settings, 'model', option.value, enforcedAllowedModelIds(latest.workspace?.allowedModels)));
        keepPicker('model', option.value);
      });
      modelSection.append(row);
    }
    sections.push(modelSection);
    // Account usage moved here when the More menu went away: the model picker already reports the
    // account's own allowances, and rate limits are account data, not a chat setting. It renders as
    // its own section so it stays readable and is announced as text, never as a menu row.
    const quotas = state.runtime?.rateLimits;
    const accountSection = el('div', 'zchatgpt-picker-section');
    accountSection.dataset.zchatgptPickerSection = 'account';
    accountSection.append(el('div', 'zchatgpt-picker-heading', COPY.accountUsage));
    const usage = el('p', 'zchatgpt-account-usage');
    usage.dataset.zchatgptAccountUsage = '';
    usage.textContent = quotas ? quotas.map(quota => `${quota.label}: ${quota.usedPercent === null ? 'usage unknown' : `${quota.usedPercent}% used`}${quota.resetsAt === null ? '' : ` · resets ${new Date(quota.resetsAt * 1000).toLocaleString()}`}`).join('\n') || 'Account usage: no limits reported.' : 'Account usage: unavailable.';
    accountSection.append(usage);
    sections.push(accountSection);
    menu.replaceChildren(...sections);
  };
  const update = (state: PresenterState) => {
    latestViewState = state;
    paintTiming(state);
    // An open details panel follows the state even when the toolbar's own key did not change: a
    // longer local read or a new preparation error must not leave the panel claiming an old fact.
    renderContextDetails(state);
    /**
     * Chat mode with a host surface is the real ChatGPT application. The native surface stays mounted
     * (so a switch back rebuilds nothing) but is hidden; the common shell above it — including the
     * one mode switch and the context summary — stays visible in both modes.
     */
    const embedActive = !!hooks.chatEmbed && state.mode === 'chat';
    if (embedSection && embedSlot && embedNotice && embedContextNotice && embedBridgeStatus && hooks.chatEmbed) {
      root.dataset.zchatgptEmbedActive = String(embedActive);
      embedSection.hidden = !embedActive;
      chat.hidden = embedActive;
      // The official page owns its own conversation list and tabs, so the native tab strip is not
      // shown beside it; a single local paper binding stands in as the session title instead.
      panes.hidden = embedActive;
      shellTitle.hidden = !embedActive;
      // New/History act on the native local records, so they stay out of the hosted Chat bar rather
      // than pretending to belong to the official page's own new-chat and history controls.
      fresh.hidden = embedActive;
      historyBtn.hidden = embedActive;
      reloadRow.hidden = !embedActive;
      if (embedActive) {
        // The first-send scope disclosure is informational: it stays visible until the first send
        // attempt and never asks the owner to approve or acknowledge it in the sidebar.
        const disclosure = state.document.enabled && state.document.disclosure;
        embedContextNotice.hidden = !disclosure;
        const bridgeSaysSomething = !embedBridgeStatus.hidden && !!embedBridgeStatus.textContent?.trim();
        embedNotice.hidden = !disclosure && !bridgeSaysSomething;
        hooks.chatEmbed.show(embedSlot);
      } else {
        hooks.chatEmbed.hide();
      }
    }
    // Chat mode is the read-only surface: Agent-only affordances (approvals, ledger, reconciliation,
    // undo, annotation review) never appear, even if a stored conversation still carries tasks. The
    // tasks stay only in presenter state; the view simply does not render them (invariants 3 and 4).
    const agentMode = state.mode === 'agent';
    const visibleTasks = agentMode ? state.tasks : [];
    const uiLanguage = state.workspace?.uiLanguage ?? 'en';
    if (lastLanguage !== uiLanguage) { lastLanguage = uiLanguage; localizer.update(uiLanguage); }
    // Only a pending Agent explanation waits for approval. Hosted Chat's pre-send scope notice is
    // informational and lives beside the official composer.
    scopeNotice.hidden = !state.pendingExplain;
    acknowledgeScope.hidden = !state.pendingExplain;
    if (state.workspace) {
      if (!workspaceView) workspaceView = mountWorkspaceView({ input, context: composerContext }, {
        searchReferences: (query, kind, signal) => presenter.searchReferences(query, kind, signal), previewReference: (reference, signal) => presenter.previewReference(reference, signal),
        addReference: async reference => { await presenter.addReference(reference); }, removeReference: async id => { await presenter.removeReference(id); },
        selectSkill: id => presenter.selectSkill(id),
        setReferenceRange: (id, range) => presenter.setReferenceRange(id, range),
      });
      const nextDraftKey = `${state.draft.references.map(reference => `${reference.id}:${reference.range?.join('-') ?? ''}:${reference.capturedAt}`).join(',')}:${state.draft.skillId}:${state.draft.profileId}`;
      if (lastWorkspace !== state.workspace || nextDraftKey !== workspaceDraftKey) {
        lastWorkspace = state.workspace; workspaceDraftKey = nextDraftKey;
        workspaceView.update({ settings: state.workspace, draft: { references: state.draft.references, skillId: state.draft.skillId, profileId: state.draft.profileId } });
      }
      applyChatTextScale(root, state.workspace.textScale);
      const acquire = state.workspace.skills.find(skill => skill.id === state.draft.skillId)?.workflow === 'acquire';
      // The collection target is an Agent affordance: it is only shown when the acquire workflow is
      // actually runnable in this chat, i.e. in Agent mode.
      acquisition.hidden = !acquire || !agentMode;
      if (acquire && !requestedCollections) { requestedCollections = true; void presenter.collections().catch(() => { requestedCollections = false; reportViewMessage(COPY.collectionsFailed); }); }
      const collectionKey = JSON.stringify(state.collectionOptions);
      if (collection.dataset.options !== collectionKey) {
        collection.dataset.options = collectionKey; const empty = el('option', '', 'Choose a collection…'); empty.value = '';
        collection.replaceChildren(empty, ...state.collectionOptions.map(item => { const option = el('option', '', item.name); option.value = `${item.libraryId}:${item.collectionKey}`; return option; }));
      }
      collection.value = state.acquisitionTarget ? `${state.acquisitionTarget.libraryId}:${state.acquisitionTarget.collectionKey}` : '';
    }
    const nextTasks = `${state.mode}/${visibleTasks.map(task => `${task.id}:${task.revision}`).join(',')}/${state.readingJobs.map(job => `${job.id}:${job.revision}`).join(',')}`;
    if (nextTasks !== tasksKey) { tasksKey = nextTasks; taskView.update({ tasks: visibleTasks, readingJobs: state.readingJobs }); }
    const list = transcriptOf(state.conversation, state.messageFocus?.messageId ?? null);
    const nextChrome = [
      state.connection, state.runtime?.revision ?? 0, state.runtime?.account.state ?? '', state.runtime?.login?.state ?? '',
      state.generating, state.message ?? '', state.mode, state.chatUnavailable ?? '', state.conversation?.id ?? '', state.conversation?.lastSeq ?? 0,
      state.conversation?.activeRequestId ?? '', state.conversations.map(c => `${c.id}:${c.title}:${c.updatedAt}:${c.messages.length}:${c.activeRequestId ?? ''}`).join('\n'),
      state.openConversations.map(c => `${c.id}:${c.title}:${c.lastSeq}:${c.activeRequestId ?? ''}`).join('\n'),
      state.draft.citations.map(c => c.id).join('\n'), state.draft.images.map(image => image.id).join('\n'), JSON.stringify(state.draft.settings), state.focusToken,
      state.draft.question.trim().length > 0,
      state.history.map(item => `${item.id}:${item.title}:${item.updatedAt}:${item.preview}`).join('\n'), state.tasks.map(task => `${task.id}:${task.revision}`).join(','), state.readingJobs.map(job => `${job.id}:${job.revision}`).join(','), state.queueing, state.conversation?.queuedRequestIds?.join(','), state.messageFocus?.token,
      list.map(m => `${m.id}:${m.status}:${m.action ?? ''}:${m.text.length}:${m.images?.map(image => image.id).join(',') ?? ''}:${m.generatedImages?.map(image => image.id).join(',') ?? ''}`).join('\n'),
      (state.conversation?.requestTiming ?? []).map(timing => `${timing.requestId}:${timing.acceptedAt}`).join(','),
      state.workspace?.uiLanguage ?? 'en',
      // The paper actions read the frozen identity to decide whether there is anything to copy, so a
      // change of attachment must repaint them even when nothing else in the chrome moved.
      `${state.document.identity.itemType ?? ''}:${state.document.identity.authors.length}:${state.document.identity.year ?? ''}:${state.document.identity.doi ?? ''}:${state.document.identity.publicationTitle ?? ''}:${state.document.identity.abstractNote?.length ?? 0}`,
    ].join('\0');
    if (nextChrome === chromeKey) {
      if (!composing && input.value !== state.draft.question) { input.value = state.draft.question; resizeInput(); }
      return;
    }
    chromeKey = nextChrome;
    renderMode(state);
    paintPaperActions(state);
    const account = state.runtime?.account.state ?? 'signedOut';
    const pendingLogin = state.runtime?.login?.state === 'pending';
    // `agentMode` is already derived above for the Agent-only task surface. Sign-in and the Codex
    // connection are Agent-only chrome too: in Chat mode the sidebar reports the Chat transport's own
    // state, so selecting Chat never renders (or triggers) Agent readiness.
    chat.dataset.zchatgptRuntime = state.connection; chat.dataset.zchatgptAuth = account; chat.dataset.zchatgptGenerating = String(state.generating);
    chat.dataset.zchatgptConversation = state.conversation?.id ?? ''; chat.dataset.zchatgptActiveRequest = state.conversation?.activeRequestId ?? '';
    status.textContent = state.connection === 'error' ? STATUS_LINE.error
      : state.connection === 'starting' ? STATUS_LINE.starting
        : !agentMode ? (state.chatUnavailable ? COPY.chatUnavailable : state.generating ? STATUS_LINE.generating : '')
          : state.connection === 'idle' ? STATUS_LINE.idle
            : pendingLogin ? STATUS_LINE.pendingLogin : account === 'signedIn' ? (state.generating ? STATUS_LINE.generating : '') : STATUS_LINE.signedOut;
    status.hidden = !status.textContent;
    login.hidden = !agentMode || account === 'signedIn' || pendingLogin || state.connection !== 'ready'; cancelLogin.hidden = !agentMode || !pendingLogin;
    retry.hidden = !agentMode || state.connection !== 'error';
    auth.hidden = login.hidden && cancelLogin.hidden && retry.hidden;
    // The `+` starts a native chat and stays available in every native state, including right after
    // a close: tying it to having a current conversation is the regression that hid it with the chat.
    // While the hosted Chat page is active it is hidden above, because that page owns new/history.
    fresh.hidden = embedActive;
    historyBtn.hidden = embedActive;
    // The single-line binding title shown while the hosted page owns the conversation.
    const shellTitleText = state.document.identity.title || state.document.attachment.title || COPY.untitled;
    if (shellTitle.textContent !== shellTitleText) shellTitle.textContent = shellTitleText;
    if (shellTitle.title !== shellTitleText) shellTitle.title = shellTitleText;
    alert.textContent = state.message ?? ''; alert.hidden = !state.message;
    updateContext(state);
    renderPanes(state);
    const historyKey = state.workspace ? JSON.stringify([state.history, state.historyQuery]) : state.conversations.map(c => `${c.id}:${c.title}:${c.createdAt}:${c.updatedAt}:${c.messages.length}:${c.activeRequestId ?? ''}:${c.id === state.conversation?.id ? '1' : '0'}`).join('\n');
    if (historyList.dataset.options !== historyKey) {
      historyList.dataset.options = historyKey;
      renderHistory(state);
    }
    const nearBottom = isNearBottom();
    const conversationChanged = renderedConversationId !== (state.conversation?.id ?? null);
    if (conversationChanged) {
      renderedConversationId = state.conversation?.id ?? null;
      messageNodes.clear(); renderedMessages.clear(); messages.replaceChildren(); contentKey = ''; hasNewContent = false;
    }
    const ids = new Set(list.map(message => message.id));
    for (const [id, node] of messageNodes) {
      if (!ids.has(id)) { node.remove(); messageNodes.delete(id); renderedMessages.delete(id); }
    }
    let cursor = messages.firstElementChild;
    for (const message of list) {
      let node = messageNodes.get(message.id);
      if (!node) { node = messageNode(message); messageNodes.set(message.id, node); }
      if (node !== cursor) messages.insertBefore(node, cursor);
      cursor = node.nextElementSibling;
    }
    // Centered timestamp dividers, one per calendar-day group. The transcript persists no per-message
    // clock, so the only honest source is the request's recorded `acceptedAt`; a message whose request
    // has no readable timing gets no divider rather than an invented time.
    const timings = new Map((state.conversation?.requestTiming ?? []).map(timing => [timing.requestId, timing.acceptedAt]));
    const timeLocale = state.workspace?.uiLanguage ?? 'en';
    const now = Date.now();
    const dividers: Array<{ before: string; label: string }> = [];
    let lastDay = '';
    for (const message of list) {
      const acceptedAt = timings.get(message.requestId);
      if (!acceptedAt) continue;
      const parsed = Date.parse(acceptedAt);
      if (!Number.isFinite(parsed)) continue;
      const day = new Date(parsed).toDateString();
      if (day === lastDay) continue;
      lastDay = day;
      const label = messageTimeLabel(acceptedAt, now, timeLocale);
      if (label) dividers.push({ before: message.id, label });
    }
    const dividerKey = `${timeLocale}\n${dividers.map(entry => `${entry.before}:${entry.label}`).join('\n')}`;
    if (conversationChanged || dividerKey !== messageTimeKey) {
      messageTimeKey = dividerKey;
      for (const node of [...messages.querySelectorAll<HTMLElement>('[data-zchatgpt-message-time]')]) node.remove();
      for (const divider of dividers) {
        const target = messageNodes.get(divider.before);
        if (!target) continue;
        const node = el('div', 'zchatgpt-message-time', divider.label);
        node.dataset.zchatgptMessageTime = '';
        messages.insertBefore(node, target);
      }
    }
    if (messages.lastElementChild !== taskPanel) messages.append(taskPanel);
    taskPanel.hidden = !visibleTasks.length && !state.readingJobs.length;
    // Agent's empty state is shown only while the surface really is empty: no transcript, no task
    // card, no draft work and nothing generating. It never covers an answer or an in-flight request.
    const hasDraftWork = !!state.draft.question.trim() || state.draft.citations.length > 0
      || state.draft.images.length > 0 || state.draft.references.length > 0;
    empty.hidden = !(agentMode && list.length === 0 && !state.generating && !visibleTasks.length && !state.readingJobs.length && !hasDraftWork);
    if (empty.hidden) { emptyNote.hidden = true; emptyNote.textContent = ''; }
    const nextKey = list.map(m => `${m.id}:${m.status}:${m.action ?? ''}:${m.text.length}:${m.generatedImages?.map(image => image.id).join(',') ?? ''}`).join('\n');
    const contentChanged = nextKey !== contentKey;
    const follow = followAnswerScroll(nearBottom, contentChanged && contentKey !== '');
    contentKey = nextKey;
    const editableView: RenderView = {
      conversation: state.conversation,
      models: state.runtime?.models ?? [],
      tasks: visibleTasks,
      queued: state.conversation?.queuedRequestIds ? new Set(state.conversation.queuedRequestIds) : null,
    };
    for (const message of list) {
      const node = messageNodes.get(message.id); if (!node) continue;
      node.dataset.status = message.status;
      paintBody(node, message, renderedMessages, editableView);
      paintActions(node, message, editableView);
    }
    if (conversationChanged) { messages.scrollTop = state.scrollTop || messages.scrollHeight; hasNewContent = false; }
    else if (contentChanged && follow.stick) {
      messages.scrollTop = messages.scrollHeight; hasNewContent = false;
    } else if (follow.showNewContent) hasNewContent = true;
    sticking = conversationChanged ? isNearBottom() : follow.stick;
    newContent.hidden = !hasNewContent;
    const draftIds = state.draft.citations.map(c => c.id).join('\n');
    if (draftCitations.dataset.rendered !== draftIds) { draftCitations.dataset.rendered = draftIds; draftCitations.replaceChildren(...state.draft.citations.map(c => citationCard(c, true))); }
    const imageIds = state.draft.images.map(image => image.id).join('\n');
    if (draftImages.dataset.rendered !== imageIds) {
      draftImages.dataset.rendered = imageIds;
      draftImages.replaceChildren(...state.draft.images.map(image => {
        const chip = el('div', 'zchatgpt-draft-image');
        chip.dataset.zchatgptDraftImage = image.id;
        const thumb = el('img', 'zchatgpt-draft-thumb');
        thumb.setAttribute('src', image.dataUrl);
        thumb.setAttribute('alt', image.name);
        const open = button('Preview image', 'preview-image', () => previewImage(image, open)); open.replaceChildren(thumb);
        chip.append(open, button('Move image earlier', 'move-image-earlier', () => { presenter.moveImage(image.id, -1); }, 'source'), button(COPY.remove, 'remove-image', () => { presenter.removeImage(image.id); }, 'remove'));
        return chip;
      }));
    }
    if (!composing && input.value !== state.draft.question) { input.value = state.draft.question; resizeInput(); }
    const signedIn = account === 'signedIn' && state.connection === 'ready';
    const pickerKey = `${JSON.stringify(state.draft.settings ?? state.conversation?.settings ?? null)}\n${JSON.stringify(state.workspace?.allowedModels ?? null)}\n${state.runtime?.models.map(entry => entry.id).join(',')}\n${signedIn}\n${JSON.stringify(state.runtime?.rateLimits ?? null)}`;
    if (menu.dataset.rendered !== pickerKey) {
      menu.dataset.rendered = pickerKey;
      renderPicker(state, signedIn);
    }
    const summary = modelChipLabel(state.draft.settings ?? state.conversation?.settings ?? null, state.runtime?.models ?? [], enforcedAllowedModelIds(state.workspace?.allowedModels));
    if (picker.dataset.summary !== summary) {
      picker.dataset.summary = summary;
      picker.replaceChildren(doc.createTextNode(summary));
    }
    picker.disabled = !signedIn;
    const usage = currentContextUsage(state.draft.settings?.model ?? state.conversation?.settings.model, state.conversation?.usage);
    contextRing.update(usage);
    // The ring's details are the only renderer of `state.contextReport`; they are rebuilt only when
    // the report changes, and cleared to null on a new chat so nothing is invented before a request.
    const reportKey = state.contextReport ? JSON.stringify(state.contextReport) : null;
    if (reportKey !== contextReportKey) { contextReportKey = reportKey; contextRing.report(state.contextReport ? contextDetailNodes(doc, state.contextReport) : null); }
    const hasInput = state.draft.question.trim().length > 0;
    // Chat's send lock is the Chat transport, not the Codex sign-in; Agent's is the ChatGPT account.
    const canSend = state.connection === 'ready' && !state.generating && hasInput && (agentMode ? signedIn : !state.chatUnavailable);
    send.disabled = !canSend; send.hidden = state.generating; stop.hidden = !state.generating;
    // A disabled control says why, so the owner is never left with only a grey arrow.
    const sendReason = hasInput
      ? (state.connection !== 'ready' ? COPY.sendNeedsConnection : agentMode && !signedIn ? COPY.sendNeedsSignIn : !agentMode && state.chatUnavailable ? state.chatUnavailable : null)
      : COPY.sendNeedsQuestion;
    // One label only: the reason is a dictionary string, so it localizes; the enabled label is Send.
    const sendLabel = send.disabled && sendReason ? sendReason : COPY.send;
    if (send.title !== sendLabel) { send.title = sendLabel; send.setAttribute('aria-label', sendLabel); }
    queue.hidden = !state.generating; queue.disabled = !canSend || state.queueing;
    input.disabled = false;
    if (input.title !== COPY.inputKeys) input.title = COPY.inputKeys;
    const settingsReason = signedIn ? COPY.settings : COPY.settingsNeedsSignIn;
    if (picker.title !== settingsReason) { picker.title = settingsReason; picker.setAttribute('aria-label', settingsReason); }
    if (state.focusToken !== focusToken) { focusToken = state.focusToken; input.focus(); }
    if (state.messageFocus && messages.dataset.focusToken !== String(state.messageFocus.token)) { messages.dataset.focusToken = String(state.messageFocus.token); messageNodes.get(state.messageFocus.messageId)?.scrollIntoView?.({ block: 'center' }); }
  };
  const unbind = presenter.bind(update);
  return () => {
    disposedView = true;
    hooks.chatEmbed?.hide();
    presenter.setScrollTop(messages.scrollTop); unbindZoom(); unbind(); workspaceView?.dispose(); taskView.dispose(); localizer.dispose(); clearTimingInterval();
    doc.removeEventListener('click', onDocumentClick);
    doc.removeEventListener('keydown', onDocumentKey);
    for (const target of pasteDocuments) target.removeEventListener('paste', onPaste, true);
    pasteWindow?.removeEventListener('paste', onPaste, true);
    chat.remove();
    embedSection?.remove();
  };
}
