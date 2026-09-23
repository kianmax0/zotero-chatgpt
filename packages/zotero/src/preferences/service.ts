import { ReaderError } from '../../../contracts/src/index.ts';
import type { ReaderWorkspace, WorkspaceSettings } from '../../../contracts/src/workspace.ts';
import { HistoryManager } from '../../../core/src/workspace/history.ts';

/**
 * The only bridge the Preferences pane needs. Everything crossing the pane sandbox is JSON text,
 * so the pane never receives live store objects or DOM nodes from the plugin compartment.
 * All reads and writes go through the existing workspace store, including its validation,
 * atomic writes and skill revision conflicts; nothing here keeps a second copy of the settings.
 */
export interface PreferencesServiceHost {
  workspace(): Promise<ReaderWorkspace>;
  /** The plugin preference `extensions.zchatgpt.automaticPdfText`; not part of the workspace store. */
  readAutomaticPdfText(): boolean;
  writeAutomaticPdfText(enabled: boolean): void;
  /** Notify live reader presenters after the workspace settings snapshot has been durably saved. */
  settingsChanged?(settings: WorkspaceSettings): void;
  /**
   * The model ids the running Codex runtime last reported, or null when it is not running. Optional
   * and strictly read-only: opening the Preferences window must never start a runtime, and a host
   * without the port still renders the pane from the bundled catalog with honest copy.
   */
  liveModels?(): Promise<string[] | null>;
}
export interface PreferencesService {
  readSettings(): Promise<string>;
  writeSettings(json: string): Promise<void>;
  setSkillEnabled(id: string, enabled: boolean): Promise<void>;
  readAutomaticPdfText(): boolean;
  writeAutomaticPdfText(enabled: boolean): void;
  /** History management is exposed as JSON text like everything else crossing the pane boundary. */
  readHistory(query: string): Promise<string>;
  deleteHistory(idsJson: string): Promise<string>;
  /**
   * The runtime's live model ids as JSON text, or the JSON literal `null` when no runtime has
   * reported any. Absent when the host has no runtime bridge; the pane then says the Spark models
   * come from the runtime instead of inventing rows.
   */
  readLiveModels?(): Promise<string>;
}

/** Ids only: the pane never sends back titles, previews or paper scopes it could have forged. */
function parseIds(json: string): string[] {
  let value: unknown;
  try { value = JSON.parse(json) as unknown; } catch { throw new ReaderError('INVALID_REQUEST', 'The selected chats payload is invalid JSON.'); }
  if (!Array.isArray(value) || !value.length || value.length > 500) throw new ReaderError('INVALID_REQUEST', 'Select between 1 and 500 stored chats.');
  if (!value.every(item => typeof item === 'string' && item.length > 0 && item.length <= 36)) throw new ReaderError('INVALID_REQUEST', 'The selected chats payload is invalid.');
  if (new Set(value).size !== value.length) throw new ReaderError('INVALID_REQUEST', 'The selected chats payload contains duplicates.');
  return value as string[];
}

function parseSettings(json: string): WorkspaceSettings {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    throw new ReaderError('INVALID_REQUEST', 'The preferences payload is invalid JSON.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ReaderError('INVALID_REQUEST', 'The preferences payload is invalid.');
  return value as WorkspaceSettings;
}

export function createPreferencesService(host: PreferencesServiceHost): PreferencesService {
  const live = host.liveModels?.bind(host);
  return {
    ...(live ? {
      async readLiveModels(): Promise<string> { return JSON.stringify(await live()); },
    } : {}),
    async readSettings(): Promise<string> {
      return JSON.stringify(await (await host.workspace()).settings());
    },
    async writeSettings(json: string): Promise<void> {
      const value = parseSettings(json);
      await (await host.workspace()).saveSettings(value);
      // This is a post-commit notification: failed writes must never update the live composer.
      host.settingsChanged?.(value);
    },
    async setSkillEnabled(id: string, enabled: boolean): Promise<void> {
      if (typeof enabled !== 'boolean') throw new ReaderError('INVALID_REQUEST', 'A skill is either enabled or disabled.');
      const workspace = await host.workspace();
      const settings = await workspace.settings();
      const skill = settings.skills.find(item => item.id === id);
      if (!skill) throw new ReaderError('NOT_FOUND', 'The skill is no longer installed.');
      // saveSkill enforces the skill revision conflict; saveSettings would silently keep a newer file.
      await workspace.saveSkill({ ...skill, enabled });
    },
    readAutomaticPdfText(): boolean {
      return host.readAutomaticPdfText() !== false;
    },
    writeAutomaticPdfText(enabled: boolean): void {
      if (typeof enabled !== 'boolean') throw new ReaderError('INVALID_REQUEST', 'Automatic PDF text is either on or off.');
      host.writeAutomaticPdfText(enabled);
    },
    async readHistory(query: string): Promise<string> {
      if (typeof query !== 'string' || query.length > 1024) throw new ReaderError('INVALID_REQUEST', 'The history search is invalid.');
      return JSON.stringify(await new HistoryManager(await host.workspace()).listing(query));
    },
    async deleteHistory(idsJson: string): Promise<string> {
      return JSON.stringify(await new HistoryManager(await host.workspace()).removeByIds(parseIds(idsJson)));
    },
  };
}
