import type { ActionTasks } from '../../../contracts/src/tasks.ts';
import type { NativeCollectionCreateTarget, NativeCollectionTarget, NativeOrganizationItemSnapshot, NativeReaderPort } from '../../../contracts/src/native.ts';
import type { ModelOption, RuntimeSnapshot, StoragePort } from '../../../contracts/src/runtime.ts';
import type { ReaderWorkspace } from '../../../contracts/src/workspace.ts';
import { ReaderError } from '../../../contracts/src/index.ts';
import { discoverScholarlyWorks } from '../../../core/src/discovery/scholarly.ts';
import type { ScholarlyDiscoveryPort, ScholarlyDiscoveryPreview } from '../../../contracts/src/discovery.ts';
import { attachLibraryAgentDisplayText, getLibraryAgentSession, sendLibraryAgentMessage } from '../../../core/src/library/session.ts';
import { authorizesLibraryIntent, libraryAgentPrompt, negatesLibraryAction, parseLibraryAgentIntent, type LibraryAgentSkill } from '../../../core/src/library/intent.ts';
import type { CodexConnection } from '../../../core/src/codex/connection.ts';
import { enforcedAllowedModelIds, offeredModelIds } from '../../../core/src/workspace/allowed-models.ts';
import type { LibraryAgentWorkbenchState, LibraryAgentSend, LibrarySkillOption } from '../views/library-agent-workbench.ts';
import type { LibraryMentionResolver, LibraryMentionNativeTarget } from './mentions.ts';

export interface LibraryAgentOrchestratorOptions {
  sessionId: string;
  clientId: string;
  cwd: string;
  uuid(): string;
  storage: StoragePort;
  tasks: ActionTasks;
  workspace: ReaderWorkspace;
  mentions: LibraryMentionResolver;
  discovery: ScholarlyDiscoveryPort;
  reader: Pick<NativeReaderPort, 'inspectOrganizationItem'>;
  selectedItems(): Promise<NativeOrganizationItemSnapshot[]>;
  collections(): Promise<Array<NativeCollectionTarget & { name: string }>>;
  ensureAgent(): Promise<void>;
  runtime(): RuntimeSnapshot;
  connection(): Pick<CodexConnection, 'request' | 'onFailure'> | null;
  observeRuntime?(listener: () => void): () => void;
}

type Capability = LibrarySkillOption & { route: LibraryAgentSkill; instructions?: string };
function offeredModels(models: readonly ModelOption[], allowedIds?: readonly string[]): ModelOption[] {
  const byId = new Map(models.map(model => [model.id, model] as const));
  return offeredModelIds(models.map(model => model.id), allowedIds).flatMap(id => { const model = byId.get(id); return model ? [model] : []; });
}
const SKILLS: Capability[] = [
  { id: 'ask', name: 'ask', route: 'ask', description: 'Answer from the selected Zotero articles.' },
  { id: 'discover', name: 'discover', route: 'discover', description: 'Find papers by research topic.' },
  { id: 'acquire', name: 'acquire', route: 'acquire', description: 'Add explicit DOI or public article URLs to a collection.' },
  { id: 'organize', name: 'organize', route: 'organize', description: 'Add tags and existing collection memberships to selected papers.' },
  { id: 'metadata', name: 'metadata', route: 'metadata', description: 'Fill blank metadata fields from a verified DOI lookup.' },
  { id: 'note', name: 'note', route: 'note', description: 'Draft a source-grounded child note for selected articles.' },
  { id: 'collection', name: 'collection', route: 'collection', description: 'Create a named Zotero collection in a chosen library or parent collection.' },
];
const DISCOVERY_DIR = 'library-agent-discovery';
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_DISCOVERY_BYTES = 128 * 1024;

function distinct<T>(items: T[], key: (item: T) => string): T[] { const seen = new Set<string>(); return items.filter(item => { const id = key(item); if (seen.has(id)) return false; seen.add(id); return true; }); }
function discoveryPath(id: string): string { if (!SESSION_ID.test(id)) throw new ReaderError('INVALID_REQUEST', 'Invalid library Agent session.'); return `${DISCOVERY_DIR}/${id}.json`; }

/** Bounded source results can be referenced by a later “save these” turn without re-searching. */
async function loadDiscovery(storage: StoragePort, sessionId: string): Promise<ScholarlyDiscoveryPreview | null> {
  const bytes = await storage.read(discoveryPath(sessionId));
  if (!bytes) return null;
  if (bytes.length > MAX_DISCOVERY_BYTES) throw new ReaderError('HISTORY_UNAVAILABLE', 'Saved scholarly results are too large.');
  try {
    const row = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as ScholarlyDiscoveryPreview;
    if (row.source !== 'openalex' || !Array.isArray(row.candidates) || row.candidates.length > 20) throw new Error('invalid');
    return row;
  } catch { throw new ReaderError('HISTORY_UNAVAILABLE', 'Saved scholarly results could not be read safely.'); }
}
async function saveDiscovery(storage: StoragePort, sessionId: string, preview: ScholarlyDiscoveryPreview): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(preview));
  if (bytes.length > MAX_DISCOVERY_BYTES) throw new ReaderError('PAYLOAD_TOO_LARGE', 'Scholarly results are too large to save.');
  await storage.writeAtomic(discoveryPath(sessionId), bytes);
}
function indexes<T>(items: T[], requested: number[]): T[] {
  if (!requested.length || requested.some(index => !Number.isSafeInteger(index) || index < 0 || index >= items.length))
    throw new ReaderError('INVALID_REQUEST', 'The Agent referred to an item outside the frozen Zotero selection.');
  return requested.map(index => items[index]!);
}
function targetCollection(
  chosen: LibraryMentionNativeTarget[],
  collections: Array<NativeCollectionTarget & { name: string }>,
  proposedIndex: number | undefined,
): NativeCollectionTarget | null {
  const explicit = chosen.filter(item => item.kind === 'collection');
  if (explicit.length > 1) throw new ReaderError('INVALID_REQUEST', 'Choose one target collection for this acquisition.');
  const proposed = proposedIndex === undefined ? null : collections[proposedIndex];
  if (proposedIndex !== undefined && !proposed) throw new ReaderError('INVALID_REQUEST', 'The Agent proposed a collection outside the frozen list.');
  if (explicit.length && proposed && (explicit[0]!.libraryId !== proposed.libraryId || explicit[0]!.collectionKey !== proposed.collectionKey))
    throw new ReaderError('REQUEST_CONFLICT', 'The Agent proposed a different collection than the one you selected.');
  const selected = explicit[0];
  if (selected) {
    if (!selected.editable || !selected.collectionKey) throw new ReaderError('UNSUPPORTED_INTERACTION', 'The selected Zotero collection is not editable.');
    return { clientId: selected.clientId, libraryId: selected.libraryId, collectionKey: selected.collectionKey };
  }
  return proposed ? { clientId: proposed.clientId, libraryId: proposed.libraryId, collectionKey: proposed.collectionKey } : null;
}
function newCollectionTarget(chosen: LibraryMentionNativeTarget[], collections: Array<NativeCollectionTarget & { name: string }>,
  items: NativeOrganizationItemSnapshot[], proposedIndex: number | undefined): NativeCollectionCreateTarget {
  const explicitParents = chosen.filter(target => target.kind === 'collection');
  if (explicitParents.length > 1) throw new ReaderError('INVALID_REQUEST', 'Choose one parent @collection for the new collection.');
  const proposed = proposedIndex === undefined ? null : collections[proposedIndex];
  if (proposedIndex !== undefined && !proposed) throw new ReaderError('INVALID_REQUEST', 'The Agent proposed a parent collection outside the frozen list.');
  const explicit = explicitParents[0];
  if (explicit && (!explicit.editable || !explicit.collectionKey)) throw new ReaderError('UNSUPPORTED_INTERACTION', 'The selected parent collection is not editable.');
  if (explicit && proposed && (explicit.libraryId !== proposed.libraryId || explicit.collectionKey !== proposed.collectionKey))
    throw new ReaderError('REQUEST_CONFLICT', 'The Agent proposed a different parent collection than the one you selected.');
  const parent = explicit ?? proposed;
  if (parent) return { clientId: parent.clientId, libraryId: parent.libraryId, parentCollectionKey: parent.collectionKey ?? null };
  const libraries = new Set([...chosen.map(target => target.libraryId), ...items.map(item => item.libraryId)]);
  if (!libraries.size) for (const collection of collections) libraries.add(collection.libraryId);
  if (libraries.size !== 1) throw new ReaderError('INVALID_REQUEST', 'Choose one @library or @collection for the new collection.');
  return { clientId: (chosen[0] ?? items[0] ?? collections[0])!.clientId, libraryId: [...libraries][0]!, parentCollectionKey: null };
}
function displayDiscovery(preview: ScholarlyDiscoveryPreview, target: boolean): string {
  if (!preview.candidates.length) return `No matching works were found for “${preview.query.topic}”. No Zotero items were saved.`;
  const rows = preview.candidates.map((candidate, index) =>
    `${index + 1}. ${candidate.title}${candidate.year ? ` (${candidate.year})` : ''} · ${candidate.doi ?? candidate.source.workUrl} · ${candidate.openAccess.isOpenAccess ? 'OA reported' : 'PDF availability unknown'}`);
  return [`Found ${preview.candidates.length} source-attributed works for “${preview.query.topic}”.`, ...rows,
    target ? 'Review the Zotero metadata and PDF choices in the task below before saving.' : 'Choose one @collection and ask Agent to save these results. No Zotero items were saved.'].join('\n');
}

/** The sole bridge from a library conversation turn to bounded Zotero task proposals. */
export function createLibraryAgentOrchestrator(options: LibraryAgentOrchestratorOptions) {
  const listeners = new Set<(state: LibraryAgentWorkbenchState) => void>();
  let sending = false;
  const availableSkills = async (): Promise<Capability[]> => {
    const settings = await options.workspace.settings();
    const readers: Capability[] = settings.skills.filter(skill => skill.enabled && skill.workflow === 'read' && skill.unsupportedDependencies.length === 0)
      .map(skill => ({ id: `workspace:${skill.id}`, name: skill.name, description: skill.description, route: 'ask', instructions: skill.markdown }));
    return [...SKILLS, ...readers];
  };
  const state = async (): Promise<LibraryAgentWorkbenchState> => {
    const session = await getLibraryAgentSession({ storage: options.storage, sessionId: options.sessionId });
    const allowed = enforcedAllowedModelIds((await options.workspace.settings()).allowedModels);
    const models = offeredModels(options.runtime().models, allowed).map(model => ({ id: model.id, label: model.displayName }));
    const previousModel = [...session.messages].reverse().find(message => message.role === 'user')?.scope?.model;
    return {
      lines: session.messages.filter(message => message.role !== 'status').map(message => ({
        id: message.id, role: message.role === 'user' ? 'user' as const : 'agent' as const,
        text: message.content, state: message.status === 'failed' ? 'failed' as const : message.status === 'uncertain' ? 'uncertain' as const : 'completed' as const,
      })),
      busy: sending || session.messages.some(message => message.role === 'status' && ['starting', 'running'].includes(message.status ?? '')),
      model: models.some(model => model.id === previousModel) ? previousModel ?? null : models[0]?.id ?? null, models,
    };
  };
  const notify = () => { void state().then(snapshot => { for (const listener of listeners) listener(snapshot); }).catch(() => undefined); };
  const stopRuntime = options.observeRuntime?.(notify);
  const subscribe = (listener: (state: LibraryAgentWorkbenchState) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  const send = async (input: LibraryAgentSend): Promise<void> => {
    if (sending) throw new ReaderError('BUSY', 'Wait for the current library Agent request to finish.');
    const question = input.question.trim(); if (!question) throw new ReaderError('INVALID_REQUEST', 'Enter an Agent request.');
    // Start every local scope read at the click. Native selection identities are copied before their
    // first await, so a later focus change cannot retarget this request.
    const selectedPromise = options.selectedItems().catch(error => {
      if (error instanceof ReaderError && error.code === 'INVALID_REQUEST') return [] as NativeOrganizationItemSnapshot[];
      throw error;
    });
    const collectionPromise = options.collections();
    const mentionPromise = options.mentions.resolve(input.mentions.map(item => item.id));
    sending = true; notify();
    try {
      const skillPromise = input.skillId === null ? Promise.resolve(null) : availableSkills().then(skills => skills.find(item => item.id === input.skillId) ?? null);
      const [skill, selected, collections, resolved] = await Promise.all([skillPromise, selectedPromise, collectionPromise, mentionPromise]);
      if (input.skillId !== null && !skill) throw new ReaderError('UNSUPPORTED_INTERACTION', 'This Agent skill is not available.');
      const nativeTargets = resolved.nativeTargets;
      const scopedMentions = await Promise.all(nativeTargets.filter(target => target.kind === 'collection' || target.kind === 'library').map(target =>
        target.kind === 'collection'
          ? options.mentions.snapshotCollectionItems(target.id, 50)
          : options.mentions.snapshotLibraryItems(target.id, { query: question, max: 50 })));
      const incomplete = scopedMentions.find(snapshot => snapshot.overLimit);
      if (incomplete) throw new ReaderError('PAYLOAD_TOO_LARGE', `@${incomplete.mention.label} contains ${incomplete.totalItems} matching articles. Narrow the search or choose a smaller collection (maximum 50); no partial action was sent.`);
      const mentionedItems = await Promise.all(nativeTargets.filter(target => target.kind === 'article' && target.itemKey).map(async target => {
        const snapshot = await options.reader.inspectOrganizationItem({ clientId: target.clientId, libraryId: target.libraryId, key: target.itemKey! });
        if (!snapshot) throw new ReaderError('NOT_FOUND', 'An @article changed before the request was sent.');
        return snapshot;
      }));
      const scopedItems = await Promise.all(scopedMentions.flatMap(snapshot => snapshot.nativeTargets).map(async target => {
        const snapshot = await options.reader.inspectOrganizationItem({ clientId: target.clientId, libraryId: target.libraryId, key: target.itemKey });
        if (!snapshot) throw new ReaderError('NOT_FOUND', 'An @collection article changed before the request was sent.');
        return snapshot;
      }));
      const items = distinct([...selected, ...mentionedItems, ...scopedItems], item => `${item.clientId}:${item.libraryId}:${item.key}`);
      if (items.length > 50) throw new ReaderError('PAYLOAD_TOO_LARGE', 'This request includes more than 50 Zotero articles. Narrow the selection before sending.');
      const libraries = new Set([...items.map(item => item.libraryId), ...nativeTargets.map(item => item.libraryId)]);
      const safeCollections = collections.filter(collection => !libraries.size || libraries.has(collection.libraryId)).slice(0, 1000);
      const safeItems = items.map((item, itemIndex) => ({ itemIndex, metadata: item.metadata, tags: item.tags,
        collectionIndexes: safeCollections.flatMap((collection, collectionIndex) => item.collectionKeys.includes(collection.collectionKey) ? [collectionIndex] : []),
      }));
      const lastDiscovery = await loadDiscovery(options.storage, options.sessionId);
      const context = JSON.parse(libraryAgentPrompt({ question, skill: skill?.route ?? null, items: safeItems,
        collections: safeCollections.map((collection, collectionIndex) => ({ collectionIndex, name: collection.name })),
        mentions: resolved.modelContext.map(mention => ({ kind: mention.kind, label: mention.label })),
      })) as Record<string, unknown>;
      context.sourceScope = 'Zotero metadata and stored abstracts only; no PDF body was supplied by this library request';
      context.previousDiscovery = lastDiscovery?.candidates.map(candidate => ({ title: candidate.title, identifier: candidate.identifier, doi: candidate.doi })) ?? [];
      await options.ensureAgent();
      const runtime = options.runtime();
      if (runtime.account.state !== 'signedIn') throw new ReaderError('AUTH_REQUIRED', 'Sign in to Codex before sending a library Agent message.');
      const allowed = enforcedAllowedModelIds((await options.workspace.settings()).allowedModels);
      const offered = offeredModels(runtime.models, allowed);
      const model: ModelOption | undefined = input.modelId ? offered.find(item => item.id === input.modelId) : offered[0];
      if (!model) throw new ReaderError('MODEL_UNAVAILABLE', 'No selected GPT-6 Agent model is available for this account.');
      const connection = options.connection();
      if (!connection) throw new ReaderError('RUNTIME_UNAVAILABLE', 'The Agent connection is unavailable.');
      const reply = await sendLibraryAgentMessage({
        connection, storage: options.storage, sessionId: options.sessionId, question,
        context, mentions: resolved.modelContext.map(item => ({ type: item.kind === 'article' ? 'item' as const : item.kind, id: item.id, label: item.label })),
        ...(skill ? { skill: { id: skill.id, name: skill.name, ...(skill.instructions ? { instructions: skill.instructions } : {}) } } : {}),
        model, cwd: options.cwd, uuid: () => options.uuid(), outputFormat: 'json', onProgress: notify,
      });
      notify();
      if (reply.format !== 'json') throw new ReaderError('UNSUPPORTED_INTERACTION', 'The Agent returned an unexpected output format.');
      const intent = parseLibraryAgentIntent(reply.rawAnswer, skill?.route ?? null);
      if (intent.kind !== 'answer' && (negatesLibraryAction(question) || !skill && !authorizesLibraryIntent(question, intent.kind, !!lastDiscovery)))
        throw new ReaderError('UNSUPPORTED_INTERACTION', 'The request did not explicitly ask for this library action. No task was prepared.');
      if (intent.kind !== 'answer' && libraries.size > 1) throw new ReaderError('INVALID_REQUEST', 'Write actions must stay in one Zotero library.');
      let display: string;
      if (intent.kind === 'answer') display = intent.text;
      else if (intent.kind === 'discover') {
        const preview = await discoverScholarlyWorks(options.discovery, { topic: intent.query, limit: intent.limit,
          openAccessOnly: intent.openAccessOnly, ...(intent.yearFrom !== undefined ? { yearFrom: intent.yearFrom } : {}),
          ...(intent.yearTo !== undefined ? { yearTo: intent.yearTo } : {}) });
        await saveDiscovery(options.storage, options.sessionId, preview);
        const target = targetCollection(nativeTargets, safeCollections, intent.targetCollectionIndex);
        if (target && preview.candidates.length) await options.tasks.planAcquisition({ conversationId: options.sessionId, question,
          target, identifiers: preview.candidates.map(candidate => candidate.identifier) });
        display = displayDiscovery(preview, !!target);
      } else if (intent.kind === 'acquire') {
        const target = targetCollection(nativeTargets, safeCollections, intent.targetCollectionIndex);
        if (!target) throw new ReaderError('INVALID_REQUEST', 'Choose a target @collection for these papers. Nothing was saved.');
        if (lastDiscovery && !/10\.\d{4,9}\/|https?:\/\//iu.test(question)) {
          const known = new Set(lastDiscovery.candidates.map(candidate => candidate.identifier));
          if (intent.identifiers.some(identifier => !known.has(identifier))) throw new ReaderError('INVALID_REQUEST', 'The Agent proposed a paper outside the prior search results.');
        }
        await options.tasks.planAcquisition({ conversationId: options.sessionId, question, target, identifiers: intent.identifiers });
        display = `Prepared ${intent.identifiers.length} paper${intent.identifiers.length === 1 ? '' : 's'} for review. No Zotero write has happened yet.`;
      } else if (intent.kind === 'organize') {
        if (!items.length) throw new ReaderError('INVALID_REQUEST', 'Select or @mention at least one Zotero paper to organize.');
        if (intent.candidates.some(candidate => candidate.itemIndex >= items.length || candidate.collectionIndexes.some(index => index >= safeCollections.length)))
          throw new ReaderError('INVALID_REQUEST', 'The Agent referred to an item or collection outside the frozen selection.');
        await options.tasks.planOrganization({ conversationId: options.sessionId, question, selection: items, collections: safeCollections, proposals: intent.candidates });
        display = `Prepared ${intent.candidates.length} selected item${intent.candidates.length === 1 ? '' : 's'} for one review. Existing tags and memberships remain unchanged until approval.`;
      } else if (intent.kind === 'metadata') {
        const selection = indexes(items, intent.itemIndexes);
        await options.tasks.planMetadataUpdate({ conversationId: options.sessionId, question, selection });
        display = `Prepared a verified blank-field metadata preview for ${selection.length} item${selection.length === 1 ? '' : 's'}. Review before applying.`;
      } else if (intent.kind === 'collection') {
        const target = newCollectionTarget(nativeTargets, safeCollections, items, intent.parentCollectionIndex);
        await options.tasks.planCollectionCreate({ conversationId: options.sessionId, question, target, name: intent.name });
        display = `Prepared the new “${intent.name}” collection for review. No Zotero collection has been created yet.`;
      } else {
        const proposals = intent.notes.map(note => ({ parent: indexes(items, [note.itemIndex])[0]!, body: note.text }));
        if (proposals.some(proposal => !proposal.parent.metadata.abstractNote?.trim()))
          throw new ReaderError('UNSUPPORTED_INTERACTION', 'A source-grounded summary note needs an abstract in the selected Zotero item. No note was saved.');
        await options.tasks.planChildNotes({ conversationId: options.sessionId, question, proposals });
        display = `Prepared ${proposals.length} source-grounded child note${proposals.length === 1 ? '' : 's'} for review. No notes were saved yet.`;
      }
      await attachLibraryAgentDisplayText({ storage: options.storage, sessionId: options.sessionId, requestId: reply.requestId, displayText: display });
      notify();
    } catch (error) { notify(); throw error; }
    finally { sending = false; notify(); }
  };
  return {
    load: state,
    subscribe,
    send,
    skills: async () => (await availableSkills()).map(({ id, name, description }) => ({ id, name, description })),
    searchMentions: (query: string) => options.mentions.search(query, options.clientId),
    dispose: () => { stopRuntime?.(); listeners.clear(); },
  };
}
