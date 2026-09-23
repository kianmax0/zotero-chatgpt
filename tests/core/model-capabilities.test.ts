import { expect, it, vi } from 'vitest';
import { buildContextBudget, estimateRequestBudget, getPinnedModelCapabilities, parseThreadUsage } from '../../packages/core/src/codex/model-capabilities.ts';
import { PINNED_MODEL_CATALOG } from '../../runtime/model-capabilities.ts';
import { PINNED_RUNTIME } from '../../runtime/manifest.ts';
import { makeSend, imageA, settings } from '../contracts/factories.ts';
import { validateWorkflow } from '../../packages/contracts/src/workspace-validation.ts';
import { defaultSettings } from '../../packages/core/src/workspace/skills.ts';
import type { Message } from '../../packages/contracts/src/index.ts';

it('uses the exact pinned model default window rather than its optional maximum', () => {
  expect(getPinnedModelCapabilities('gpt-5.4')).toMatchObject({ contextWindow: 272000, maxContextWindow: 1000000, inputModalities: ['text', 'image'], provenance: 'pinned-catalog', runtimeVersion: '0.156.1' });
  expect(getPinnedModelCapabilities('gpt-5.6-sol')).toMatchObject({ contextWindow: 272000, maxContextWindow: 872000 });
});

it('keeps the pinned catalog identity welded to the manifest binary identity', () => {
  // If either literal drifts from the manifest the identities disagree and every lookup silently returns null.
  expect(PINNED_MODEL_CATALOG.runtimeVersion).toBe(PINNED_RUNTIME.codexVersion);
  expect(PINNED_MODEL_CATALOG.runtimeSha256).toBe(PINNED_RUNTIME.sha256);
});

it('resolves every embedded catalog id so a manifest bump cannot silently empty the model picker', () => {
  const expected: Record<string, [contextWindow: number, maxContextWindow: number]> = {
    'gpt-6-astra': [272000, 872000],
    'gpt-6-sol': [272000, 872000],
    'gpt-6-luna': [272000, 872000],
    'gpt-5.6-sol': [272000, 872000],
    'gpt-5.6-terra': [272000, 872000],
    'gpt-5.6-luna': [272000, 872000],
    'gpt-daybreak-blue-latest': [272000, 872000],
    'gpt-daybreak-red-latest': [372000, 372000],
    'gpt-5.5': [272000, 272000],
    'gpt-5.4': [272000, 1000000],
    'gpt-5.4-mini': [272000, 272000],
    'gpt-5.2': [272000, 272000],
    'codex-auto-review': [272000, 872000],
  };
  expect(Object.keys(PINNED_MODEL_CATALOG.models)).toEqual(Object.keys(expected));
  for (const [id, [contextWindow, maxContextWindow]] of Object.entries(expected)) {
    expect(getPinnedModelCapabilities(id), `${id} must resolve from the pinned catalog`).toMatchObject({ contextWindow, maxContextWindow, inputModalities: ['text', 'image'], provenance: 'pinned-catalog', runtimeVersion: PINNED_RUNTIME.codexVersion });
  }
});

it('lists gpt-6-astra first, mirroring the newest-first catalog the composer rank leads with', () => {
  // The composer no longer trusts the server array; it ranks gpt-6-astra first itself
  // (generation-settings.ts). The embedded catalog keeps the same newest-first order so the
  // offline mirror and the picker default cannot disagree.
  expect(Object.keys(PINNED_MODEL_CATALOG.models)[0]).toBe('gpt-6-astra');
});

it.each(['gpt-5.6-sol-future', 'GPT-5.6-Sol', ' gpt-5.6-sol', 'unlisted-model', '__proto__'])('leaves unmatched model %s unknown', model => {
  expect(getPinnedModelCapabilities(model)).toBeNull();
});

it('does not reuse a catalog after the declared binary identity changes', async () => {
  vi.resetModules();
  vi.doMock('../../runtime/manifest.ts', () => ({ PINNED_RUNTIME: { codexVersion: PINNED_RUNTIME.codexVersion, sha256: 'different-binary' } }));
  try {
    const changed = await import('../../packages/core/src/codex/model-capabilities.ts');
    expect(changed.getPinnedModelCapabilities('gpt-5.6-sol')).toBeNull();
  } finally { vi.doUnmock('../../runtime/manifest.ts'); vi.resetModules(); }
});

const last = { inputTokens: 1200, cachedInputTokens: 800, outputTokens: 100, reasoningOutputTokens: 40, totalTokens: 1300 };
const total = { inputTokens: 9200, cachedInputTokens: 1800, outputTokens: 1500, reasoningOutputTokens: 400, totalTokens: 10700 };
const usage = () => ({ threadId: 'synthetic-thread', turnId: 'synthetic-turn', tokenUsage: { last: { ...last }, total: { ...total }, modelContextWindow: 353400 } });

it('keeps last and cumulative token usage separate and strips unrelated data', () => {
  const params = usage();
  const parsed = parseThreadUsage({ method: 'thread/tokenUsage/updated', params: { ...params, privateData: 'discard' } });
  expect(parsed).toEqual({ threadId: 'synthetic-thread', turnId: 'synthetic-turn', last, total, modelContextWindow: 353400 });
  params.tokenUsage.last.inputTokens = 0;
  expect(parsed?.last.inputTokens).toBe(1200);
});

it('accepts a notification payload and preserves an absent reported window as unknown', () => {
  expect(parseThreadUsage({ ...usage(), tokenUsage: { last, total, modelContextWindow: null } })?.modelContextWindow).toBeNull();
  expect(parseThreadUsage({ ...usage(), tokenUsage: { last, total } })?.modelContextWindow).toBeNull();
});

it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '12'])('rejects unsafe token counts %s instead of publishing false usage', bad => {
  expect(parseThreadUsage({ ...usage(), tokenUsage: { ...usage().tokenUsage, last: { ...last, inputTokens: bad } } })).toBeNull();
});

it('ignores unrelated notifications and malformed identities or usage shapes', () => {
  for (const value of [null, [], {}, { method: 'item/started', params: usage() }, { ...usage(), threadId: '' }, { ...usage(), tokenUsage: { last } }, { ...usage(), tokenUsage: { last, total, modelContextWindow: -1 } }]) expect(parseThreadUsage(value)).toBeNull();
});

const budgetInput = { modelId: 'gpt-5.4', historyTokens: 0, instructionBytes: 1000, workflowBytes: 500, imageCount: 0, questionBytes: 100, outputReserve: 16000 };

it('reserves instructions, workflow, history, question, output and safety before admitting source text', () => {
  const budget = buildContextBudget({ ...budgetInput, reportedWindow: 100000, historyTokens: 20000 });
  expect(budget).toMatchObject({ capacity: 100000, provenance: 'runtime-reported', accuracy: 'estimate', textBudgetTokens: 42400, reservations: { history: 20000, instructions: 1000, workflow: 500, images: 0, question: 100, output: 16000, safety: 20000, total: 57600 } });
});

it('labels a pinned capacity as an estimate and never substitutes the larger maximum', () => {
  expect(buildContextBudget(budgetInput)).toMatchObject({ capacity: 272000, provenance: 'pinned-catalog', accuracy: 'estimate', textBudgetTokens: 200000 });
});

it('keeps unlisted-model capacity unknown until a valid runtime window is supplied', () => {
  expect(buildContextBudget({ ...budgetInput, modelId: 'unlisted-model' })).toMatchObject({ capacity: null, provenance: 'unknown', accuracy: 'unknown', textBudgetTokens: null });
  expect(buildContextBudget({ ...budgetInput, modelId: 'unlisted-model', reportedWindow: 100000 })).toMatchObject({ capacity: 100000, provenance: 'runtime-reported', textBudgetTokens: 62400 });
});

it('does not treat missing history measurements as an empty conversation', () => {
  const withoutHistory = { modelId: 'gpt-5.4', instructionBytes: 1000, workflowBytes: 500, imageCount: 0, questionBytes: 100, outputReserve: 16000 };
  expect(buildContextBudget(withoutHistory)).toMatchObject({ capacity: 272000, accuracy: 'unknown', textBudgetTokens: null, reservations: { history: null, total: null } });
});

it('accounts for image allowance while clearly marking its unmeasured cost', () => {
  const budget = buildContextBudget({ ...budgetInput, reportedWindow: 100000, imageCount: 2 });
  expect(budget.reservations.images).toBe(32768);
  expect(budget.textBudgetTokens).toBe(29632);
  expect(budget.assumptions).toContain('image-token-cost-unmeasured');
  expect(budget.accuracy).toBe('estimate');
});

it('clamps exhausted budgets to zero and reports the overload without dropping reservations', () => {
  expect(buildContextBudget({ ...budgetInput, reportedWindow: 1000, historyTokens: 5000 })).toMatchObject({ textBudgetTokens: 0, overBudget: true, reservations: { total: 22800 } });
});

it.each([
  { questionBytes: -1 }, { instructionBytes: 1.5 }, { workflowBytes: Infinity }, { imageCount: -1 },
  { historyTokens: NaN }, { reportedWindow: 0 }, { reportedWindow: Infinity }, { outputReserve: -1 },
  { historyTokens: Number.MAX_SAFE_INTEGER, workflowBytes: Number.MAX_SAFE_INTEGER },
])('rejects invalid or overflowing budget inputs %j', patch => {
  expect(() => buildContextBudget({ ...budgetInput, ...patch })).toThrow(RangeError);
});

/**
 * The request-level reservation estimate is the single producer-side authority (R5): the chat
 * presenter delegates to it instead of keeping a second copy, so these numbers are what a send
 * actually plans against. The fixtures are the synthetic ones the contracts tests use.
 */
function userMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: '2e4a6c8e-0b1d-4f3a-a5c7-9e1b3d5f7a90', requestId: '9a1c3e5f-7b2d-4c6e-8f0a-1b3d5f7a9c0e',
    role: 'user', phase: null, settings: settings, text: 'Explain x', citations: [], status: 'completed', ...overrides,
  };
}
function summary(id: string, textBytes: number) {
  return { id, revision: { fingerprint: 'synthetic-v1', size: textBytes, modifiedAt: 1000 }, parserVersion: 'zotero-pdfjs-text-v1', totalPages: 3, pages: [], textBytes };
}
/** The bytes one recorded turn adds before its document text is counted. */
const turnBytes = (text: string): number => new TextEncoder().encode(JSON.stringify({ role: 'user', text, citations: [] })).length;

it('charges each distinct recorded document once and adds the image allowance', () => {
  const document = summary('aabbccdd-0000-4000-8000-000000000001', 40000);
  const budget = estimateRequestBudget({
    request: makeSend({ question: 'Why?', settings: { model: 'gpt-5.4', serviceTier: null, effort: null } }),
    messages: [
      userMessage({ text: 'first', document }),
      userMessage({ text: 'second', document, referenceDocuments: [{ referenceId: 'ref-1', document }], images: [imageA] }),
    ],
    usage: { model: 'gpt-5.4', contextWindow: 100000, last, total },
  });
  // The same document cited by two turns and re-sent as a reference is still charged once.
  expect(budget.capacity).toBe(100000);
  expect(budget.provenance).toBe('runtime-reported');
  expect(budget.reservations.history).toBe(turnBytes('first') + turnBytes('second') + 16384 + 40000);
  expect(budget.reservations.images).toBe(0);
  expect(budget.reservations.question).toBe(new TextEncoder().encode('Why?').length);
  expect(budget.reservations.total).toBe(
    budget.reservations.history! + budget.reservations.instructions + budget.reservations.workflow + budget.reservations.images + budget.reservations.question + budget.reservations.output + budget.reservations.safety!,
  );
});

it('charges the frozen workflow and the request images, and stays honest without a reported window', () => {
  const workflow = validateWorkflow({ skill: null, profileId: null, preferences: defaultSettings().preferences });
  const budget = estimateRequestBudget({
    request: makeSend({ workflow, images: [imageA], settings: { model: 'unlisted-model', serviceTier: null, effort: null } }),
    messages: [],
  });
  expect(budget.capacity).toBeNull();
  expect(budget.accuracy).toBe('unknown');
  expect(budget.reservations.workflow).toBeGreaterThan(0);
  expect(budget.reservations.images).toBe(16384);
  expect(budget.reservations.history).toBe(0);
});
