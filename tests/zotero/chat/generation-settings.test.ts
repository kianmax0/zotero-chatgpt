import { expect, it } from 'vitest';
import type { ModelOption } from '../../../packages/contracts/src/runtime.ts';
import { enforcedAllowedModelIds } from '../../../packages/core/src/workspace/allowed-models.ts';

import { alignSettings, applyComposerChoice, catalogDefaultSettings, composerControls, effortLabel, modelChipLabel, offeredModels, resolveFastTier, settingsCaption } from '../../../packages/zotero/src/chat/generation-settings.ts';

const catalog: ModelOption[] = [
  {
    id: 'gpt-6-sol', displayName: 'GPT-6 Sol', isDefault: true,
    supportedReasoningEfforts: [{ id: 'medium', description: 'Balanced' }, { id: 'high', description: 'Deeper' }],
    defaultReasoningEffort: 'medium',
    serviceTiers: [{ id: 'priority', name: 'Priority', description: 'Priority service' }, { id: 'flex', name: 'Flex', description: 'Flex service' }],
    defaultServiceTier: 'priority',
  },
  {
    id: 'gpt-6-luna', displayName: 'GPT-6 Luna', isDefault: false,
    supportedReasoningEfforts: [{ id: 'low', description: 'Faster' }],
    defaultReasoningEffort: 'low',
    serviceTiers: [],
    defaultServiceTier: null,
  },
];

function option(id: string, displayName: string, overrides: Partial<ModelOption> = {}): ModelOption {
  return {
    id, displayName, isDefault: false,
    supportedReasoningEfforts: [{ id: 'medium', description: 'Balanced' }],
    defaultReasoningEffort: 'medium',
    serviceTiers: [], defaultServiceTier: null,
    ...overrides,
  };
}

/**
 * The live `model/list` order captured from a real signed-in account (screenshot 2026-09-13):
 * The runtime order is deliberately different from the preferred GPT-6 Sol, Astra, Luna order.
 */
const liveModels: ModelOption[] = [
  option('gpt-6-luna', 'GPT-6-Luna'),
  option('gpt-6-astra', 'GPT-6-Astra', { isDefault: true }),
  option('gpt-6-sol', 'GPT-6-Sol'),
  option('gpt-5.5', 'GPT-5.5'),
  option('gpt-5.3-codex-spark', 'GPT-5.3-Codex-Spark'),
];

/** The embedded catalog's ids in its own order, including the families that must not be offered. */
const embeddedModels: ModelOption[] = [
  option('gpt-6-astra', 'GPT-6-Astra'),
  option('gpt-6-sol', 'GPT-6-Sol'),
  option('gpt-6-luna', 'GPT-6-Luna'),
  option('gpt-daybreak-blue-latest', 'GPT-Daybreak-Blue'),
  option('gpt-daybreak-red-latest', 'GPT-Daybreak-Red'),
  option('gpt-5.5', 'GPT-5.5'),
  option('gpt-5.4', 'GPT-5.4'),
  option('gpt-5.4-mini', 'GPT-5.4-Mini'),
  option('gpt-5.2', 'GPT-5.2'),
  option('codex-auto-review', 'Codex Auto Review'),
];

const offeredIds = ['gpt-6-sol', 'gpt-6-astra', 'gpt-6-luna'];
const settings = { model: 'gpt-6-sol', serviceTier: 'priority', effort: 'medium' };

it('prefers GPT-6 Sol regardless of server order or the isDefault flag', () => {
  expect(catalogDefaultSettings(liveModels)).toEqual({ model: 'gpt-6-sol', serviceTier: null, effort: 'medium' });
  expect(catalogDefaultSettings(embeddedModels)).toEqual({ model: 'gpt-6-sol', serviceTier: null, effort: 'medium' });
  expect(catalogDefaultSettings(catalog)).toEqual({ model: 'gpt-6-sol', serviceTier: 'priority', effort: 'medium' });
  expect(catalogDefaultSettings([])).toBeNull();
});

it('returns gpt-6-sol regardless of the order the runtime pages the catalog in', () => {
  const expected = { model: 'gpt-6-sol', serviceTier: null, effort: 'medium' };
  const reversed = [...liveModels].reverse();
  const shuffled = [liveModels[3]!, liveModels[1]!, liveModels[0]!, liveModels[2]!, liveModels[4]!];
  const astraLast = [...liveModels.filter(model => model.id !== 'gpt-6-astra'), liveModels[1]!];
  for (const input of [liveModels, reversed, shuffled, astraLast]) {
    expect(catalogDefaultSettings(input)).toEqual(expected);
  }
});

it('offers only the three current GPT-6 models, ignoring the runtime order', () => {
  for (const input of [liveModels, embeddedModels]) {
    expect(composerControls(input, null)[0]?.options.map(option => option.value)).toEqual(offeredIds);
  }
  expect(offeredModels(liveModels).map(model => model.id)).toEqual(offeredIds);
  expect(offeredModels(embeddedModels).map(model => model.id)).toEqual(offeredIds);
});

it('keeps an explicit still-offered model and replaces a removed one with the new default', () => {
  const chosen = { model: 'gpt-6-astra', serviceTier: null, effort: 'medium' };
  expect(alignSettings(liveModels, chosen)).toEqual(chosen);
  expect(alignSettings(liveModels, { model: 'gpt-5.5', serviceTier: null, effort: 'medium' }))
    .toEqual({ model: 'gpt-6-sol', serviceTier: null, effort: 'medium' });
  expect(alignSettings(liveModels, { model: 'gpt-5.3-codex-spark', serviceTier: null, effort: 'low' }))
    .toEqual({ model: 'gpt-6-sol', serviceTier: null, effort: 'medium' });
  expect(alignSettings(liveModels, { model: 'retired-model', serviceTier: null, effort: 'medium' }))
    .toEqual({ model: 'gpt-6-sol', serviceTier: null, effort: 'medium' });
});

it('keeps a legacy conversation usable: its model control shows an offered value, not blank', () => {
  const controls = composerControls(liveModels, { model: 'gpt-5.5', serviceTier: null, effort: 'medium' });
  const modelControl = controls.find(control => control.field === 'model')!;
  expect(modelControl.disabled).toBe(false);
  expect(modelControl.value).toBe('gpt-6-sol');
  expect(modelControl.options.map(option => option.value)).toContain(modelControl.value);
  // The composer button names the model that would be sent, not the removed saved id.
  expect(modelChipLabel({ model: 'gpt-5.3-codex-spark', serviceTier: null, effort: 'low' }, liveModels)).toBe('GPT-6-Sol Medium');
});

it('moves a legacy conversation to the new default on its next send', () => {
  // presenter.currentSettings() calls alignSettings on every send; a new chat calls
  // catalogDefaultSettings. Both must agree on gpt-6-astra for the removed-model conversation.
  const legacy = { model: 'gpt-5.3-codex-spark', serviceTier: null, effort: 'low' };
  expect(alignSettings(liveModels, legacy)).toEqual(catalogDefaultSettings(liveModels));
});

it('returns no default from an empty catalog instead of a hardcoded menu', () => {
  expect(catalogDefaultSettings(catalog)).toEqual({ model: 'gpt-6-sol', serviceTier: 'priority', effort: 'medium' });
  expect(catalogDefaultSettings([])).toBeNull();
});

it('keeps a still-supported combo when aligning, including an explicit gpt-6-sol speed', () => {
  expect(alignSettings(catalog, settings)).toEqual(settings);
  expect(alignSettings(catalog, { ...settings, serviceTier: null, effort: null })).toEqual({ ...settings, serviceTier: null, effort: null });
});

it('on model change, drops unsupported speed/effort to the new model defaults and never maps speed onto effort', () => {
  const next = applyComposerChoice(catalog, settings, 'model', 'gpt-6-luna');
  expect(next).toEqual({ model: 'gpt-6-luna', serviceTier: null, effort: 'low' });
  expect(next.effort).not.toBe('priority');
  expect(applyComposerChoice(catalog, settings, 'speed', 'flex')).toEqual({ ...settings, serviceTier: 'flex' });
  expect(applyComposerChoice(catalog, { ...settings, serviceTier: 'flex' }, 'speed', '')).toEqual({ ...settings, serviceTier: null });
  expect(applyComposerChoice(catalog, settings, 'effort', 'high')).toEqual({ ...settings, effort: 'high' });
});

it('builds three independent controls from the selected model, with Default when a field is null', () => {
  const withExtras = composerControls(catalog, settings);
  expect(withExtras.map(c => c.field)).toEqual(['model', 'speed', 'effort']);
  expect(withExtras[0]).toMatchObject({ label: 'Model', value: 'gpt-6-sol', disabled: false });
  expect(withExtras[0]?.options.map(o => o.value)).toEqual(['gpt-6-sol', 'gpt-6-luna']);
  expect(withExtras[1]).toMatchObject({ label: 'Speed', value: 'priority', disabled: false });
  expect(withExtras[1]?.options).toEqual([
    { value: '', label: 'Default' },
    { value: 'flex', label: 'Fast' },
    { value: 'priority', label: 'Priority' },
  ]);
  expect(withExtras[2]?.options.map(o => o.value)).toEqual(['', 'medium', 'high']);

  const noTiers = composerControls(catalog, { model: 'gpt-6-luna', serviceTier: null, effort: 'low' });
  expect(noTiers[1]).toMatchObject({ label: 'Speed', value: '', disabled: true });
  expect(noTiers[1]?.options).toEqual([{ value: '', label: 'Default' }]);
  expect(noTiers[2]?.disabled).toBe(false);

  const empty = composerControls([], null);
  expect(empty.every(c => c.disabled)).toBe(true);
});

it('labels a frozen snapshot from the catalog without rewriting it when the menu later changes', () => {
  const frozen = settingsCaption(settings, catalog);
  expect(frozen).toBe('GPT-6 Sol · Priority · medium');
  expect(settingsCaption({ ...settings, serviceTier: null, effort: null }, catalog)).toBe('GPT-6 Sol · Default · Default');
  expect(settingsCaption({ ...settings, serviceTier: 'flex' }, catalog)).toBe('GPT-6 Sol · Fast · medium');
  expect(settingsCaption(settings, [catalog[1]!])).toBe('gpt-6-sol · priority · medium');
});

it('maps product Fast onto a fast-named catalog tier, else the catalog’s fast-like tier', () => {
  expect(resolveFastTier(catalog[0])).toEqual({ id: 'flex', name: 'Flex' });
  const withFast = {
    ...catalog[0]!,
    serviceTiers: [
      { id: 'priority', name: 'Priority', description: '' },
      { id: 'fast-lane', name: 'Fast', description: '' },
    ],
  };
  expect(resolveFastTier(withFast)).toEqual({ id: 'fast-lane', name: 'Fast' });
  expect(resolveFastTier(catalog[1])).toBeUndefined();
});

it('prints catalog effort ids with Cursor-like names only when those ids exist', () => {
  expect(effortLabel('low')).toBe('Low');
  expect(effortLabel('xhigh')).toBe('Extra High');
  expect(effortLabel('extra_high')).toBe('Extra High');
  expect(effortLabel(null)).toBe('Default');
  expect(effortLabel('custom-tier')).toBe('custom-tier');
});

it('labels the model chip as model + effort + Fast without inventing missing tiers', () => {
  expect(modelChipLabel(null, catalog)).toBe('Model');
  expect(modelChipLabel(settings, catalog)).toBe('GPT-6 Sol Medium');
  expect(modelChipLabel({ ...settings, serviceTier: 'flex', effort: 'high' }, catalog)).toBe('GPT-6 Sol High Fast');
  expect(modelChipLabel({ model: 'gpt-6-luna', serviceTier: null, effort: 'low' }, catalog)).toBe('GPT-6 Luna Low');
});

/**
 * The Preferences allowlist half of `offeredModels`. An empty or stale list recovers to available
 * current GPT-6 models; older or unknown catalog ids are never used as fallback choices.
 */
it('pins the stale/empty fallback to the current set with gpt-6-sol first', () => {
  for (const stale of [['retired-model'], ['retired-model', 'gpt-9-ghost'], []] as const) {
    const ids = offeredModels(liveModels, stale).map(model => model.id);
    expect(ids).toEqual(offeredIds);
    expect(ids[0]).toBe('gpt-6-sol');
    expect(ids[0]).not.toBe('gpt-6-astra');
    // No other family leaks back in, and the default model is unchanged.
    expect(ids).not.toContain('gpt-5.5');
    expect(ids).not.toContain('gpt-5.3-codex-spark');
    expect(catalogDefaultSettings(liveModels, stale)?.model).toBe('gpt-6-sol');
    expect(composerControls(liveModels, null, stale)[0]?.options.map(option => option.value)).toEqual(offeredIds);
  }
});

it('keeps the current set when the allowlist is undefined', () => {
  for (const input of [liveModels, embeddedModels]) {
    const untouched = offeredModels(input, undefined).map(model => model.id);
    const omitted = offeredModels(input).map(model => model.id);
    expect(untouched).toEqual(offeredIds);
    expect(omitted).toEqual(offeredIds);
  }
});

it('offers exactly the allowed ids in the same rank order when an allowlist is provided', () => {
  // Rank still wins over the order the allowlist lists the ids in: Sol is newest-first.
  expect(offeredModels(liveModels, ['gpt-6-luna', 'gpt-6-astra', 'gpt-6-astra']).map(model => model.id))
    .toEqual(['gpt-6-astra', 'gpt-6-luna']);
  expect(offeredModels(liveModels, ['gpt-6-astra', 'gpt-6-luna']).map(model => model.id))
    .toEqual(['gpt-6-astra', 'gpt-6-luna']);
  // An explicitly allowed historic id still cannot become a new picker choice.
  expect(offeredModels(liveModels, ['gpt-5.5']).map(model => model.id)).toEqual(offeredIds);
});

it('degrades a stale allowlist to the current set, never to raw catalog order', () => {
  // A stale list recovers to the current set and never leaks gpt-5.5 / Spark back into the picker.
  const stale = offeredModels(liveModels, ['retired-model', 'gpt-9-ghost']).map(model => model.id);
  expect(stale).toEqual(offeredIds);
  expect(stale[0]).toBe('gpt-6-sol');
  expect(stale[0]).not.toBe('gpt-6-astra');
  expect(stale).not.toEqual(liveModels.map(model => model.id));
  // A partially stale list keeps only the ids the catalog still carries.
  expect(offeredModels(liveModels, ['gpt-5.5', 'retired-model']).map(model => model.id)).toEqual(offeredIds);
});

it('keeps an explicitly empty allowlist from blanking the picker and from changing the default', () => {
  const untouched = offeredModels(embeddedModels).map(model => model.id);
  const empty = offeredModels(embeddedModels, []).map(model => model.id);
  expect(untouched).toEqual(offeredIds);
  // An empty list filters everything out; it degrades to the same current-model default, never `[]` and
  // never raw catalog order. It therefore matches the untouched default exactly.
  expect(empty).toEqual(offeredIds);
  expect(empty[0]).toBe('gpt-6-sol');
  expect(empty).toEqual(untouched);
  expect(empty).not.toEqual(embeddedModels.map(model => model.id));
  expect(empty.length).toBeGreaterThan(0);
});

it('derives the catalog default from the allowlist when one is provided', () => {
  expect(catalogDefaultSettings(liveModels, ['gpt-6-luna', 'gpt-6-astra']))
    .toEqual({ model: 'gpt-6-astra', serviceTier: null, effort: 'medium' });
  // A stale allowlist degrades to the available current-model set rather than the catalog head.
  expect(catalogDefaultSettings(liveModels, ['retired-model']))
    .toEqual({ model: 'gpt-6-sol', serviceTier: null, effort: 'medium' });
  expect(catalogDefaultSettings(liveModels, []))
    .toEqual({ model: 'gpt-6-sol', serviceTier: null, effort: 'medium' });
});

it('aligns a legacy conversation pinned to a now-excluded model to the first allowed model', () => {
  const allowed = ['gpt-6-astra', 'gpt-6-luna'];
  expect(alignSettings(liveModels, { model: 'gpt-5.5', serviceTier: null, effort: 'medium' }, allowed))
    .toEqual({ model: 'gpt-6-astra', serviceTier: null, effort: 'medium' });
  // A still-allowed choice is kept untouched, including a supported non-default effort.
  const highLuna = option('gpt-6-luna', 'GPT-5.6-Luna', {
    supportedReasoningEfforts: [{ id: 'medium', description: 'Balanced' }, { id: 'high', description: 'Deeper' }],
  });
  const withHighLuna = liveModels.map(model => (model.id === 'gpt-6-luna' ? highLuna : model));
  expect(alignSettings(withHighLuna, { model: 'gpt-6-luna', serviceTier: null, effort: 'high' }, allowed))
    .toEqual({ model: 'gpt-6-luna', serviceTier: null, effort: 'high' });
});

it('limits the model control to the allowlist and aligns an excluded saved model', () => {
  const controls = composerControls(liveModels, { model: 'gpt-5.5', serviceTier: null, effort: 'medium' }, ['gpt-6-sol', 'gpt-6-luna']);
  const modelControl = controls.find(control => control.field === 'model')!;
  expect(modelControl.options.map(option => option.value)).toEqual(['gpt-6-sol', 'gpt-6-luna']);
  expect(modelControl.value).toBe('gpt-6-sol');
  expect(modelControl.disabled).toBe(false);
});

it('uses one enforced allowlist for defaults, visible choices, model changes and the chip label', () => {
  const allowed = ['gpt-6-luna'];
  expect(catalogDefaultSettings(liveModels, allowed)?.model).toBe('gpt-6-luna');
  expect(alignSettings(liveModels, { model: 'gpt-6-sol', serviceTier: null, effort: 'medium' }, allowed))
    .toEqual({ model: 'gpt-6-luna', serviceTier: null, effort: 'medium' });
  expect(composerControls(liveModels, settings, allowed)[0]?.options.map(option => option.value)).toEqual(['gpt-6-luna']);
  expect(applyComposerChoice(liveModels, settings, 'model', 'gpt-6-sol', allowed).model).toBe('gpt-6-luna');
  expect(modelChipLabel(settings, liveModels, allowed)).toBe('GPT-6-Luna Medium');
});

it('aligns a model choice against the allowlist while the speed/effort paths still bypass it', () => {
  const allowed = ['gpt-6-astra', 'gpt-6-luna'];
  expect(applyComposerChoice(liveModels, settings, 'model', 'gpt-5.5', allowed))
    .toEqual({ model: 'gpt-6-astra', serviceTier: null, effort: 'medium' });
  // Speed and effort keep their direct write-through: no alignSettings, no allowlist filtering.
  expect(applyComposerChoice(liveModels, settings, 'speed', 'flex', allowed)).toEqual({ ...settings, serviceTier: 'flex' });
  expect(applyComposerChoice(liveModels, settings, 'effort', 'high', allowed)).toEqual({ ...settings, effort: 'high' });
});

it('labels the chip against the allowlist', () => {
  const pinned = { model: 'gpt-5.5', serviceTier: null, effort: 'medium' };
  expect(modelChipLabel(pinned, liveModels, ['gpt-6-luna'])).toBe('GPT-6-Luna Medium');
  expect(modelChipLabel(null, liveModels, ['gpt-6-luna'])).toBe('Model');
});

it('keeps captions looking excluded models up in the full list', () => {
  // settingsCaption takes no allowlist and must stay truthful about a model the picker no longer
  // offers, so it still reads the full runtime snapshot.
  expect(settingsCaption({ model: 'gpt-5.5', serviceTier: null, effort: 'medium' }, liveModels)).toBe('GPT-5.5 · Default · medium');
});

it('offers exactly the enforced allowlist intersection, so a stale id cannot leak back in', () => {
  // `enforcedAllowedModelIds` is the gate the composer wiring passes to `offeredModels`.
  expect(offeredModels(liveModels, enforcedAllowedModelIds([{ id: 'gpt-6-astra', name: 'a' }, { id: 'gpt-5.5', name: 'b' }])).map(model => model.id))
    .toEqual(['gpt-6-astra']);
  // Nothing allowed remains: degrade to the current runtime offers, never to raw catalog order.
  expect(offeredModels(liveModels, enforcedAllowedModelIds([{ id: 'gpt-5.5', name: 'b' }])).map(model => model.id)).toEqual(offeredIds);
  // Historical Spark remains excluded even if old settings contain it.
  const withSpark = enforcedAllowedModelIds([{ id: 'gpt-6-astra', name: 'a' }, { id: 'gpt-5.3-codex-spark', name: 's' }]);
  expect(offeredModels(liveModels, withSpark).map(model => model.id)).toEqual(['gpt-6-astra']);
  expect(offeredModels(liveModels, withSpark).map(model => model.id)).not.toContain('gpt-5.5');
});
