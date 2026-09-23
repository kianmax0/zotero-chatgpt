/* eslint-disable @typescript-eslint/unbound-method -- assertions inspect injected spies without invoking them. */
import { expect, it, vi } from 'vitest';
import { ReaderError } from '../../../packages/contracts/src/index.ts';
import type { ReaderSkill, ReaderWorkspace, WorkspaceSettings } from '../../../packages/contracts/src/workspace.ts';
import { defaultSettings } from '../../../packages/core/src/workspace/skills.ts';
import { createPreferencesService } from '../../../packages/zotero/src/preferences/service.ts';

const copy = <T>(value: T): T => structuredClone(value);

const userSkill: ReaderSkill = { id: 'user-study', name: 'Study', description: 'Study the supplied source', version: '1.0', revision: 'revision-one', markdown: '# Study\nPreserve notation.', origin: 'user', enabled: true, workflow: 'read', permissions: [], unsupportedDependencies: [] };

function fixture(overrides: Partial<ReaderWorkspace> = {}, liveModels?: () => Promise<string[] | null>) {
  let settings: WorkspaceSettings = { ...defaultSettings(), skills: [...defaultSettings().skills, copy(userSkill)], profiles: [{ id: 'formal', name: 'Formal', preferences: { mathematics: 'formal' } }] };
  const workspace: ReaderWorkspace = {
    settings: vi.fn(() => Promise.resolve(copy(settings))),
    saveSettings: vi.fn<ReaderWorkspace['saveSettings']>(value => { settings = copy(value); return Promise.resolve(); }),
    saveSkill: vi.fn<ReaderWorkspace['saveSkill']>(value => { const next = { ...copy(value), revision: 'revision-two' }; settings.skills = [...settings.skills.filter(item => item.id !== value.id), next]; return Promise.resolve(next); }),
    ...overrides,
  } as ReaderWorkspace;
  let automaticPdfText = true;
  // No `exportText` port: the pane no longer offers an export, so the fixture proves the service
  // builds against a host that has dropped it.
  const service = createPreferencesService({
    workspace: () => Promise.resolve(workspace),
    readAutomaticPdfText: () => automaticPdfText,
    writeAutomaticPdfText: enabled => { automaticPdfText = enabled; },
    ...(liveModels ? { liveModels } : {}),
  });
  return { service, workspace, current: () => copy(settings), automaticPdfText: () => automaticPdfText };
}

it('carries the runtime live model ids as JSON text, and stays absent when the host has no runtime', async () => {
  // Presence, not a flag: an older host exposes nothing, so the pane cannot fabricate a live list.
  expect('readLiveModels' in fixture().service).toBe(false);

  const ids = ['gpt-6-astra', 'gpt-5.3-codex-spark'];
  const present = fixture(undefined, () => Promise.resolve(ids));
  expect(await present.service.readLiveModels!()).toBe(JSON.stringify(ids));
  // The service forwards the ids verbatim; the offerable-family filter is owned by core (and reused
  // by the pane), not re-implemented here.
  expect(await present.service.readLiveModels!()).toBe('["gpt-6-astra","gpt-5.3-codex-spark"]');

  const none = fixture(undefined, () => Promise.resolve(null));
  expect(await none.service.readLiveModels!()).toBe('null');
  // Reading the live list never writes the store and never starts anything.
  expect(present.workspace.saveSettings).not.toHaveBeenCalled();
  expect(none.workspace.saveSettings).not.toHaveBeenCalled();
});

it('carries the automatic-PDF-text pref without touching the workspace store', () => {
  const { service, workspace, automaticPdfText } = fixture();
  expect(service.readAutomaticPdfText()).toBe(true);
  service.writeAutomaticPdfText(false);
  expect(automaticPdfText()).toBe(false);
  expect(service.readAutomaticPdfText()).toBe(false);
  service.writeAutomaticPdfText(true);
  expect(service.readAutomaticPdfText()).toBe(true);
  expect(workspace.saveSettings).not.toHaveBeenCalled();
  expect(() => service.writeAutomaticPdfText('yes' as unknown as boolean)).toThrow(ReaderError);
  expect(automaticPdfText()).toBe(true);
});

it('reads the real stored settings as JSON without inventing fields', async () => {
  const { service, current } = fixture();
  const parsed = JSON.parse(await service.readSettings()) as WorkspaceSettings;
  expect(parsed).toEqual(current());
  expect(Object.keys(parsed).sort()).toEqual(['allowedModels', 'preferences', 'profiles', 'schemaVersion', 'skills', 'textScale', 'uiLanguage']);
  // The allowlist crosses the JSON bridge intact so the pane can render the stored selection.
  expect(parsed.allowedModels?.map(model => model.id)).toEqual(['gpt-6-sol', 'gpt-6-astra', 'gpt-6-luna']);
});

it('writes a full validated snapshot through saveSettings, including skill activation', async () => {
  const { service, workspace } = fixture();
  const next = { ...JSON.parse(await service.readSettings()) as WorkspaceSettings, uiLanguage: 'zh' as const, textScale: 1.5 };
  await service.writeSettings(JSON.stringify(next));
  expect(workspace.saveSettings).toHaveBeenCalledWith(next);
});

it('refuses malformed or non-object payloads with a clean error instead of touching the store', async () => {
  const { service, workspace } = fixture();
  await expect(service.writeSettings('not json')).rejects.toBeInstanceOf(ReaderError);
  await expect(service.writeSettings('[]')).rejects.toBeInstanceOf(ReaderError);
  await expect(service.writeSettings('null')).rejects.toBeInstanceOf(ReaderError);
  expect(workspace.saveSettings).not.toHaveBeenCalled();
  await expect(service.writeSettings('not json')).rejects.toThrow(/invalid/iu);
});

it('propagates store failures so the pane can report them honestly', async () => {
  const failure = new ReaderError('REQUEST_CONFLICT', 'This workflow has changed since it was opened.');
  const { service } = fixture({ saveSettings: vi.fn<ReaderWorkspace['saveSettings']>().mockRejectedValue(failure) });
  const snapshot = await service.readSettings();
  await expect(service.writeSettings(snapshot)).rejects.toBe(failure);
});

it('toggles exactly one installed workflow through saveSkill and preserves its revision', async () => {
  const { service, workspace, current } = fixture();
  await expect(service.setSkillEnabled('user-study', false)).resolves.toBeUndefined();
  expect(workspace.saveSkill).toHaveBeenCalledWith({ ...userSkill, enabled: false });
  expect(current().skills.find(skill => skill.id === 'user-study')?.enabled).toBe(false);
  // Other skills are untouched: only the requested workflow is written.
  expect(workspace.saveSkill).toHaveBeenCalledOnce();
});

it('refuses to toggle unknown workflows or non-boolean values', async () => {
  const { service, workspace } = fixture();
  await expect(service.setSkillEnabled('missing', true)).rejects.toThrow('no longer installed');
  await expect(service.setSkillEnabled('user-study', 'yes' as unknown as boolean)).rejects.toThrow(/enabled/iu);
  expect(workspace.saveSkill).not.toHaveBeenCalled();
});

it('surfaces a conflict when the stored workflow revision changed underneath the pane', async () => {
  const conflict = new ReaderError('REQUEST_CONFLICT', 'This workflow has changed since it was opened. Load the newer revision before editing it.');
  const { service } = fixture({ saveSkill: vi.fn<ReaderWorkspace['saveSkill']>().mockRejectedValue(conflict) });
  await expect(service.setSkillEnabled('user-study', false)).rejects.toBe(conflict);
});

it('offers the pane no preferences export at all', () => {
  // The native Preferences pane dropped its export button, so the port behind it went with it: the
  // service exposes nothing that would write the stored snapshot to a file.
  const { service } = fixture();
  expect('exportPreferences' in service).toBe(false);
});
