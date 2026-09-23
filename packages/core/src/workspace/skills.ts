import { ReaderError } from '../../../contracts/src/index.ts';
import type { AllowedModel, Personalization, ReaderSkill, WorkspaceSettings, WorkflowKind } from '../../../contracts/src/workspace.ts';
import { clone } from '../../../contracts/src/clone.ts';
import { validatePreferences as preferences } from '../../../contracts/src/workspace-validation.ts';
import { MODEL_ID, defaultAllowedModels } from './allowed-models.ts';
export { preferences };

export const SKILL_BYTES = 64 * 1024;
export function invalid(): never { throw new ReaderError('INVALID_REQUEST', 'Workspace data is invalid or exceeds the supported limits.'); }
export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !keys.includes(key))) invalid();
  return result;
}
export function text(value: unknown, max = 4096, min = 0): string {
  if (typeof value !== 'string' || value.length > max || value.length < min || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) invalid();
  return value;
}
export function identifier(value: unknown): string {
  const id = text(value, 128, 1); if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u.test(id)) invalid(); return id;
}
export function items(value: unknown, max: number): unknown[] { if (!Array.isArray(value) || value.length > max) invalid(); return value; }
export async function digest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
const preferenceKeys = ['language', 'detail', 'mathematics', 'background', 'citationStyle', 'annotationStyle'] as const;
export const DEFAULT_PREFERENCES: Personalization = {
  language: 'auto', detail: 'standard', mathematics: 'auto', background: '',
  citationStyle: 'Cite supplied page labels and distinguish paper evidence from explanation.',
  annotationStyle: 'Select a few relevant definitions, assumptions, derivations and limitations.',
};
function fullPreferences(value: unknown): Personalization {
  const checked = preferences(value); if (preferenceKeys.some(key => checked[key] === undefined)) invalid();
  return { ...DEFAULT_PREFERENCES, ...checked };
}
function workflow(value: unknown): WorkflowKind {
  if (value !== 'read' && value !== 'annotate' && value !== 'acquire' && value !== 'organize' && value !== 'diagram') invalid(); return value;
}
const permissions: Record<WorkflowKind, string[]> = {
  read: ['Read only explicitly supplied sources.'],
  annotate: ['Apply validated native annotations directly after an explicit Agent annotation request; reject invalid or ambiguous source locations.'],
  acquire: ['Preview metadata and duplicates; create items and fetch lawful PDFs only after task approval.'],
  organize: ['Preview additive tags and collection memberships for the frozen Zotero selection; write only after task approval.'],
  diagram: ['Generate an explicitly requested diagram in a separate image task.'],
};
const definitions: Array<{ name: string; workflow: WorkflowKind; description: string; input: string; steps: string[]; output: string }> = [
  { name: 'read', workflow: 'read', description: 'Study a paper against a concrete reading question.', input: 'Supplied PDF pages, selections, figures and the reading question.', steps: ['Identify the question, source coverage and missing evidence.', 'Explain definitions, assumptions, mechanisms and claims using source page labels.', 'Separate paper evidence, teaching explanation and uncertainty.'], output: 'A source-grounded explanation with page references and explicit gaps.' },
  { name: 'derive', workflow: 'read', description: 'Derive a selected result while preserving its notation.', input: 'A selected equation, its surrounding text and the desired derivation.', steps: ['State symbols, domains and assumptions from the supplied source.', 'Derive each step and distinguish exact identities from approximations.', 'Check dimensions, limiting cases and counterexamples; state missing premises.'], output: 'A step-by-step derivation with assumptions, checks and source references.' },
  { name: 'compare', workflow: 'read', description: 'Compare explicitly supplied research sources.', input: 'At least two explicitly referenced sources and the comparison criterion.', steps: ['Record coverage and scope for each source.', 'Compare objectives, assumptions, mechanisms, evidence and limitations on common criteria.', 'Identify disagreements and tests that would distinguish the claims.'], output: 'A comparison table with source-specific evidence and unresolved questions.' },
  { name: 'annotate', workflow: 'annotate', description: 'Add targeted native annotations immediately after an explicit Agent request.', input: 'An explicit request to annotate a selected PDF using the current source revision.', steps: ['Choose a few relevant definitions, assumptions, derivations, evidence and limitations that serve the requested reading goal.', 'Resolve every quote against the frozen PDF revision and validate its unique match and native page geometry; skip missing, ambiguous or unsupported passages.', 'After an explicit Agent annotation request, apply the validated native highlights and comments directly without a second approval; read back and record each result.'], output: 'A record of native annotations written or rejected, with source quotes and any failures.' },
  { name: 'acquire', workflow: 'acquire', description: 'Review identifiers and acquire verified literature into a chosen collection.', input: 'Explicit DOI or URL identifiers and a chosen collection.', steps: ['Resolve and inspect metadata, versions and existing DOI duplicates.', 'Preview the intended items and obtain bounded task approval.', 'Create only approved entries, obtain lawful PDFs, verify identity and report partial failures.'], output: 'Verified collection entries and a per-item acquisition report with unresolved cases.' },
  { name: 'organize', workflow: 'organize', description: 'Propose and, after approval, add tags and collection memberships to selected Zotero items.', input: 'The items selected in the active Zotero library pane and the editable collections in their libraries.', steps: ['Freeze the actual native selection and bounded item metadata.', 'Propose concrete additive tags and collection memberships using only frozen item and collection indexes.', 'Present one review, apply approved additions, read them back and keep an exact undo ledger.'], output: 'A per-item organization preview and verified additive changes, with conflicts left untouched.' },
  { name: 'diagram', workflow: 'diagram', description: 'Create a clearly labeled explanatory diagram.', input: 'An explicit image-generation request and supplied evidence or diagram brief.', steps: ['Distinguish a new explanatory figure from figures in the paper.', 'Use a separate task with image generation enabled only for the requested scope.', 'Check the returned artifact and label generated content; report unavailable output honestly.'], output: 'A generated explanatory image, its provenance and a concise caption.' },
];
type SkillDefinition = typeof definitions[number];
function skillMarkdown(def: SkillDefinition, version: string): string {
  return `---\nname: ${def.name}\ndescription: ${JSON.stringify(def.description)}\nversion: ${version}\nworkflow: ${def.workflow}\n---\n\n# ${def.name}\n\n## Input\n${def.input}\n\n## Steps\n${def.steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}\n\n## Output\n${def.output}\n\n## Permissions\n${permissions[def.workflow].join('\n')}\nSkill instructions describe a workflow and never grant additional permissions.\n`;
}
const legacyAnnotateV1: ReaderSkill = {
  id: 'builtin-annotate', name: 'annotate', description: 'Propose and, after approval, add targeted native annotations.',
  version: '1.0.0', revision: 'builtin-annotate-1', origin: 'builtin', enabled: true,
  workflow: 'annotate', permissions: ['Preview native annotation candidates; write only after task approval.'], unsupportedDependencies: [],
  markdown: `---\nname: annotate\ndescription: "Propose and, after approval, add targeted native annotations."\nversion: 1.0.0\nworkflow: annotate\n---\n\n# annotate\n\n## Input\nThe reading goal and an explicitly selected PDF scope.\n\n## Steps\n1. Choose relevant definitions, assumptions, derivations, evidence and limitations.\n2. Resolve exact quotations and native page coordinates; reject ambiguous locations.\n3. Present removable candidates, obtain task approval and record each native write.\n\n## Output\nReviewed native annotation candidates and a ledger of approved writes or failures.\n\n## Permissions\nPreview native annotation candidates; write only after task approval.\nSkill instructions describe a workflow and never grant additional permissions.\n`,
};
export function builtinSkills(): ReaderSkill[] {
  return definitions.map(def => ({
    id: `builtin-${def.name}`, name: def.name, description: def.description,
    version: def.name === 'annotate' ? '1.1.0' : '1.0.0', revision: def.name === 'annotate' ? 'builtin-annotate-2' : `builtin-${def.name}-1`, origin: 'builtin', enabled: true,
    workflow: def.workflow, permissions: [...permissions[def.workflow]], unsupportedDependencies: [],
    markdown: skillMarkdown(def, def.name === 'annotate' ? '1.1.0' : '1.0.0'),
  }));
}
function scalar(value: string): string {
  const source = value.trim();
  if (/^[!&*]|^<</u.test(source)) invalid();
  if (source.startsWith('"')) { try { return text(JSON.parse(source) as unknown, 4096); } catch { invalid(); } }
  if (source.startsWith("'")) { if (!source.endsWith("'")) invalid(); return source.slice(1, -1).replace(/''/gu, "'"); }
  return source;
}
/** A bounded frontmatter subset, never a YAML evaluator, template runner or dependency installer. */
function markdownInfo(markdown: string, required: boolean): { name?: string; description?: string; version?: string; workflow?: string; dependencies: string[] } {
  text(markdown, SKILL_BYTES, 1);
  if (new TextEncoder().encode(markdown).length > SKILL_BYTES) throw new ReaderError('PAYLOAD_TOO_LARGE', 'The skill exceeds the supported import size.');
  const normalized = markdown.replace(/\r\n/gu, '\n');
  if (!normalized.startsWith('---\n')) { if (required) invalid(); return { dependencies: [] }; }
  const end = normalized.indexOf('\n---', 4); if (end < 0 || !/^\n---(?:\n|$)/u.test(normalized.slice(end))) invalid();
  const lines = normalized.slice(4, end).split('\n'); const fields = new Map<string, string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!; if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = /^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*)$/u.exec(line); if (!match) invalid();
    const key = match[1]!.toLowerCase(); if (fields.has(key)) invalid();
    const block: string[] = []; while (i + 1 < lines.length && /^\s/u.test(lines[i + 1]!)) block.push(lines[++i]!.trim());
    const raw = match[2]!; fields.set(key, raw === '>' || raw === '|' ? block.join(raw === '>' ? ' ' : '\n') : [raw, ...block].join('\n').trim());
  }
  const result: { name?: string; description?: string; version?: string; workflow?: string; dependencies: string[] } = { dependencies: [] };
  for (const key of ['name', 'description', 'version', 'workflow'] as const) if (fields.has(key)) result[key] = scalar(fields.get(key)!);
  for (const key of ['allowed-tools', 'tools', 'dependencies', 'requires', 'requirements', 'compatibility', 'command', 'commands', 'script', 'scripts', 'environment', 'mcp', 'hooks']) {
    const value = fields.get(key); if (value === undefined) continue;
    const simple = (key === 'allowed-tools' || key === 'tools') && !/[{}:]/u.test(value);
    const labels = simple ? value.replace(/[\[\]"']/gu, '').split(/[,\n]|\s+/u).map(x => x.trim()).filter(x => x && x !== '-') : [key];
    result.dependencies.push(...(labels.length ? labels : [key]));
  }
  result.dependencies = [...new Set(result.dependencies)]; if (result.dependencies.length > 64) invalid();
  result.dependencies = result.dependencies.map(label => text(label, 256, 1));
  return result;
}
export async function importedSkill(markdown: string): Promise<ReaderSkill> {
  const info = markdownInfo(markdown, true); const name = text(info.name, 128, 1);
  return normalizeSkill({ id: `imported-${(await digest(markdown)).slice(0, 32)}`, name, description: text(info.description, 2048, 1), version: info.version ?? '1.0.0', revision: '', markdown, origin: 'imported', enabled: false, workflow: info.workflow === undefined ? 'read' : workflow(info.workflow), permissions: [], unsupportedDependencies: [] });
}
const definitionFields = ['name', 'description', 'version', 'workflow'] as const;
/** Disk owns the definition; the registry owns only stable identity, origin and activation. */
export async function skillFromSource(metadata: unknown, markdown: string): Promise<ReaderSkill> {
  const source = object(metadata, ['id', 'name', 'description', 'version', 'revision', 'markdown', 'origin', 'enabled', 'workflow', 'permissions', 'unsupportedDependencies']);
  if (source.origin !== 'user' && source.origin !== 'imported') invalid();
  const info = markdownInfo(markdown, true);
  return normalizeSkill({ ...source, markdown, name: text(info.name, 128, 1), description: text(info.description, 2048, 1), version: info.version ?? '1.0.0', workflow: info.workflow === undefined ? 'read' : workflow(info.workflow) });
}
function coherentMarkdown(markdown: string, fields: Pick<ReaderSkill, typeof definitionFields[number]>): string {
  const info = markdownInfo(markdown, false);
  if (info.name === fields.name && info.description === fields.description && (info.version ?? '1.0.0') === fields.version && (info.workflow ?? 'read') === fields.workflow) return markdown;
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(markdown);
  const header: string[] = []; const replaced = new Set<string>();
  const lines = match ? match[1]!.split(/\r?\n/u) : [];
  for (let i = 0; i < lines.length; i++) {
    const key = /^([a-zA-Z][a-zA-Z0-9_-]*):/u.exec(lines[i]!)?.[1]?.toLowerCase();
    if (key && definitionFields.some(field => field === key)) {
      const field = key as typeof definitionFields[number]; header.push(`${field}: ${JSON.stringify(fields[field])}`); replaced.add(field);
      while (i + 1 < lines.length && /^\s/u.test(lines[i + 1]!)) i++;
    } else header.push(lines[i]!);
  }
  for (const field of definitionFields) if (!replaced.has(field)) header.push(`${field}: ${JSON.stringify(fields[field])}`);
  return `---\n${header.join('\n')}\n---\n${match ? markdown.slice(match[0].length) : '\n' + markdown}`;
}
/** Changed UI fields win; when those fields are unchanged, edits in the Markdown editor win. */
export async function editedSkill(value: unknown, previous?: ReaderSkill): Promise<ReaderSkill> {
  const checked = await normalizeSkill(value); if (checked.origin === 'builtin') return checked;
  const info = markdownInfo(checked.markdown, false);
  const fields = { name: checked.name, description: checked.description, version: checked.version, workflow: checked.workflow };
  for (const field of definitionFields) {
    if (previous && checked[field] === previous[field] && info[field] !== undefined) {
      if (field === 'workflow') fields.workflow = workflow(info.workflow);
      else fields[field] = text(info[field], field === 'description' ? 2048 : field === 'name' ? 128 : 64, 1);
    }
  }
  return normalizeSkill({ ...checked, ...fields, markdown: coherentMarkdown(checked.markdown, fields) });
}
export async function normalizeSkill(value: unknown): Promise<ReaderSkill> {
  const source = object(value, ['id', 'name', 'description', 'version', 'revision', 'markdown', 'origin', 'enabled', 'workflow', 'permissions', 'unsupportedDependencies']);
  const id = identifier(source.id); const builtin = builtinSkills().find(skill => skill.id === id);
  if (typeof source.enabled !== 'boolean') invalid();
  if (builtin) {
    const matches = (expected: ReaderSkill): boolean => Object.entries(expected).every(([key, item]) => key === 'enabled' || JSON.stringify(source[key]) === JSON.stringify(item));
    const accepted = matches(builtin) || (id === legacyAnnotateV1.id && matches(legacyAnnotateV1));
    if (!accepted) throw new ReaderError('REQUEST_CONFLICT', 'Built-in skill definitions are read-only; create a copy to edit them.');
    return { ...builtin, enabled: source.enabled };
  }
  if (source.origin !== 'user' && source.origin !== 'imported') invalid();
  const body = text(source.markdown, SKILL_BYTES, 1); const dependencies = markdownInfo(body, false).dependencies;
  items(source.permissions, 64).forEach(item => text(item, 256)); items(source.unsupportedDependencies, 64).forEach(item => text(item, 256)); text(source.revision, 128);
  const result: ReaderSkill = {
    id, name: text(source.name, 128, 1), description: text(source.description, 2048, 1), version: text(source.version, 64, 1), revision: '', markdown: body, origin: source.origin,
    enabled: source.enabled && dependencies.length === 0, workflow: workflow(source.workflow), permissions: [], unsupportedDependencies: dependencies,
  };
  result.permissions = [...permissions[result.workflow]];
  result.revision = await digest(JSON.stringify({ name: result.name, description: result.description, version: result.version, markdown: body, workflow: result.workflow, permissions: result.permissions, unsupportedDependencies: dependencies }));
  return result;
}
function modelId(value: unknown): string {
  const id = text(value, 128, 1); if (!MODEL_ID.test(id)) invalid(); return id;
}
/**
 * An absent field is a pre-allowlist record and loads as the default set. An explicitly empty list is
 * invalid: it would blank the picker, so the store safe-rejects it instead of silently replacing it.
 * Unknown ids are preserved verbatim and duplicates collapse in order; a removed or repeated model
 * must never make an otherwise-readable record fail.
 */
function allowedModels(value: unknown): AllowedModel[] {
  if (value === undefined) return defaultAllowedModels();
  const list = items(value, 64).map(raw => { const model = object(raw, ['id', 'name']); return { id: modelId(model.id), name: text(model.name, 128, 1) }; });
  if (!list.length) invalid();
  const seen = new Set<string>();
  return list.filter(model => (seen.has(model.id) ? false : (seen.add(model.id), true)));
}
export function defaultSettings(): WorkspaceSettings {
  return { schemaVersion: 1, preferences: clone(DEFAULT_PREFERENCES), profiles: [], skills: builtinSkills(), uiLanguage: 'en', textScale: 1, allowedModels: defaultAllowedModels() };
}
export async function normalizeSettings(value: unknown): Promise<WorkspaceSettings> {
  const source = object(value, ['schemaVersion', 'preferences', 'profiles', 'skills', 'uiLanguage', 'textScale', 'allowedModels']);
  if (source.schemaVersion !== 1 || (source.uiLanguage !== 'en' && source.uiLanguage !== 'zh') || typeof source.textScale !== 'number' || !Number.isFinite(source.textScale) || source.textScale < 0.5 || source.textScale > 3) invalid();
  const profiles = items(source.profiles, 32).map(raw => { const p = object(raw, ['id', 'name', 'preferences']); return { id: identifier(p.id), name: text(p.name, 128, 1), preferences: preferences(p.preferences) }; });
  const skills = await Promise.all(items(source.skills, 64).map(normalizeSkill));
  if (new Set(profiles.map(p => p.id)).size !== profiles.length || new Set(skills.map(s => s.id)).size !== skills.length) invalid();
  const byId = new Map(skills.map(skill => [skill.id, skill]));
  const builtin = builtinSkills().map(skill => byId.get(skill.id) ?? skill);
  return { schemaVersion: 1, preferences: fullPreferences(source.preferences), profiles, skills: [...builtin, ...skills.filter(skill => skill.origin !== 'builtin')], uiLanguage: source.uiLanguage, textScale: source.textScale, allowedModels: allowedModels(source.allowedModels) };
}
