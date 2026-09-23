import { expect, it } from 'vitest';
import type { ModelOption } from '../../packages/contracts/src/runtime.ts';
import type { AllowedModel } from '../../packages/contracts/src/workspace.ts';
import {
  DEFAULT_ALLOWED_MODEL_IDS, LEGACY_DEFAULT_ALLOWED_MODEL_IDS, MODEL_ID, allowedModelIds, defaultAllowedModels, enforcedAllowedModelIds, isDefaultAllowedModels, isOfferableModelId, modelCandidates, modelChoices, modelLabel, offeredModelIds, resolveAllowedModels, unofferableAllowedModelIds,
} from '../../packages/core/src/workspace/allowed-models.ts';
import { PINNED_MODEL_CATALOG } from '../../runtime/model-capabilities.ts';

function model(id: string, displayName = id): ModelOption {
  return { id, displayName, isDefault: false, supportedReasoningEfforts: [], defaultReasoningEffort: null, serviceTiers: [], defaultServiceTier: null };
}

it('defaults to the three current GPT-6 models, preferring Sol', () => {
  expect(DEFAULT_ALLOWED_MODEL_IDS).toEqual(['gpt-6-sol', 'gpt-6-astra', 'gpt-6-luna']);
  expect(defaultAllowedModels()).toEqual([
    { id: 'gpt-6-sol', name: 'GPT-6 Sol' },
    { id: 'gpt-6-astra', name: 'GPT-6 Astra' },
    { id: 'gpt-6-luna', name: 'GPT-6 Luna' },
  ]);
  // An absent field means the default set; duplicates never widen it.
  expect(allowedModelIds(undefined)).toEqual([...DEFAULT_ALLOWED_MODEL_IDS]);
  expect(allowedModelIds([{ id: 'gpt-6-astra', name: 'x' }, { id: 'gpt-6-astra', name: 'y' }])).toEqual(['gpt-6-astra']);
});

it('offers the three current GPT-6 ids from the pinned catalog before a live list is available', () => {
  const candidates = modelCandidates();
  expect(candidates.map(candidate => candidate.id)).toEqual(['gpt-6-sol', 'gpt-6-astra', 'gpt-6-luna']);
  expect(candidates[0]).toEqual({ id: 'gpt-6-sol', name: 'GPT-6 Sol' });
  expect(modelCandidates(['gpt-6-luna', 'gpt-5.6-sol', 'gpt-6-sol', 'gpt-6-luna']).map(candidate => candidate.id)).toEqual(['gpt-6-sol', 'gpt-6-astra', 'gpt-6-luna']);
  // The catalog still carries the excluded ids for capability lookups; the picker just never offers them.
  for (const excluded of ['gpt-daybreak-blue-latest', 'gpt-daybreak-red-latest', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.2', 'codex-auto-review']) {
    expect(PINNED_MODEL_CATALOG.models[excluded as keyof typeof PINNED_MODEL_CATALOG.models], excluded).toBeDefined();
    expect(candidates.map(candidate => candidate.id), excluded).not.toContain(excluded);
  }
});

it('derives family membership from the exact id and stays strict about it', () => {
  for (const id of ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna']) {
    expect(isOfferableModelId(id), id).toBe(true);
  }
  for (const id of ['gpt-6', 'gpt-6-terra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.3-codex-spark', 'gpt-5.3-spark', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.2', 'gpt-daybreak-blue-latest', 'gpt-daybreak-red-latest', 'codex-auto-review', 'gpt-60', 'gpt-5.60-sol', 'gpt-5.3', 'gpt-5.3-codex', 'gpt-5.30-spark', 'gpt-7-future', '']) {
    expect(isOfferableModelId(id), id).toBe(false);
  }
});

it('adds only exact current GPT-6 models reported by the running runtime', () => {
  const live = ['gpt-6-luna', 'gpt-6-sol', 'gpt-6-terra', 'gpt-5.6-sol', 'gpt-5.3-codex-spark', 'gpt-5.5'];
  expect(modelCandidates(live).map(candidate => candidate.id)).toEqual(['gpt-6-sol', 'gpt-6-astra', 'gpt-6-luna']);
  // A live id already in the catalog is never duplicated.
  expect(modelCandidates(['gpt-6-astra', 'gpt-6-astra']).map(candidate => candidate.id)).toEqual(['gpt-6-sol', 'gpt-6-astra', 'gpt-6-luna']);
});

it('resolves the allowed set against a runtime catalog without leaking excluded families', () => {
  const catalog = [model('gpt-5.5'), model('gpt-6-astra', 'GPT-6-Astra'), model('gpt-5.6-sol'), model('gpt-5.4')];
  // The default allowlist keeps only its own ids, in the catalog's own order.
  expect(resolveAllowedModels(catalog, undefined).map(entry => entry.id)).toEqual(['gpt-6-astra']);
  // An explicit allowlist is authoritative, but an id the picker no longer offers must not leak back in.
  const allowed: AllowedModel[] = [{ id: 'gpt-5.5', name: 'GPT-5.5' }, { id: 'gpt-6-astra', name: 'GPT-6 Astra' }];
  expect(resolveAllowedModels(catalog, allowed).map(entry => entry.id)).toEqual(['gpt-6-astra']);
  // An allowed id the account does not offer is never invented.
  expect(resolveAllowedModels(catalog, [{ id: 'gpt-7-future', name: 'GPT-7 Future' }])).toEqual([]);
});

it('preserves unknown or removed allowed ids in the record without offering them', () => {
  const stored: AllowedModel[] = [{ id: 'gpt-6-astra', name: 'GPT-6 Astra' }, { id: 'gpt-retired-x', name: 'GPT Retired X' }];
  // The honesty guarantee: an id the picker no longer knows is preserved, never dropped or errored.
  expect(allowedModelIds(stored)).toEqual(['gpt-6-astra', 'gpt-retired-x']);
  // The pane renders only offerable ids, so a removed family does not come back as a row.
  expect(modelChoices(stored).map(candidate => candidate.id)).toEqual(modelCandidates().map(candidate => candidate.id));
  // The picker enforces only the still-offerable part.
  expect(enforcedAllowedModelIds(stored)).toEqual(['gpt-6-astra']);
  expect(modelChoices(undefined)).toEqual(modelCandidates());
});

it('does not resurrect historical saved ids as current model rows', () => {
  const stored: AllowedModel[] = [...defaultAllowedModels(), { id: 'gpt-5.3-codex-spark', name: 'GPT-5.3 Codex Spark' }, { id: 'gpt-5.5', name: 'GPT-5.5' }];
  expect(modelChoices(stored).map(candidate => candidate.id)).toEqual(['gpt-6-sol', 'gpt-6-astra', 'gpt-6-luna']);
  expect(modelChoices(stored).some(candidate => candidate.id === 'gpt-5.5')).toBe(false);
  // Historical Spark ids still do not appear from their presence in stored settings.
  expect(modelChoices(undefined).some(candidate => candidate.id.startsWith('gpt-5.3'))).toBe(false);
});

it('accepts exact dotted runtime ids and rejects malformed ones', () => {
  for (const id of ['gpt-6-astra', 'gpt-5.6-luna', 'codex-auto-review']) expect(MODEL_ID.test(id), id).toBe(true);
  for (const id of ['', '.starts-with-dot', 'has space', 'x'.repeat(129)]) expect(MODEL_ID.test(id), id).toBe(false);
  expect(modelLabel('codex-auto-review')).toBe('Codex Auto Review');
  expect(modelLabel('gpt-daybreak-blue-latest')).toBe('GPT Daybreak Blue Latest');
  expect(modelLabel('gpt-5.3-codex-spark')).toBe('GPT-5.3 Codex Spark');
});

it('keeps the current default offer set until the owner edits the allowlist', () => {
  // Absent and freshly-materialised defaults both stay "untouched", so the picker keeps its
  // current-model policy without widening to unrecognized siblings.
  expect(isDefaultAllowedModels(undefined)).toBe(true);
  expect(isDefaultAllowedModels(defaultAllowedModels())).toBe(true);
  expect(enforcedAllowedModelIds(undefined)).toBeUndefined();
  expect(enforcedAllowedModelIds(defaultAllowedModels())).toBeUndefined();
  // Reordering or duplicating the same set is still the default.
  expect(isDefaultAllowedModels([...defaultAllowedModels()].reverse())).toBe(true);
  // The moment the owner removes or adds a model the explicit ids take over.
  const narrowed = defaultAllowedModels().filter(entry => entry.id !== 'gpt-6-luna');
  expect(isDefaultAllowedModels(narrowed)).toBe(false);
  expect(enforcedAllowedModelIds(narrowed)).toEqual(['gpt-6-sol', 'gpt-6-astra']);
  const withHistorical = [...defaultAllowedModels(), { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' }];
  expect(isDefaultAllowedModels(withHistorical)).toBe(false);
  expect(enforcedAllowedModelIds(withHistorical)).toEqual(['gpt-6-sol', 'gpt-6-astra', 'gpt-6-luna']);
});

it('treats the exact previous default allowlist as untouched without rewriting its stored IDs', () => {
  const legacy = LEGACY_DEFAULT_ALLOWED_MODEL_IDS.map(id => ({ id, name: modelLabel(id) }));
  expect(isDefaultAllowedModels(legacy)).toBe(true);
  expect(enforcedAllowedModelIds(legacy)).toBeUndefined();
  expect(allowedModelIds(legacy)).toEqual([...LEGACY_DEFAULT_ALLOWED_MODEL_IDS]);
});

it('keeps an excluded id out of the picker and degrades to the family default when nothing is left', () => {
  // A stale entry is filtered; the still-offerable part of the list survives untouched.
  expect(enforcedAllowedModelIds([{ id: 'gpt-6-astra', name: 'a' }, { id: 'gpt-5.5', name: 'b' }])).toEqual(['gpt-6-astra']);
  expect(enforcedAllowedModelIds([{ id: 'gpt-6-luna', name: 'a' }, { id: 'codex-auto-review', name: 'b' }, { id: 'gpt-5.4', name: 'c' }])).toEqual(['gpt-6-luna']);
  // A list with nothing current left degrades to the current set instead of blanking the picker.
  expect(enforcedAllowedModelIds([{ id: 'gpt-5.5', name: 'a' }, { id: 'gpt-5.2', name: 'b' }])).toBeUndefined();
  expect(enforcedAllowedModelIds([{ id: 'gpt-retired-x', name: 'a' }])).toBeUndefined();
  // Nothing is dropped from the record itself: only the picker enforcement narrows.
  expect(allowedModelIds([{ id: 'gpt-5.5', name: 'a' }, { id: 'gpt-5.2', name: 'b' }])).toEqual(['gpt-5.5', 'gpt-5.2']);
});

it('ranks the composer offer list here, newest-first, so no UI keeps its own order', () => {
  // The runtime pages the catalog newest-last; the policy, not the array, decides the order.
  const catalog = ['gpt-6-luna', 'gpt-5.5', 'gpt-6-sol', 'gpt-6-astra', 'gpt-5.4'];
  expect(offeredModelIds(catalog)).toEqual(['gpt-6-sol', 'gpt-6-astra', 'gpt-6-luna']);
  // An enforced allowlist is authoritative and keeps the same rank, even outside the two families.
  expect(offeredModelIds(catalog, ['gpt-6-luna', 'gpt-5.5'])).toEqual(['gpt-6-luna']);
  // A stale allowlist degrades to the family rule, never to raw catalog order.
  expect(offeredModelIds(catalog, ['gpt-retired-x'])).toEqual(['gpt-6-sol', 'gpt-6-astra', 'gpt-6-luna']);
  // A list without any current model stays empty; a retired choice is not silently replaced by an old model.
  const otherFamilies = ['gpt-5.5', 'gpt-5.4'];
  expect(offeredModelIds(otherFamilies)).toEqual([]);
  expect(offeredModelIds(otherFamilies, [])).toEqual([]);
  expect(offeredModelIds(['gpt-6-future', 'gpt-6-sol', 'gpt-6-astra', 'gpt-6-luna']))
    .toEqual(['gpt-6-sol', 'gpt-6-astra', 'gpt-6-luna']);
});

it('names the stored ids a save must carry because this build cannot offer them', () => {
  const stored: AllowedModel[] = [
    { id: 'gpt-6-astra', name: 'GPT-6 Astra' },
    { id: 'gpt-5.5', name: 'GPT-5.5' },
    { id: 'gpt-5.3-codex-spark', name: 'GPT-5.3 Codex Spark' },
    { id: 'gpt-5.5', name: 'duplicate' },
  ];
  // Only the ids with no row are carried, de-duplicated and in stored order; the absent field means
  // the default set, which is present in the pinned catalog.
  expect(unofferableAllowedModelIds(stored)).toEqual(['gpt-5.5', 'gpt-5.3-codex-spark']);
  expect(unofferableAllowedModelIds(undefined)).toEqual([]);
  expect(unofferableAllowedModelIds(defaultAllowedModels(), ['gpt-6-sol', 'gpt-6-luna'])).toEqual([]);
});
