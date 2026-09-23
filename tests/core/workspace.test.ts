import { expect, it } from 'vitest';
import { WorkspaceStore } from '../../packages/core/src/workspace/store.ts';
import { ConversationStore } from '../../packages/core/src/sessions/store.ts';
import { MemoryStorage } from './doubles.ts';
import { citationA, imageA, paperA, paperB, settings } from '../contracts/factories.ts';
import type { ReaderSkill, SavedDraft, WorkspaceSettings } from '../../packages/contracts/src/workspace.ts';
import { defaultSettings } from '../../packages/core/src/workspace/skills.ts';
import { defaultAllowedModels } from '../../packages/core/src/workspace/allowed-models.ts';
import { documentA } from '../contracts/document-fixture.ts';
import { documentSummary } from '../../packages/contracts/src/document.ts';
import type { ActionTaskRecord } from '../../packages/contracts/src/tasks.ts';
const clock = { uuid: () => '12345678-0000-4000-8000-000000000001', now: () => '2026-09-12T10:00:00.000Z' };
it('persists independent drafts and images without rewriting image bytes on every edit', async () => {
  const storage = new MemoryStorage(); const store = new WorkspaceStore(storage, clock);
  const saved = { schemaVersion: 1 as const, paper: paperA, conversationId: null, draft: { paper: paperA, question: 'First', citations: [citationA], images: [imageA], settings, references: [], skillId: null, profileId: null, overrides: {} }, scrollTop: 120, pageRange: [2, 3] as [number, number], updatedAt: clock.now() };
  await store.saveDraft(saved); saved.draft.question = 'Revised'; await store.saveDraft(saved);
  const next = new WorkspaceStore(storage, clock);
  expect(await next.readDraft(paperA, null)).toMatchObject({ draft: { question: 'Revised', images: [imageA] }, scrollTop: 120, pageRange: [2, 3] });
  expect(storage.writes.filter(text => text.includes(imageA.dataUrl))).toHaveLength(1);
});
it('searches original paper titles and message text while omitting contentless conversations', async () => {
  const storage = new MemoryStorage(); const conversations = new ConversationStore(storage, clock);
  const c = await conversations.create(paperA, 'Original title', settings);
  const store = new WorkspaceStore(storage, clock);
  expect(await store.history()).toEqual([]);
  c.title = 'Renamed discussion'; c.messages.push({ id: 'm1', requestId: 'r1', role: 'user', phase: null, settings, text: 'Bayesian posterior', citations: [citationA], paper: { title: 'Original title', authors: ['Author'] }, status: 'completed' });
  await conversations.save(c);
  expect((await store.history('posterior'))[0]).toMatchObject({ title: 'Renamed discussion', identity: { title: 'Original title' } });
  expect(await store.history('Original title')).toHaveLength(1);
});
it('loads a pre-archive record as unarchived and partitions history into exactly one of two scopes', async () => {
  const storage = new MemoryStorage(); const conversations = new ConversationStore(storage, uniqueClock());
  const legacy = await conversations.create(paperA, 'Legacy discussion', settings);
  legacy.messages.push({ id: 'm1', requestId: 'r1', role: 'user', phase: null, settings, text: 'Legacy content', citations: [], status: 'completed' });
  await conversations.save(legacy);
  // A legacy record on disk carries schema 3 and no archive field: reading it must not invent one.
  const bytes = new TextDecoder().decode(storage.files.get(`conversations/${legacy.id}.json`));
  const stored = JSON.parse(bytes) as { schemaVersion: number; archivedAt?: string };
  expect(stored).not.toHaveProperty('archivedAt');
  expect(stored.schemaVersion).toBe(3);
  const store = new WorkspaceStore(storage, clock);
  expect((await store.history()).map(entry => entry.id)).toEqual([legacy.id]);
  expect((await store.history()).every(entry => entry.archivedAt === undefined)).toBe(true);
  expect(await store.history('', { archived: true })).toEqual([]);
  // Archiving is an additive field on the same schema-3 record: it persists and flips the scope.
  legacy.archivedAt = clock.now();
  await conversations.save(legacy);
  const archived = await store.history('', { archived: true });
  expect(archived.map(entry => entry.id)).toEqual([legacy.id]);
  expect(archived[0]?.archivedAt).toBe(clock.now());
  expect(await store.history()).toEqual([]);
  expect(await store.history('Legacy content')).toEqual([]);
  expect((await store.history('Legacy content', { archived: true }))[0]).toMatchObject({ id: legacy.id, archivedAt: clock.now() });
  // Restoring deletes the field and returns the chat to the default scope unchanged.
  delete legacy.archivedAt;
  await conversations.save(legacy);
  expect((await store.history()).map(entry => entry.id)).toEqual([legacy.id]);
  expect(await store.history('', { archived: true })).toEqual([]);
});

it('never drops a conversation from both history scopes and never lists one twice', async () => {
  const storage = new MemoryStorage(); const conversations = new ConversationStore(storage, uniqueClock());
  const make = async (paper: typeof paperA, title: string, archived: boolean) => {
    const c = await conversations.create(paper, title, settings);
    c.messages.push({ id: `${title}-m1`, requestId: `${title}-r1`, role: 'user', phase: null, settings, text: `${title} question`, citations: [], status: 'completed' });
    if (archived) c.archivedAt = clock.now();
    await conversations.save(c);
    return c.id;
  };
  const activeIds = [await make(paperA, 'Active A', false), await make(paperB, 'Active B', false)];
  const archivedIds = [await make(paperA, 'Archived A', true), await make(paperB, 'Archived B', true)];
  const store = new WorkspaceStore(storage, clock);
  const active = await store.history();
  const archived = await store.history('', { archived: true });
  expect(active.map(entry => entry.id).sort()).toEqual([...activeIds].sort());
  expect(archived.map(entry => entry.id).sort()).toEqual([...archivedIds].sort());
  expect(active.filter(entry => entry.archivedAt !== undefined)).toEqual([]);
  expect(archived.filter(entry => entry.archivedAt === undefined)).toEqual([]);
  // Every stored chat is listed exactly once across the two scopes.
  const listed = [...active, ...archived].map(entry => entry.id);
  expect(listed.sort()).toEqual([...activeIds, ...archivedIds].sort());
  expect(new Set(listed).size).toBe(listed.length);
});

it('lists saved conversation summaries without reading PDF bodies but still validates sources when opened', async () => {
  class ObservedStorage extends MemoryStorage {
    reads: string[] = [];
    override read(path: string) { this.reads.push(path); return super.read(path); }
  }
  const storage = new ObservedStorage(); const conversations = new ConversationStore(storage, clock); const c = await conversations.create(paperA, 'Long paper', settings);
  c.documents = { [documentA.id]: documentA };
  c.messages.push({ id: 'm1', requestId: 'r1', role: 'user', phase: null, settings, text: 'Question preserved in metadata', citations: [], status: 'completed', document: documentSummary(documentA) });
  c.requests.push({ requestId: 'r2', hash: 'h', hashVersion: 2, state: 'accepted', turnId: null, createdAt: clock.now(), updatedAt: clock.now() });
  c.activeBatchId = '11223344-0000-4000-8000-000000000001'; await conversations.save(c);
  storage.files.delete(`conversations/${c.id}.${documentA.id}.source.json`); storage.reads = [];
  const store = new WorkspaceStore(storage, clock);
  expect(await store.history('preserved')).toMatchObject([{ id: c.id, messageCount: 1 }]);
  expect(storage.reads.some(path => path.endsWith('.source.json'))).toBe(false);
  await expect(store.readConversation(c.id)).rejects.toMatchObject({ code: 'HISTORY_UNAVAILABLE' });
  storage.files.set(`conversations/${c.id}.${documentA.id}.source.json`, new TextEncoder().encode(JSON.stringify(documentA)));
  expect(await store.readConversation(c.id)).toMatchObject({ queuedRequestIds: ['r2'], activeBatchId: c.activeBatchId });
});
function nativeTask(conversationId: string): Extract<ActionTaskRecord, { kind: 'acquisition' }> {
  return { schemaVersion: 1, id: 'native-acquisition', conversationId, kind: 'acquisition', state: 'review', question: 'Acquire Bayesian source literature', createdAt: clock.now(), updatedAt: '2026-09-13T11:00:00.000Z', revision: 1, target: { clientId: paperA.clientId, libraryId: paperA.libraryId, collectionKey: 'COLLECT1' }, items: [] };
}
it('includes and searches native task-only history from the existing ledger using the task update date', async () => {
  const storage = new MemoryStorage(); const conversations = new ConversationStore(storage, uniqueClock());
  const c = await conversations.create(paperA, 'Only acquisition', settings); const empty = await conversations.create(paperB, 'No work', settings);
  const task = nativeTask(c.id); const bytes = new TextEncoder().encode(JSON.stringify(task)); storage.files.set(`tasks/${task.id}.json`, bytes);
  const writes = storage.writes.length; const store = new WorkspaceStore(storage, clock, { clientId: paperA.clientId });
  expect(await store.history('Bayesian source')).toMatchObject([{ id: c.id, messageCount: 0, taskCount: 1, updatedAt: task.updatedAt, preview: task.question, hasDraft: false }]);
  expect((await store.history()).some(entry => entry.id === empty.id)).toBe(false);
  expect(storage.writes).toHaveLength(writes); expect(storage.files.get(`tasks/${task.id}.json`)).toEqual(bytes);
});
it('rejects corrupt or foreign task ownership without modifying existing task records', async () => {
  const storage = new MemoryStorage(); const c = await new ConversationStore(storage, clock).create(paperA, 'Task', settings);
  const task = nativeTask(c.id); const path = `tasks/${task.id}.json`; const store = new WorkspaceStore(storage, clock, { clientId: paperA.clientId });
  for (const value of [{ ...task, schemaVersion: 99 }, { ...task, id: 'other-task' }, { ...task, target: { ...task.target, clientId: '22222222-0000-4000-8000-000000000001' } }]) {
    const bytes = new TextEncoder().encode(JSON.stringify(value)); storage.files.set(path, bytes);
    await expect(store.history()).rejects.toMatchObject({ code: 'HISTORY_UNAVAILABLE' }); expect(storage.files.get(path)).toEqual(bytes);
  }
});
it('rejects other profile conversations before loading derived logs, sources or drafts', async () => {
  class ObservedStorage extends MemoryStorage {
    reads: string[] = [];
    override read(path: string) { this.reads.push(path); return super.read(path); }
  }
  const storage = new ObservedStorage(); const foreign = { ...paperA, clientId: '22222222-0000-4000-8000-000000000001' };
  const c = await new ConversationStore(storage, clock).create(foreign, 'Foreign profile', settings); storage.reads = [];
  const store = new WorkspaceStore(storage, clock, { clientId: paperA.clientId });
  await expect(store.history()).rejects.toMatchObject({ code: 'HISTORY_UNAVAILABLE' });
  expect(storage.reads).toEqual([`conversations/${c.id}.json`]); storage.reads = [];
  await expect(store.readConversation(c.id)).rejects.toMatchObject({ code: 'HISTORY_UNAVAILABLE' });
  expect(storage.reads).toEqual([`conversations/${c.id}.json`]);
});
it('imports SKILL.md without running dependencies and freezes non-recursive chat snapshots', async () => {
  const storage = new MemoryStorage(); const store = new WorkspaceStore(storage, clock);
  const skill = await store.importSkill('---\nname: careful-reader\ndescription: Explain definitions.\nallowed-tools: python\n---\n# Steps\nRead definitions and explain assumptions.');
  expect(skill).toMatchObject({ origin: 'imported', enabled: false }); expect(skill.unsupportedDependencies).toContain('python');
  const updated = new WorkspaceStore(storage, clock); expect((await updated.settings()).skills.some(s => s.id === skill.id)).toBe(true);
  const conversations = new ConversationStore(storage, clock); const c = await conversations.create(paperA, 'A', settings);
  c.messages.push({ id: 'm1', requestId: 'r1', role: 'assistant', phase: 'final', settings, text: 'Quoted background.', citations: [citationA], status: 'completed' }); await conversations.save(c);
  const ref = await store.snapshotChat(c.id, ['m1']);
  expect(ref.text).toContain('Quoted background.'); expect(ref.text).not.toContain(citationA.text); expect(ref.messageIds).toEqual(['m1']);
});
it('retains corrupted settings and refuses unsupported schema instead of resetting', async () => {
  const storage = new MemoryStorage(); const bad = new TextEncoder().encode('{"schemaVersion":99}'); storage.files.set('workspace/settings.json', bad);
  const store = new WorkspaceStore(storage, clock); await expect(store.settings()).rejects.toThrow(/untouched|read/i);
  expect(storage.files.get('workspace/settings.json')).toEqual(bad);
});

function draft(conversationId: string | null = null): SavedDraft {
  return { schemaVersion: 1, paper: paperA, conversationId, draft: { paper: paperA, question: 'Remember this question', citations: [], images: [], settings, references: [], skillId: null, profileId: null, overrides: {} }, scrollTop: 20, pageRange: null, updatedAt: clock.now() };
}
function uniqueClock() {
  let id = 0;
  return { now: clock.now, uuid: () => `12345678-0000-4000-8000-${(++id).toString(16).padStart(12, '0')}` };
}

it('persists preferences, profiles and builtin availability across store instances', async () => {
  const storage = new MemoryStorage(); const store = new WorkspaceStore(storage, clock);
  const value = await store.settings();
  expect(value.skills.map(skill => skill.name)).toEqual(expect.arrayContaining(['read', 'derive', 'compare', 'annotate', 'acquire', 'organize', 'diagram']));
  for (const skill of value.skills) {
    expect(skill.markdown).toMatch(/Input/); expect(skill.markdown).toMatch(/Steps/); expect(skill.markdown).toMatch(/Output/); expect(skill.markdown).toMatch(/Permission/);
  }
  value.preferences.language = 'zh'; value.uiLanguage = 'zh'; value.textScale = 1.4;
  value.profiles.push({ id: 'apc', name: 'APC', preferences: { mathematics: 'formal', background: 'Linear algebra' } });
  value.skills.find(skill => skill.id === 'builtin-diagram')!.enabled = false;
  await store.saveSettings(value);
  expect(await new WorkspaceStore(storage, clock).settings()).toMatchObject({ preferences: { language: 'zh' }, uiLanguage: 'zh', textScale: 1.4, profiles: [{ id: 'apc' }] });
  expect((await store.settings()).skills.find(skill => skill.id === 'builtin-diagram')?.enabled).toBe(false);
});

it('recomputes unsupported dependencies when an imported skill is edited or enabled', async () => {
  const store = new WorkspaceStore(new MemoryStorage(), clock);
  const imported = await store.importSkill('---\nname: python-reader\ndescription: Read carefully.\nallowed-tools: [python, bash]\n---\nRead the supplied text.');
  const edited = await store.saveSkill({ ...imported, enabled: true, unsupportedDependencies: [] });
  expect(edited.enabled).toBe(false); expect(edited.unsupportedDependencies).toEqual(expect.arrayContaining(['python', 'bash']));
  const local = await store.importSkill('---\nname: local-reader\ndescription: Read supplied text.\n---\nExplain the supplied definitions.');
  expect(local.enabled).toBe(false);
  const enabled = await store.saveSkill({ ...local, enabled: true });
  expect(enabled.enabled).toBe(true);
  const changed = await store.saveSkill({ ...enabled, markdown: enabled.markdown + '\nState missing evidence.' });
  expect(changed.revision).not.toBe(enabled.revision);
});

it('serializes separate skill imports without losing either update and preserves builtin definitions', async () => {
  const store = new WorkspaceStore(new MemoryStorage(), clock);
  await Promise.all(['one', 'two'].map(name => store.importSkill(`---\nname: ${name}\ndescription: Supplied text only.\n---\nExplain definitions.`)));
  expect((await store.settings()).skills.filter(skill => skill.origin === 'imported')).toHaveLength(2);
  const builtin = (await store.settings()).skills.find(skill => skill.id === 'builtin-read')!;
  await expect(store.saveSkill({ ...builtin, markdown: 'Run arbitrary commands.' })).rejects.toThrow();
  await expect(store.deleteSkill('builtin-read')).rejects.toThrow();
});

it('rejects oversized or malformed skill imports without writing settings', async () => {
  const storage = new MemoryStorage(); const store = new WorkspaceStore(storage, clock);
  for (const markdown of ['---\nname: incomplete\n', 'No frontmatter', '---\nname: x\ndescription: d\n---\n' + 'x'.repeat(70 * 1024), '---\nname: !execute code\ndescription: d\n---\nbody']) await expect(store.importSkill(markdown)).rejects.toThrow();
  expect(storage.writes).toHaveLength(0);
});

it('does not overwrite corrupt settings through a later save', async () => {
  const storage = new MemoryStorage(); const store = new WorkspaceStore(storage, clock); const value = await store.settings();
  const corrupt = new TextEncoder().encode('{"schemaVersion":99}'); storage.files.set('workspace/settings.json', corrupt);
  await expect(store.saveSettings(value)).rejects.toThrow();
  expect(storage.files.get('workspace/settings.json')).toEqual(corrupt);
});

it('isolates drafts by attachment and conversation and snapshots inputs before async storage', async () => {
  const storage = new MemoryStorage(); const store = new WorkspaceStore(storage, clock);
  const first = draft(); const saving = store.saveDraft(first); first.draft.question = 'Late mutation'; await saving;
  const other = draft('12345678-0000-4000-8000-000000000002'); other.draft.question = 'Second conversation'; await store.saveDraft(other);
  const supplement = draft(); supplement.paper = paperB; supplement.draft.paper = paperB; supplement.draft.question = 'Supplement'; await store.saveDraft(supplement);
  expect((await store.readDraft(paperA, null))?.draft.question).toBe('Remember this question');
  expect((await store.readDraft(paperA, other.conversationId))?.draft.question).toBe('Second conversation');
  expect((await store.readDraft(paperB, null))?.draft.question).toBe('Supplement');
  await store.deleteDraft(paperA, null); expect(await store.readDraft(paperA, null)).toBeNull();
  expect(await store.readDraft(paperB, null)).not.toBeNull();
});

it('deduplicates shared image content across drafts and refuses missing or corrupt assets', async () => {
  const storage = new MemoryStorage(); const store = new WorkspaceStore(storage, clock);
  const first = draft(); first.draft.images = [imageA]; await store.saveDraft(first);
  const second = draft('12345678-0000-4000-8000-000000000002'); second.draft.images = [{ ...imageA, id: '6c8e0a2b-4d1f-4e3a-9c5b-1a7d3e5f9b21', name: 'same-image.png' }]; await store.saveDraft(second);
  expect(storage.writes.filter(text => text.includes(imageA.dataUrl))).toHaveLength(1);
  const assetPath = [...storage.files.keys()].find(path => path.startsWith('workspace/assets/'))!;
  const corrupt = new TextEncoder().encode('{"schemaVersion":99}'); storage.files.set(assetPath, corrupt);
  await expect(store.readDraft(paperA, null)).rejects.toThrow();
  await expect(store.saveDraft(first)).rejects.toThrow();
  expect(storage.files.get(assetPath)).toEqual(corrupt);
  storage.files.delete(assetPath); await expect(store.readDraft(paperA, second.conversationId)).rejects.toThrow();
});

it('refuses corrupt draft replacement or deletion and rejects cross-paper draft content', async () => {
  const storage = new MemoryStorage(); const store = new WorkspaceStore(storage, clock); const value = draft(); await store.saveDraft(value);
  const path = [...storage.files.keys()].find(key => key.startsWith('workspace/drafts/'))!;
  const corrupt = new TextEncoder().encode('{"schemaVersion":2}'); storage.files.set(path, corrupt);
  await expect(store.readDraft(paperA, null)).rejects.toThrow();
  await expect(store.saveDraft(value)).rejects.toThrow();
  await expect(store.deleteDraft(paperA, null)).rejects.toThrow();
  expect(storage.files.get(path)).toEqual(corrupt);
  value.draft.paper = paperB; await expect(store.saveDraft(value)).rejects.toThrow();
});

it('keeps draft-only history and exposes offline conversations without private runtime records', async () => {
  const storage = new MemoryStorage(); const conversations = new ConversationStore(storage, clock);
  const c = await conversations.create(paperA, 'Draft discussion', settings); c.upstream.threadId = 'private-upstream'; await conversations.save(c);
  const store = new WorkspaceStore(storage, clock); await store.saveDraft(draft(c.id));
  expect(await store.history()).toMatchObject([{ id: c.id, hasDraft: true, messageCount: 0 }]);
  expect(await store.readConversation(c.id)).not.toHaveProperty('upstream');
  expect(await store.readConversation(c.id)).not.toHaveProperty('requests');
  expect(await store.currentConversation(paperA)).toMatchObject({ id: c.id });
  expect(await store.currentConversation(paperB)).toBeNull();
});

it('fails closed on corrupt owned conversation records and unavailable listing without touching data', async () => {
  const storage = new MemoryStorage(); const path = 'conversations/12345678-0000-4000-8000-000000000001.json';
  const corrupt = new TextEncoder().encode('{"schemaVersion":99}'); storage.files.set(path, corrupt);
  await expect(new WorkspaceStore(storage, clock).history()).rejects.toThrow(); expect(storage.files.get(path)).toEqual(corrupt);
  const withoutList = { read: storage.read.bind(storage), writeAtomic: storage.writeAtomic.bind(storage), append: storage.append.bind(storage), remove: storage.remove.bind(storage) };
  await expect(new WorkspaceStore(withoutList, clock).history()).rejects.toThrow();
});

it('selects complete recent chat messages and refuses oversized or missing explicit selections', async () => {
  const storage = new MemoryStorage(); const conversations = new ConversationStore(storage, uniqueClock());
  const c = await conversations.create(paperA, 'Discussion', settings);
  for (let i = 0; i < 8; i++) c.messages.push({ id: `m${i}`, requestId: `r${i}`, role: 'assistant', phase: 'final', settings, text: `Complete message ${i}.`, citations: [], status: 'completed' });
  await conversations.save(c); const store = new WorkspaceStore(storage, clock);
  const recent = await store.snapshotChat(c.id); expect(recent.messageIds).toEqual(['m2', 'm3', 'm4', 'm5', 'm6', 'm7']);
  expect(recent.text).toContain('Complete message 7.'); expect(recent.text).not.toContain('Complete message 0.');
  await expect(store.snapshotChat(c.id, ['absent'])).rejects.toThrow();
  c.messages[7]!.text = 'x'.repeat(70 * 1024); await conversations.save(c);
  await expect(store.snapshotChat(c.id, ['m7'])).rejects.toThrow();
  await expect(store.snapshotChat(c.id)).rejects.toThrow();
});

it('rejects excess dependency declarations rather than silently dropping them', async () => {
  const store = new WorkspaceStore(new MemoryStorage(), clock);
  const dependencies = Array.from({ length: 65 }, (_, index) => `tool${index}`).join(', ');
  await expect(store.importSkill(`---\nname: many-tools\ndescription: Too many requirements.\nallowed-tools: [${dependencies}]\n---\nBody.`)).rejects.toThrow();
});

it('does not lose unknown object fields while freezing settings for persistence', async () => {
  const store = new WorkspaceStore(new MemoryStorage(), clock); const value = await store.settings();
  Object.defineProperty(value.preferences, '__proto__', { enumerable: true, value: { extra: 'unsupported' } });
  await expect(store.saveSettings(value)).rejects.toThrow();
});

it('checks a conversation file identity before any log or source lookup', async () => {
  class ObservedStorage extends MemoryStorage {
    reads: string[] = [];
    override read(path: string) { this.reads.push(path); return super.read(path); }
  }
  const storage = new ObservedStorage(); const conversations = new ConversationStore(storage, clock);
  const c = await conversations.create(paperA, 'Synthetic', settings);
  storage.files.set(`conversations/${c.id}.json`, new TextEncoder().encode(JSON.stringify({ ...c, id: '../outside' })));
  storage.reads = [];
  await expect(new WorkspaceStore(storage, clock).readConversation(c.id)).rejects.toThrow();
  expect(storage.reads).toEqual([`conversations/${c.id}.json`]);
});

it('exports builtin Markdown in a form that can be imported as a disabled editable copy', async () => {
  const store = new WorkspaceStore(new MemoryStorage(), clock);
  const builtin = (await store.settings()).skills.find(skill => skill.id === 'builtin-derive')!;
  const copy = await store.importSkill(builtin.markdown);
  expect(copy).toMatchObject({ name: 'derive', origin: 'imported', enabled: false, workflow: 'read' });
  expect(copy.markdown).toBe(builtin.markdown);
});

it('preserves independent paper and generated image origins through shared asset storage', async () => {
  const storage = new MemoryStorage(); const store = new WorkspaceStore(storage, clock); const value = draft();
  value.draft.images = [
    { ...imageA, origin: { kind: 'generated', model: 'synthetic-model' } },
    { ...imageA, id: '6c8e0a2b-4d1f-4e3a-9c5b-1a7d3e5f9b21', origin: { kind: 'paper', paper: paperA, pageIndex: 3, revision: { fingerprint: 'synthetic', size: 123, modifiedAt: 456 } } },
  ];
  await store.saveDraft(value); value.draft.question = 'Edited after adding images'; await store.saveDraft(value);
  expect((await new WorkspaceStore(storage, clock).readDraft(paperA, null))?.draft.images).toEqual(value.draft.images);
  expect(storage.writes.filter(text => text.includes(imageA.dataUrl))).toHaveLength(1);
});

const skillSource = '---\nname: source-reader\ndescription: Explain source definitions.\nversion: 1.0.0\nworkflow: read\n---\n\nKeep this unique workflow body in SKILL.md only.\n';
const skillPath = (skill: ReaderSkill) => `workspace/skills/${skill.id}/SKILL.md`;
function storedSettings(storage: MemoryStorage): { skills: Array<Record<string, unknown>> } {
  return JSON.parse(new TextDecoder().decode(storage.files.get('workspace/settings.json'))) as { skills: Array<Record<string, unknown>> };
}

it('stores custom skill bodies only in actual SKILL.md files and reloads deliberate edits', async () => {
  const storage = new MemoryStorage(); const store = new WorkspaceStore(storage, clock); const skill = await store.importSkill(skillSource);
  expect(new TextDecoder().decode(storage.files.get(skillPath(skill)))).toBe(skill.markdown);
  expect(storedSettings(storage).skills.find(entry => entry.id === skill.id)).not.toHaveProperty('markdown');
  const edited = skillSource.replace('name: source-reader', 'name: renamed-on-disk').replace('Explain source definitions.', 'A revised description.').replace('version: 1.0.0', 'version: 2.0.0').replace('Keep this unique workflow body in SKILL.md only.', 'An edited workflow body.');
  storage.files.set(skillPath(skill), new TextEncoder().encode(edited));
  const loaded = (await new WorkspaceStore(storage, clock).settings()).skills.find(entry => entry.id === skill.id)!;
  expect(loaded).toMatchObject({ name: 'renamed-on-disk', description: 'A revised description.', version: '2.0.0', markdown: edited, enabled: false });
  expect(loaded.revision).not.toBe(skill.revision);
  expect(storedSettings(storage).skills.find(entry => entry.id === skill.id)).toMatchObject({ name: 'renamed-on-disk', revision: loaded.revision });
});

it('updates frontmatter coherently from UI fields and honors edits made only in the Markdown editor', async () => {
  const storage = new MemoryStorage(); const store = new WorkspaceStore(storage, clock); const skill = await store.importSkill(skillSource);
  const edited = await store.saveSkill({ ...skill, name: 'UI readable name', description: 'UI description', version: '3.0.0', workflow: 'annotate' });
  const reloaded = (await new WorkspaceStore(storage, clock).settings()).skills.find(entry => entry.id === skill.id)!;
  expect(reloaded).toMatchObject({ name: 'UI readable name', description: 'UI description', version: '3.0.0', workflow: 'annotate' });
  const bodyEdit = edited.markdown.replace('UI readable name', 'Name from Markdown');
  const second = await store.saveSkill({ ...edited, markdown: bodyEdit });
  expect(second.name).toBe('Name from Markdown');
  expect(new TextDecoder().decode(storage.files.get(skillPath(skill)))).toBe(second.markdown);
  expect((await store.importSkill(second.markdown)).name).toBe('Name from Markdown');
});

it('disables unsupported dependencies added on disk without executing or enabling them', async () => {
  const storage = new MemoryStorage(); const store = new WorkspaceStore(storage, clock); const skill = await store.importSkill(skillSource);
  await store.saveSkill({ ...skill, enabled: true });
  const edited = skillSource.replace('workflow: read', 'workflow: read\nallowed-tools: [python, bash]\nenabled: true'); storage.files.set(skillPath(skill), new TextEncoder().encode(edited));
  const loaded = (await store.settings()).skills.find(entry => entry.id === skill.id)!;
  expect(loaded.enabled).toBe(false); expect(loaded.unsupportedDependencies).toEqual(expect.arrayContaining(['python', 'bash']));
  expect(new TextDecoder().decode(storage.files.get(skillPath(skill)))).toBe(edited);
});

it('retains registered skills and settings when source files are missing or malformed', async () => {
  const storage = new MemoryStorage(); const store = new WorkspaceStore(storage, clock); const skill = await store.importSkill(skillSource);
  const settingsBytes = storage.files.get('workspace/settings.json')!; storage.files.delete(skillPath(skill));
  await expect(store.settings()).rejects.toThrow(/untouched|read/i);
  await expect(store.saveSkill(skill)).rejects.toThrow();
  expect(storage.files.get('workspace/settings.json')).toEqual(settingsBytes);
  const corrupt = new TextEncoder().encode('---\nname: broken\n'); storage.files.set(skillPath(skill), corrupt);
  await expect(store.settings()).rejects.toThrow(); await expect(store.deleteSkill(skill.id)).rejects.toThrow();
  expect(storage.files.get(skillPath(skill))).toEqual(corrupt);
});

it('migrates legacy inline skills once without retaining a second Markdown authority', async () => {
  const storage = new MemoryStorage(); const store = new WorkspaceStore(storage, clock); const defaults = await store.settings();
  const legacy: ReaderSkill = { id: 'legacy-reader', name: 'source-reader', description: 'Explain source definitions.', version: '1.0.0', revision: 'legacy-revision', markdown: skillSource, origin: 'user', enabled: true, workflow: 'read', permissions: [], unsupportedDependencies: [] };
  const value: WorkspaceSettings = { ...defaults, preferences: { ...defaults.preferences, language: 'zh' }, skills: [...defaults.skills, legacy] };
  storage.files.set('workspace/settings.json', new TextEncoder().encode(JSON.stringify(value)));
  const migrated = await new WorkspaceStore(storage, clock).settings();
  expect(migrated.preferences.language).toBe('zh'); expect(migrated.skills.find(skill => skill.id === legacy.id)).toMatchObject({ markdown: skillSource, enabled: true, origin: 'user' });
  expect(new TextDecoder().decode(storage.files.get(skillPath(legacy)))).toBe(skillSource);
  expect(storedSettings(storage).skills.every(skill => !('markdown' in skill))).toBe(true);
  const writes = storage.writes.length; await new WorkspaceStore(storage, clock).settings(); expect(storage.writes).toHaveLength(writes);
});

it('does not overwrite direct file edits from a stale editor or a preferences save', async () => {
  const storage = new MemoryStorage(); const store = new WorkspaceStore(storage, clock); const skill = await store.importSkill(skillSource); const prior = await store.settings();
  const external = skillSource.replace('Keep this unique workflow body in SKILL.md only.', 'Edited outside the app.'); storage.files.set(skillPath(skill), new TextEncoder().encode(external));
  await expect(store.saveSkill({ ...skill, markdown: skill.markdown + '\nStale editor addition.' })).rejects.toThrow(/changed|newer|conflict/i);
  prior.preferences.language = 'zh'; await store.saveSettings(prior);
  expect(new TextDecoder().decode(storage.files.get(skillPath(skill)))).toBe(external);
  expect((await store.settings()).preferences.language).toBe('zh');
});

it('resumes an interrupted inline migration without overwriting its already-created source', async () => {
  const storage = new MemoryStorage(); const store = new WorkspaceStore(storage, clock); const defaults = await store.settings();
  const legacy: ReaderSkill = { id: 'legacy-retry', name: 'source-reader', description: 'Explain source definitions.', version: '1.0.0', revision: 'legacy', markdown: skillSource, origin: 'user', enabled: true, workflow: 'read', permissions: [], unsupportedDependencies: [] };
  const inline = new TextEncoder().encode(JSON.stringify({ ...defaults, skills: [...defaults.skills, legacy] })); storage.files.set('workspace/settings.json', inline);
  const write = storage.writeAtomic.bind(storage); let interrupted = true;
  storage.writeAtomic = (path, bytes) => path === 'workspace/settings.json' && interrupted ? Promise.reject(new Error('Synthetic interruption')) : write(path, bytes);
  await expect(store.settings()).rejects.toThrow(); expect(storage.files.get('workspace/settings.json')).toEqual(inline);
  const external = skillSource.replace('Keep this unique workflow body in SKILL.md only.', 'Preserve this edit made after interruption.'); storage.files.set(skillPath(legacy), new TextEncoder().encode(external));
  interrupted = false;
  const recovered = (await new WorkspaceStore(storage, clock).settings()).skills.find(skill => skill.id === legacy.id)!;
  expect(recovered.markdown).toBe(external); expect(new TextDecoder().decode(storage.files.get(skillPath(legacy)))).toBe(external);
  expect(storedSettings(storage).skills.every(skill => !('markdown' in skill))).toBe(true);
});

it('persists the current model allowlist through the real store and migrates absent settings', async () => {
  const storage = new MemoryStorage(); const store = new WorkspaceStore(storage, clock);
  // A store that never touched the setting resolves the three current GPT-6 models.
  expect((await store.settings()).allowedModels).toEqual(defaultAllowedModels());
  const value = await store.settings();
  value.allowedModels = defaultAllowedModels().filter(model => model.id !== 'gpt-6-luna');
  await store.saveSettings(value);
  const reloaded = await new WorkspaceStore(storage, clock).settings();
  expect(reloaded.allowedModels).toEqual([{ id: 'gpt-6-sol', name: 'GPT-6 Sol' }, { id: 'gpt-6-astra', name: 'GPT-6 Astra' }]);
  // A legacy record without the field loads as the default set and is migrated on read, like every
  // other additive settings field.
  const legacy = { ...defaultSettings() } as Partial<WorkspaceSettings>;
  delete legacy.allowedModels;
  storage.files.set('workspace/settings.json', new TextEncoder().encode(JSON.stringify(legacy)));
  expect((await new WorkspaceStore(storage, clock).settings()).allowedModels).toEqual(defaultAllowedModels());
  const migrated = JSON.parse(new TextDecoder().decode(storage.files.get('workspace/settings.json'))) as WorkspaceSettings;
  expect(migrated.allowedModels).toEqual(defaultAllowedModels());
  expect(storage.files.get('workspace/settings.json')).toBeDefined();
});

it('keeps an unknown or removed allowed model id without error and still resolves the known ones', async () => {
  const storage = new MemoryStorage(); const store = new WorkspaceStore(storage, clock);
  const value = await store.settings();
  value.allowedModels = [...defaultAllowedModels(), { id: 'gpt-retired-x', name: 'GPT Retired X' }];
  await store.saveSettings(value);
  const reloaded = await new WorkspaceStore(storage, clock).settings();
  expect(reloaded.allowedModels?.map(model => model.id)).toEqual(['gpt-6-sol', 'gpt-6-astra', 'gpt-6-luna', 'gpt-retired-x']);
  expect(reloaded.allowedModels?.find(model => model.id === 'gpt-retired-x')?.name).toBe('GPT Retired X');
  // A repeated id is collapsed in order rather than making the whole settings record unreadable.
  value.allowedModels = [...defaultAllowedModels(), { id: 'gpt-retired-x', name: 'GPT Retired X' }, { id: 'gpt-retired-x', name: 'GPT Retired X' }];
  await store.saveSettings(value);
  expect((await new WorkspaceStore(storage, clock).settings()).allowedModels?.map(model => model.id)).toEqual(['gpt-6-sol', 'gpt-6-astra', 'gpt-6-luna', 'gpt-retired-x']);
});

it('refuses to persist an empty allowlist and leaves the stored record untouched', async () => {
  const storage = new MemoryStorage(); const store = new WorkspaceStore(storage, clock);
  const value = await store.settings();
  const before = storage.files.get('workspace/settings.json');
  value.allowedModels = [];
  await expect(store.saveSettings(value)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(storage.files.get('workspace/settings.json')).toEqual(before);
  expect((await store.settings()).allowedModels).toEqual(defaultAllowedModels());
});

it('safe-rejects an explicitly empty allowlist on disk instead of blanking the picker', async () => {
  const storage = new MemoryStorage();
  const corrupt = new TextEncoder().encode(JSON.stringify({ ...defaultSettings(), allowedModels: [] }));
  storage.files.set('workspace/settings.json', corrupt);
  const store = new WorkspaceStore(storage, clock);
  await expect(store.settings()).rejects.toThrow(/untouched|read/i);
  expect(storage.files.get('workspace/settings.json')).toEqual(corrupt);
});
