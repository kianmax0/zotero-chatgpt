import { mountChatView, renderReaderShell } from './chat/view.ts';
import { ConversationPresenter, type PresenterAgent } from './chat/presenter.ts';
import { offeredModels } from './chat/generation-settings.ts';
import { acquireChatSurface, createChatEmbedSurface, type ChatEmbedSurface } from './chat/embed.ts';
import { dispatchSelectionAction, prepareOfficialChatContext } from './chat/official-chat.ts';
import { installOfficialChatResource, OFFICIAL_CHAT_RESOURCE_ROOT, registerOfficialChatActor, removeOfficialChatResource, unregisterOfficialChatActor } from './chat/official-chat-actor.ts';
import { parseOfficialConversationStore, rememberOfficialConversation } from './chat/official-chat-history.ts';
import { createAgentRuntime, type AgentRuntime } from './runtime/agent-runtime.ts';
import { createLocalServices, openLocalStorage } from './runtime/local-services.ts';
import { runtimePaths } from './runtime/prepare.ts';
import { createGeneratedImageLoader } from './runtime/generated-image.ts';
import { createReaderClient } from '../../core/src/index.ts';
import { CHAT_TRANSPORT_UNAVAILABLE_MESSAGE } from '../../core/src/chat/chat-transport.ts';
import { reconcileLibraryOrganization, runLibraryOrganization } from '../../core/src/library/organization.ts';
import { enforcedAllowedModelIds } from '../../core/src/workspace/allowed-models.ts';
import { selectionBrief } from '../../core/src/chat/document-brief.ts';
import { copyFileToClipboard } from './chat/clipboard-file.ts';
import type { ReaderClient } from '../../contracts/src/runtime.ts';
import { PINNED_RUNTIME } from '../../../runtime/manifest.ts';
import { geckoHost } from './runtime/gecko.ts';
import { injectReaderStyles } from './reader/dock.ts';
import { NativeReaderPane, currentReaderZoom, zoomReader } from './reader/reader-pane.ts';
import { createToolbarButton, insertToolbarButton } from './reader/toolbar.ts';
import { captureSelection, freezeCitationVersion, openCitation, paperIdentityFor, paperMetadata, type SelectionPopupEvent } from './reader/selection.ts';
import { attachmentIdentity, nativeDocumentServices, paperScope, readerContextFor, type AttachmentIdentity } from './reader/context.ts';
import { SelectionActionBar } from './reader/selection-actions.ts';
import { nativeDocumentSource, ReaderDocumentCache } from './reader/document.ts';
import { nativeSourceNavigator, openSourcePage } from './reader/source-highlight.ts';
import { installKatexResource, KATEX_STYLESHEET, removeKatexResource } from './reader/katex-resource.ts';
import type { HostReader, ToolbarEvent, ZoteroHost, ZoteroWindow } from './reader/host-types.ts';
import { createPreferencesService } from './preferences/service.ts';
import { createPreferencePaneRegistrar, type PreferencePaneRegistrar } from './preferences/registration.ts';
import { createFileActions, type LibraryFileActions } from './actions/files.ts';
import { createLibraryReferencePort, type LibraryWindow } from './library/reference.ts';
import { mountLibraryAgentEntry } from './views/library-agent-entry.ts';
import { ReaderError, paperId, type Citation, type PaperScope } from '../../contracts/src/index.ts';
declare const Zotero: ZoteroHost;
declare const crypto: { randomUUID(): string };
export interface PluginContext { rootURI: string; pluginID: string; version?: string }
interface ReaderEntry { pane: NativeReaderPane; buttons: Set<HTMLButtonElement>; bar: SelectionActionBar; latestSelectionId?: string; latestCitation?: Citation; stagedOfficialSelection?: string }
const CLIENT_ID_PREF = 'extensions.zchatgpt.clientId';
const LIBRARY_AGENT_SESSION_PREF = 'extensions.zchatgpt.libraryAgentSessionId';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
let context: PluginContext | undefined;
let paneID = '';
let active = false;
let notifierID: string | undefined;
/**
 * The Codex process owner. It is constructed at startup but does no work: `prepareRuntime`, spawn and
 * the protocol handshake only happen when `connection()` is called, which only Agent actions do.
 */
let agent: AgentRuntime | undefined;
/**
 * The one shared reader client. Built from local storage; its construction performs no Codex work.
 */
let clientPromise: Promise<ReaderClient> | null = null;
let client: ReaderClient | null = null;
/**
 * One hosted surface per paper per main window. Each paper owns its ChatGPT draft, streaming turn and
 * official `/c/…` history independently; inactive surfaces park without unloading.
 */
const chatSurfaces = new Map<ZoteroWindow, Map<string, ChatEmbedSurface>>();
function chatSurface(win: ZoteroWindow, binding: string): ChatEmbedSurface | null {
  let surfaces = chatSurfaces.get(win);
  if (!surfaces) { surfaces = new Map(); chatSurfaces.set(win, surfaces); }
  return acquireChatSurface(surfaces, binding, () => createChatEmbedSurface(win));
}
function showChatSurface(win: ZoteroWindow, binding: string, surface: ChatEmbedSurface, anchor: Element, frame: Element | null): void {
  for (const [key, other] of chatSurfaces.get(win) ?? []) if (key !== binding) other.hide();
  surface.show(anchor, frame);
}
let documentCache: ReaderDocumentCache | undefined;
let localServices: ReturnType<typeof createLocalServices> | undefined;
let preferencePanes: PreferencePaneRegistrar | undefined;
let officialChatActorRegistered = false;
let officialChatResourceInstalled = false;
let katexResourceInstalled = false;
/** Small, JSON-only surface the Preferences window script may call; see preferences/entry.ts. */
interface PreferencesBridgeHost {
  ZoteroChatGPTPreferencesHost?: unknown;
  ZoteroChatGPTPreferencesPane?: unknown;
}
function preferencesBridge(): PreferencesBridgeHost { return Zotero as ZoteroHost & PreferencesBridgeHost; }
const AUTO_PDF_PREF = 'extensions.zchatgpt.automaticPdfText';
const PDF_DISCLOSURE_PREF = 'extensions.zchatgpt.pdfTextDisclosureSeen';
const OFFICIAL_CHAT_URLS_PREF = 'extensions.zchatgpt.officialChatConversationURLs';
const readers = new Map<HostReader, ReaderEntry>();
const windows = new Map<ZoteroWindow, () => void>();
const libraryAgentEntries = new Map<ZoteroWindow, () => void>();
/** Presenters outlive views: drafts and conversation copies stay while a sidebar is closed. */
const presenters = new Map<string, ConversationPresenter>();
const citationVersions = new WeakMap<Citation, Promise<Citation>>();

function officialConversationURL(binding: string): string | null {
  const stored = parseOfficialConversationStore(Zotero.Prefs.get(OFFICIAL_CHAT_URLS_PREF, true));
  return stored[binding]?.url ?? null;
}
function rememberOfficialConversationURL(binding: string, url: string): void {
  const stored = parseOfficialConversationStore(Zotero.Prefs.get(OFFICIAL_CHAT_URLS_PREF, true));
  const next = rememberOfficialConversation(stored, binding, url, new Date().toISOString());
  Zotero.Prefs.set(OFFICIAL_CHAT_URLS_PREF, JSON.stringify(next), true);
}

/** Persistent random namespace of this Zotero profile; it never changes across restarts or upgrades. */
function clientId(): string {
  const existing = Zotero.Prefs.get(CLIENT_ID_PREF, true);
  if (typeof existing === 'string' && UUID.test(existing)) return existing;
  const fresh = crypto.randomUUID(); Zotero.Prefs.set(CLIENT_ID_PREF, fresh, true); return fresh;
}
/** Stable task-ledger scope for library actions; it is not a PDF attachment or conversation. */
function libraryAgentSessionId(): string {
  const existing = Zotero.Prefs.get(LIBRARY_AGENT_SESSION_PREF, true);
  if (typeof existing === 'string' && UUID.test(existing)) return existing;
  const fresh = crypto.randomUUID(); Zotero.Prefs.set(LIBRARY_AGENT_SESSION_PREF, fresh, true); return fresh;
}
/**
 * The one place the Agent capability is assembled. Task orchestration and multi-pass reading always
 * arrive together from the local services; grouping them here is what keeps the chat path from
 * reaching either of them except through this injected interface.
 */
function assembleAgent(services: ReturnType<typeof createLocalServices>): PresenterAgent {
  return { tasks: () => services.getTasks(), reading: client => services.getReading(client) };
}
/**
 * The composition root merges the read port with the file actions. The read side must not import
 * `actions/` (dependency-boundaries), so the two halves meet here: `library/reference.ts` keeps
 * search/read/open/capture and `actions/files.ts` owns the file picker and export. Both are
 * stateless, so assembling this per call is just object spread.
 */
function libraryPort(reader?: HostReader): ReturnType<typeof createLocalServices>['library'] & LibraryFileActions {
  if (!localServices) throw new Error('The local Zotero library is unavailable.');
  const id = clientId();
  const base = { ...localServices.library, ...createFileActions(Zotero, { clientId: id, uuid: () => crypto.randomUUID(), now: () => new Date().toISOString() }) };
  // Library selection belongs to the Zotero window that owns this reader. Capture it synchronously
  // there; a later foreground-window lookup could silently organize a different user's selection.
  if (!reader?._window || !documentCache) return base;
  const bound = createLibraryReferencePort(Zotero, {
    clientId: id,
    documentCache,
    uuid: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
    getWindow: () => reader._window as unknown as Window & LibraryWindow,
  });
  return { ...base, ...(bound.selectedItems ? { selectedItems: () => bound.selectedItems!() } : {}) };
}
/**
 * Build the shared reader client over local records. This creates directories, not Codex: the
 * connector resolves to `agent.connection()`, which every Agent action calls and only then starts
 * Codex. The `cwd` and generated-image roots are computed as pure paths so the client can be built
 * before any runtime directory exists.
 */
function sharedClient(): Promise<ReaderClient> {
  if (clientPromise) return clientPromise;
  if (!active) return Promise.reject(new Error('Plugin stopped.'));
  const { host } = geckoHost();
  const paths = runtimePaths(host);
  const generatedImage = createGeneratedImageLoader({ host, allowedOutputDirectories: [paths.cwd, host.join(paths.account, 'generated_images')] });
  clientPromise = openLocalStorage(host).then(storage => createReaderClient(() => {
    if (!agent) throw new Error('Plugin stopped.');
    return agent.connection();
  }, storage, {
    codexVersion: PINNED_RUNTIME.codexVersion,
    cwd: paths.cwd,
    uuid: () => crypto.randomUUID(),
    ...(context?.version ? { pluginVersion: context.version } : {}),
    generatedImage,
  })).then(created => {
    if (!active) { void created.close().catch(() => undefined); throw new Error('Plugin stopped.'); }
    client = created; return created;
  });
  return clientPromise;
}
/** Agent readiness: the one call that lazily starts Codex. Only Agent-only actions use it. */
function ensureAgent(): Promise<void> {
  if (!agent) return Promise.reject(new Error('Plugin stopped.'));
  return sharedClient().then(async created => {
    if (created.ensureAgentReady) await created.ensureAgentReady(); else await created.refreshAccount();
  });
}
/**
 * Known without starting Codex: this build wires no native Chat transport, so the local Chat
 * completion path refuses rather than silently borrowing Agent's runtime. Production Chat never
 * renders this — Chat is the hosted ChatGPT application — but the reason stays honest for callers
 * that could still reach the native path.
 */
function chatUnavailableReason(): string { return CHAT_TRANSPORT_UNAVAILABLE_MESSAGE; }
function presenterFor(identity: AttachmentIdentity, reader?: HostReader): ConversationPresenter {
  const client = clientId();
  const paper = paperScope(client, identity); const key = paperId(paper);
  let presenter = presenters.get(key);
  if (!presenter) {
    // One reader context per attachment: identity, frozen read state and the document port all come
    // from the reader layer, so Chat and Agent read the same object instead of each building one.
    const context = readerContextFor(Zotero, identity, reader, client);
    const source = nativeDocumentSource(Zotero, () => Zotero.Reader._readers.find(r => {
      const item = Zotero.Items.get(r.itemID); return item?.key === paper.attachmentKey && item.libraryID === paper.libraryId;
    }), paper);
    const local = localServices;
    presenter = new ConversationPresenter(context, {
      client: sharedClient,
      ensureAgent,
      chatUnavailableReason,
      // Chat mode's surface is the hosted ChatGPT application, so this presenter's Chat path is
      // never the producer of a Chat answer and must not start the work that only it needs.
      chatHostedExternally: true,
      openAuthorization: url => Zotero.launchURL(url),
      uuid: () => crypto.randomUUID(),
      now: () => new Date().toISOString(),
      ...(local ? {
        getWorkspace: local.getWorkspace,
        // The Agent capability is assembled here, once, from the local services; a host without it
        // leaves the chat path unable to reach approvals, the ledger or undo (Stage 4).
        agent: assembleAgent(local),
        library: libraryPort(reader),
        openCitation: citation => openCitation(Zotero, citation, clientId()),
        // The clipboard copy re-reads the local metadata by the frozen scope, so it never borrows
        // whatever paper the reader happens to show when a slower read returns.
        readPaperIdentity: scope => Promise.resolve(paperIdentityFor(Zotero, scope)),
        openItem: async (reference: import('../../contracts/src/native.ts').NativeItemRef) => {
          if (reference.clientId !== clientId()) throw new ReaderError('NOT_FOUND', 'The output belongs to another profile.');
          const item = Zotero.Items.getByLibraryAndKey?.(reference.libraryId, reference.key);
          const win = Zotero.getMainWindows()[0] as (ZoteroWindow & { ZoteroPane?: { selectItem(id: number): Promise<void> } }) | undefined;
          if (!item || !item.id || !win?.ZoteroPane) throw new ReaderError('NOT_FOUND', 'The saved output could not be opened.');
          await win.ZoteroPane.selectItem(item.id);
        },
        openHistory: async (scope: PaperScope, conversationId: string) => {
          await local.library.open(scope);
          const target = Zotero.Reader._readers.find(reader => { const item = Zotero.Items.get(reader.itemID); return item?.key === scope.attachmentKey && item.libraryID === scope.libraryId; });
          const identity = target && attachmentIdentity(Zotero, target);
          if (!target || !identity) throw new ReaderError('NOT_FOUND', 'The saved chat attachment could not be opened.');
          await entry(target).pane.controller.open();
          const next = presenterFor(identity, target); await next.activate(); await next.openConversation(conversationId);
        },
      } : {}),
      document: nativeDocumentServices({
        paper,
        source,
        cache: () => documentCache,
        automaticText: {
          read: () => Zotero.Prefs.get(AUTO_PDF_PREF, true) !== false,
          write: value => { Zotero.Prefs.set(AUTO_PDF_PREF, value, true); },
          disclosureSeen: () => Zotero.Prefs.get(PDF_DISCLOSURE_PREF, true) === true,
          markDisclosureSeen: () => { Zotero.Prefs.set(PDF_DISCLOSURE_PREF, true, true); },
        },
      }),
    });
    presenters.set(key, presenter);
  }
  return presenter;
}
const hooks = {
  openCitation: (citation: Citation) => openCitation(Zotero, citation, clientId()),
  copyText: (text: string) => {
    const internals = (Zotero as ZoteroHost & { Utilities?: { Internal?: { copyTextToClipboard?(value: string): void } } }).Utilities?.Internal;
    if (internals?.copyTextToClipboard) internals.copyTextToClipboard(text);
    else void globalThis.navigator?.clipboard?.writeText(text);
  },
  openLink: (url: string) => { Zotero.launchURL(url); },
  exportImage: async (image: import('../../contracts/src/index.ts').ImageAttachment) => {
    if (!localServices) throw new Error('Image export is unavailable.');
    await libraryPort().exportImage(image);
  },
};
function readerAssets(): { stylesheet?: string; katex?: string } {
  if (!context) return {};
  return {
    stylesheet: `${context.rootURI}content/assets/sidebar.css`,
    katex: KATEX_STYLESHEET,
  };
}
function zoomDocuments(reader: HostReader, root: HTMLElement): Array<Document | HTMLElement> {
  // Reader chrome iframe only. The nested PDF.js document keeps native zoom.
  const readerDoc = reader._iframeWindow?.document ?? root.ownerDocument;
  return [...new Set([readerDoc, root])];
}
function entry(reader: HostReader): ReaderEntry {
  let current = readers.get(reader);
  if (!current) {
    const buttons = new Set<HTMLButtonElement>();
    const pane = new NativeReaderPane(Zotero, reader, paneID, buttons, (body, identity, close, opened) => {
      const root = renderReaderShell(body, identity);
      const presenter = presenterFor(identity, reader);
      const hostedBinding = `${paperId(presenter.snapshot().document.paper)}:${reader.itemID}`;
      const prepareHostedContext = () => {
        const snapshot = presenter.snapshot();
        // The first-send scope notice is informational; the owner's send action is the approval.
        // Chat context is bibliography + stored abstract only and never reads PDF pages.
        const selected = readers.get(reader)?.stagedOfficialSelection ?? null;
        return prepareOfficialChatContext({
          disclosure: snapshot.document.disclosure,
          enabled: () => Zotero.Prefs.get(AUTO_PDF_PREF, true) !== false,
          document: async () => {
            const result = await presenter.exportPaperContext();
            if (!result.ok) return result.reason === 'no-info'
              ? { ok: false as const, reason: 'no-info' as const }
              : { ok: false as const, reason: 'failed' as const };
            return { ok: true as const, text: result.text, hasAbstract: result.hasAbstract };
          },
          selection: selected,
          consumeSelection: () => {
            if (snapshot.document.disclosure) presenter.acknowledgeContext();
            const source = readers.get(reader);
            if (source?.stagedOfficialSelection === selected) delete source.stagedOfficialSelection;
          },
        });
      };
      const unmount = mountChatView(root, presenter, {
        ...hooks,
        openDocumentPage: (document, pageIndex, quote) =>
          openSourcePage(nativeSourceNavigator(Zotero, () => reader, document.paper), document, pageIndex, quote ?? null),
        zoomTargets: zoomDocuments(reader, root),
        // The reader's own close callback: collapses the dock exactly as the toolbar toggle does,
        // restoring the previous Zotero context pane, zoom/anchor and focus. The view calls it only
        // when the last unarchived chat for this attachment is closed.
        closeDock: close,
        // Chat mode is the real ChatGPT web application. The surface is created on the first Chat
        // dock and kept for the window, so no mode switch, reader switch or sidebar close unloads
        // the session; the reader's own browser is the frame whose rect the surface is measured in.
        chatEmbed: {
          show: anchor => {
            const status = anchor.closest('[data-zchatgpt-embed]')?.querySelector<HTMLElement>('[data-zchatgpt-bridge-status-line]');
            const surface = chatSurface(reader._window, hostedBinding);
            if (!surface) {
              if (status) { status.textContent = 'Four paper ChatGPT sessions already contain drafts or work. Finish or clear one before opening another.'; status.hidden = false; }
              return;
            }
            // A surface really was shown: the previous capacity message is no longer true, so it is
            // cleared instead of lingering next to a working page.
            if (status) { status.textContent = ''; status.hidden = true; }
            surface.bindContext(hostedBinding, prepareHostedContext);
            surface.bindConversation(hostedBinding, officialConversationURL(hostedBinding), url => rememberOfficialConversationURL(hostedBinding, url));
            showChatSurface(reader._window, hostedBinding, surface, anchor, reader._iframe ?? null);
          },
          hide: () => chatSurfaces.get(reader._window)?.get(hostedBinding)?.hide(),
          reload: () => chatSurfaces.get(reader._window)?.get(hostedBinding)?.reload(),
          // The application owns its own conversation and this host has no supported way to put
          // context into it, so the paper action prepares the local *bibliography* and says plainly
          // that it is on the clipboard. It sends nothing and starts no Codex; the automatic PDF text
          // that a real send carries is assembled by `prepareHostedContext`, not by this.
          copyPaperContext: async () => {
            const context = await presenter.exportPaperContext();
            if (!context.ok) return { copied: false, reason: context.reason };
            hooks.copyText(context.text);
            return { copied: true, kind: 'paper' };
          },
          // The one route that hands the real document to the application: the file itself goes on
          // the clipboard and the owner pastes it into ChatGPT's own composer. Nothing here touches
          // the remote page or its upload control.
          copyPdfFile: async () => {
            const item = Zotero.Items.get(reader.itemID);
            const path = item?.getFilePathAsync ? await item.getFilePathAsync() : false;
            if (!path) return { copied: false, reason: 'no-file' as const };
            const outcome = copyFileToClipboard(path);
            if (outcome === 'copied') return { copied: true, kind: 'file' as const };
            return { copied: false, reason: outcome === 'unsupported' ? 'unavailable' as const : 'failed' as const };
          },
        },
        uuid: () => crypto.randomUUID(),
        readerZoom: {
          zoomIn: () => { pane.controller.manualZoom(); zoomReader(reader, 'in'); },
          zoomOut: () => { pane.controller.manualZoom(); zoomReader(reader, 'out'); },
          zoomReset: () => { pane.controller.manualZoom(); zoomReader(reader, 'reset'); },
          readZoom: () => currentReaderZoom(reader),
        },
      });
      if (opened) void presenter.activate();
      return unmount;
    }, readerAssets());
    // Both selection actions only show the sidebar; the citation copy was taken before the click.
    const act = async (citation: Citation, mode: 'chat' | 'agent', run: (presenter: ConversationPresenter, frozen: Citation, mode: 'chat' | 'agent') => void | Promise<void>) => {
      const identity = attachmentIdentity(Zotero, reader); if (!identity || !active) return;
      const frozen = await (citationVersions.get(citation) ?? freezeCitationVersion(Zotero, reader, citation));
      await pane.controller.open();
      const presenter = presenterFor(identity, reader); await presenter.activate(); current!.latestCitation = frozen; await run(presenter, frozen, mode);
    };
    const modeAtClick = (): 'chat' | 'agent' => {
      const identity = attachmentIdentity(Zotero, reader);
      return identity ? presenterFor(identity, reader).snapshot().mode : 'chat';
    };
    const officialResult = async (work: Promise<{ status: string; reason?: string }>): Promise<void> => {
      const result = await work;
      if (!['staged', 'accepted', 'submitted'].includes(result.status)) throw new Error(`ChatGPT did not accept this selection (${result.reason ?? result.status}).`);
    };
    const hostedSurface = (presenter: ConversationPresenter): ChatEmbedSurface => {
      const binding = `${paperId(presenter.snapshot().document.paper)}:${reader.itemID}`;
      const surface = chatSurface(reader._window, binding);
      if (!surface) throw new ReaderError('BUSY', 'Four paper ChatGPT sessions already contain drafts or work. Finish or clear one before opening another.');
      return surface;
    };
    const bar = new SelectionActionBar({
      explain: citation => { const mode = modeAtClick(); void act(citation, mode, async (presenter, frozen, frozenMode) => dispatchSelectionAction(
        frozenMode,
        'explain',
        selectionBrief(frozen),
        {
          stage: text => officialResult(hostedSurface(presenter).stage(text)),
          submitQuestion: question => officialResult(hostedSurface(presenter).submitQuestion(question)),
        },
        { explain: () => presenter.explain(frozen), stage: () => { presenter.addCitation(frozen); presenter.focusInput(); } },
      )).catch(error => Zotero.logError(error)); },
      ask: citation => { const mode = modeAtClick(); void act(citation, mode, async (presenter, frozen, frozenMode) => dispatchSelectionAction(
        frozenMode,
        'ask',
        selectionBrief(frozen),
        {
          stage: async text => { await officialResult(hostedSurface(presenter).stage(text)); current!.stagedOfficialSelection = text; },
          submitQuestion: question => officialResult(hostedSurface(presenter).submitQuestion(question)),
        },
        { explain: () => presenter.explain(frozen), stage: () => { presenter.addCitation(frozen); presenter.focusInput(); } },
      )).catch(error => Zotero.logError(error)); },
    });
    current = { buttons, pane, bar };
    readers.set(reader, current);
  }
  return current;
}
function onSelectionPopup(event: SelectionPopupEvent): void {
  if (!active) return;
  const current = entry(event.reader);
  if (!current.pane.supported()) return;
  const identity = attachmentIdentity(Zotero, event.reader); const metadata = paperMetadata(Zotero, event.reader);
  if (!identity || !metadata) return;
  try {
    const citation = captureSelection(event, paperScope(clientId(), identity), metadata, { uuid: () => crypto.randomUUID(), now: () => new Date().toISOString() });
    const version = freezeCitationVersion(Zotero, event.reader, citation);
    current.latestSelectionId = citation.id;
    // Chat mode hosts the web application, whose conversation this host cannot feed. The most recent
    // selection Zotero reported is what its "Copy selection" control can hand to the owner's clipboard.
    current.latestCitation = citation;
    citationVersions.set(citation, version);
    void version.catch(() => { if (active && current.latestSelectionId === citation.id) current.bar.showNotice(event, 'This PDF version could not be verified. Reopen the PDF and select the passage again.'); });
    current.bar.show(event, citation);
  } catch (error) {
    // Limits (for example a cross-page selection) are stated in place; nothing is sent.
    current.bar.showNotice(event, error instanceof ReaderError ? error.message : 'This selection cannot be used with Codex.');
    if (!(error instanceof ReaderError)) Zotero.logError(error);
  }
}
function attach(event: ToolbarEvent): void {
  if (!active) return;
  injectReaderStyles(event.doc, readerAssets());
  const current = entry(event.reader);
  if (!current.pane.supported()) return;
  const button = createToolbarButton(event.doc, () => {
    if (!active || !current.pane.selected()) return;
    void current.pane.controller.toggle().catch(error => Zotero.logError(error));
  });
  for (const old of current.buttons) if (!old.isConnected) current.buttons.delete(old);
  insertToolbarButton(event, button); current.buttons.add(button);
  current.pane.setActive(current.pane.controller.active);
}
function reconcile(): void {
  for (const [reader, current] of readers) {
    if (!Zotero.Reader._readers.includes(reader)) {
      current.pane.dispose(); current.bar.dispose();
      for (const button of current.buttons) button.remove();
      readers.delete(reader);
    } else current.pane.reconcile();
  }
  // A tab change moves the reader browser that the Chat surface is pinned to, and the tab notifier
  // is the only signal that arrives before the frame is re-laid-out.
  for (const surfaces of chatSurfaces.values()) for (const surface of surfaces.values()) surface.sync();
}
export function startup(options: PluginContext): void {
  if (active) return;
  if (agent) throw new Error('The previous Codex process has not stopped. Retry shutdown before enabling the plugin.');
  context = options; active = true;
  // Constructing the owner does not read the runtime directory, spawn or handshake; nothing is
  // started until an Agent action asks for readiness.
  agent = createAgentRuntime(options.rootURI, options.version);
  documentCache = new ReaderDocumentCache({ yield: () => new Promise(resolve => setTimeout(resolve, 0)) });
  localServices = createLocalServices(geckoHost().host, Zotero, clientId(), documentCache);
  paneID = Zotero.ItemPaneManager.registerSection({
    paneID: 'codex-reader', pluginID: options.pluginID,
    header: { l10nID: 'zchatgpt-pane-title', icon: `${options.rootURI}content/assets/icon.svg` },
    sidenav: { l10nID: 'zchatgpt-pane-title', icon: `${options.rootURI}content/assets/icon.svg` },
    onItemChange: ({ tabType, setEnabled }) => { setEnabled(active && tabType === 'reader'); },
    onRender: ({ body }) => {
      if (!active) return;
      body.replaceChildren();
      const section = body.closest<HTMLElement>('item-pane-custom-section');
      if (section) {
        section.dataset.zchatgptSection = '';
        section.hidden = true;
      }
    },
  });
  const workspace = () => localServices
    ? localServices.getWorkspace()
    : Promise.reject(new ReaderError('BUSY', 'Zotero ChatGPT is stopping.'));
  preferencesBridge().ZoteroChatGPTPreferencesHost = createPreferencesService({
    workspace,
    // One pref, one owner: the native pane and the reader opt-out read the same value.
    readAutomaticPdfText: () => Zotero.Prefs.get(AUTO_PDF_PREF, true) !== false,
    writeAutomaticPdfText: value => {
      Zotero.Prefs.set(AUTO_PDF_PREF, value, true);
      // Keep every open Chat strip honest and abort unused local extraction when the owner opts out
      // from another window's Preferences pane.
      for (const presenter of presenters.values()) presenter.setDocumentEnabled(value);
    },
    // The runtime's last live `model/list` ids, or null when Agent has never loaded them. Read-only:
    // opening the Preferences window never starts Codex, and an offerable id it reports (a GPT-5.3
    // Spark model) becomes selectable in the pane. Excluded families are filtered in core, not here.
    liveModels: () => Promise.resolve(client ? client.snapshot().models.map(model => model.id) : null),
  });
  preferencePanes = createPreferencePaneRegistrar({
    panes: Zotero.PreferencePanes, pluginID: options.pluginID, rootURI: options.rootURI,
    logError: error => Zotero.logError(error),
  });
  void preferencePanes.ensure();
  // Zotero 9.0.6's unregisterEventListener has an inverted filter. PluginObserver
  // removes pluginID listeners on actual disable/uninstall; active guards late events.
  Zotero.Reader.registerEventListener('renderToolbar', attach, options.pluginID);
  Zotero.Reader.registerEventListener('renderTextSelectionPopup', onSelectionPopup, options.pluginID);
  notifierID = Zotero.Notifier.registerObserver({ notify: reconcile }, ['tab'], options.pluginID);
  try {
    installKatexResource(options.rootURI); katexResourceInstalled = true;
    installOfficialChatResource(options.rootURI); officialChatResourceInstalled = true;
    registerOfficialChatActor(OFFICIAL_CHAT_RESOURCE_ROOT); officialChatActorRegistered = true;
  } catch (error) {
    if (officialChatActorRegistered) {
      try { unregisterOfficialChatActor(); officialChatActorRegistered = false; } catch { /* keep its resource mapping below */ }
    }
    if (!officialChatActorRegistered && officialChatResourceInstalled) {
      try { removeOfficialChatResource(); officialChatResourceInstalled = false; } catch { /* retained for a shutdown retry */ }
    }
    if (katexResourceInstalled) {
      try { removeKatexResource(); katexResourceInstalled = false; } catch { /* retained for a shutdown retry */ }
    }
    active = false;
    if (notifierID) Zotero.Notifier.unregisterObserver(notifierID); notifierID = undefined;
    preferencePanes?.remove(); preferencePanes = undefined;
    if (paneID) Zotero.ItemPaneManager.unregisterSection(paneID); paneID = '';
    const bridge = preferencesBridge();
    try { delete bridge.ZoteroChatGPTPreferencesHost; delete bridge.ZoteroChatGPTPreferencesPane; } catch { /* startup is already failing */ }
    documentCache?.clear(); documentCache = undefined; localServices = undefined; agent = undefined; context = undefined;
    throw error;
  }
}
export function onMainWindowLoad(window: Window): void {
  const win = window as ZoteroWindow;
  if (!active || !context || windows.has(win)) return;
  const doc = win.document;
  const css = doc.createElementNS('http://www.w3.org/1999/xhtml', 'link');
  css.setAttribute('rel', 'stylesheet'); css.setAttribute('href', `${context.rootURI}content/assets/sidebar.css`);
  const katex = doc.createElementNS('http://www.w3.org/1999/xhtml', 'link');
  katex.setAttribute('rel', 'stylesheet'); katex.setAttribute('href', KATEX_STYLESHEET);
  const locale = doc.createElementNS('http://www.w3.org/1999/xhtml', 'link');
  // Zotero registers plugin locale files by resource basename, not absolute URI.
  locale.setAttribute('rel', 'localization'); locale.setAttribute('href', 'zchatgpt.ftl');
  doc.documentElement.append(css, katex, locale);
  const onNativeClick = (event: Event) => {
    const target = event.target as Element | null;
    const button = target?.closest?.('.btn[data-pane]') as HTMLElement | null;
    if (!button || !button.closest('#zotero-context-pane-sidenav')) return;
    const reader = win.Zotero_Tabs && Zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID);
    if (!reader) return;
    const current = entry(reader);
    if (button.dataset.pane === paneID) {
      if (!current.pane.controller.active && current.pane.selected()) void current.pane.controller.toggle().catch(error => Zotero.logError(error));
    } else current.pane.controller.nativeAction();
  };
  doc.addEventListener('click', onNativeClick, true);
  const observer = new win.MutationObserver(reconcile);
  const pane = doc.getElementById('zotero-context-pane');
  if (pane) observer.observe(pane, { attributes: true, subtree: true, attributeFilter: ['collapsed', 'selectedIndex'] });
  windows.set(win, () => { observer.disconnect(); doc.removeEventListener('click', onNativeClick, true); css.remove(); katex.remove(); locale.remove(); });
  try {
    const services = localServices;
    if (services) libraryAgentEntries.set(win, mountLibraryAgentEntry({
      document: doc,
      sessionId: libraryAgentSessionId(),
      getTasks: () => services.getTasks(),
      collections: () => services.library.collections(),
      startLogin: async () => {
        const flow = await (await sharedClient()).startLogin();
        Zotero.launchURL(flow.authorizationUrl);
      },
      organizeSelected: async (question, _window, sessionId) => {
        if (!documentCache) throw new ReaderError('RUNTIME_UNAVAILABLE', 'The Zotero library is unavailable.');
        const bound = createLibraryReferencePort(Zotero, {
          clientId: clientId(), documentCache,
          uuid: () => crypto.randomUUID(), now: () => new Date().toISOString(),
          getWindow: () => win as unknown as Window & LibraryWindow,
        });
        if (!bound.selectedItems) throw new ReaderError('UNSUPPORTED_INTERACTION', 'The Zotero library selection is unavailable.');
        // Calling selectedItems copies the owning window's row keys synchronously, before its first
        // native read awaits. Start all local snapshots now: login/reconciliation may take minutes,
        // and a later focus or selection change must not redirect this click to different items.
        const selectionSnapshot = bound.selectedItems().then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
        const collectionSnapshot = bound.collections().then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
        const settingsSnapshot = services.getWorkspace().then(workspace => workspace.settings()).then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
        await ensureAgent();
        const runtime = await sharedClient();
        if (runtime.snapshot().account.state !== 'signedIn') throw new ReaderError('AUTH_REQUIRED', 'Sign in to Agent before organizing selected Zotero items.');
        const connection = agent?.currentConnection();
        if (!connection) throw new ReaderError('RUNTIME_UNAVAILABLE', 'The Agent connection is unavailable.');
        const storage = await services.getStorage();
        const tasks = await services.getTasks();
        const reconciled = await reconcileLibraryOrganization({ storage, connection, tasks, sessionId });
        if (reconciled) return;
        const selection = await selectionSnapshot; if (!selection.ok) throw selection.error;
        const collectionList = await collectionSnapshot; if (!collectionList.ok) throw collectionList.error;
        const settings = await settingsSnapshot; if (!settings.ok) throw settings.error;
        const collections = collectionList.value.filter(collection => collection.libraryId === selection.value[0]?.libraryId);
        const model = offeredModels(runtime.snapshot().models, enforcedAllowedModelIds(settings.value.allowedModels))[0];
        if (!model) throw new ReaderError('MODEL_UNAVAILABLE', 'No supported GPT-6 Agent model is available for this account.');
        await runLibraryOrganization({
          connection, storage, tasks, sessionId, requestId: crypto.randomUUID(),
          question, selection: selection.value, collections, model, cwd: runtimePaths(geckoHost().host).cwd,
        });
      },
      openOutput: async (task, itemId) => {
        const output = task.items.find(item => item.id === itemId);
        const reference = task.kind === 'acquisition' && output?.kind === 'acquisition' ? output.item
          : task.kind === 'organization' && output?.kind === 'organization' ? output.before : null;
        if (!reference) throw new ReaderError('NOT_FOUND', 'The saved Zotero item could not be opened.');
        const item = Zotero.Items.getByLibraryAndKey?.(reference.libraryId, reference.key) || undefined;
        const pane = (win as ZoteroWindow & { ZoteroPane?: { selectItem(id: number): Promise<void> } }).ZoteroPane;
        if (!item?.id || !pane) throw new ReaderError('NOT_FOUND', 'The saved Zotero item could not be opened from this window.');
        await pane.selectItem(item.id);
      },
    }));
  } catch (error) { Zotero.logError(error); }
  // Enabling an add-on does not necessarily rerender an already-open reader toolbar.
  for (const reader of Zotero.Reader._readers) {
    if (reader._window !== win) continue;
    const readerDoc = reader._iframeWindow?.document;
    const find = readerDoc?.querySelector('.toolbar .find');
    if (readerDoc && find?.parentElement) attach({ reader, doc: readerDoc, append: (...nodes) => { find.before(...nodes); } });
  }
}
export function onMainWindowUnload(window: Window): void {
  const win = window as ZoteroWindow;
  libraryAgentEntries.get(win)?.(); libraryAgentEntries.delete(win);
  // The window is going away, so its Chat surface goes with it: the document cannot outlive the
  // window it was created in.
  for (const surface of chatSurfaces.get(win)?.values() ?? []) surface.destroy(); chatSurfaces.delete(win);
  for (const [reader, current] of readers) {
    if (reader._window !== win) continue;
    for (const button of current.buttons) button.remove();
    current.pane.dispose(); current.bar.dispose(); readers.delete(reader);
  }
  windows.get(win)?.(); windows.delete(win);
}
export async function shutdown(): Promise<void> {
  active = false;
  for (const win of windows.keys()) onMainWindowUnload(win);
  for (const surfaces of chatSurfaces.values()) for (const surface of surfaces.values()) surface.destroy();
  chatSurfaces.clear();
  if (officialChatActorRegistered) {
    try { unregisterOfficialChatActor(); officialChatActorRegistered = false; } catch (error) { Zotero.logError(error); }
    // A live actor must never point at a removed substitution. If unregister failed, retain both so a
    // deliberate shutdown retry can finish the pair safely.
  }
  if (!officialChatActorRegistered && officialChatResourceInstalled) {
    try { removeOfficialChatResource(); officialChatResourceInstalled = false; }
    catch (error) { Zotero.logError(error); }
  }
  if (katexResourceInstalled) {
    try { removeKatexResource(); katexResourceInstalled = false; }
    catch (error) { Zotero.logError(error); }
  }
  for (const current of readers.values()) { for (const button of current.buttons) button.remove(); current.pane.dispose(); current.bar.dispose(); }
  readers.clear();
  preferencePanes?.remove(); preferencePanes = undefined;
  const bridge = preferencesBridge();
  try { delete bridge.ZoteroChatGPTPreferencesHost; delete bridge.ZoteroChatGPTPreferencesPane; }
  catch (error) { Zotero.logError(error); }
  if (notifierID) Zotero.Notifier.unregisterObserver(notifierID);
  notifierID = undefined;
  if (paneID) Zotero.ItemPaneManager.unregisterSection(paneID);
  paneID = ''; context = undefined;
  for (const presenter of presenters.values()) { await presenter.flushDraft?.().catch(() => Zotero.logError(new Error('A chat draft could not be saved during shutdown.'))); presenter.dispose(); }
  presenters.clear();
  documentCache?.clear(); documentCache = undefined;
  const stopping = agent;
  const pendingClient = clientPromise; clientPromise = null;
  if (pendingClient) { try { client = await pendingClient; } catch { /* Construction failed; nothing to close. */ } }
  const closingClient = client; client = null;
  const local = localServices; localServices = undefined;
  // Closing the client first fails the channel, so a pending RPC cannot hold shutdown open; the
  // owner then confirms the process exit. `agent` is only cleared once its stop resolved.
  const results = await Promise.allSettled([local?.stop(), closingClient?.close(), stopping?.stop()]);
  if (results[2]?.status === 'fulfilled' && agent === stopping) agent = undefined;
  if (results.some(result => result.status === 'rejected')) throw new Error('Plugin shutdown could not complete every cleanup operation. Retrying preserves ownership of any remaining Codex process.');
}
