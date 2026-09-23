import { ReaderError, paperId, type Conversation, type ImageAttachment, type PaperIdentity, type PaperScope } from '../../../contracts/src/index.ts';
import type { HistoryChange, HistoryEntry, HistoryScope, ReaderReference, ReaderSkill, ReaderWorkspace, SavedDraft, WorkspaceSettings } from '../../../contracts/src/workspace.ts';
import type { StoragePort } from '../../../contracts/src/runtime.ts';
import type { ActionTaskRecord } from '../../../contracts/src/tasks.ts';
import { clone } from '../../../contracts/src/clone.ts';
import { validateReference as reference } from '../../../contracts/src/workspace-validation.ts';
import { LIMITS, validateCitation, validateImageAttachment, validatePaperScope, validateSettings } from '../../../contracts/src/validation.ts';
import { ConversationStore, type StoreClock } from '../sessions/store.ts';
import { validateTaskRecord } from '../tasks/controller.ts';
import { SKILL_BYTES, builtinSkills, defaultSettings, digest, editedSkill, identifier, importedSkill, invalid, items, normalizeSettings, normalizeSkill, object, preferences, skillFromSource, text } from './skills.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const REFERENCE_BYTES = 48 * 1024;
const SETTINGS_BYTES = 4 * 1024 * 1024;
const DRAFT_BYTES = 1024 * 1024;
const ASSET_BYTES = 3 * 1024 * 1024;
const draftKeys = ['paper', 'settings', 'question', 'citations', 'images', 'references', 'skillId', 'profileId', 'overrides'] as const;
const savedKeys = ['schemaVersion', 'paper', 'conversationId', 'draft', 'scrollTop', 'pageRange', 'updatedAt'] as const;
const settingKeys = ['schemaVersion', 'preferences', 'profiles', 'skills', 'uiLanguage', 'textScale', 'allowedModels'] as const;
const skillKeys = ['id', 'name', 'description', 'version', 'revision', 'markdown', 'origin', 'enabled', 'workflow', 'permissions', 'unsupportedDependencies'] as const;
function unavailable(): never { throw new ReaderError('HISTORY_UNAVAILABLE', 'Saved workspace data could not be read; it was left untouched.'); }
function failedSave(): never { throw new ReaderError('INTERNAL_ERROR', 'Workspace data could not be saved.'); }
function changedSkill(): never { throw new ReaderError('REQUEST_CONFLICT', 'This skill has changed since it was opened. Load the newer revision before editing it.'); }
function registry(settings: WorkspaceSettings) {
  return { ...settings, skills: settings.skills.map(skill => Object.fromEntries(Object.entries(skill).filter(([key]) => key !== 'markdown'))) };
}
function snapshot(value: unknown): unknown {
  try { return JSON.parse(JSON.stringify(value)) as unknown; } catch { invalid(); }
}
function uuid(value: unknown): string { if (typeof value !== 'string' || !UUID.test(value)) invalid(); return value; }
function timestamp(value: unknown): string {
  const result = text(value, 40, 1); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(result) || !Number.isFinite(Date.parse(result))) invalid(); return result;
}
function range(value: unknown): [number, number] {
  const pair = items(value, 2); if (pair.length !== 2 || !pair.every(n => typeof n === 'number' && Number.isSafeInteger(n) && n > 0) || (pair[0] as number) > (pair[1] as number)) invalid();
  return [pair[0] as number, pair[1] as number];
}
function savedDraft(value: unknown): SavedDraft {
  const source = object(value, savedKeys); if (source.schemaVersion !== 1) invalid();
  const paper = validatePaperScope(source.paper); const draft = object(source.draft, draftKeys);
  const draftPaper = validatePaperScope(draft.paper); if (paperId(paper) !== paperId(draftPaper)) invalid();
  if (typeof source.scrollTop !== 'number' || !Number.isFinite(source.scrollTop) || source.scrollTop < 0 || source.scrollTop > 1e12) invalid();
  const citations = items(draft.citations, LIMITS.citationsPerRequest).map(validateCitation);
  if (citations.some(citation => paperId(citation.paper) !== paperId(paper))) invalid();
  const images = items(draft.images, LIMITS.imagesPerRequest).map(validateImageAttachment);
  const references = items(draft.references, 16).map(reference);
  for (const values of [citations, images, references]) if (new Set(values.map(item => item.id)).size !== values.length) invalid();
  return {
    schemaVersion: 1, paper, conversationId: source.conversationId === null ? null : uuid(source.conversationId),
    draft: { paper: draftPaper, question: text(draft.question, 64 * 1024), citations, images, references, settings: draft.settings === null ? null : validateSettings(draft.settings), skillId: draft.skillId === null ? null : identifier(draft.skillId), profileId: draft.profileId === null ? null : identifier(draft.profileId), overrides: preferences(draft.overrides) },
    scrollTop: source.scrollTop, pageRange: source.pageRange === null ? null : range(source.pageRange), updatedAt: timestamp(source.updatedAt),
  };
}
function publicConversation(value: Conversation): Conversation {
  return clone({ ...(value.paperIdentity ? { paperIdentity: value.paperIdentity } : {}), ...(value.usage ? { usage: value.usage } : {}), ...(value.titleCustomized ? { titleCustomized: true } : {}), ...(value.parentConversationId ? { parentConversationId: value.parentConversationId, forkMessageId: value.forkMessageId } : {}), ...(value.archivedAt ? { archivedAt: value.archivedAt } : {}), ...(value.activeBatchId ? { activeBatchId: value.activeBatchId } : {}), ...(value.queuedRequestIds ? { queuedRequestIds: value.queuedRequestIds } : {}), id: value.id, paper: value.paper, title: value.title, settings: value.settings, activeRequestId: value.activeRequestId, messages: value.messages, lastSeq: value.lastSeq, createdAt: value.createdAt, updatedAt: value.updatedAt });
}
function identityOf(conversation: Conversation, saved: SavedDraft | null = null): PaperIdentity {
  const reported = conversation.paperIdentity ?? conversation.messages.find(message => message.paper)?.paper;
  if (reported) return clone(reported);
  const citation = [...conversation.messages.flatMap(message => message.citations), ...(saved?.draft.citations ?? [])].find(item => paperId(item.paper) === paperId(conversation.paper));
  if (citation) return { title: citation.title || conversation.title, authors: [...citation.authors], ...(citation.year ? { year: citation.year } : {}), ...(citation.doi ? { doi: citation.doi } : {}) };
  return { title: conversation.title || 'Untitled document', authors: [] };
}
function hasDraft(saved: SavedDraft | null): boolean { return !!saved && (!!saved.draft.question.trim() || saved.draft.citations.length > 0 || saved.draft.images.length > 0 || saved.draft.references.length > 0); }
function preview(value: string): string { const characters = [...value]; return characters.length > 240 ? characters.slice(0, 240).join('') + '…' : value; }

/** Uses only relative paths beneath the plugin's injected records store. No runtime is started. */
export class WorkspaceStore implements ReaderWorkspace {
  private queue = Promise.resolve();
  private readonly clientId: string | undefined;
  /** Views that must reconcile after a removal committed. Empty until a sidebar or pane subscribes. */
  private readonly historyListeners = new Set<(change: HistoryChange) => void>();
  constructor(private storage: StoragePort, private clock: StoreClock, scope?: { clientId: string }) { this.clientId = scope ? uuid(scope.clientId) : undefined; }
  private ownedPaper(value: PaperScope): PaperScope {
    const paper = validatePaperScope(value); if (this.clientId && paper.clientId !== this.clientId) unavailable(); return paper;
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation); this.queue = result.then(() => undefined, () => undefined); return result;
  }
  private async readJson(path: string, max: number): Promise<unknown> {
    let bytes: Uint8Array | null; try { bytes = await this.storage.read(path); } catch { unavailable(); }
    if (bytes === null) return undefined;
    if (bytes.length > max) unavailable();
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; } catch { unavailable(); }
  }
  private async writeJson(path: string, value: unknown, max: number): Promise<void> {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    if (bytes.length > max) throw new ReaderError('PAYLOAD_TOO_LARGE', 'Workspace data exceeds the supported storage size.');
    try { await this.storage.writeAtomic(path, bytes); } catch { failedSave(); }
  }
  private async loadSettings(): Promise<WorkspaceSettings> {
    const raw = await this.readJson('workspace/settings.json', SETTINGS_BYTES); if (raw === undefined) return defaultSettings();
    let checked: WorkspaceSettings; const migrations: ReaderSkill[] = [];
    try {
      const source = object(raw, settingKeys); if (source.schemaVersion !== 1) unavailable();
      const skills: ReaderSkill[] = [];
      for (const value of items(source.skills, 64)) {
        const metadata = object(value, skillKeys); const skillId = identifier(metadata.id);
        const builtin = builtinSkills().find(skill => skill.id === skillId);
        if (builtin) {
          if (metadata.origin !== 'builtin' || typeof metadata.enabled !== 'boolean') unavailable();
          skills.push({ ...builtin, enabled: metadata.enabled }); continue;
        }
        const markdown = await this.readSkill(skillId);
        if (markdown === null) {
          if (metadata.markdown === undefined) unavailable();
          const migrated = await editedSkill(metadata); migrations.push(migrated); skills.push(migrated);
        } else skills.push(await skillFromSource(metadata, markdown));
      }
      checked = await normalizeSettings({ ...source, skills });
    } catch { unavailable(); }
    // On interruption the old inline registry remains intact. Existing files win on retry.
    for (const skill of migrations) await this.writeSkill(skill, null);
    const stored = registry(checked);
    if (JSON.stringify(stored) !== JSON.stringify(raw)) await this.writeJson('workspace/settings.json', stored, SETTINGS_BYTES);
    return checked;
  }
  private skillPath(skillId: string): string { return `workspace/skills/${identifier(skillId)}/SKILL.md`; }
  private async readSkill(skillId: string): Promise<string | null> {
    let bytes: Uint8Array | null; try { bytes = await this.storage.read(this.skillPath(skillId)); } catch { unavailable(); }
    if (bytes === null) return null; if (bytes.length > SKILL_BYTES) unavailable();
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { unavailable(); }
  }
  private async writeSkill(skill: ReaderSkill, previous: ReaderSkill | null): Promise<void> {
    if (skill.origin === 'builtin') return;
    const current = await this.readSkill(skill.id);
    if (previous) {
      if (current === null) unavailable();
      let observed: ReaderSkill; try { observed = await skillFromSource(previous, current); } catch { unavailable(); }
      if (observed.revision !== previous.revision) changedSkill();
    } else if (current !== null && current !== skill.markdown) changedSkill();
    if (current === skill.markdown) return;
    const bytes = new TextEncoder().encode(skill.markdown); if (bytes.length > SKILL_BYTES) invalid();
    try { await this.storage.writeAtomic(this.skillPath(skill.id), bytes); } catch { failedSave(); }
  }
  private async persistSettings(settings: WorkspaceSettings, previous: WorkspaceSettings): Promise<void> {
    for (const skill of settings.skills) await this.writeSkill(skill, previous.skills.find(item => item.id === skill.id) ?? null);
    await this.writeJson('workspace/settings.json', registry(settings), SETTINGS_BYTES);
  }
  settings(): Promise<WorkspaceSettings> { return this.serial(() => this.loadSettings()); }
  async saveSettings(value: WorkspaceSettings): Promise<void> {
    const frozen = snapshot(value);
    return this.serial(async () => {
      const requested = await normalizeSettings(frozen); const current = await this.loadSettings();
      const rawSkills = new Map(items(object(frozen, settingKeys).skills, 64).map(value => { const source = object(value, skillKeys); return [identifier(source.id), source] as const; }));
      const skills = new Map(current.skills.map(skill => [skill.id, skill]));
      for (const skill of requested.skills) {
        const raw = rawSkills.get(skill.id); if (!raw) continue;
        const previous = skills.get(skill.id);
        if (previous && previous.origin !== skill.origin) changedSkill();
        if (previous && skill.origin !== 'builtin' && raw.revision !== previous.revision) {
          // Preferences forms carry a full old snapshot. Preserve newer file definitions.
          if (skill.revision !== raw.revision) changedSkill();
          continue;
        }
        skills.set(skill.id, await editedSkill(raw, previous));
      }
      const checked = await normalizeSettings({ ...requested, skills: [...skills.values()] });
      await this.persistSettings(checked, current);
    });
  }
  async saveSkill(value: ReaderSkill): Promise<ReaderSkill> {
    const frozen = snapshot(value);
    return this.serial(async () => {
      const requested = await normalizeSkill(frozen); const settings = await this.loadSettings();
      const previous = settings.skills.find(skill => skill.id === requested.id);
      if (previous && previous.origin !== requested.origin) changedSkill();
      if (previous && requested.origin !== 'builtin' && object(frozen, skillKeys).revision !== previous.revision) changedSkill();
      const skill = await editedSkill(frozen, previous); const before = clone(settings);
      const index = settings.skills.findIndex(item => item.id === skill.id);
      if (index < 0) settings.skills.push(skill); else settings.skills[index] = skill;
      const checked = await normalizeSettings(settings); await this.persistSettings(checked, before); return clone(skill);
    });
  }
  importSkill(markdown: string): Promise<ReaderSkill> {
    return this.serial(async () => {
      const skill = await importedSkill(markdown); const settings = await this.loadSettings();
      const existing = settings.skills.find(item => item.id === skill.id);
      if (existing) { if (existing.markdown !== skill.markdown) throw new ReaderError('REQUEST_CONFLICT', 'The skill identifier already belongs to different content.'); return clone(existing); }
      const before = clone(settings); settings.skills.push(skill); const checked = await normalizeSettings(settings);
      await this.persistSettings(checked, before); return clone(skill);
    });
  }
  deleteSkill(id: string): Promise<void> {
    return this.serial(async () => {
      identifier(id); const settings = await this.loadSettings(); const skill = settings.skills.find(item => item.id === id);
      if (!skill) throw new ReaderError('NOT_FOUND', 'Unknown skill');
      if (skill.origin === 'builtin') throw new ReaderError('REQUEST_CONFLICT', 'Built-in skills can be disabled but not deleted.');
      settings.skills = settings.skills.filter(item => item.id !== id); await this.writeJson('workspace/settings.json', registry(settings), SETTINGS_BYTES);
      try { await this.storage.remove(this.skillPath(id)); } catch { failedSave(); }
    });
  }
  private draftPath(paper: PaperScope, conversationId: string | null): string {
    const checked = this.ownedPaper(paper); const conversation = conversationId === null ? 'unbound' : uuid(conversationId);
    return `workspace/drafts/${checked.clientId}-${checked.libraryId}-${checked.attachmentKey}-${conversation}.json`;
  }
  private assetPath(id: unknown): string { if (typeof id !== 'string' || !/^[0-9a-f]{64}$/u.test(id)) invalid(); return `workspace/assets/${id}.json`; }
  private async loadAsset(id: string): Promise<{ mime: string; dataUrl: string } | null> {
    const raw = await this.readJson(this.assetPath(id), ASSET_BYTES); if (raw === undefined) return null;
    try {
      const asset = object(raw, ['schemaVersion', 'mime', 'dataUrl']); if (asset.schemaVersion !== 1) unavailable();
      const image = validateImageAttachment({ id: '00000000-0000-4000-8000-000000000000', name: 'stored-image', mime: asset.mime, dataUrl: asset.dataUrl });
      const content = { mime: image.mime, dataUrl: image.dataUrl }; if (await digest(JSON.stringify(content)) !== id) unavailable(); return content;
    } catch { unavailable(); }
  }
  private async saveAsset(image: ImageAttachment): Promise<Pick<ImageAttachment, 'id' | 'name' | 'mime' | 'origin'> & { assetId: string }> {
    const content = { mime: image.mime, dataUrl: image.dataUrl }; const assetId = await digest(JSON.stringify(content));
    const existing = await this.loadAsset(assetId);
    if (!existing) await this.writeJson(this.assetPath(assetId), { schemaVersion: 1, ...content }, ASSET_BYTES);
    else if (existing.mime !== image.mime || existing.dataUrl !== image.dataUrl) throw new ReaderError('REQUEST_CONFLICT', 'Saved workspace image assets are immutable.');
    return { id: image.id, name: image.name, mime: image.mime, assetId, ...(image.origin ? { origin: clone(image.origin) } : {}) };
  }
  private async loadDraft(paper: PaperScope, conversationId: string | null): Promise<SavedDraft | null> {
    const raw = await this.readJson(this.draftPath(paper, conversationId), DRAFT_BYTES); if (raw === undefined) return null;
    try {
      const source = object(raw, savedKeys); if (source.schemaVersion !== 1) unavailable();
      const draft = object(source.draft, draftKeys); const images: ImageAttachment[] = [];
      for (const item of items(draft.images, LIMITS.imagesPerRequest)) {
        const image = object(item, ['id', 'name', 'mime', 'assetId', 'origin']); this.assetPath(image.assetId);
        const asset = await this.loadAsset(image.assetId as string); if (!asset || asset.mime !== image.mime) unavailable();
        images.push(validateImageAttachment({ id: image.id, name: image.name, mime: image.mime, dataUrl: asset.dataUrl, ...(image.origin !== undefined ? { origin: image.origin } : {}) }));
      }
      const checked = savedDraft({ ...source, draft: { ...draft, images } });
      if (paperId(checked.paper) !== paperId(paper) || checked.conversationId !== conversationId) unavailable(); return checked;
    } catch { unavailable(); }
  }
  async saveDraft(value: SavedDraft): Promise<void> {
    const frozen = savedDraft(value);
    return this.serial(async () => {
      await this.loadDraft(frozen.paper, frozen.conversationId);
      const images = []; for (const image of frozen.draft.images) images.push(await this.saveAsset(image));
      await this.writeJson(this.draftPath(frozen.paper, frozen.conversationId), { ...frozen, draft: { ...frozen.draft, images }, updatedAt: timestamp(this.clock.now()) }, DRAFT_BYTES);
    });
  }
  readDraft(paper: PaperScope, conversationId: string | null): Promise<SavedDraft | null> {
    const frozen = validatePaperScope(paper); this.draftPath(frozen, conversationId);
    return this.serial(() => this.loadDraft(frozen, conversationId));
  }
  /** Deletes only the draft file when it exists; shared image assets are never collected here. */
  private async removeDraft(paper: PaperScope, conversationId: string | null): Promise<void> {
    const path = this.draftPath(paper, conversationId);
    if (!await this.loadDraft(paper, conversationId)) return;
    try { await this.storage.remove(path); } catch { failedSave(); }
  }
  deleteDraft(paper: PaperScope, conversationId: string | null): Promise<void> {
    const frozen = validatePaperScope(paper); this.draftPath(frozen, conversationId);
    return this.serial(() => this.removeDraft(frozen, conversationId));
  }
  private async loadConversation(id: string, metadataOnly = false): Promise<Conversation> {
    uuid(id); const path = `conversations/${id}.json`;
    let bytes: Uint8Array | null; try { bytes = await this.storage.read(path); } catch { unavailable(); }
    if (bytes === null) throw new ReaderError('NOT_FOUND', 'Unknown conversation');
    if (bytes.length > 64 * 1024 * 1024) unavailable();
    try {
      const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) unavailable();
      const header = raw as Record<string, unknown>;
      if (header.id !== id || (header.schemaVersion !== 1 && header.schemaVersion !== 2 && header.schemaVersion !== 3)) unavailable();
      this.ownedPaper(validatePaperScope(header.paper));
    } catch { unavailable(); }
    const captured = bytes;
    const readOnly: StoragePort = {
      read: target => {
        if (target === path) return Promise.resolve(captured);
        const prefix = `conversations/${id}.`; const suffix = '.source.json';
        if (target === `conversations/${id}.jsonl` || (!metadataOnly && target.startsWith(prefix) && target.endsWith(suffix) && UUID.test(target.slice(prefix.length, -suffix.length)))) return this.storage.read(target);
        return Promise.reject(new Error('Unowned conversation record'));
      },
      writeAtomic: () => Promise.reject(new Error('Read-only history')),
      append: () => Promise.reject(new Error('Read-only history')),
      remove: () => Promise.reject(new Error('Read-only history')),
    };
    const store = new ConversationStore(readOnly, this.clock);
    const value = metadataOnly ? await store.peek(id, this.clientId ? { clientId: this.clientId } : undefined) : await store.get(id);
    if (value.id !== id) unavailable();
    return publicConversation({ ...value, queuedRequestIds: value.requests.filter(request => request.state === 'accepted' && request.requestId !== value.activeRequestId).map(request => request.requestId) });
  }
  private async currentId(paper: PaperScope): Promise<string | null> {
    const checked = this.ownedPaper(paper);
    const raw = await this.readJson(`papers/${checked.clientId}-${checked.libraryId}-${checked.attachmentKey}.json`, DRAFT_BYTES);
    if (raw === undefined) return null;
    try {
      const index = object(raw, ['schemaVersion', 'conversations', 'current']); if (index.schemaVersion !== 1) unavailable();
      const ids = items(index.conversations, 10_000).map(uuid); if (new Set(ids).size !== ids.length) unavailable();
      const current = index.current === null ? null : uuid(index.current); if (current !== null && !ids.includes(current)) unavailable(); return current;
    } catch { unavailable(); }
  }
  readConversation(id: string): Promise<Conversation> { return this.serial(() => this.loadConversation(id)); }
  currentConversation(paper: PaperScope): Promise<Conversation | null> {
    const frozen = validatePaperScope(paper);
    return this.serial(async () => {
      const id = await this.currentId(frozen); if (!id) return null;
      const value = await this.loadConversation(id);
      if (paperId(value.paper) !== paperId(frozen)) unavailable(); return value;
    });
  }
  private async historyTasks(conversations: Map<string, Conversation>): Promise<Map<string, ActionTaskRecord[]>> {
    if (!this.storage.list) unavailable();
    let files: string[]; try { files = await this.storage.list('tasks'); } catch { unavailable(); }
    if (files.length > 50_000 || files.some(file => typeof file !== 'string')) unavailable();
    const result = new Map<string, ActionTaskRecord[]>();
    for (const file of new Set(files)) {
      if (!/^[a-zA-Z0-9-]{1,128}\.json$/u.test(file)) { if (file.endsWith('.json')) unavailable(); continue; }
      let task: ActionTaskRecord;
      try {
        task = validateTaskRecord(await this.readJson(`tasks/${file}`, 8 * 1024 * 1024));
        if (task.id !== file.slice(0, -5)) unavailable(); timestamp(task.createdAt); timestamp(task.updatedAt);
      } catch { unavailable(); }
      const taskClient = task.kind === 'annotations' ? task.paper.clientId : task.kind === 'figure-annotations' ? task.selection.paper.clientId
        : task.kind === 'acquisition' ? task.target.clientId : task.kind === 'child-notes' ? task.items[0]?.parent.clientId
          : task.kind === 'collection-create' ? task.items[0]?.target.clientId : task.items[0]?.before.clientId;
      if (!taskClient || (task.kind === 'organization' && task.items.some(item => item.before.clientId !== taskClient))
        || (task.kind === 'metadata-update' && task.items.some(item => item.before.clientId !== taskClient))
        || (task.kind === 'child-notes' && task.items.some(item => item.parent.clientId !== taskClient))) unavailable();
      if (this.clientId && taskClient !== this.clientId) unavailable();
      const conversation = conversations.get(task.conversationId);
      if (!conversation) continue; // A deleted conversation's ledger remains available to the task controller.
      if (taskClient !== conversation.paper.clientId || (task.kind === 'annotations' && paperId(task.paper) !== paperId(conversation.paper))
        || (task.kind === 'figure-annotations' && paperId(task.selection.paper) !== paperId(conversation.paper))) unavailable();
      const tasks = result.get(conversation.id) ?? []; tasks.push(task); result.set(conversation.id, tasks);
    }
    return result;
  }
  history(query = '', scope: HistoryScope = {}): Promise<HistoryEntry[]> {
    const search = text(query, 1024).normalize('NFKC').toLowerCase().trim();
    const archivedScope = scope.archived === true;
    return this.serial(async () => {
      if (!this.storage.list) unavailable();
      let files: string[]; try { files = await this.storage.list('conversations'); } catch { unavailable(); }
      if (files.length > 50_000 || files.some(file => typeof file !== 'string')) unavailable();
      const ids = [...new Set(files.filter(file => file.endsWith('.json') && UUID.test(file.slice(0, -5))).map(file => file.slice(0, -5)))];
      if (ids.length > 10_000) unavailable();
      const conversations = new Map<string, Conversation>();
      for (const id of ids) conversations.set(id, await this.loadConversation(id, true));
      const tasksByConversation = await this.historyTasks(conversations);
      const entries: HistoryEntry[] = []; const currentByPaper = new Map<string, string | null>();
      for (const c of conversations.values()) {
        // Exactly one scope per chat: archive state is the only difference between the two queries.
        if (!!c.archivedAt !== archivedScope) continue;
        const tasks = tasksByConversation.get(c.id) ?? [];
        // The Preferences pane must not delete a chat the sidebar would refuse to delete over.
        const unfinishedWork = !!c.activeRequestId || !!c.queuedRequestIds?.length
          || tasks.some(task => ['preparing', 'review', 'running', 'uncertain'].includes(task.state) || task.items.some(item => ['writing', 'undoing', 'uncertain'].includes(item.status)));
        let saved = await this.loadDraft(c.paper, c.id);
        if (!saved) {
          const key = paperId(c.paper);
          if (!currentByPaper.has(key)) currentByPaper.set(key, await this.currentId(c.paper));
          if (currentByPaper.get(key) === c.id) saved = await this.loadDraft(c.paper, null);
        }
        const draftPresent = hasDraft(saved);
        if (!draftPresent && !tasks.length && !c.messages.some(message => !!message.text.trim() || !!message.images?.length || !!message.generatedImages?.length || message.citations.length > 0)) continue;
        const identity = identityOf(c, saved);
        const searchable = [c.title, identity.title, ...identity.authors, ...c.messages.map(message => message.text), ...tasks.map(task => task.question), saved?.draft.question ?? ''].join('\n').normalize('NFKC').toLowerCase();
        if (search && !searchable.includes(search)) continue;
        const updatedAt = [c.updatedAt, ...(draftPresent && saved ? [saved.updatedAt] : []), ...tasks.map(task => task.updatedAt)].sort().at(-1)!;
        const previews = [{ at: c.updatedAt, text: c.messages.findLast(message => message.text.trim())?.text ?? '' }, ...(draftPresent && saved ? [{ at: saved.updatedAt, text: saved.draft.question }] : []), ...tasks.map(task => ({ at: task.updatedAt, text: task.question }))].filter(item => item.text.trim()).sort((a, b) => b.at.localeCompare(a.at));
        entries.push({ id: c.id, paper: clone(c.paper), title: c.title, identity, updatedAt, createdAt: c.createdAt, messageCount: c.messages.length, taskCount: tasks.length, preview: preview(previews[0]?.text ?? ''), hasDraft: draftPresent, activeRequestId: c.activeRequestId, ...(unfinishedWork ? { unfinishedWork: true } : {}), ...(c.archivedAt ? { archivedAt: c.archivedAt } : {}) });
      }
      return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    });
  }
  /**
   * Explicit removal of one stored chat and its bound draft. Shared image assets and native task
   * ledgers are deliberately left in place; nothing else is pruned, and the paper index's current
   * pointer falls back to the previous chat (or none) inside the conversation store.
   */
  removeConversation(paper: PaperScope, id: string): Promise<void> {
    const checked = this.ownedPaper(paper);
    return this.serial(async () => {
      uuid(id);
      const store = new ConversationStore(this.storage, this.clock);
      await store.remove(checked, id);
      await this.removeDraft(checked, id);
      // Only after both files are gone: a view must never drop a row the store could not remove.
      this.publishHistory({ paper: clone(checked), removed: [id] });
    });
  }
  /**
   * Registers one listener for committed removals. The store stays the only writer; this is a
   * notification, not a second owner, so a throw inside a listener cannot affect the removal.
   */
  subscribeHistory(listener: (change: HistoryChange) => void): () => void {
    this.historyListeners.add(listener);
    return () => { this.historyListeners.delete(listener); };
  }
  private publishHistory(change: HistoryChange): void {
    for (const listener of [...this.historyListeners]) {
      try { listener(clone(change)); } catch { /* a view cannot invalidate a committed change */ }
    }
  }
  snapshotChat(conversationId: string, messageIds?: string[]): Promise<ReaderReference> {
    const requested = messageIds === undefined ? null : items(messageIds, 32).map(id => text(id, 128, 1));
    if (requested && (!requested.length || new Set(requested).size !== requested.length)) invalid();
    return this.serial(async () => {
      const conversation = await this.loadConversation(conversationId);
      const eligible = conversation.messages.filter(message => message.status !== 'pending' && message.status !== 'streaming' && message.text.length > 0);
      if (requested && requested.some(id => !conversation.messages.some(message => message.id === id))) throw new ReaderError('NOT_FOUND', 'A selected chat message no longer exists.');
      if (requested && requested.some(id => !eligible.some(message => message.id === id))) throw new ReaderError('BUSY', 'Select completed messages with text for a chat reference.');
      let selected = requested ? eligible.filter(message => requested.includes(message.id)) : eligible.slice(-6);
      if (!selected.length) throw new ReaderError('INVALID_REQUEST', 'This conversation has no completed text to reference.');
      const render = () => `Chat snapshot: ${selected.length} of ${eligible.length} completed text messages. Message text only; citations, images and nested references are not expanded. Chat content is background, not paper evidence.\n\n${selected.map(message => `[${message.role}]\n${message.text}`).join('\n\n')}`;
      while (new TextEncoder().encode(render()).length > REFERENCE_BYTES) {
        if (requested || selected.length === 1) throw new ReaderError('PAYLOAD_TOO_LARGE', 'The selected whole chat messages exceed the reference limit; choose fewer or shorter messages.');
        selected = selected.slice(1);
      }
      return reference({ id: this.clock.uuid(), kind: 'chat', label: `${conversation.title} · ${selected.length} messages`, paper: conversation.paper, identity: identityOf(conversation), conversationId, messageIds: selected.map(message => message.id), text: render(), capturedAt: this.clock.now() });
    });
  }
}
