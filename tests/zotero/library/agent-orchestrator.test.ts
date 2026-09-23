import { beforeEach, expect, it, vi } from 'vitest';
import type { ModelOption, RuntimeSnapshot, StoragePort } from '../../../packages/contracts/src/runtime.ts';
import type { NativeOrganizationItemSnapshot } from '../../../packages/contracts/src/native.ts';
import { createLibraryAgentOrchestrator } from '../../../packages/zotero/src/library/agent-orchestrator.ts';
import type { LibraryMentionItemSnapshot } from '../../../packages/zotero/src/library/mentions.ts';
import { attachLibraryAgentDisplayText, sendLibraryAgentMessage } from '../../../packages/core/src/library/session.ts';

vi.mock('../../../packages/core/src/library/session.ts', () => ({
  getLibraryAgentSession: vi.fn(() => Promise.resolve({ messages: [] })),
  sendLibraryAgentMessage: vi.fn(),
  attachLibraryAgentDisplayText: vi.fn(() => Promise.resolve({ messages: [] })),
}));

const sessionId = '123e4567-e89b-42d3-a456-426614174000';
const mentionId = '123e4567-e89b-42d3-a456-426614174001';
const model: ModelOption = { id: 'gpt-6-sol', displayName: 'GPT-6 Sol', isDefault: true, supportedReasoningEfforts: [{ id: 'medium', description: '' }], defaultReasoningEffort: 'medium', serviceTiers: [], defaultServiceTier: null };
const runtime: RuntimeSnapshot = { revision: 1, runtime: 'ready', account: { state: 'signedIn' }, login: null, models: [model], error: null };
const collection = { clientId: 'client', libraryId: 1, collectionKey: 'COLLECT1', name: 'Methods' };
const item: NativeOrganizationItemSnapshot = {
  clientId: 'client', libraryId: 1, key: 'PAPER001',
  metadata: { itemType: 'journalArticle', title: 'A paper', DOI: '10.1234/paper', abstractNote: 'A testable abstract.', creators: [] },
  tags: [], collectionKeys: [], attachmentKeys: [], dateModified: 'now', contentSignature: 'content', organizationSignature: 'organization',
};

beforeEach(() => { vi.clearAllMocks(); });
function fixture(selection: NativeOrganizationItemSnapshot[] = [], workspaceSkills: Array<{ id: string; name: string; description: string; markdown: string; enabled: boolean; workflow: string; unsupportedDependencies: string[] }> = []) {
  const files = new Map<string, Uint8Array>();
  const storage: StoragePort = {
    read: name => Promise.resolve(files.get(name) ?? null), writeAtomic: (name, bytes) => { files.set(name, bytes); return Promise.resolve(); },
    append: () => Promise.resolve(), remove: name => { files.delete(name); return Promise.resolve(); },
  };
  const tasks = {
    planAcquisition: vi.fn(() => Promise.resolve({})), planOrganization: vi.fn(() => Promise.resolve({})),
    planMetadataUpdate: vi.fn(() => Promise.resolve({})), planChildNotes: vi.fn(() => Promise.resolve({})),
    planCollectionCreate: vi.fn(() => Promise.resolve({})),
  };
  const discovery = { search: vi.fn(() => Promise.resolve([{
    id: 'https://openalex.org/W123', identifier: 'https://doi.org/10.1234/topic', doi: '10.1234/topic', title: 'A relevant paper', authors: ['A. Author'], year: 2025,
    source: { provider: 'openalex' as const, workUrl: 'https://openalex.org/W123' }, openAccess: { isOpenAccess: true, status: 'gold', landingPageUrl: null, pdfUrl: null, repository: null },
  }])) };
  const selectedItems = vi.fn(() => Promise.resolve(selection));
  const workspaceSettings = vi.fn(() => Promise.resolve({ allowedModels: [{ id: model.id, name: model.displayName }], skills: workspaceSkills }));
  const mentionResolver = {
    search: () => Promise.resolve([]),
    resolve: vi.fn((ids: readonly string[]) => Promise.resolve(ids.length ? { modelContext: [{ id: mentionId, kind: 'collection' as const, label: 'Methods' }], nativeTargets: [{ id: mentionId, clientId: 'client', kind: 'collection' as const, libraryId: 1, editable: true, collectionKey: 'COLLECT1' }] } : { modelContext: [], nativeTargets: [] })),
    snapshotCollectionItems: vi.fn((): Promise<LibraryMentionItemSnapshot> => Promise.resolve({ mention: { id: mentionId, kind: 'collection' as const, label: 'Methods' }, target: { id: mentionId, clientId: 'client', kind: 'collection' as const, libraryId: 1, editable: true, collectionKey: 'COLLECT1' }, max: 50, totalItems: 0, overLimit: false, modelContext: { mention: { kind: 'collection' as const, label: 'Methods' }, items: [] }, nativeTargets: [] })),
    snapshotLibraryItems: vi.fn((): Promise<LibraryMentionItemSnapshot> => Promise.resolve({ mention: { id: mentionId, kind: 'library' as const, label: 'My Library' }, target: { id: mentionId, clientId: 'client', kind: 'library' as const, libraryId: 1, editable: true }, max: 50, totalItems: 0, overLimit: false, modelContext: { mention: { kind: 'library' as const, label: 'My Library' }, items: [] }, nativeTargets: [] })),
  };
  const orchestrator = createLibraryAgentOrchestrator({
    sessionId, clientId: 'client', cwd: '/private/tmp/library-agent', uuid: () => '123e4567-e89b-42d3-a456-426614174002',
    storage, tasks: tasks as never, workspace: { settings: workspaceSettings } as never,
    mentions: mentionResolver, discovery, reader: { inspectOrganizationItem: () => Promise.resolve(item) },
    selectedItems, collections: () => Promise.resolve([collection]), ensureAgent: () => Promise.resolve(), runtime: () => runtime,
    connection: () => ({ request: vi.fn(), onFailure: () => () => {} }),
  });
  return { orchestrator, tasks, discovery, selectedItems, workspaceSettings, mentionResolver, files };
}
function reply(intent: object) {
  vi.mocked(sendLibraryAgentMessage).mockResolvedValue({ format: 'json', requestId: '123e4567-e89b-42d3-a456-426614174003', rawAnswer: JSON.stringify(intent), value: intent, session: { messages: [] } } as never);
}

it('turns a natural-language topic request into one source-backed Zotero acquisition review', async () => {
  const f = fixture(); reply({ kind: 'discover', query: 'predictive coding continual learning', limit: 5, openAccessOnly: true, targetCollectionIndex: 0 });
  await f.orchestrator.send({ question: 'Find five papers on predictive coding and download them to Methods', skillId: 'discover', mentions: [{ id: mentionId, kind: 'collection', label: 'Methods' }], modelId: null });
  expect(f.selectedItems).toHaveBeenCalledOnce();
  expect(f.discovery.search).toHaveBeenCalledWith(expect.objectContaining({ topic: 'predictive coding continual learning', limit: 5, openAccessOnly: true }), undefined);
  expect(f.tasks.planAcquisition).toHaveBeenCalledWith({ conversationId: sessionId, question: 'Find five papers on predictive coding and download them to Methods', target: { clientId: 'client', libraryId: 1, collectionKey: 'COLLECT1' }, identifiers: ['https://doi.org/10.1234/topic'] });
  expect(vi.mocked(attachLibraryAgentDisplayText).mock.calls[0]?.[0].displayText).toContain('A relevant paper');
  expect(f.files.has('library-agent-discovery/' + sessionId + '.json')).toBe(true);
  f.orchestrator.dispose();
});

it('plans selected-item organization and source-grounded note as distinct review tasks', async () => {
  const f = fixture([item]);
  reply({ kind: 'organize', candidates: [{ itemIndex: 0, tags: ['predictive coding'], collectionIndexes: [0] }] });
  await f.orchestrator.send({ question: 'Tag the selected paper', skillId: 'organize', mentions: [{ id: mentionId, kind: 'collection', label: 'Methods' }], modelId: null });
  expect(f.tasks.planOrganization).toHaveBeenCalledWith(expect.objectContaining({ selection: [item], proposals: [{ itemIndex: 0, tags: ['predictive coding'], collectionIndexes: [0] }] }));
  reply({ kind: 'note', notes: [{ itemIndex: 0, text: 'Short explanation.' }] });
  await f.orchestrator.send({ question: 'Add a note', skillId: 'note', mentions: [{ id: mentionId, kind: 'collection', label: 'Methods' }], modelId: null });
  expect(f.tasks.planChildNotes).toHaveBeenCalledWith({ conversationId: sessionId, question: 'Add a note', proposals: [{ parent: item, body: 'Short explanation.' }] });
  f.orchestrator.dispose();
});

it('freezes the selected paper before an asynchronous skill lookup can observe a later selection', async () => {
  const f = fixture([item]);
  const later = { ...item, key: 'PAPER002', metadata: { ...item.metadata, title: 'Later paper' } };
  let selected = item;
  f.selectedItems.mockImplementation(() => Promise.resolve([selected]));
  let releaseSettings!: () => void;
  const settingsGate = new Promise<void>(resolve => { releaseSettings = resolve; });
  f.workspaceSettings.mockImplementationOnce(async () => { await settingsGate; return { allowedModels: [{ id: model.id, name: model.displayName }], skills: [] }; });
  reply({ kind: 'organize', candidates: [{ itemIndex: 0, tags: ['reviewed'], collectionIndexes: [] }] });
  const pending = f.orchestrator.send({ question: 'Tag the selected paper', skillId: 'organize', mentions: [], modelId: null });
  expect(f.selectedItems).toHaveBeenCalledOnce();
  selected = later;
  releaseSettings();
  await pending;
  expect(f.tasks.planOrganization).toHaveBeenCalledWith(expect.objectContaining({ selection: [item] }));
  f.orchestrator.dispose();
});

it('refuses a model-chosen collection that conflicts with the explicit @collection', async () => {
  const f = fixture(); reply({ kind: 'acquire', identifiers: ['10.1234/paper'], targetCollectionIndex: 1 });
  await expect(f.orchestrator.send({ question: 'Get DOI 10.1234/paper', skillId: 'acquire', mentions: [{ id: mentionId, kind: 'collection', label: 'Methods' }], modelId: null })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(f.tasks.planAcquisition).not.toHaveBeenCalled();
  f.orchestrator.dispose();
});

it('answers a read-only library question without creating any Zotero task', async () => {
  const f = fixture([item]); reply({ kind: 'answer', text: 'The selected abstract studies a testable mechanism.' });
  await f.orchestrator.send({ question: 'What is this paper about?', skillId: 'ask', mentions: [], modelId: null });
  expect(f.tasks.planAcquisition).not.toHaveBeenCalled();
  expect(f.tasks.planOrganization).not.toHaveBeenCalled();
  expect(f.tasks.planChildNotes).not.toHaveBeenCalled();
  expect(vi.mocked(attachLibraryAgentDisplayText).mock.calls[0]?.[0].displayText).toContain('testable mechanism');
  f.orchestrator.dispose();
});

it('does not let an unskilled read-only question become a model-proposed write task', async () => {
  const f = fixture([item]); reply({ kind: 'note', notes: [{ itemIndex: 0, text: 'Unrequested note.' }] });
  await expect(f.orchestrator.send({ question: 'What is this paper about?', skillId: null, mentions: [], modelId: null })).rejects.toMatchObject({ code: 'UNSUPPORTED_INTERACTION' });
  expect(f.tasks.planChildNotes).not.toHaveBeenCalled();
  f.orchestrator.dispose();
});

it('honours an explicit do-not-write request even when a write skill is selected', async () => {
  const f = fixture([item]); reply({ kind: 'note', notes: [{ itemIndex: 0, text: 'Unwanted note.' }] });
  await expect(f.orchestrator.send({ question: 'Do not add a note; only explain the abstract', skillId: 'note', mentions: [], modelId: null })).rejects.toMatchObject({ code: 'UNSUPPORTED_INTERACTION' });
  expect(f.tasks.planChildNotes).not.toHaveBeenCalled();
  f.orchestrator.dispose();
});

it('reads @collection members into the frozen scope and refuses an incomplete collection', async () => {
  const f = fixture();
  f.mentionResolver.snapshotCollectionItems.mockResolvedValueOnce({
    mention: { id: mentionId, kind: 'collection', label: 'Methods' }, target: { id: mentionId, clientId: 'client', kind: 'collection', libraryId: 1, editable: true, collectionKey: 'COLLECT1' },
    max: 50, totalItems: 1, overLimit: false,
    modelContext: { mention: { kind: 'collection', label: 'Methods' }, items: [] },
    nativeTargets: [{ id: 'member', clientId: 'client', libraryId: 1, itemKey: item.key, dateModified: item.dateModified, metadataSignature: 'signature', editable: true }],
  });
  reply({ kind: 'answer', text: 'The collection contains a paper.' });
  await f.orchestrator.send({ question: 'What is in this collection?', skillId: 'ask', mentions: [{ id: mentionId, kind: 'collection', label: 'Methods' }], modelId: null });
  const sent = vi.mocked(sendLibraryAgentMessage).mock.calls[0]?.[0];
  expect(JSON.stringify(sent?.context)).toContain('A paper');
  f.mentionResolver.snapshotCollectionItems.mockResolvedValueOnce({
    mention: { id: mentionId, kind: 'collection', label: 'Methods' }, target: { id: mentionId, clientId: 'client', kind: 'collection', libraryId: 1, editable: true, collectionKey: 'COLLECT1' },
    max: 50, totalItems: 51, overLimit: true,
    modelContext: { mention: { kind: 'collection', label: 'Methods' }, items: [] }, nativeTargets: [],
  });
  vi.mocked(sendLibraryAgentMessage).mockClear();
  await expect(f.orchestrator.send({ question: 'Organize all of these', skillId: 'organize', mentions: [{ id: mentionId, kind: 'collection', label: 'Methods' }], modelId: null })).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  expect(sendLibraryAgentMessage).not.toHaveBeenCalled();
  f.orchestrator.dispose();
});

it('routes a named child collection through one native review task', async () => {
  const f = fixture(); reply({ kind: 'collection', name: 'Predictive coding' });
  await f.orchestrator.send({ question: 'Create a Predictive coding folder in Methods', skillId: 'collection', mentions: [{ id: mentionId, kind: 'collection', label: 'Methods' }], modelId: null });
  expect(f.tasks.planCollectionCreate).toHaveBeenCalledWith({ conversationId: sessionId, question: 'Create a Predictive coding folder in Methods', target: { clientId: 'client', libraryId: 1, parentCollectionKey: 'COLLECT1' }, name: 'Predictive coding' });
  f.orchestrator.dispose();
});

it('does not treat a paper title alone as evidence for a generated child note', async () => {
  const metadata = { ...item.metadata }; delete metadata.abstractNote;
  const noAbstract = { ...item, metadata };
  const f = fixture([noAbstract]); reply({ kind: 'note', notes: [{ itemIndex: 0, text: 'Invented result' }] });
  await expect(f.orchestrator.send({ question: 'Add a summary note', skillId: 'note', mentions: [], modelId: null })).rejects.toMatchObject({ code: 'UNSUPPORTED_INTERACTION' });
  expect(f.tasks.planChildNotes).not.toHaveBeenCalled();
  f.orchestrator.dispose();
});

it('offers an installed read skill through slash selection without granting write permissions', async () => {
  const f = fixture([item], [{ id: 'explain', name: 'explain', description: 'Explain selected evidence', markdown: '# Explain carefully', enabled: true, workflow: 'read', unsupportedDependencies: [] }]);
  expect(await f.orchestrator.skills()).toContainEqual({ id: 'workspace:explain', name: 'explain', description: 'Explain selected evidence' });
  reply({ kind: 'answer', text: 'The abstract describes the mechanism.' });
  await f.orchestrator.send({ question: 'Explain this article', skillId: 'workspace:explain', mentions: [], modelId: null });
  expect(vi.mocked(sendLibraryAgentMessage).mock.calls[0]?.[0].skill).toMatchObject({ id: 'workspace:explain', instructions: '# Explain carefully' });
  expect(f.tasks.planChildNotes).not.toHaveBeenCalled();
  f.orchestrator.dispose();
});
