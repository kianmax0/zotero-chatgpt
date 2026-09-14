import { ReaderError, paperId } from '../../../contracts/src/index.ts';
import type { HistoryEntry, HistoryFilter, HistoryListing, HistoryMutationReport, HistoryPaperOption, HistorySource } from '../../../contracts/src/workspace.ts';
import { validateHistoryEntry } from '../../../contracts/src/workspace-validation.ts';

/**
 * History management for the native Preferences pane. All of it is headless: listing, filtering,
 * counting, reversible archiving and explicit removal work against the same `HistoryScope.archived`
 * the sidebar already uses, so there is no second storage model and no second definition of
 * "archived". Nothing here prunes, expires or garbage-collects anything: every removal is driven by
 * an explicit selection.
 */

const HISTORY_LIMIT = 10_000;
const confirmation = 'The change could not be confirmed.';
function reason(error: unknown): string { return error instanceof Error ? error.message : 'The action could not be completed.'; }
function unavailable(): never { throw new ReaderError('HISTORY_UNAVAILABLE', 'Saved chat history could not be read; it was left untouched.'); }
function requireIds(ids: readonly string[]): void {
  if (!ids.length) throw new ReaderError('INVALID_REQUEST', 'Select at least one stored chat.');
  if (ids.length > HISTORY_LIMIT || ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) {
    throw new ReaderError('INVALID_REQUEST', 'The selected chats are invalid.');
  }
}

function validEntry(value: unknown): boolean {
  try { validateHistoryEntry(value); return true; } catch { return false; }
}
function validFailed(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value as Record<string, unknown>).every(key => key === 'id' || key === 'message')
    && typeof (value as Record<string, unknown>).id === 'string' && typeof (value as Record<string, unknown>).message === 'string';
}
/** A listing is rejected whole — including a count that disagrees with its rows — never half-accepted. */
export function isHistoryListing(value: unknown): value is HistoryListing {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some(key => !['entries', 'activeCount', 'archivedCount'].includes(key))) return false;
  if (!Array.isArray(source.entries) || source.entries.length > HISTORY_LIMIT || !source.entries.every(validEntry)) return false;
  const entries = source.entries as HistoryEntry[];
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) return false;
  const activeCount = typeof source.activeCount === 'number' ? source.activeCount : Number.NaN;
  const archivedCount = typeof source.archivedCount === 'number' ? source.archivedCount : Number.NaN;
  if (!Number.isSafeInteger(activeCount) || !Number.isSafeInteger(archivedCount)) return false;
  if (activeCount < 0 || archivedCount < 0) return false;
  if (activeCount + archivedCount !== entries.length) return false;
  return activeCount === entries.filter(entry => !entry.archivedAt).length
    && archivedCount === entries.filter(entry => !!entry.archivedAt).length;
}
/** A mutation report is rejected unless its own numbers agree, so the pane never shows a false success. */
export function isHistoryReport(value: unknown): value is HistoryMutationReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some(key => !['action', 'requested', 'changed', 'failed', 'warnings', 'partial'].includes(key))) return false;
  if (!['archive', 'restore', 'delete'].includes(source.action as string)) return false;
  if (!Array.isArray(source.changed) || !source.changed.every(id => typeof id === 'string')) return false;
  if (!Array.isArray(source.failed) || !source.failed.every(validFailed)) return false;
  if (!Array.isArray(source.warnings) || !source.warnings.every(text => typeof text === 'string')) return false;
  if (typeof source.partial !== 'boolean' || typeof source.requested !== 'number' || !Number.isSafeInteger(source.requested) || source.requested < 0) return false;
  if (new Set(source.changed).size !== source.changed.length || source.changed.length > source.requested) return false;
  return source.partial === (source.changed.length < source.requested);
}
export function historyCounts(entries: readonly HistoryEntry[]): { total: number; active: number; archived: number } {
  const archived = entries.filter(entry => !!entry.archivedAt).length;
  return { total: entries.length, active: entries.length - archived, archived };
}
/** The distinct papers among listed chats, ordered by the label the owner sees. */
export function historyPapers(entries: readonly HistoryEntry[]): HistoryPaperOption[] {
  const byId = new Map<string, HistoryPaperOption>();
  for (const entry of entries) {
    const id = paperId(entry.paper);
    if (byId.has(id)) continue;
    byId.set(id, { id, label: entry.identity.title || entry.title || 'Untitled document', paper: entry.paper });
  }
  return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}
/** Pure client-side filter over one listing; an empty input yields an empty output, never everything. */
export function filterHistory(entries: readonly HistoryEntry[], filter: HistoryFilter): HistoryEntry[] {
  return entries.filter(entry => {
    if (filter.scope === 'active' && entry.archivedAt) return false;
    if (filter.scope === 'archived' && !entry.archivedAt) return false;
    return filter.paperId === null || paperId(entry.paper) === filter.paperId;
  });
}

export class HistoryManager {
  constructor(private readonly source: HistorySource) {}

  private async scope(query: string, archived: boolean): Promise<HistoryEntry[]> {
    if (typeof query !== 'string' || query.length > 1024) throw new ReaderError('INVALID_REQUEST', 'The history search is invalid.');
    const value = await this.source.history(query, { archived });
    if (!Array.isArray(value) || value.length > HISTORY_LIMIT) return unavailable();
    return value.map(validateHistoryEntry);
  }

  /** Both scopes in one listing, newest first, so the pane can count and filter without a second call. */
  async listing(query = ''): Promise<HistoryListing> {
    const [active, archived] = await Promise.all([this.scope(query, false), this.scope(query, true)]);
    const seen = new Set<string>();
    const entries = [...active, ...archived].filter(entry => !seen.has(entry.id) && seen.add(entry.id));
    entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    return { entries, activeCount: active.length, archivedCount: archived.length };
  }

  /** Current entries for the given ids, in the given order; ids that are gone are reported as missing. */
  private async resolve(ids: readonly string[]): Promise<{ entries: HistoryEntry[]; missing: string[] }> {
    const listing = await this.listing();
    const byId = new Map(listing.entries.map(entry => [entry.id, entry]));
    const entries: HistoryEntry[] = []; const missing: string[] = [];
    for (const id of ids) { const entry = byId.get(id); if (entry) entries.push(entry); else missing.push(id); }
    return { entries, missing };
  }

  private async confirmScope(id: string, archived: boolean, report: HistoryMutationReport): Promise<boolean> {
    try { return (await this.scope('', archived)).some(entry => entry.id === id); }
    catch (error) {
      report.warnings.push(`The ${archived ? 'archive' : 'restore'} of ${id} could not be re-verified: ${reason(error)}`);
      return false;
    }
  }

  private async confirmGone(id: string, report: HistoryMutationReport): Promise<boolean> {
    try { return !(await this.scope('', false)).some(entry => entry.id === id) && !(await this.scope('', true)).some(entry => entry.id === id); }
    catch (error) {
      report.warnings.push(`The removal of ${id} could not be re-verified: ${reason(error)}`);
      return false;
    }
  }

  private refuse(entries: readonly HistoryEntry[], report: HistoryMutationReport): HistoryMutationReport {
    report.warnings.push('This build cannot change stored chats from the Preferences pane.');
    for (const entry of entries) report.failed.push({ id: entry.id, message: 'Changing stored chats is unavailable.' });
    report.partial = report.requested > 0;
    return report;
  }

  /**
   * Archive or restore each entry through the reversible `archivedAt` path. A mutation is only
   * reported as changed after the target scope is re-read and contains the chat; if the write failed
   * but the chat did move, it is still a change and the failure is kept as a warning instead of
   * being reported as a failed action.
   */
  async setArchived(entries: readonly HistoryEntry[], archived: boolean): Promise<HistoryMutationReport> {
    const report: HistoryMutationReport = { action: archived ? 'archive' : 'restore', requested: entries.length, changed: [], failed: [], warnings: [], partial: false };
    if (!entries.length) return report;
    const source = this.source;
    if (!source.setConversationArchived) return this.refuse(entries, report);
    for (const entry of entries) {
      let error: unknown = null;
      try { await source.setConversationArchived(entry.id, archived); } catch (caught) { error = caught; }
      if (await this.confirmScope(entry.id, archived, report)) {
        report.changed.push(entry.id);
        if (error) report.warnings.push(`The ${report.action} of ${entry.id} reported an error after it took effect: ${reason(error)}`);
      } else {
        report.failed.push({ id: entry.id, message: error ? reason(error) : confirmation });
      }
    }
    report.partial = report.changed.length < report.requested;
    return report;
  }

  /**
   * Remove each entry through the explicit store removal. Gone from both scopes counts as removed
   * even if the call reported an error afterwards; still stored counts as failed with the reason.
   */
  async remove(entries: readonly HistoryEntry[]): Promise<HistoryMutationReport> {
    const report: HistoryMutationReport = { action: 'delete', requested: entries.length, changed: [], failed: [], warnings: [], partial: false };
    if (!entries.length) return report;
    const source = this.source;
    if (!source.removeConversation) return this.refuse(entries, report);
    for (const entry of entries) {
      // Same refusal as the sidebar: never delete a chat whose answer or native task is unfinished.
      if (entry.unfinishedWork) {
        report.failed.push({ id: entry.id, message: 'An answer or native task is still unfinished in this chat. Finish or cancel it before deleting the chat.' });
        continue;
      }
      let error: unknown = null;
      try { await source.removeConversation(entry.paper, entry.id); } catch (caught) { error = caught; }
      if (await this.confirmGone(entry.id, report)) {
        report.changed.push(entry.id);
        if (error) report.warnings.push(`The removal of ${entry.id} reported an error after it took effect: ${reason(error)}`);
      } else {
        report.failed.push({ id: entry.id, message: error ? reason(error) : 'The chat is still stored; deletion was not confirmed.' });
      }
    }
    report.partial = report.changed.length < report.requested;
    return report;
  }

  /** Id-addressed archive/restore, which is all the pane sends across the compartment boundary. */
  async setArchivedByIds(ids: readonly string[], archived: boolean): Promise<HistoryMutationReport> {
    requireIds(ids);
    const { entries, missing } = await this.resolve(ids);
    const report = await this.setArchived(entries, archived);
    report.requested = ids.length;
    for (const id of missing) report.failed.push({ id, message: 'The chat is no longer stored.' });
    report.partial = report.changed.length < report.requested;
    return report;
  }

  /** Id-addressed explicit removal; missing ids are reported instead of being silently skipped. */
  async removeByIds(ids: readonly string[]): Promise<HistoryMutationReport> {
    requireIds(ids);
    const { entries, missing } = await this.resolve(ids);
    const report = await this.remove(entries);
    report.requested = ids.length;
    for (const id of missing) report.failed.push({ id, message: 'The chat is no longer stored.' });
    report.partial = report.changed.length < report.requested;
    return report;
  }
}
