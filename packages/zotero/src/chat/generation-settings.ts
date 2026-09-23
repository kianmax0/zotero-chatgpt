import type { GenerationSettings } from '../../../contracts/src/index.ts';
import type { ModelOption } from '../../../contracts/src/runtime.ts';
import { offeredModelIds } from '../../../core/src/workspace/allowed-models.ts';

export type ComposerField = 'model' | 'speed' | 'effort';
export interface ComposerOption { value: string; label: string }
export interface ComposerControl {
  field: ComposerField;
  label: string;
  value: string;
  options: ComposerOption[];
  disabled: boolean;
}

function modelOf(models: readonly ModelOption[], id: string): ModelOption | undefined {
  return models.find(model => model.id === id);
}

/**
 * The models the picker may offer, in the order the core policy ranks them. The eligibility rule,
 * the rank and the never-blank fallback all live in `core/workspace/allowed-models.ts`
 * (`offeredModelIds`); this function only maps the resulting ids back onto the catalog entries the
 * UI needs to render, so the composer cannot drift from the policy the Preferences pane enforces.
 *
 * `allowedIds` is the Preferences allowlist from `enforcedAllowedModelIds`. `undefined` means the
 * current default set is selected, including for a persisted legacy default.
 */
export function offeredModels(models: readonly ModelOption[], allowedIds?: readonly string[]): ModelOption[] {
  const byId = new Map(models.map(model => [model.id, model] as const));
  return offeredModelIds(models.map(model => model.id), allowedIds).flatMap(id => { const model = byId.get(id); return model ? [model] : []; });
}

/**
 * The preferred current model the picker can offer. The catalog's `isDefault` flag describes the
 * CLI's own start-up preference and can lag behind, so the product rank determines this default.
 */
function defaultModel(models: readonly ModelOption[], allowedIds?: readonly string[]): ModelOption | undefined {
  return offeredModels(models, allowedIds)[0];
}
function encode(value: string | null): string { return value ?? ''; }
function supportedTier(model: ModelOption, tier: string | null): boolean {
  return tier === null || model.serviceTiers.some(option => option.id === tier);
}
function supportedEffort(model: ModelOption, effort: string | null): boolean {
  return effort === null || model.supportedReasoningEfforts.some(option => option.id === effort);
}

export function catalogDefaultSettings(models: readonly ModelOption[], allowedIds?: readonly string[]): GenerationSettings | null {
  const model = defaultModel(models, allowedIds);
  return model ? { model: model.id, serviceTier: model.defaultServiceTier, effort: model.defaultReasoningEffort } : null;
}

/** Keep a still-legal combo; if the model or a field is gone, show that model's catalog defaults. */
export function alignSettings(models: readonly ModelOption[], settings: GenerationSettings, allowedIds?: readonly string[]): GenerationSettings {
  const offered = offeredModels(models, allowedIds);
  const model = modelOf(offered, settings.model) ?? offered[0];
  if (!model) return settings;
  return {
    model: model.id,
    serviceTier: supportedTier(model, settings.serviceTier) ? settings.serviceTier : model.defaultServiceTier,
    effort: supportedEffort(model, settings.effort) ? settings.effort : model.defaultReasoningEffort,
  };
}

export function applyComposerChoice(models: readonly ModelOption[], current: GenerationSettings, field: ComposerField, raw: string, allowedIds?: readonly string[]): GenerationSettings {
  if (field === 'model') return alignSettings(models, { ...current, model: raw || current.model }, allowedIds);
  if (field === 'speed') return { ...current, serviceTier: raw === '' ? null : raw };
  return { ...current, effort: raw === '' ? null : raw };
}

/** Prefer a catalog tier named Fast; otherwise the first fast-like id/name (flex/turbo/plus). Never invent a missing id. */
export function resolveFastTier(model: ModelOption | undefined): { id: string; name: string } | undefined {
  if (!model) return undefined;
  const named = model.serviceTiers.find(tier => /^fast$/iu.test(tier.id) || /^fast$/iu.test(tier.name));
  const match = named ?? model.serviceTiers.find(tier => /fast|flex|turbo|plus/iu.test(`${tier.id} ${tier.name}`));
  return match ? { id: match.id, name: match.name } : undefined;
}

function speedOptions(model: ModelOption | undefined): ComposerOption[] {
  const options: ComposerOption[] = [{ value: '', label: 'Default' }];
  if (!model) return options;
  const fast = resolveFastTier(model);
  if (fast) options.push({ value: fast.id, label: 'Fast' });
  for (const tier of model.serviceTiers) {
    if (fast && tier.id === fast.id) continue;
    options.push({ value: tier.id, label: tier.name || tier.id });
  }
  return options;
}

function speedLabel(model: ModelOption | undefined, tier: string | null): string {
  if (tier === null) return 'Default';
  const fast = resolveFastTier(model);
  if (fast && fast.id === tier) return 'Fast';
  return model?.serviceTiers.find(option => option.id === tier)?.name ?? tier;
}

export function composerControls(models: readonly ModelOption[], settings: GenerationSettings | null, allowedIds?: readonly string[]): ComposerControl[] {
  const offered = offeredModels(models, allowedIds);
  // A draft/conversation can still hold a model the picker no longer offers; align it first so the
  // model field shows an offered value instead of a blank selection.
  const current = settings ? alignSettings(models, settings, allowedIds) : null;
  const selected = current ? modelOf(offered, current.model) : undefined;
  const modelOptions = offered.map(model => ({ value: model.id, label: model.displayName }));
  const effortOptions: ComposerOption[] = [{ value: '', label: 'Default' }, ...(selected?.supportedReasoningEfforts.map(effort => ({ value: effort.id, label: effortLabel(effort.id) })) ?? [])];
  const ready = offered.length > 0 && !!selected;
  return [
    { field: 'model', label: 'Model', value: current?.model ?? '', options: modelOptions, disabled: !ready },
    { field: 'speed', label: 'Speed', value: encode(current?.serviceTier ?? null), options: ready ? speedOptions(selected) : [{ value: '', label: 'Default' }], disabled: !ready || (selected?.serviceTiers.length ?? 0) === 0 },
    { field: 'effort', label: 'Reasoning', value: encode(current?.effort ?? null), options: ready ? effortOptions : [{ value: '', label: 'Default' }], disabled: !ready || (selected?.supportedReasoningEfforts.length ?? 0) === 0 },
  ];
}

export function settingsCaption(settings: GenerationSettings, models: readonly ModelOption[]): string {
  const model = modelOf(models, settings.model);
  const modelName = model?.displayName ?? settings.model;
  const speed = speedLabel(model, settings.serviceTier);
  const effort = settings.effort === null ? 'Default' : settings.effort;
  return `${modelName} · ${speed} · ${effort}`;
}

export function effortLabel(id: string | null): string {
  if (!id) return 'Default';
  const key = id.toLowerCase().replace(/[_\s-]/gu, '');
  if (key === 'none') return 'None';
  if (key === 'low') return 'Low';
  if (key === 'medium') return 'Medium';
  if (key === 'high') return 'High';
  if (key === 'xhigh' || key === 'extrahigh') return 'Extra High';
  return id;
}

export function modelChipLabel(settings: GenerationSettings | null, models: readonly ModelOption[], allowedIds?: readonly string[]): string {
  if (!settings) return 'Model';
  // The button must name the model the composer would actually send, so a saved model the picker
  // no longer offers is shown as its aligned replacement rather than a stale, unselectable id.
  const current = alignSettings(models, settings, allowedIds);
  const model = modelOf(offeredModels(models, allowedIds), current.model);
  const parts = [model?.displayName ?? current.model];
  if (current.effort) parts.push(effortLabel(current.effort));
  const fast = resolveFastTier(model);
  if (fast && current.serviceTier === fast.id) parts.push('Fast');
  return parts.join(' ');
}
