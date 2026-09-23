import type { ModelOption } from '../../../contracts/src/runtime.ts';
import type { AllowedModel } from '../../../contracts/src/workspace.ts';
import { PINNED_MODEL_CATALOG } from '../../../../runtime/model-capabilities.ts';

/**
 * The persisted model allowlist: which models the composer may offer.
 *
 * This module is the single source of truth for the default set, the candidate list the native
 * Preferences pane renders, and the resolver the picker consumes. It deliberately lives in core so
 * the store, the pane and the composer all agree without a second list.
 *
 * The picker offers only the three current GPT-6 ids. A pinned catalog entry can be offered before
 * the runtime starts; Sol and Luna join only after the live `model/list` reports their exact ids.
 * Historical stored ids remain in settings but never become new picker choices.
 */

/** Exact model-id shape: runtime ids contain `.`, `-` and `_`, so the skill `identifier` shape is too strict. */
export const MODEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u;

/**
 * This intentionally accepts exact ids only. A family prefix is too broad for a deliberately small
 * picker and could surface retired or internal models when the runtime catalog changes.
 */
export const CURRENT_MODEL_IDS = ['gpt-6-sol', 'gpt-6-astra', 'gpt-6-luna'] as const;
const CURRENT_MODEL_RANK = new Map<string, number>(CURRENT_MODEL_IDS.map((id, index) => [id, index]));

/** True for exactly the current models the picker may offer. */
export function isOfferableModelId(id: string): boolean {
  return CURRENT_MODEL_RANK.has(id);
}

/**
 * Compatibility alias for callers that used the older bundled-family predicate.
 */
export function isBundledFamilyModelId(id: string): boolean { return isOfferableModelId(id); }

const ACRONYMS: Readonly<Record<string, string>> = { gpt: 'GPT', ai: 'AI' };
function titleCase(part: string): string {
  const acronym = ACRONYMS[part.toLowerCase()];
  return acronym ?? (part.length ? part.charAt(0).toUpperCase() + part.slice(1) : part);
}
/**
 * A readable label derived from the exact id. The pinned catalog has no display names and the live
 * `model/list` display names are not persisted, so every label here is local to this reader and
 * derived from the id it names — never a fabricated product name.
 */
export function modelLabel(id: string): string {
  const words = id.split(/[-_]/u).filter(Boolean).map(titleCase);
  if (words.length >= 2 && words[0] === 'GPT' && /^\d/u.test(words[1]!)) return `${words[0]}-${words.slice(1).join(' ')}`;
  return words.join(' ');
}

/**
 * Default to the three current models. Sol is preferred for new conversations; Astra is a pinned
 * fallback and Luna is runtime-discovered when available.
 */
export const DEFAULT_ALLOWED_MODEL_IDS: readonly string[] = CURRENT_MODEL_IDS;
/** Default model set persisted by earlier plugin builds; treated as untouched but never re-offered. */
export const LEGACY_DEFAULT_ALLOWED_MODEL_IDS: readonly string[] = ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'];
export function defaultAllowedModels(): AllowedModel[] {
  return DEFAULT_ALLOWED_MODEL_IDS.map(id => ({ id, name: modelLabel(id) }));
}

/**
 * The picker ordering is product-owned and independent of the runtime's array order.
 */
function compareOfferRank(a: string, b: string): number { return (CURRENT_MODEL_RANK.get(a) ?? CURRENT_MODEL_IDS.length) - (CURRENT_MODEL_RANK.get(b) ?? CURRENT_MODEL_IDS.length) || a.localeCompare(b); }
/**
 * The exact ids the composer may offer from a live catalog, newest-first. This is the whole offer
 * policy in one place — which ids are eligible, their order, and what happens when a stored list has
 * nothing offerable left:
 *
 * - With an enforced allowlist, exactly the named current ids present in the live catalog.
 * - Otherwise the current GPT-6 list, in product rank order.
 * - A stale list degrades only to current models still present in the live catalog. Older or
 *   unrecognized catalog entries are never used as a blank-picker fallback.
 *
 * The composer renders this list and nothing else; the stored record is never rewritten here.
 */
export function offeredModelIds(catalogIds: readonly string[], allowedIds?: readonly string[]): string[] {
  const ranked = (ids: readonly string[]): string[] => [...ids].sort(compareOfferRank);
  const current = catalogIds.filter(isOfferableModelId);
  if (allowedIds !== undefined) {
    const offered = current.filter(id => allowedIds.includes(id));
    if (offered.length) return ranked(offered);
  }
  return ranked(current);
}

export interface ModelCandidate { id: string; name: string }

/**
 * Every model the pane may offer: pinned current ids plus exact current ids from the live runtime.
 * Server ordering is ignored and duplicates are removed.
 */
export function modelCandidates(liveModelIds: readonly string[] = []): ModelCandidate[] {
  const available = new Set(Object.keys(PINNED_MODEL_CATALOG.models).filter(isOfferableModelId));
  for (const id of liveModelIds) if (isOfferableModelId(id)) available.add(id);
  const ids = CURRENT_MODEL_IDS.filter(id => available.has(id));
  return ids.map(id => ({ id, name: modelLabel(id) }));
}

/**
 * The exact ids a record allows. An absent field means the default set; duplicates are collapsed.
 * Ids that the pane no longer offers are preserved, so an unknown or removed model never turns into
 * an error or a silent drop. This is the record-level honesty guarantee; the picker enforcement in
 * `enforcedAllowedModelIds` is what keeps an offerable set restricted.
 */
export function allowedModelIds(allowedModels: readonly AllowedModel[] | undefined): string[] {
  return [...new Set((allowedModels ?? defaultAllowedModels()).map(model => model.id))];
}

/**
 * Stored ids absent from the currently available candidate set, in stored order. The pane has no
 * row for these, so a save carries them through rather than silently dropping historical settings.
 */
export function unofferableAllowedModelIds(allowedModels: readonly AllowedModel[] | undefined, liveModelIds: readonly string[] = []): string[] {
  const available = new Set(modelCandidates(liveModelIds).map(candidate => candidate.id));
  return allowedModelIds(allowedModels).filter(id => !available.has(id));
}

/**
 * The models the picker may offer from a runtime catalog: current allowed ids present in that
 * catalog. Pure, so it can be unit-tested without a runtime.
 */
export function resolveAllowedModels(models: readonly ModelOption[], allowedModels: readonly AllowedModel[] | undefined): ModelOption[] {
  const allowed = new Set(allowedModelIds(allowedModels).filter(isOfferableModelId));
  return models.filter(model => allowed.has(model.id));
}

/**
 * True while the stored list is either current default or the exact legacy default. Existing
 * installs keep their stored bytes and IDs, while both defaults select the current offered set.
 */
export function isDefaultAllowedModels(allowedModels: readonly AllowedModel[] | undefined): boolean {
  if (allowedModels === undefined) return true;
  const ids = allowedModelIds(allowedModels);
  const sameSet = (expected: readonly string[]): boolean => ids.length === expected.length && expected.every(id => ids.includes(id));
  return sameSet(DEFAULT_ALLOWED_MODEL_IDS) || sameSet(LEGACY_DEFAULT_ALLOWED_MODEL_IDS);
}

/**
 * The allowlist the picker should enforce: `undefined` while the stored list is the untouched
 * default (so current and legacy defaults both select all available current models), otherwise the
 * offerable ids to offer. A stale list that has no current IDs degrades to the current available set
 * rather than blanking the picker. The stored record itself is never rewritten by this call.
 */
export function enforcedAllowedModelIds(allowedModels: readonly AllowedModel[] | undefined): string[] | undefined {
  if (isDefaultAllowedModels(allowedModels)) return undefined;
  const ids = allowedModelIds(allowedModels).filter(isOfferableModelId);
  return ids.length ? ids : undefined;
}

/**
 * Pinned and live-reported current candidates. Saved ids are deliberately not candidates: a model
 * absent from both sources is stale and must not appear selectable.
 */
export function modelChoices(_allowedModels: readonly AllowedModel[] | undefined, liveModelIds: readonly string[] = []): ModelCandidate[] {
  return modelCandidates(liveModelIds);
}
