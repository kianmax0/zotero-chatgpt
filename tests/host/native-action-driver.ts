import { NativeOperationError, type NativeActionPort, type NativeFigureCalloutInput, type NativeFigureSelection, type NativeMetadata, type NativeOrganizationItemSnapshot } from '../../packages/contracts/src/native.ts';
import { ReaderError, type DocumentContext, type ImageAttachment, type PaperScope } from '../../packages/contracts/src/index.ts';
import type { LibraryReferencePort } from '../../packages/contracts/src/workspace.ts';
import { ActionTaskController } from '../../packages/core/src/tasks/controller.ts';
import { createNativeActionPortFrom } from '../../packages/zotero/src/actions/native.ts';
import type { NativeHostCollection, NativeHostItem, NativeZoteroHost } from '../../packages/zotero/src/host/native.ts';
import { nativeDocumentSource, ReaderDocumentCache } from '../../packages/zotero/src/reader/document.ts';
import { nativeSourceNavigator, openSourcePage } from '../../packages/zotero/src/reader/source-highlight.ts';
import type { HostReader, ZoteroHost, ZoteroWindow } from '../../packages/zotero/src/reader/host-types.ts';
import { createLibraryReferencePort } from '../../packages/zotero/src/library/reference.ts';
import { geckoHost } from '../../packages/zotero/src/runtime/gecko.ts';
import { checkPath, GeckoStorage, privateDirectory, type FileHost } from '../../packages/zotero/src/runtime/storage.ts';

export interface NativeSmokeConfig {
  pdfPath: string;
  supplementPdfPath: string;
  reportPath: string;
  profile: string;
  dataDir: string;
  subjectID: string;
  subjectVersion: string;
  artifactHash: string;
  verificationToken?: string;
  driverSourceHash?: string;
}
interface SmokeItem extends NativeHostItem {
  setField(name: string, value: string): void;
  saveTx(options?: { skipSelect?: boolean }): Promise<number | boolean>;
  loadAllData(): Promise<void>;
  getAnnotations(): SmokeItem[];
}
interface SmokeCollection extends NativeHostCollection { name: string; saveTx(): Promise<number | boolean> }
interface SmokeWindow extends ZoteroWindow {
  ZoteroPane?: { loaded?: boolean; itemsView?: { getSelectedItems(asIDs?: false): SmokeItem[] } };
  Zotero_Tabs: { selectedID: string; getTabInfo(id: string): { id?: string; data?: { itemID?: number } }; select(id: string): void };
}
interface SmokeReader extends HostReader { tabID: string; _window: SmokeWindow; _initPromise?: Promise<void>; close(): void }
interface SmokeLibrary { libraryID: number; editable: boolean; filesEditable: boolean; waitForDataLoad(type: 'item' | 'collection'): Promise<void> }
interface SmokeZotero extends Omit<NativeZoteroHost, 'Item' | 'Items' | 'Reader' | 'Libraries' | 'Collections' | 'Utilities' | 'Attachments' | 'Annotations'> {
  version: string;
  initializationPromise: Promise<void>;
  DataDirectory: { dir: string };
  Promise: { delay(milliseconds: number): Promise<void> };
  getMainWindow(): SmokeWindow | undefined;
  Prefs: { get(name: string, global?: boolean): unknown; set(name: string, value: string, global?: boolean): void };
  Item: new (type: string) => SmokeItem;
  Collection: new () => SmokeCollection;
  Items: {
    get(id: number): SmokeItem | false | undefined;
    getAsync(id: number): Promise<SmokeItem>;
    getByLibraryAndKey(libraryID: number, key: string): SmokeItem | false | undefined;
    getAll(libraryID: number, onlyTopLevel: boolean, includeDeleted: boolean, asIDs: true): Promise<number[]>;
  };
  Reader: { _readers: SmokeReader[]; open(id: number, location?: unknown, options?: { tabID?: string; allowDuplicate?: boolean; openInBackground?: boolean }): Promise<SmokeReader>; getByTabID(id: string): SmokeReader | undefined };
  Libraries: { userLibraryID: number; get(id: number): SmokeLibrary | undefined };
  Collections: { get(id: number): SmokeCollection | false | undefined; getByLibraryAndKey(libraryID: number, key: string): SmokeCollection | false | undefined; getByLibrary(libraryID: number, recursive: boolean, includeTrashed: boolean): SmokeCollection[] };
  Annotations: NativeZoteroHost['Annotations'] & { hasCacheImage(item: SmokeItem): Promise<boolean> };
  Utilities: NativeZoteroHost['Utilities'] & { generateObjectKey(): string };
  Attachments: NativeZoteroHost['Attachments'] & { importFromFile(options: { file: string; parentItemID: number; title: string; saveOptions: { skipSelect: true } }): Promise<SmokeItem> };
  Notifier: { registerObserver(observer: { notify(event: string, type: string, ids: Array<string | number>): void }, types: string[], name: string): string; unregisterObserver(id: string): void };
}
declare const Zotero: SmokeZotero;
declare const PathUtils: { profileDir: string; join(...parts: string[]): string };
declare const ChromeUtils: { importESModule(uri: string): { AddonManager: { getAddonByID(id: string): Promise<{ isActive: boolean; version: string } | null> } } };
declare const Services: { appinfo: { OS: string; XPCOMABI: string; platformVersion?: string } };

type Evidence = 'real-host-api' | 'synthetic-proposal-real-host-write' | 'synthetic-user-edit-real-host-api' | 'real-network-translator';
interface SmokeCheck { name: string; evidence: Evidence; status: 'running' | 'passed' | 'failed'; ok?: boolean; startedAt: string; completedAt?: string; details?: Record<string, unknown>; failure?: { code: string; message?: string } }
export interface NativeSmokeReport {
  schemaVersion: 1;
  stage: 'native-agent';
  runId: string;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'passed' | 'partial' | 'failed';
  build: { expectedVersion: string; expectedArtifactHash: string; artifactHashSource: 'prepare-script'; adapterSource: 'working-tree-production-modules-in-test-driver'; subjectScope: 'installed-addon-identity-only'; driverSourceHash: string | null; actualVersion?: string };
  environment?: { zotero: string; os: string; abi: string; width: number; height: number; dpr: number };
  driverIssuedModelRequests: 0;
  modelProposalSource: 'deterministic-synthetic-fixture';
  verificationToken: string;
  checks: SmokeCheck[];
  notRun: Array<{ name: string; reason: string }>;
  retained?: { parentKey: string; attachmentKeys: string[]; collectionKey: string; taskIds: string[]; ledger: string; manuallyEditedAnnotationKey?: string; organizationItemKeys?: string[]; organizationCollectionKey?: string };
}
class SmokeFailure extends Error { constructor(readonly code: string) { super(code); this.name = 'NativeSmokeFailure'; } }
function requireCheck(ok: unknown, code: string): asserts ok { if (!ok) throw new SmokeFailure(code); }
function safePath(value: unknown): string {
  requireCheck(typeof value === 'string' && value.startsWith('/') && value.length < 4096 && !/[\\:\u0000-\u001f]/u.test(value) && value.slice(1).split('/').every(part => !!part && part !== '.' && part !== '..'), 'INVALID_CONFIG_PATH');
  return value;
}
function safeFailure(error: unknown): { code: string; message?: string } {
  if (error instanceof SmokeFailure) return { code: error.code };
  if (error instanceof NativeOperationError || error instanceof ReaderError) return { code: error.code, message: error.message.slice(0, 256) };
  const native = error && typeof error === 'object' ? error as { name?: unknown; stack?: unknown; message?: unknown } : {};
  const name = typeof native.name === 'string' && /^[A-Za-z_]{1,80}$/u.test(native.name) ? native.name : 'Unknown';
  const stack = typeof native.stack === 'string' ? native.stack : '';
  const knownFrames = ['privateDirectory', 'geckoHost', 'createNativeActionPortFrom', 'open', 'loadAllData', 'setPermissions', 'makeDirectory'].filter(name => stack.includes(name));
  const locations = [...stack.matchAll(/(?:reader|tabs|dataObject|item|annotations|driver)\.js:\d+:\d+/gu)].map(match => match[0]).slice(0, 6);
  const message = typeof native.message === 'string' ? native.message : '';
  const properties = ['tabID', 'itemID', '_window', 'Zotero_Tabs', 'focusOptions', 'keepTabFocused', 'getLibraryAndKeyFromID', 'collapsed', 'ZoteroContextPane', 'cloneInto', 'isReady'].filter(property => message.includes(property));
  return { code: 'UNEXPECTED_NATIVE_ERROR', message: [name, ...knownFrames, ...locations, ...properties].join(' / ') };
}
async function digest(bytes: Uint8Array): Promise<string> { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))].map(value => value.toString(16).padStart(2, '0')).join(''); }
async function digestText(value: string): Promise<string> { return digest(new TextEncoder().encode(value)); }
function tabInfo(window: SmokeWindow, id: string) { try { return window.Zotero_Tabs.getTabInfo(id); } catch { return undefined; } }

/** Test-only entrypoint. Importing this file never runs it or opens a reader. */
export async function runHostSmoke(config: NativeSmokeConfig): Promise<NativeSmokeReport> {
  await Zotero.initializationPromise;
  const verificationToken = typeof config.verificationToken === 'string' && /^RUN-[a-f0-9]{24}$/u.test(config.verificationToken) ? config.verificationToken : 'ORCHID-72';
  const profile = safePath(config.profile); const dataDir = safePath(config.dataDir);
  const contextProfile = profile.match(/^(.*\/\.zotero-chatgpt-dev\/(?:context|context-runs\/[a-z0-9][a-z0-9-]{0,63}))\/profile$/u);
  requireCheck(Boolean(contextProfile) && dataDir === `${contextProfile?.[1]}/data` && PathUtils.profileDir === profile, 'PROFILE_GUARD_REJECTED');
  const contextRoot = profile.slice(0, -'/profile'.length);
  requireCheck(dataDir === PathUtils.join(contextRoot, 'data') && Zotero.DataDirectory.dir === dataDir, 'DATA_GUARD_REJECTED');
  const reportPath = safePath(config.reportPath); const pdfPath = safePath(config.pdfPath); const supplementPath = safePath(config.supplementPdfPath);
  requireCheck(reportPath.slice(0, reportPath.lastIndexOf('/')) === contextRoot && /\.json$/u.test(reportPath), 'REPORT_SCOPE_REJECTED');
  const fixtures = PathUtils.join(contextRoot, 'fixtures') + '/';
  requireCheck(pdfPath.startsWith(fixtures) && supplementPath.startsWith(fixtures) && /\.pdf$/iu.test(pdfPath) && /\.pdf$/iu.test(supplementPath) && pdfPath !== supplementPath, 'FIXTURE_SCOPE_REJECTED');
  requireCheck(typeof config.subjectID === 'string' && config.subjectID.length > 0 && config.subjectID.length <= 256 && typeof config.subjectVersion === 'string' && /^[a-f0-9]{64}$/u.test(config.artifactHash), 'INVALID_BUILD_IDENTITY');
  const { host } = geckoHost();
  const guard = () => requireCheck(PathUtils.profileDir === profile && Zotero.DataDirectory.dir === dataDir, 'ACTIVE_CONTEXT_CHANGED');
  for (const path of [profile, dataDir, contextRoot]) requireCheck(await checkPath(host, path, 'directory'), 'DEDICATED_DIRECTORY_UNSAFE');
  for (const file of [pdfPath, supplementPath]) {
    let parent = contextRoot;
    for (const part of file.slice(contextRoot.length + 1).split('/').slice(0, -1)) { parent = host.join(parent, part); requireCheck(await checkPath(host, parent, 'directory'), 'FIXTURE_ANCESTOR_UNSAFE'); }
  }
  for (const path of [pdfPath, supplementPath]) requireCheck(await checkPath(host, path, 'regular'), 'SYNTHETIC_PDF_UNAVAILABLE');
  requireCheck(!host.isSymlink(reportPath), 'REPORT_SYMLINK_REJECTED');
  const report: NativeSmokeReport = {
    schemaVersion: 1, stage: 'native-agent', runId: host.uuid(), startedAt: new Date().toISOString(), status: 'running',
    build: { expectedVersion: config.subjectVersion, expectedArtifactHash: config.artifactHash, artifactHashSource: 'prepare-script', adapterSource: 'working-tree-production-modules-in-test-driver', subjectScope: 'installed-addon-identity-only', driverSourceHash: config.driverSourceHash ?? null },
    driverIssuedModelRequests: 0, modelProposalSource: 'deterministic-synthetic-fixture', verificationToken, checks: [],
    notRun: [
      { name: 'real-model-proposal', reason: 'The driver supplies explicit synthetic annotation proposals. They are not model output.' },
      { name: 'oa-pdf-acquisition-and-correspondence', reason: 'This bounded smoke does not download external PDFs. Real network evidence is limited to unsaved DOI metadata translation.' },
      { name: 'official-login-and-credentials', reason: 'No login flow or authentication file is inspected.' },
      { name: 'installed-subject-ui-feature-wiring', reason: 'This smoke calls working-tree production adapters bundled in the test driver. Installed subject version/hash identify the host setup, not final XPI feature wiring.' },
      { name: 'citation-link-click-in-model-answer', reason: 'The click handler binds a verbatim quote supplied in a live-model answer. This driver exercises the production locate/navigate path with an explicit synthetic fixture quote instead, which is not model output.' },
    ],
  };
  let reportWrites = Promise.resolve();
  const save = (): Promise<void> => {
    const bytes = new TextEncoder().encode(JSON.stringify(report, null, 2));
    const operation = reportWrites.then(async () => {
      guard(); requireCheck(!host.isSymlink(reportPath), 'REPORT_SYMLINK_REJECTED');
      try { await host.io.write(reportPath, bytes, { mode: 'overwrite', flush: true }); }
      catch { throw new SmokeFailure('REPORT_PERSIST_FAILED'); }
    });
    reportWrites = operation.catch(() => {}); return operation;
  };
  const step = async <T>(name: string, evidence: Evidence, work: () => Promise<{ value: T; details?: Record<string, unknown> }>, optional = false): Promise<T | undefined> => {
    guard(); const entry: SmokeCheck = { name, evidence, status: 'running', startedAt: new Date().toISOString() }; report.checks.push(entry); await save();
    try { const result = await work(); entry.status = 'passed'; entry.ok = true; if (result.details) entry.details = result.details; entry.completedAt = new Date().toISOString(); await save(); return result.value; }
    catch (error) { entry.status = 'failed'; entry.ok = false; entry.failure = safeFailure(error); entry.completedAt = new Date().toISOString(); await save(); if (!optional) throw error; return undefined; }
  };
  const until = async <T>(read: () => T | false | undefined, code: string, timeout = 30000): Promise<T> => {
    const started = Date.now(); while (Date.now() - started < timeout) { guard(); const value = read(); if (value) return value; await Zotero.Promise.delay(20); } throw new SmokeFailure(code);
  };
  const ownedReaders: SmokeReader[] = []; let window: SmokeWindow | undefined; let previousTab: string | undefined;
  let tasks: ActionTaskController | undefined; let unsubscribe: (() => void) | undefined; let reportTail = Promise.resolve();
  let currentStage = 'driver-startup';
  try {
    await save();
    window = await until(() => Zotero.getMainWindow(), 'MAIN_WINDOW_UNAVAILABLE');
    await until(() => window?.ZoteroPane?.loaded && window.ZoteroPane.itemsView && window.Zotero_Tabs, 'LIBRARY_WINDOW_NOT_READY');
    previousTab = window.Zotero_Tabs.selectedID;
    report.environment = { zotero: Zotero.version, os: Services.appinfo.OS, abi: Services.appinfo.XPCOMABI, width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio };
    const libraryID = Zotero.Libraries.userLibraryID; const library = Zotero.Libraries.get(libraryID);
    requireCheck(library?.editable && library.filesEditable, 'SYNTHETIC_LIBRARY_NOT_EDITABLE'); await library.waitForDataLoad('item');
    await step('subject-addon-and-profile-guard', 'real-host-api', async () => {
      const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs'); const subject = await AddonManager.getAddonByID(config.subjectID);
      requireCheck(subject?.isActive && subject.version === config.subjectVersion, 'SUBJECT_ADDON_NOT_ACTIVE'); report.build.actualVersion = subject.version;
      return { value: true, details: { profileMatched: true, dataDirectoryMatched: true, addonActive: true, productionModulesBundledInTestDriver: true } };
    });
    const fixture = await step('create-isolated-synthetic-fixtures', 'real-host-api', async () => {
      for (const [path, token] of [[pdfPath, verificationToken], [supplementPath, 'BAMBOO-19']] as const) {
        const stat = await host.io.stat(path); requireCheck(stat.size > 0 && stat.size < 256 * 1024, 'SYNTHETIC_FIXTURE_SIZE_INVALID');
        const contents = new TextDecoder().decode(await host.io.read(path));
        requireCheck(contents.startsWith('%PDF-') && contents.includes('Synthetic page 1 - development testing only') && contents.includes(token), 'SYNTHETIC_FIXTURE_MARKERS_MISSING');
      }
      guard(); const collection = new Zotero.Collection(); collection.libraryID = libraryID; collection.name = `[Synthetic native smoke] ${report.runId}`; await collection.saveTx();
      guard(); const parent = new Zotero.Item('journalArticle'); parent.libraryID = libraryID; parent.setField('title', `[Synthetic native smoke] ${report.runId}`); parent.setField('abstractNote', 'Local synthetic fixture. No model or network metadata provenance.'); parent.addTag('preserve-existing-parent'); parent.addToCollection(collection.key); await parent.saveTx({ skipSelect: true });
      guard(); const peer = new Zotero.Item('journalArticle'); peer.libraryID = libraryID; peer.setField('title', `[Synthetic organization peer] ${report.runId}`); peer.setField('abstractNote', 'Second local synthetic item for a bounded organization batch.'); peer.addTag('preserve-existing-peer'); peer.addToCollection(collection.key); await peer.saveTx({ skipSelect: true });
      guard(); const main = await Zotero.Attachments.importFromFile({ file: pdfPath, parentItemID: parent.id, title: 'Synthetic main PDF', saveOptions: { skipSelect: true } });
      guard(); const supplement = await Zotero.Attachments.importFromFile({ file: supplementPath, parentItemID: parent.id, title: 'Synthetic supplement PDF', saveOptions: { skipSelect: true } });
      await Promise.all([parent.loadAllData(), peer.loadAllData(), main.loadAllData(), supplement.loadAllData()]);
      requireCheck(main.key !== supplement.key && main.parentID === parent.id && supplement.parentID === parent.id && main.getAnnotations().length === 0 && supplement.getAnnotations().length === 0, 'SYNTHETIC_ATTACHMENT_IDENTITY_FAILED');
      return { value: { collection, parent, peer, main, supplement }, details: { parentKey: parent.key, peerKey: peer.key, collectionKey: collection.key, attachmentKeys: [main.key, supplement.key], modelGenerated: false, networkImported: false } };
    });
    requireCheck(fixture, 'FIXTURES_NOT_CREATED');
    currentStage = 'open-synthetic-main-reader';
    const readersBeforeOpen = new Set(Zotero.Reader._readers);
    const opened = await Zotero.Reader.open(fixture.main.id, undefined, { allowDuplicate: true, openInBackground: false });
    requireCheck(!readersBeforeOpen.has(opened) && opened.itemID === fixture.main.id, 'DRIVER_READER_OWNERSHIP_MISMATCH'); ownedReaders.push(opened);
    currentStage = 'initialize-synthetic-main-reader';
    if (opened._initPromise) await opened._initPromise;
    await until(() => (opened._internalReader?._primaryView ?? opened._internalReader?._lastView)?._iframeWindow?.PDFViewerApplication?.pdfDocument, 'SYNTHETIC_PDF_NOT_READY');
    currentStage = 'profile-client-identity';
    const configuredClient = Zotero.Prefs.get('extensions.zchatgpt.clientId', true);
    requireCheck(configuredClient === undefined || configuredClient === null || configuredClient === '' || (typeof configuredClient === 'string' && /^[0-9a-f-]{36}$/u.test(configuredClient)), 'PROFILE_CLIENT_ID_INVALID');
    const clientId = typeof configuredClient === 'string' && configuredClient ? configuredClient : host.uuid();
    if (!configuredClient) { guard(); Zotero.Prefs.set('extensions.zchatgpt.clientId', clientId, true); }
    const paper: PaperScope = { clientId, libraryId: libraryID, attachmentKey: fixture.main.key };
    const supplementPaper: PaperScope = { ...paper, attachmentKey: fixture.supplement.key };
    currentStage = 'construct-production-adapters';
    const cache = new ReaderDocumentCache({ yield: () => Zotero.Promise.delay(0), maxEntries: 3 });
    const source = nativeDocumentSource(Zotero as unknown as ZoteroHost, () => opened, paper);
    const native: NativeActionPort = createNativeActionPortFrom({ clientId, zotero: Zotero });
    const ledgerName = `zotero-chatgpt/native-agent-smoke/${report.runId}`;
    currentStage = 'create-isolated-gecko-ledger';
    const ledger = await privateDirectory(host, profile, ledgerName);
    currentStage = 'construct-task-controller';
    const storage = new GeckoStorage(host, ledger);
    tasks = new ActionTaskController(storage, native, { uuid: () => host.uuid(), key: () => Zotero.Utilities.generateObjectKey(), now: () => new Date().toISOString() });
    const taskController = tasks;
    unsubscribe = taskController.subscribe(record => {
      if (report.retained && !report.retained.taskIds.includes(record.id)) report.retained.taskIds.push(record.id);
      reportTail = reportTail.then(save).catch(() => { /* The next awaited report save exposes failures. */ });
    });
    report.retained = { parentKey: fixture.parent.key, attachmentKeys: [fixture.main.key, fixture.supplement.key], collectionKey: fixture.collection.key, taskIds: [], ledger: ledgerName, organizationItemKeys: [fixture.parent.key, fixture.peer.key] };
    const organizationReview = await step('organization-review-freezes-two-selected-items-without-writing', 'synthetic-proposal-real-host-write', async () => {
      guard(); const targetCollection = new Zotero.Collection(); targetCollection.libraryID = libraryID; targetCollection.name = `[Synthetic organization target] ${report.runId}`; await targetCollection.saveTx();
      const refs = [fixture.parent, fixture.peer].map(item => ({ clientId, libraryId: libraryID, key: item.key }));
      const selection: NativeOrganizationItemSnapshot[] = []; for (const ref of refs) { const snapshot = await native.inspectOrganizationItem(ref); requireCheck(snapshot, 'ORGANIZATION_SELECTION_SNAPSHOT_MISSING'); selection.push(snapshot); }
      const target = { clientId, libraryId: libraryID, collectionKey: targetCollection.key };
      const tag = `synthetic-organization-${report.runId}`;
      const task = await taskController.planOrganization({ conversationId: host.uuid(), question: 'Synthetic smoke: add one tag and one collection to both frozen selected items.', modelRequestId: host.uuid(), selection, collections: [target], proposals: selection.map((_item, itemIndex) => ({ itemIndex, tags: [tag], collectionIndexes: [0] })) });
      requireCheck(task.kind === 'organization' && task.state === 'review' && task.items.length === 2 && task.items.every((item, index) => item.sourceIndex === index && item.status === 'candidate' && item.before.key === selection[index]?.key), 'ORGANIZATION_REVIEW_NOT_FROZEN');
      const unchanged = await Promise.all(refs.map(ref => native.inspectOrganizationItem(ref)));
      requireCheck(unchanged.every((item, index) => item && !item.tags.includes(tag) && !item.collectionKeys.includes(target.collectionKey) && item.contentSignature === selection[index]?.contentSignature), 'ORGANIZATION_PREAPPROVAL_WRITE_DETECTED');
      if (report.retained) report.retained.organizationCollectionKey = target.collectionKey;
      return { value: { task, selection, target, tag }, details: { selectedItems: selection.length, frozenSourceIndexes: task.items.map(item => item.sourceIndex), proposedTagsPerItem: 1, proposedCollectionsPerItem: 1, nativeWritesBeforeApproval: 0 } };
    });
    requireCheck(organizationReview, 'ORGANIZATION_REVIEW_UNAVAILABLE');
    const organizationApplied = await step('organization-approval-adds-and-reads-back-without-replacing-existing-values', 'synthetic-proposal-real-host-write', async () => {
      const approved = await taskController.approve(organizationReview.task.id, organizationReview.task.items.map(item => item.id));
      requireCheck(approved.kind === 'organization' && approved.state === 'completed' && approved.items.every(item => item.status === 'applied' && item.change), 'ORGANIZATION_APPROVAL_FAILED');
      const readback = await Promise.all(organizationReview.selection.map(item => native.inspectOrganizationItem(item)));
      requireCheck(readback.every((item, index) => item && item.tags.includes(organizationReview.tag) && item.tags.includes(organizationReview.selection[index]!.tags[0]!) && item.collectionKeys.includes(organizationReview.target.collectionKey) && item.collectionKeys.includes(fixture.collection.key)), 'ORGANIZATION_ADDITIVE_READBACK_FAILED');
      requireCheck(approved.items.every((item, index) => item.kind === 'organization' && item.change && item.change.addedTags.length === 1 && item.change.addedCollectionKeys.length === 1 && item.change.after.contentSignature === readback[index]?.contentSignature), 'ORGANIZATION_LEDGER_READBACK_MISMATCH');
      return { value: approved, details: { taskId: approved.id, selectedItems: approved.items.length, verifiedReadbacks: readback.length, existingTagsPreserved: true, existingCollectionsPreserved: true, additiveOnly: true } };
    });
    requireCheck(organizationApplied, 'ORGANIZATION_APPLY_UNAVAILABLE');
    await step('organization-undo-removes-unchanged-additions-and-preserves-a-later-edit', 'synthetic-user-edit-real-host-api', async () => {
      const laterTag = `synthetic-later-edit-${report.runId}`; guard(); const peer = Zotero.Items.getByLibraryAndKey(libraryID, fixture.peer.key); requireCheck(peer, 'ORGANIZATION_EDIT_TARGET_MISSING'); peer.addTag(laterTag); await peer.saveTx({ skipSelect: true });
      const result = await taskController.undo(organizationApplied.id); requireCheck(result.kind === 'organization' && result.state === 'conflict', 'ORGANIZATION_UNDO_CONFLICT_NOT_REPORTED');
      const parentResult = result.items.find(item => item.before.key === fixture.parent.key); const peerResult = result.items.find(item => item.before.key === fixture.peer.key);
      const parentAfter = await native.inspectOrganizationItem({ clientId, libraryId: libraryID, key: fixture.parent.key }); const peerAfter = await native.inspectOrganizationItem({ clientId, libraryId: libraryID, key: fixture.peer.key });
      requireCheck(parentResult?.status === 'undone' && parentAfter && parentAfter.tags.includes('preserve-existing-parent') && !parentAfter.tags.includes(organizationReview.tag) && parentAfter.collectionKeys.includes(fixture.collection.key) && !parentAfter.collectionKeys.includes(organizationReview.target.collectionKey), 'ORGANIZATION_SAFE_UNDO_FAILED');
      requireCheck(peerResult?.status === 'conflict' && peerResult.errorCode === 'OUTPUT_CHANGED' && peerAfter && peerAfter.tags.includes('preserve-existing-peer') && peerAfter.tags.includes(organizationReview.tag) && peerAfter.tags.includes(laterTag) && peerAfter.collectionKeys.includes(fixture.collection.key) && peerAfter.collectionKeys.includes(organizationReview.target.collectionKey), 'ORGANIZATION_UNDO_OVERWROTE_LATER_EDIT');
      return { value: true, details: { unchangedItemUndoVerified: true, laterNativeEditPreserved: true, conflictingItemKey: fixture.peer.key, conflictCode: peerResult.errorCode, existingTagsPreserved: true, existingCollectionsPreserved: true } };
    });
    const document = await step('native-whole-pdf-text-and-loaded-file-sha256', 'real-host-api', async () => {
      const pdf = (opened._internalReader?._primaryView ?? opened._internalReader?._lastView)?._iframeWindow?.PDFViewerApplication?.pdfDocument;
      const globals = globalThis as unknown as { IOUtils?: { stat?: unknown }; Cu?: { cloneInto?: unknown }; crypto?: { subtle?: { digest?: unknown } } };
      const diagnostic: Record<string, unknown> = { loadedByteAPI: typeof pdf?.getData, globalFileStat: typeof globals.IOUtils?.stat, globalCloneInto: typeof globals.Cu?.cloneInto, globalDigest: typeof globals.crypto?.subtle?.digest, substep: 'loaded-byte-read' };
      report.checks.at(-1)!.details = diagnostic; await save();
      requireCheck(typeof pdf?.getData === 'function', 'LOADED_PDF_BYTES_UNAVAILABLE'); const loadedBytes = new Uint8Array(await pdf.getData());
      diagnostic.loadedBytes = loadedBytes.length; diagnostic.substep = 'loaded-and-file-hash'; await save();
      const importedPath = await fixture.main.getFilePathAsync(); requireCheck(importedPath, 'IMPORTED_SYNTHETIC_PDF_MISSING');
      const [loadedHash, fileHash] = await Promise.all([digest(loadedBytes), host.io.computeHexDigest(importedPath, 'sha256')]);
      diagnostic.loadedMatchesDisk = loadedHash === fileHash; diagnostic.substep = 'production-source-capture'; await save();
      const captured = await source.capture(); const signal = new AbortController().signal;
      const nativePage = await captured.pdf.getPageData({ pageIndex: 0 });
      diagnostic.nativeCharacterCount = nativePage.chars.length; diagnostic.nativePartial = nativePage.partial === true;
      diagnostic.firstCharacterType = typeof nativePage.chars[0]?.c;
      try { nativePage.chars.map(char => char.c); diagnostic.foreignArrayMap = true; } catch { diagnostic.foreignArrayMap = false; }
      try { Array.from(nativePage.chars).map(char => char.c); diagnostic.localArrayMap = true; } catch { diagnostic.localArrayMap = false; }
      diagnostic.substep = 'production-document-cache-read'; await save();
      const document = await cache.read(paper, captured, signal, () => {}); await source.validate(document);
      diagnostic.coverage = document.pages.map(page => ({ pageIndex: page.pageIndex, status: page.status, partial: page.partial === true, characters: page.text.length })); await save();
      const body = document.pages.map(page => page.text).join('\n');
      requireCheck(document.totalPages === 2 && document.pages.length === 2 && document.pages.every(page => page.status === 'text' && !page.partial), 'FULL_PDF_TEXT_COVERAGE_FAILED');
      requireCheck(document.pages[0]?.pageLabel === 'i' && document.pages[1]?.pageLabel === '1' && body.includes(verificationToken) && !body.includes('BAMBOO-19'), 'SYNTHETIC_MAIN_TEXT_IDENTITY_FAILED');
      requireCheck(loadedHash === fileHash && document.revision.sha256 === fileHash, 'LOADED_AND_DISK_HASH_MISMATCH');
      return { value: document, details: { pages: document.totalPages, pageLabels: document.pages.map(page => page.pageLabel), textCharacters: body.length, loadedBytes: loadedBytes.length, sha256: fileHash, loadedBytesMatchFile: true } };
    });
    requireCheck(document, 'DOCUMENT_NOT_PREPARED');
    await step('native-quote-coordinate-resolution', 'real-host-api', async () => {
      const quote = 'Calibration constant for this synthetic example: 37. A prior describes beliefs before a measurement is observed.';
      const resolution = await native.resolveQuote({ paper, revision: document.revision, quote });
      requireCheck(resolution.status === 'resolved', 'QUOTE_DID_NOT_RESOLVE');
      requireCheck(resolution.candidate.position.pageIndex === 0 && resolution.candidate.position.rects.length >= 2 && resolution.candidate.pageLabel === 'i', 'QUOTE_COORDINATES_UNAVAILABLE');
      return { value: resolution.candidate, details: { pageLabel: resolution.candidate.pageLabel, pageIndex: 0, rectangles: resolution.candidate.position.rects.length, multiLineQuote: true, sortIndex: resolution.candidate.sortIndex } };
    });
    await step('globally-ambiguous-quote-stays-unresolved-and-unwritten', 'synthetic-proposal-real-host-write', async () => {
      const repeated = 'A prior describes beliefs before a measurement is observed.';
      const task = await taskController.planAnnotations({ conversationId: host.uuid(), paper, revision: document.revision, question: 'Synthetic ambiguity control: do not write a quote that occurs on both pages.', modelRequestId: host.uuid(), candidates: [{ quote: repeated, pageIndex: 0, reason: 'The model page is only a hint and cannot hide the second occurrence.' }] });
      const item = task.kind === 'annotations' ? task.items[0] : undefined; await fixture.main.loadAllData();
      requireCheck(task.state === 'review' && item?.status === 'unresolved' && item.resolution?.status === 'ambiguous' && item.resolution.matches === 2 && fixture.main.getAnnotations().length === 0, 'AMBIGUOUS_QUOTE_WAS_NOT_SKIPPED');
      return { value: true, details: { modelProposedPage: 0, nativeOutcome: item.resolution.status, nativeMatches: item.resolution.matches, nativeWrites: 0, approveEligible: false } };
    });
    const proposals = [
      { quote: 'Calibration constant for this synthetic example: 37. A prior describes beliefs before a measurement is observed.', pageIndex: 0, reason: 'Synthetic unique multi-line candidate on the first physical page.' },
      { quote: `Hidden verification token on this page: ${verificationToken}. A prior describes beliefs before a measurement is observed.`, pageIndex: 1, reason: 'Synthetic unique multi-line candidate on the second physical page.' },
    ];
    const conversationId = host.uuid();
    const plan = async () => taskController.planAnnotations({ conversationId, paper, revision: document.revision, question: 'Synthetic smoke: annotate the two supplied definitions.', modelRequestId: host.uuid(), candidates: proposals });
    const firstTask = await step('batch-review-produces-zero-native-annotations', 'synthetic-proposal-real-host-write', async () => {
      const task = await plan(); await fixture.main.loadAllData();
      requireCheck(task.state === 'review' && task.items.length === 2 && task.items.every(item => item.kind === 'annotation' && item.resolution?.status === 'resolved'), 'ANNOTATION_REVIEW_FAILED');
      requireCheck(fixture.main.getAnnotations().length === 0, 'PREAPPROVAL_NATIVE_WRITE_DETECTED');
      return { value: task, details: { candidateCount: task.items.length, nativeAnnotationCountBeforeApproval: 0, proposalSource: 'deterministic-synthetic-fixture' } };
    });
    requireCheck(firstTask, 'FIRST_TASK_UNAVAILABLE');
    await step('batch-approval-creates-native-annotations-once', 'synthetic-proposal-real-host-write', async () => {
      guard(); const selected = firstTask.items.map(item => item.id); const approved = await taskController.approve(firstTask.id, selected); const repeated = await taskController.approve(firstTask.id, selected); await fixture.main.loadAllData();
      requireCheck(approved.state === 'completed' && repeated.state === 'completed' && approved.items.every(item => item.kind === 'annotation' && item.annotation), 'BATCH_NATIVE_WRITE_FAILED');
      requireCheck(fixture.main.getAnnotations().length === 2 && fixture.supplement.getAnnotations().length === 0, 'BATCH_DUPLICATED_OR_WRONG_ATTACHMENT');
      const restored = new ActionTaskController(new GeckoStorage(host, ledger), native, { uuid: () => host.uuid(), key: () => Zotero.Utilities.generateObjectKey(), now: () => new Date().toISOString() });
      requireCheck((await restored.get(approved.id)).state === 'completed', 'GECKO_LEDGER_READBACK_FAILED');
      return { value: approved, details: { taskId: approved.id, annotations: 2, repeatedApprovalCreatedExtra: false, persistentLedgerReadback: true } };
    });
    await step('batch-undo-removes-only-task-annotations', 'synthetic-proposal-real-host-write', async () => {
      guard(); const result = await taskController.undo(firstTask.id); await fixture.main.loadAllData();
      requireCheck(result.state === 'undone' && fixture.main.getAnnotations().length === 0 && !fixture.main.deleted, 'NATIVE_ANNOTATION_UNDO_FAILED');
      requireCheck((await source.capture()).revision.sha256 === document.revision.sha256, 'UNDO_CHANGED_PDF_BYTES');
      return { value: true, details: { remainingAnnotations: 0, attachmentRetained: true, pdfHashUnchanged: true } };
    });
    await step('undo-preserves-a-subsequent-native-user-edit', 'synthetic-user-edit-real-host-api', async () => {
      const task = await plan(); guard(); const approved = await taskController.approve(task.id, task.items.map(item => item.id));
      requireCheck(approved.kind === 'annotations' && approved.state === 'completed', 'CONFLICT_FIXTURE_APPROVAL_FAILED');
      const saved = approved.items[0]?.annotation; requireCheck(saved, 'CONFLICT_FIXTURE_ANNOTATION_MISSING');
      const edited = Zotero.Items.getByLibraryAndKey(libraryID, saved.key); requireCheck(edited && edited.isAnnotation(), 'EDIT_TARGET_MISSING');
      const comment = 'Synthetic manual edit: retain this correction when the task is undone.';
      guard(); edited.annotationComment = comment; await edited.saveTx({ skipSelect: true }); const sameSecond = edited.dateModified === saved.dateModified;
      guard(); const result = await taskController.undo(task.id); await fixture.main.loadAllData();
      const current = Zotero.Items.getByLibraryAndKey(libraryID, saved.key);
      requireCheck(result.state === 'conflict' && current && current.annotationComment === comment && fixture.main.getAnnotations().length === 1, 'UNDO_OVERWROTE_MANUAL_EDIT');
      if (report.retained) report.retained.manuallyEditedAnnotationKey = saved.key;
      return { value: true, details: { conflictingAnnotationKey: saved.key, nativeCommentEditPreserved: true, otherTaskAnnotationRemoved: true, editInSameTimestampSecond: sameSecond, userEditSource: 'driver simulates a user edit through native Item.saveTx' } };
    });
    // Bounded real-host check of the citation path: production locate + native navigate on the
    // frozen revision, with an explicit synthetic fixture quote. No library write and no model output.
    await step('citation-quote-navigation-on-frozen-revision', 'real-host-api', async () => {
      const annotationsBefore = fixture.main.getAnnotations().length;
      const quote = 'A prior describes beliefs before a measurement is observed.';
      type CitationViewer = { currentPageNumber?: number; currentScaleValue?: string | number; pagesRotation?: number };
      const exercise = async (label: string) => {
        guard(); const before = new Set(Zotero.Reader._readers); const reader = await Zotero.Reader.open(fixture.main.id, undefined, { allowDuplicate: true, openInBackground: false });
        requireCheck(!before.has(reader) && reader.itemID === fixture.main.id, 'CITATION_READER_OWNERSHIP_MISMATCH'); ownedReaders.push(reader); if (reader._initPromise) await reader._initPromise;
        const ready = await until(() => { const view = reader._internalReader?._primaryView ?? reader._internalReader?._lastView; const application = view?._iframeWindow?.PDFViewerApplication; return application?.pdfDocument && application.pdfViewer ? application : undefined; }, `${label}-pdf-ready`, 60000);
        const viewer = ready.pdfViewer as unknown as CitationViewer;
        requireCheck(viewer && typeof viewer.currentPageNumber === 'number', 'READER_VIEWER_PAGE_NUMBER_UNAVAILABLE');
        let zoomExercised = false; try { viewer.currentScaleValue = 'page-width'; zoomExercised = viewer.currentScaleValue === 'page-width'; } catch { /* Diagnosed below as an unavailable setup. */ }
        const requestedRotation = typeof viewer.pagesRotation === 'number' ? (viewer.pagesRotation + 90) % 360 : undefined;
        let rotationExercised = false; if (requestedRotation !== undefined) { try { viewer.pagesRotation = requestedRotation; rotationExercised = viewer.pagesRotation === requestedRotation; } catch { /* Diagnosed below as an unavailable setup. */ } }
        type ViewState = { scale: string | number | undefined; rotation: number | undefined; page: number | undefined };
        const viewState = (): ViewState => ({ scale: viewer.currentScaleValue, rotation: viewer.pagesRotation, page: viewer.currentPageNumber });
        const immediatelyAfterSet = viewState();
        requireCheck(zoomExercised && rotationExercised, 'CITATION_VIEW_STATE_SETUP_UNAVAILABLE');
        const waitForStableRequestedView = async (code: string): Promise<ViewState> => {
          let stableSamples = 0;
          return until(() => {
            const current = viewState(); const matches = current.scale === 'page-width' && current.rotation === requestedRotation;
            stableSamples = matches ? stableSamples + 1 : 0; return stableSamples >= 2 ? current : undefined;
          }, code, 5000);
        };
        const settledAfterSet = await waitForStableRequestedView(`${label}-view-state-after-set`);
        await reader.navigate({ pageIndex: 1 }); await until(() => viewer.currentPageNumber === 2, `${label}-move-to-second-page`);
        const afterInitialNavigate = viewState();
        const beforeOpenSourcePage = await waitForStableRequestedView(`${label}-view-state-before-source-open`);
        const navigator = nativeSourceNavigator(Zotero as unknown as ZoteroHost, () => reader, paper);
        const outcome = await openSourcePage(navigator, { paper, revision: document.revision }, 0, quote);
        await until(() => viewer.currentPageNumber === 1, `${label}-navigate-to-citation-page`);
        const afterOpenSourcePage = viewState();
        const observed = { label, outcome, zoomExercised, rotationExercised, requestedScale: 'page-width', requestedRotation, immediatelyAfterSet, settledAfterSet, afterInitialNavigate, beforeOpenSourcePage, afterOpenSourcePage };
        const currentDetails = report.checks.at(-1)!.details ?? {}; report.checks.at(-1)!.details = { ...currentDetails, [label]: observed };
        requireCheck(outcome === 'highlighted' && afterOpenSourcePage.scale === beforeOpenSourcePage.scale && afterOpenSourcePage.rotation === beforeOpenSourcePage.rotation, 'CITATION_NAVIGATION_CHANGED_VIEW_STATE');
        reader.close(); await until(() => !Zotero.Reader._readers.includes(reader), `${label}-reader-close`); window!.Zotero_Tabs.select(opened.tabID);
        return { ...observed, scalePreserved: true, rotationPreserved: true };
      };
      const first = await exercise('citation-first-open'); const reopened = await exercise('citation-reopen');
      const navigator = nativeSourceNavigator(Zotero as unknown as ZoteroHost, () => opened, paper); const missQuote = 'SYNTHETIC ABSENT QUOTE 9F3K'; const miss = await openSourcePage(navigator, { paper, revision: document.revision }, 0, missQuote);
      guard(); await fixture.main.loadAllData();
      requireCheck(first.outcome === 'highlighted' && reopened.outcome === 'highlighted' && miss === 'unlocated', 'CITATION_PATH_OUTCOME_UNEXPECTED');
      requireCheck(fixture.main.getAnnotations().length === annotationsBefore, 'CITATION_PATH_WROTE_TO_LIBRARY');
      return { value: true, details: { firstOpen: first, reopened, missOutcome: miss, navigationPageIndex: 0, quoteIsSyntheticFixture: true, modelProducedQuote: false, libraryWrite: false, annotationsBefore, annotationsAfter: fixture.main.getAnnotations().length } };
    });
    const references = createLibraryReferencePort(Zotero, { clientId, documentCache: cache, uuid: () => host.uuid(), getWindow: () => window });
    const referencePort: LibraryReferencePort = references;
    const figureSelection: NativeFigureSelection = { paper, revision: document.revision, pageIndex: 0, rect: [40, 400, 540, 760] };
    const figureProposal = { box: [0.1, 0.2, 0.5, 0.6] as [number, number, number, number], strokes: [[[0.1, 0.2], [0.3, 0.6], [0.5, 0.2]] as Array<[number, number]>], explanation: 'Synthetic callout: the boxed area illustrates this figure panel.' };
    const figureReview = await step('figure-crop-review-freezes-region-without-writing', 'synthetic-proposal-real-host-write', async () => {
      guard(); await fixture.main.loadAllData(); const annotationsBefore = fixture.main.getAnnotations().length;
      const image: ImageAttachment = await references.captureRegion(figureSelection);
      requireCheck(image.mime === 'image/png' && image.origin?.kind === 'paper' && image.origin.paper.attachmentKey === paper.attachmentKey && image.origin.pageIndex === figureSelection.pageIndex && image.origin.revision.sha256 === document.revision.sha256, 'FIGURE_CROP_ORIGIN_INVALID');
      const task = await taskController.planFigureAnnotations({ conversationId: host.uuid(), question: 'Synthetic smoke: explain and call out this figure region.', modelRequestId: host.uuid(), selection: figureSelection, image, proposals: [figureProposal] });
      requireCheck(task.kind === 'figure-annotations' && task.state === 'review' && task.selection.pageIndex === figureSelection.pageIndex && task.selection.rect.every((value, index) => value === figureSelection.rect[index]) && task.items.length === 1 && task.items[0]?.status === 'candidate', 'FIGURE_REVIEW_NOT_FROZEN');
      const item = task.items[0]; requireCheck(item?.kind === 'figure-callout' && item.reservedKey !== item.inkKey, 'FIGURE_RESERVED_KEYS_INVALID');
      requireCheck(!Zotero.Items.getByLibraryAndKey(libraryID, item.reservedKey) && !Zotero.Items.getByLibraryAndKey(libraryID, item.inkKey) && fixture.main.getAnnotations().length === annotationsBefore, 'FIGURE_PREAPPROVAL_WRITE_DETECTED');
      return { value: { task, item, image, input: { selection: figureSelection, image, index: 0, imageKey: item.reservedKey, inkKey: item.inkKey, proposal: figureProposal } satisfies NativeFigureCalloutInput, annotationsBefore }, details: { taskId: task.id, physicalPageIndex: figureSelection.pageIndex, selectedRectanglePoints: figureSelection.rect, cropMime: image.mime, cropOriginRevisionMatches: true, callouts: 1, nativeWritesBeforeApproval: 0, modelProposalSource: 'deterministic-synthetic-fixture' } };
    });
    requireCheck(figureReview, 'FIGURE_REVIEW_UNAVAILABLE');
    const figureApplied = await step('figure-approval-writes-native-image-ink-and-cached-png', 'synthetic-proposal-real-host-write', async () => {
      guard(); const approved = await taskController.approve(figureReview.task.id, [figureReview.item.id]);
      const itemAfterApproval = approved.kind === 'figure-annotations' ? approved.items[0] : undefined;
      let inspectionStatus = 'unavailable';
      try { inspectionStatus = (await native.inspectFigureCallout(figureReview.input)).status; } catch { inspectionStatus = 'inspection-failed'; }
      const expectedLabel = 'A: Synthetic callout: the boxed area illustrates this figure panel.';
      const inspectCalloutItem = async (key: string, type: 'image' | 'ink') => {
        const item = Zotero.Items.getByLibraryAndKey(libraryID, key); if (!item) return { exists: false };
        await item.loadAllData(); const json = await Zotero.Annotations.toJSON(item);
        let position: unknown = null; try { position = JSON.parse(item.annotationPosition ?? '{}'); } catch { /* Keep only the invalid-source status. */ }
        return {
          exists: true, annotationType: item.annotationType, parentMatches: item.parentID === fixture.main.id,
          provenancePresent: item.annotationComment?.startsWith('[AI · Zotero ChatGPT]') === true,
          expectedCommentPresent: type === 'image' ? item.annotationComment?.includes(expectedLabel) === true : item.annotationComment?.includes('A callout') === true,
          color: item.annotationColor, pageLabel: item.annotationPageLabel, sortIndexValid: /^\d{5}\|\d{6}\|\d{5}$/u.test(item.annotationSortIndex ?? ''),
          isExternal: item.annotationIsExternal, tags: item.getTags().length, position,
          cachePresent: typeof json.image === 'string', cacheMatchesFrozenCrop: json.image === figureReview.image.dataUrl,
          cacheHashMatchesFrozenCrop: typeof json.image === 'string' ? await digestText(json.image) === await digestText(figureReview.image.dataUrl) : false,
        };
      };
      const details: Record<string, unknown> = { taskState: approved.state, itemStatus: itemAfterApproval?.status ?? 'missing', errorCode: itemAfterApproval?.errorCode ?? null, operation: itemAfterApproval?.operation ?? null, nativePairInspection: inspectionStatus };
      if (approved.kind === 'figure-annotations' && approved.state !== 'completed') details.nativeReadback = { image: await inspectCalloutItem(figureReview.item.reservedKey, 'image'), ink: await inspectCalloutItem(figureReview.item.inkKey, 'ink') };
      report.checks.at(-1)!.details = details;
      await save();
      requireCheck(approved.kind === 'figure-annotations' && approved.state === 'completed' && approved.items[0]?.kind === 'figure-callout' && approved.items[0].status === 'applied' && approved.items[0].callout, 'FIGURE_APPROVAL_FAILED');
      const callout = approved.items[0].callout;
      const area = Zotero.Items.getByLibraryAndKey(libraryID, figureReview.item.reservedKey); const ink = Zotero.Items.getByLibraryAndKey(libraryID, figureReview.item.inkKey);
      requireCheck(area && ink && area.isAnnotation() && ink.isAnnotation() && area.annotationType === 'image' && ink.annotationType === 'ink' && area.parentID === fixture.main.id && ink.parentID === fixture.main.id, 'FIGURE_NATIVE_ANNOTATION_TYPES_INVALID');
      await fixture.main.loadAllData();
      const [areaJSON, inkJSON, inspection] = await Promise.all([Zotero.Annotations.toJSON(area), Zotero.Annotations.toJSON(ink), native.inspectFigureCallout(figureReview.input)]);
      requireCheck(typeof areaJSON.image === 'string' && areaJSON.image.startsWith('data:image/png;base64,') && typeof inkJSON.image === 'string' && inkJSON.image.startsWith('data:image/png;base64,'), 'FIGURE_NATIVE_CACHE_IMAGE_READBACK_FAILED');
      requireCheck(inspection.status === 'complete' && JSON.stringify(inspection.callout) === JSON.stringify(callout), 'FIGURE_NATIVE_TASK_READBACK_MISMATCH');
      const imagePosition = callout.image.position; const inkPosition = callout.ink.position;
      requireCheck('rects' in imagePosition && 'paths' in inkPosition, 'FIGURE_NATIVE_POSITION_KINDS_INVALID');
      const imageRect = imagePosition.rects[0]; const inkPath = inkPosition.paths[0];
      requireCheck(imageRect?.every((value, index) => Math.abs(value - [90, 544, 290, 688][index]!) < 0.001), 'FIGURE_IMAGE_COORDINATE_TRANSFORM_INVALID');
      requireCheck(inkPath?.every((value, index) => Math.abs(value - [90, 688, 190, 544, 290, 688][index]!) < 0.001), 'FIGURE_INK_COORDINATE_TRANSFORM_INVALID');
      requireCheck(callout.image.imageSHA256 === await digestText(String(areaJSON.image)) && callout.ink.imageSHA256 === await digestText(String(inkJSON.image)), 'FIGURE_CACHE_HASH_READBACK_FAILED');
      return { value: { approved, area, ink }, details: { taskId: approved.id, imageKey: callout.image.key, inkKey: callout.ink.key, imageType: callout.image.type, inkType: callout.ink.type, imageRect, inkPaths: inkPosition.paths.length, cachedPNGsVerified: true, zoteroAreaCacheRegeneratedFromNativeBounds: areaJSON.image !== figureReview.image.dataUrl, exactNativeReadback: true, deterministicProposal: true } };
    });
    requireCheck(figureApplied, 'FIGURE_APPLY_UNAVAILABLE');
    await step('figure-undo-removes-both-task-items-and-cache-readback', 'synthetic-proposal-real-host-write', async () => {
      guard(); const result = await taskController.undo(figureApplied.approved.id); await fixture.main.loadAllData();
      const area = Zotero.Items.getByLibraryAndKey(libraryID, figureReview.item.reservedKey); const ink = Zotero.Items.getByLibraryAndKey(libraryID, figureReview.item.inkKey);
      const [areaCache, inkCache] = await Promise.all([Zotero.Annotations.hasCacheImage(figureApplied.area), Zotero.Annotations.hasCacheImage(figureApplied.ink)]);
      const inspection = await native.inspectFigureCallout(figureReview.input);
      requireCheck(result.kind === 'figure-annotations' && result.state === 'undone' && !area && !ink && inspection.status === 'absent', 'FIGURE_NATIVE_UNDO_FAILED');
      requireCheck(!areaCache && !inkCache && fixture.main.getAnnotations().length === figureReview.annotationsBefore, 'FIGURE_TASK_OUTPUT_OR_CACHE_REMAINS');
      requireCheck((await source.capture()).revision.sha256 === document.revision.sha256, 'FIGURE_UNDO_CHANGED_PDF_BYTES');
      return { value: true, details: { taskId: result.id, remainingTaskOwnedAnnotations: 0, remainingTaskOwnedCacheImages: 0, unrelatedAnnotationsPreserved: true, attachmentRetained: true, pdfHashUnchanged: true } };
    });
    await verifyReferenceImagesAndReaders({ report, step, host, contextRoot, window, opened, paper, supplementPaper, document, fixture, references, referencePort, verificationToken, until });
    await step('native-metadata-create-and-undo-use-synthetic-data', 'real-host-api', async () => {
      const reservedKey = Zotero.Utilities.generateObjectKey(); const metadata: NativeMetadata = { itemType: 'journalArticle', title: `[SYNTHETIC METADATA FIXTURE] ${report.runId}`, creators: [], abstractNote: 'Local deterministic mock metadata, not obtained from a model or network. Tests only native item/collection writes.' };
      guard(); const created = await native.createItem({ target: { clientId, libraryId: libraryID, collectionKey: fixture.collection.key }, key: reservedKey, metadata });
      const actual = Zotero.Items.getByLibraryAndKey(libraryID, reservedKey);
      requireCheck(actual && actual.getField('title') === metadata.title && created.collectionKeys.includes(fixture.collection.key), 'SYNTHETIC_METADATA_IMPORT_FAILED');
      guard(); const undo = await native.undoCreatedItem({ expected: created, attachments: [] });
      const trashed = Zotero.Items.getByLibraryAndKey(libraryID, reservedKey);
      requireCheck(undo.status === 'trashed' && trashed && trashed.deleted, 'SYNTHETIC_METADATA_UNDO_FAILED');
      return { value: true, details: { metadataSource: 'local deterministic mock fixture', nativeItemKey: reservedKey, collectionKey: fixture.collection.key, movedToTrash: true, realNetworkAcquisition: false, realModelOutput: false } };
    });
    await step('public-doi-unsaved-native-translator-preview', 'real-network-translator', async () => {
      const doi = '10.1038/nature14539'; const before = (await Zotero.Items.getAll(libraryID, false, true, true)).sort((a, b) => a - b);
      const abort = new AbortController(); const timeout = window!.setTimeout(() => abort.abort(), 45000);
      try {
        const preview = await native.previewMetadata({ identifier: doi }, abort.signal);
        requireCheck(preview.source === 'identifier' && preview.candidates.length > 0 && preview.candidates.every(item => item.DOI?.toLowerCase() === doi && !!item.title), 'PUBLIC_DOI_PREVIEW_UNVERIFIED');
        const after = (await Zotero.Items.getAll(libraryID, false, true, true)).sort((a, b) => a - b);
        requireCheck(JSON.stringify(before) === JSON.stringify(after), 'UNSAVED_TRANSLATOR_CHANGED_LIBRARY');
        return { value: true, details: { inputDOI: doi, candidateCount: preview.candidates.length, titles: preview.candidates.map(item => item.title), libraryItemIDsUnchanged: true, saved: false, pdfDownloaded: false } };
      } finally { window!.clearTimeout(timeout); }
    }, true);
    report.status = report.checks.some(check => check.status === 'failed') ? 'partial' : 'passed';
  } catch (error) {
    report.status = 'failed';
    if (!report.checks.some(check => check.status === 'failed')) report.checks.push({ name: currentStage, evidence: 'real-host-api', status: 'failed', ok: false, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), failure: safeFailure(error) });
  } finally {
    unsubscribe?.(); await reportTail;
    for (const reader of ownedReaders) {
      guard();
      if (Zotero.Reader._readers.includes(reader)) reader.close();
    }
    if (window && previousTab && tabInfo(window, previousTab)?.id === previousTab) window.Zotero_Tabs.select(previousTab);
    report.completedAt = new Date().toISOString(); await save();
  }
  return report;
}

type Step = <T>(name: string, evidence: Evidence, work: () => Promise<{ value: T; details?: Record<string, unknown> }>, optional?: boolean) => Promise<T | undefined>;
async function verifyReferenceImagesAndReaders(options: {
  report: NativeSmokeReport; step: Step; host: FileHost; contextRoot: string; window: SmokeWindow; opened: SmokeReader; paper: PaperScope; supplementPaper: PaperScope; document: DocumentContext;
  fixture: { parent: SmokeItem; main: SmokeItem; supplement: SmokeItem }; references: ReturnType<typeof createLibraryReferencePort>; referencePort: LibraryReferencePort;
  verificationToken: string;
  until<T>(this: void, read: () => T | false | undefined, code: string, timeout?: number): Promise<T>;
}): Promise<void> {
  const { step, host, window, opened, paper, supplementPaper, fixture, references, referencePort, until } = options;
  await step('native-capture-page-produces-paper-origin-image', 'real-host-api', async () => {
    const viewer = (opened._internalReader?._primaryView ?? opened._internalReader?._lastView)?._iframeWindow?.PDFViewerApplication?.pdfViewer;
    const scale = viewer?.currentScaleValue;
    const nativePDF = (opened._internalReader?._primaryView ?? opened._internalReader?._lastView)?._iframeWindow?.PDFViewerApplication?.pdfDocument as unknown as { getPage(index: number): Promise<{ getViewport?: unknown; render?: unknown; view?: unknown; wrappedJSObject?: unknown }> };
    const nativePage = await nativePDF.getPage(1);
    const cu = (globalThis as unknown as { Cu?: { waiveXrays?(value: object): unknown } }).Cu;
    const waived = cu?.waiveXrays?.(nativePage) as { getViewport?: unknown; render?: unknown; view?: unknown } | undefined;
    options.report.checks.at(-1)!.details = { pageGetViewport: typeof nativePage.getViewport, pageRender: typeof nativePage.render, pageViewIsArray: Array.isArray(nativePage.view), pageViewLength: Array.isArray(nativePage.view) ? nativePage.view.length : null, waivedGetViewport: typeof waived?.getViewport, waivedRender: typeof waived?.render, waivedViewIsArray: Array.isArray(waived?.view) };
    const image = await references.capturePage(paper, 0);
    requireCheck(image.mime === 'image/png' && image.origin?.kind === 'paper' && image.origin.paper.attachmentKey === paper.attachmentKey && image.origin.revision.sha256 === options.document.revision.sha256, 'CAPTURE_PAGE_ORIGIN_INVALID');
    const bytes = Uint8Array.from(atob(image.dataUrl.slice(image.dataUrl.indexOf(',') + 1)), character => character.charCodeAt(0));
    requireCheck(bytes.length > 24 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71, 'CAPTURE_PAGE_BYTES_INVALID');
    const view = new DataView(bytes.buffer); const width = view.getUint32(16); const height = view.getUint32(20);
    requireCheck(width === 1190 && height === 1684 && viewer?.currentScaleValue === scale, 'CAPTURE_PAGE_SCALE_OR_DIMENSIONS_CHANGED');
    const screenshotName = `native-agent-page-${options.report.runId}.png`; const screenshotPath = host.join(options.contextRoot, screenshotName); requireCheck(!host.isSymlink(screenshotPath), 'SCREENSHOT_PATH_UNSAFE');
    await host.io.write(screenshotPath, bytes, { mode: 'create', flush: true });
    return { value: true, details: { mime: image.mime, width, height, bytes: bytes.length, sha256: await digest(bytes), artifact: screenshotName, origin: 'paper', pageIndex: 0, pdfZoomUnchanged: true, generatedImage: false } };
  });
  await step('article-reference-background-reader-lifecycle', 'real-host-api', async () => {
    const results = await referencePort.search(options.report.runId); const supplement = results.find(reference => reference.paper?.attachmentKey === supplementPaper.attachmentKey);
    const main = results.find(reference => reference.paper?.attachmentKey === paper.attachmentKey);
    requireCheck(supplement && main, 'SYNTHETIC_ARTICLE_REFERENCES_NOT_FOUND');
    requireCheck(!Zotero.Reader._readers.some(reader => reader.itemID === fixture.supplement.id), 'SUPPLEMENT_READER_ALREADY_PRESENT');
    const selected = window.Zotero_Tabs.selectedID; const beforeReaders = new Set(Zotero.Reader._readers);
    const added = new Set<string>(); const closed = new Set<string>(); const selectedBackground = new Set<string>();
    const observer = Zotero.Notifier.registerObserver({ notify(event, type, ids) {
      if (type !== 'tab') return;
      for (const value of ids) {
        const id = String(value); if (!id.startsWith('zchatgpt-reference-')) continue;
        if (event === 'add') added.add(id); if (event === 'close') closed.add(id); if (event === 'select') selectedBackground.add(id);
      }
    } }, ['tab'], `zchatgpt-native-smoke-${options.report.runId}`);
    try {
      const value = await referencePort.read(supplement, new AbortController().signal);
      requireCheck(value.document?.paper.attachmentKey === fixture.supplement.key && value.document.pages.some(page => page.text.includes('BAMBOO-19')) && value.document.pages.every(page => !page.text.includes(options.verificationToken)), 'ARTICLE_REFERENCE_READ_WRONG_PDF');
      await until(() => !Zotero.Reader._readers.some(reader => reader.itemID === fixture.supplement.id), 'BACKGROUND_READER_NOT_RELEASED');
      await until(() => added.size > 0 && [...added].every(id => closed.has(id)), 'BACKGROUND_TAB_LIFECYCLE_NOT_OBSERVED');
      requireCheck(window.Zotero_Tabs.selectedID === selected && selectedBackground.size === 0 && Zotero.Reader._readers.every(reader => beforeReaders.has(reader)), 'BACKGROUND_REFERENCE_CHANGED_USER_TABS');
      const existing = await referencePort.read(main, new AbortController().signal);
      requireCheck(existing.document?.paper.attachmentKey === fixture.main.key && Zotero.Reader._readers.includes(opened) && window.Zotero_Tabs.selectedID === selected, 'EXISTING_READER_WAS_CLOSED_OR_REPLACED');
      return { value: true, details: { explicitOtherAttachmentRead: true, supplementTokenMatched: true, backgroundTabsOpened: added.size, backgroundTabsClosed: closed.size, foregroundSelectionPreserved: true, existingReaderRetained: true, mainAndSupplementSourcesDistinct: existing.document.id !== value.document.id } };
    } finally { Zotero.Notifier.unregisterObserver(observer); }
  });
}
