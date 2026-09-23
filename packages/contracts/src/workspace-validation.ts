import { ReaderError, paperId, type ContextBatch, type ContextReport } from './index.ts';
import type { HistoryEntry, Personalization, ReaderReference, ReaderSkill, ReferenceInput, WorkflowSnapshot } from './workspace.ts';
import { LIMITS, validatePaperIdentity, validatePaperScope } from './validation.ts';
import { validateDocument } from './document.ts';
function fail(): never { throw new ReaderError('INVALID_REQUEST', 'The workflow or reference snapshot is invalid.'); }
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const result = value as Record<string, unknown>; if (Object.keys(result).some(key => !keys.includes(key))) fail(); return result;
}
function text(value: unknown, max = 4096, min = 0): string {
  if (typeof value !== 'string' || value.length < min || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) fail(); return value;
}
function array(value: unknown, max: number): unknown[] { if (!Array.isArray(value) || value.length > max) fail(); return value; }
function count(value: unknown, max = Number.MAX_SAFE_INTEGER): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) fail(); return value; }
function uuid(value: unknown): string { const id = text(value, 36, 36); if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(id)) fail(); return id; }
function timestamp(value: unknown): string {
  const result = text(value, 40, 1); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(result) || !Number.isFinite(Date.parse(result))) fail(); return result;
}
const preferenceKeys = ['language', 'detail', 'mathematics', 'background', 'citationStyle', 'annotationStyle'] as const;
export function validatePreferences(value: unknown): Partial<Personalization> {
  const source = object(value, preferenceKeys); const result: Partial<Personalization> = {};
  if (source.language !== undefined) result.language = text(source.language, 64, 1);
  if (source.detail !== undefined) { if (typeof source.detail !== 'string' || !['brief', 'standard', 'detailed'].includes(source.detail)) fail(); result.detail = source.detail as Personalization['detail']; }
  if (source.mathematics !== undefined) { if (typeof source.mathematics !== 'string' || !['auto', 'intuition-first', 'formal'].includes(source.mathematics)) fail(); result.mathematics = source.mathematics as Personalization['mathematics']; }
  for (const key of ['background', 'citationStyle', 'annotationStyle'] as const) if (source[key] !== undefined) result[key] = text(source[key]);
  return result;
}
export function validateReference(value: unknown): ReaderReference {
  const source = object(value, ['id', 'kind', 'label', 'paper', 'identity', 'conversationId', 'messageIds', 'text', 'range', 'capturedAt']);
  if (!['article', 'chat', 'collection', 'note', 'annotation', 'file'].includes(String(source.kind))) fail();
  const capturedAt = timestamp(source.capturedAt);
  const result: ReaderReference = { id: text(source.id, 256, 1), kind: source.kind as ReaderReference['kind'], label: text(source.label, 2048, 1), capturedAt };
  if (source.paper !== undefined) result.paper = validatePaperScope(source.paper);
  if (source.identity !== undefined) result.identity = validatePaperIdentity(source.identity);
  if (source.conversationId !== undefined) result.conversationId = uuid(source.conversationId);
  if (source.messageIds !== undefined) { result.messageIds = array(source.messageIds, 32).map(id => text(id, 128, 1)); if (new Set(result.messageIds).size !== result.messageIds.length) fail(); }
  if (source.text !== undefined) { result.text = text(source.text, LIMITS.referenceTextBytes); if (new TextEncoder().encode(result.text).length > LIMITS.referenceTextBytes) fail(); }
  if (source.range !== undefined) { const pair = array(source.range, 2).map(n => count(n, 10000)); if (pair.length !== 2 || pair[0]! < 1 || pair[1]! < pair[0]!) fail(); result.range = [pair[0]!, pair[1]!]; }
  return result;
}
const historyEntryKeys = ['id', 'paper', 'title', 'identity', 'updatedAt', 'createdAt', 'messageCount', 'preview', 'hasDraft', 'activeRequestId', 'taskCount', 'unfinishedWork', 'archivedAt'] as const;
/**
 * Validates one History listing row exactly as the store may return it. A malformed row fails the
 * whole listing rather than being dropped: a list that silently lost a chat would misreport what is
 * stored on disk.
 */
export function validateHistoryEntry(value: unknown): HistoryEntry {
  const source = object(value, historyEntryKeys);
  if (typeof source.hasDraft !== 'boolean') fail();
  const result: HistoryEntry = {
    id: uuid(source.id), paper: validatePaperScope(source.paper), title: text(source.title, 2048),
    identity: validatePaperIdentity(source.identity), updatedAt: timestamp(source.updatedAt), createdAt: timestamp(source.createdAt),
    messageCount: count(source.messageCount, 10_000), preview: text(source.preview, 4096), hasDraft: source.hasDraft,
    activeRequestId: source.activeRequestId === null ? null : uuid(source.activeRequestId),
  };
  if (source.taskCount !== undefined) result.taskCount = count(source.taskCount, 10_000);
  if (source.unfinishedWork !== undefined) { if (source.unfinishedWork !== true) fail(); result.unfinishedWork = true; }
  if (source.archivedAt !== undefined) result.archivedAt = timestamp(source.archivedAt);
  return result;
}
export function validateReferenceInput(value: unknown): ReferenceInput {
  const source = object(value, ['id', 'kind', 'label', 'paper', 'identity', 'conversationId', 'messageIds', 'text', 'range', 'capturedAt', 'document']);
  const { document, ...ref } = source; const result: ReferenceInput = validateReference(ref);
  if (document !== undefined) {
    if (result.kind !== 'article' || !result.paper) fail();
    result.document = validateDocument(document);
    if (paperId(result.paper) !== paperId(result.document.paper)) fail();
  }
  return result;
}
export function validateWorkflow(value: unknown): WorkflowSnapshot {
  const source = object(value, ['skill', 'preferences', 'profileId', 'autoApplyAnnotations']);
  const prefs = validatePreferences(source.preferences); if (preferenceKeys.some(key => prefs[key] === undefined)) fail();
  let skill: ReaderSkill | null = null;
  if (source.skill !== null) {
    const s = object(source.skill, ['id', 'name', 'description', 'version', 'revision', 'markdown', 'origin', 'enabled', 'workflow', 'permissions', 'unsupportedDependencies']);
    if (s.enabled !== true || !['builtin', 'user', 'imported'].includes(String(s.origin)) || !['read', 'annotate', 'acquire', 'organize', 'diagram'].includes(String(s.workflow))) fail();
    const unsupported = array(s.unsupportedDependencies, 64).map(x => text(x, 256)); if (unsupported.length) throw new ReaderError('UNSUPPORTED_INTERACTION', 'This workflow has unsupported dependencies; they were not executed.');
    skill = { id: text(s.id, 128, 1), name: text(s.name, 128, 1), description: text(s.description, 2048), version: text(s.version, 64, 1), revision: text(s.revision, 128, 1), markdown: text(s.markdown, 64 * 1024, 1), origin: s.origin as ReaderSkill['origin'], enabled: true, workflow: s.workflow as ReaderSkill['workflow'], permissions: array(s.permissions, 64).map(x => text(x, 256)), unsupportedDependencies: [] };
  }
  if (source.autoApplyAnnotations !== undefined && (source.autoApplyAnnotations !== true || skill?.workflow !== 'annotate')) fail();
  return { skill, preferences: prefs as Personalization, profileId: source.profileId === null ? null : text(source.profileId, 128, 1), ...(source.autoApplyAnnotations ? { autoApplyAnnotations: true as const } : {}) };
}
export function validateBatch(value: unknown): ContextBatch {
  const source = object(value, ['id', 'index', 'total', 'phase', 'question', 'summaries']);
  if (source.phase !== 'map' && source.phase !== 'reduce') fail();
  const total = count(source.total, 512), index = count(source.index, total); if (!total || (source.phase === 'map' && index >= total)) fail();
  const result: ContextBatch = { id: uuid(source.id), index, total, phase: source.phase, question: text(source.question, 8000, 1) };
  if (source.summaries !== undefined) {
    let bytes = 0;
    result.summaries = array(source.summaries, 512).map(value => {
      const s = object(value, ['index', 'pages', 'pageLabels', 'text', 'paper', 'title']); const body = text(s.text, 128 * 1024);
      bytes += new TextEncoder().encode(body).length; if (bytes > 128 * 1024) throw new ReaderError('PAYLOAD_TOO_LARGE', 'The combined reading findings are too large; no summaries were truncated.');
      return { index: count(s.index, total - 1), pages: array(s.pages, 10000).map(n => count(n, 9999)), ...(s.pageLabels !== undefined ? { pageLabels: array(s.pageLabels, 10000).map(label => text(label, 64)) } : {}), text: body, ...(s.paper !== undefined ? { paper: validatePaperScope(s.paper) } : {}), ...(s.title !== undefined ? { title: text(s.title, 2048) } : {}) };
    });
  }
  return result;
}
export function validateContextReport(value: unknown): ContextReport {
  const r = object(value, ['mode', 'capacity', 'provenance', 'reservedTokens', 'textBudgetTokens', 'selectedPages', 'totalPages', 'reason']);
  if (!['full', 'focused', 'multi-pass'].includes(String(r.mode)) || !['runtime-reported', 'pinned-catalog', 'unknown'].includes(String(r.provenance))) fail();
  return { mode: r.mode as ContextReport['mode'], capacity: r.capacity === null ? null : count(r.capacity), provenance: r.provenance as ContextReport['provenance'], reservedTokens: r.reservedTokens === null ? null : count(r.reservedTokens), textBudgetTokens: r.textBudgetTokens === null ? null : count(r.textBudgetTokens), selectedPages: array(r.selectedPages, 10000).map(n => count(n, 9999)), totalPages: count(r.totalPages, 10000), reason: text(r.reason, 2048) };
}
