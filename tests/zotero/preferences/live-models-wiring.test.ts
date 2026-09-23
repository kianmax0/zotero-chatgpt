import { Window } from 'happy-dom';
import { expect, it, vi } from 'vitest';
import type { HistoryListing, WorkspaceSettings } from '../../../packages/contracts/src/workspace.ts';
import { defaultSettings } from '../../../packages/core/src/workspace/skills.ts';
import { createPreferencesPane, type PreferencesPaneHost } from '../../../packages/zotero/src/preferences/pane.ts';
import { createPreferencesService, type PreferencesService } from '../../../packages/zotero/src/preferences/service.ts';

/**
 * The wiring, not the widget: these tests compose the same objects the plugin entry composes — the
 * real `createPreferencesService` and the real pane — so a dropped live-model port fails here even
 * if the pane itself still renders. `index.ts` is a Zotero compartment that reads plugin globals at
 * load, so the composition below mirrors its `liveModels` line instead of importing it.
 */
function serviceHost(liveModels?: () => Promise<string[] | null>) {
  return {
    workspace: () => Promise.reject(new Error('The workspace is not needed to read the live models.')),
    readAutomaticPdfText: () => true,
    writeAutomaticPdfText: () => undefined,
    ...(liveModels ? { liveModels } : {}),
  };
}

const listing: HistoryListing = { entries: [], activeCount: 0, archivedCount: 0 };

function mountPane(service: PreferencesService) {
  const settings: WorkspaceSettings = { ...defaultSettings(), uiLanguage: 'en', textScale: 1 };
  const host: PreferencesPaneHost = {
    read: () => Promise.resolve(settings),
    save: vi.fn<PreferencesPaneHost['save']>(() => Promise.resolve()),
    setSkillEnabled: vi.fn<PreferencesPaneHost['setSkillEnabled']>(() => Promise.resolve()),
    readAutomaticPdfText: () => true,
    writeAutomaticPdfText: vi.fn(),
    readHistory: () => Promise.resolve(listing),
    deleteHistory: () => Promise.resolve({ action: 'delete', requested: 0, changed: [], failed: [], warnings: [], partial: false }),
    // Exactly what `preferences/entry.ts` does: the port is forwarded only when the service has it.
    ...(service.readLiveModels ? { readLiveModels: async (): Promise<unknown> => JSON.parse(await service.readLiveModels!()) as unknown } : {}),
  };
  const window = new Window({ url: 'https://test.invalid' });
  const document = window.document as unknown as Document;
  document.body.innerHTML = '<vbox/>';
  const root = document.body.firstElementChild!;
  const pane = createPreferencesPane(host);
  const ready = pane.mount(root);
  const find = <T extends Element>(selector: string): T => {
    const found = root.querySelector<T>(selector);
    if (!found) throw new Error(`Missing ${selector}`);
    return found;
  };
  return { ready, root, find };
}

it('forwards runtime-reported GPT-6 models to the pane and filters every other id', async () => {
  const service = createPreferencesService({ ...serviceHost(), liveModels: () => Promise.resolve(['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-6-terra', 'gpt-5.5']) });
  const { ready, root, find } = mountPane(service);
  await ready;
  expect(find<HTMLInputElement>('[data-zchatgpt-model-allowed="gpt-6-sol"]')).not.toBeNull();
  expect(find<HTMLInputElement>('[data-zchatgpt-model-allowed="gpt-6-luna"]')).not.toBeNull();
  expect(root.querySelector('[data-zchatgpt-model="gpt-6-terra"]')).toBeNull();
  expect(root.querySelector('[data-zchatgpt-model="gpt-5.5"]')).toBeNull();
  expect(find('[data-zchatgpt-pref="models-note"]').textContent).toMatch(/running runtime's report/u);
});

it('keeps only the bundled current model and honest copy when the service has no live model port', async () => {
  const service = createPreferencesService(serviceHost());
  expect('readLiveModels' in service).toBe(false);
  const { ready, root, find } = mountPane(service);
  await ready;
  expect(root.querySelector('[data-zchatgpt-model^="gpt-5.3"]')).toBeNull();
  expect(find('[data-zchatgpt-pref="models-note"]').textContent).toMatch(/bundled catalog, not your account/u);
});
