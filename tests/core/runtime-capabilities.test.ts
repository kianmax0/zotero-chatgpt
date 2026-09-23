import { afterEach, expect, it, vi } from 'vitest';
import { createReaderClient } from '../../packages/core/src/index.ts';
import { parseModel } from '../../packages/core/src/codex/models.ts';
import type { ReaderClient } from '../../packages/contracts/src/runtime.ts';
import { MemoryStorage, flush } from './doubles.ts';
import { model, server } from './fixtures.ts';

const clients: ReaderClient[] = [];
afterEach(async () => { await Promise.allSettled(clients.splice(0).map(client => client.close())); vi.useRealTimers(); });
const capabilities = { imageGeneration: true, namespaceTools: true, webSearch: false };
const quota = { rateLimits: { primary: { usedPercent: 99 } }, rateLimitsByLimitId: {
  codex: { limitId: 'codex', limitName: 'do-not-expose-private-name', primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 2000000000 }, secondary: { usedPercent: 60, windowDurationMins: 10080, resetsAt: 2000100000 }, credits: { balance: 'do-not-expose-balance' } },
  'codex-spark': { limitId: 'codex-spark', primary: { usedPercent: 10, windowDurationMins: 60, resetsAt: 2000001000 } },
} };
async function setup(configure?: (fixture: ReturnType<typeof server>) => void) {
  const fixture = server(); fixture.handlers.set('modelProvider/capabilities/read', () => ({ ...capabilities, privateData: 'do-not-expose-provider' })); fixture.handlers.set('account/rateLimits/read', () => structuredClone(quota)); configure?.(fixture);
  let id = 0;
  const client = await createReaderClient(fixture.p, new MemoryStorage(), { codexVersion: '0.156.1', cwd: '/isolated', uuid: () => `12345678-0000-4000-8000-${String(++id).padStart(12, '0')}`, pluginVersion: '0.4.0-runtime-test', now: () => '2026-09-12T10:00:00.000Z' });
  clients.push(client); return { ...fixture, client };
}

it('uses the supplied plugin version in the initialize handshake, only once Agent readiness is requested', async () => {
  const f = await setup();
  // Creating the client performs no Codex work at all: the handshake is lazy.
  expect(f.p.writes).toEqual([]);
  await f.client.refreshAccount();
  const first = JSON.parse(f.p.writes[0]!) as { params: { clientInfo: { version: string } } };
  expect(first.params.clientInfo.version).toBe('0.4.0-runtime-test');
});

it('preserves advertised image input support and treats malformed optional modality data as unknown', () => {
  expect(parseModel({ ...model, inputModalities: ['text', 'image'] })?.inputModalities).toEqual(['text', 'image']);
  expect(parseModel({ ...model, inputModalities: undefined })?.inputModalities).toBeUndefined();
  expect(parseModel({ ...model, inputModalities: ['text', 12] })).toMatchObject({ id: model.model });
  expect(parseModel({ ...model, inputModalities: ['text', 12] })?.inputModalities).toBeUndefined();
});

it('publishes provider capabilities and whitelisted multi-bucket limits without account metadata', async () => {
  const f = await setup(); await f.client.refreshAccount(); await flush();
  const snapshot = f.client.snapshot(); expect(snapshot.capabilities).toEqual(capabilities);
  expect(snapshot.rateLimits).toEqual([
    { label: 'Codex · primary', usedPercent: 25, windowMinutes: 300, resetsAt: 2000000000 },
    { label: 'Codex · secondary', usedPercent: 60, windowMinutes: 10080, resetsAt: 2000100000 },
    { label: 'Codex Spark · primary', usedPercent: 10, windowMinutes: 60, resetsAt: 2000001000 },
  ]);
  expect(JSON.stringify(snapshot)).not.toContain('do-not-expose'); expect(snapshot.models[0]?.id).toBe(model.model);
});

it('keeps login and models usable when both optional queries fail', async () => {
  const f = await setup(f => {
    f.handlers.set('modelProvider/capabilities/read', () => { throw new Error('Synthetic optional failure'); });
    f.handlers.set('account/rateLimits/read', () => { throw new Error('Synthetic optional failure'); });
  });
  await expect(f.client.refreshAccount()).resolves.toBeUndefined(); await flush();
  expect(f.client.snapshot()).toMatchObject({ runtime: 'ready', account: { state: 'signedIn' }, models: [{ id: model.model }], error: null });
  expect(f.client.snapshot().capabilities).toBeUndefined(); expect(f.client.snapshot().rateLimits).toBeUndefined();
  await expect(f.client.startLogin()).resolves.toMatchObject({ loginId: 'login-1' });
});

it('treats partial capabilities and absent or invalid quota values as unknown rather than zero', async () => {
  const f = await setup(f => {
    f.handlers.set('modelProvider/capabilities/read', () => ({ imageGeneration: true }));
    f.handlers.set('account/rateLimits/read', () => ({ rateLimits: { primary: { usedPercent: '50' }, secondary: null } }));
  });
  await f.client.refreshAccount(); await flush();
  expect(f.client.snapshot().capabilities).toBeUndefined(); expect(f.client.snapshot().rateLimits).toBeUndefined(); expect(f.client.snapshot().error).toBeNull();
});

it('merges sparse rate notices without erasing other windows or copying unapproved fields', async () => {
  const f = await setup(); await f.client.refreshAccount(); await flush();
  f.p.emit({ method: 'account/rateLimits/updated', params: { rateLimits: { limitId: 'codex', primary: { usedPercent: 41, resetsAt: null, windowDurationMins: null }, secondary: null, email: 'do-not-expose-notice' } } }); await flush();
  expect(f.client.snapshot().rateLimits).toEqual([
    { label: 'Codex · primary', usedPercent: 41, windowMinutes: 300, resetsAt: 2000000000 },
    { label: 'Codex · secondary', usedPercent: 60, windowMinutes: 10080, resetsAt: 2000100000 },
    { label: 'Codex Spark · primary', usedPercent: 10, windowMinutes: 60, resetsAt: 2000001000 },
  ]);
  expect(JSON.stringify(f.client.snapshot())).not.toContain('do-not-expose');
});

it('does not terminate the runtime on a malformed optional rate notification', async () => {
  const f = await setup(); await f.client.refreshAccount(); await flush();
  f.p.emit({ method: 'account/rateLimits/updated', params: [] }); await flush();
  expect(f.client.snapshot().runtime).toBe('ready'); expect(f.client.snapshot().models).toHaveLength(1); expect(f.client.snapshot().rateLimits).toBeUndefined();
  expect(f.p.terminated).toBe(false);
});

it('clears prior account limits on sign-out and ignores rolling updates while signed out', async () => {
  const f = await setup(); await f.client.refreshAccount(); await flush();
  f.handlers.set('account/read', () => ({ account: null, requiresOpenaiAuth: true })); await f.client.refreshAccount(); await flush();
  f.p.emit({ method: 'account/rateLimits/updated', params: { rateLimits: quota.rateLimitsByLimitId.codex } }); await flush();
  expect(f.client.snapshot().account.state).toBe('signedOut'); expect(f.client.snapshot().rateLimits).toBeUndefined();
});

it('does not let a late read overwrite a newer rolling usage notification', async () => {
  let respond!: (value: unknown) => void;
  const f = await setup(f => { f.handlers.set('account/rateLimits/read', () => new Promise(resolve => { respond = resolve; })); });
  await f.client.refreshAccount(); await flush();
  f.p.emit({ method: 'account/rateLimits/updated', params: { rateLimits: { limitId: 'codex', primary: { usedPercent: 75 } } } }); await flush();
  respond(quota); await flush();
  expect(f.client.snapshot().rateLimits?.find(row => row.label === 'Codex · primary')?.usedPercent).toBe(75);
});

it('lets optional timeouts expire without blocking base refresh or later main calls', async () => {
  vi.useFakeTimers();
  const f = await setup(f => { f.handlers.set('account/rateLimits/read', () => new Promise(() => undefined)); });
  await f.client.refreshAccount(); await flush(); expect(f.client.snapshot().models).toHaveLength(1);
  expect(f.client.snapshot().capabilities).toEqual(capabilities);
  await vi.advanceTimersByTimeAsync(10001); await flush();
  expect(f.client.snapshot().runtime).toBe('ready'); expect(f.client.snapshot().rateLimits).toBeUndefined(); expect(f.p.terminated).toBe(false);
  f.handlers.set('account/rateLimits/read', () => structuredClone(quota));
  await f.client.refreshAccount(); await flush(); expect(f.client.snapshot().rateLimits).toHaveLength(3);
});
