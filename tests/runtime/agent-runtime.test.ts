/* eslint-disable @typescript-eslint/unbound-method -- assertions inspect injected spies without invoking them. */
import { expect, it, vi } from 'vitest';
import { RuntimeFailure, type ManagedProcess } from '../../packages/contracts/src/runtime.ts';
import type { CodexConnection } from '../../packages/core/src/codex/connection.ts';
import { AgentRuntime, type AgentRuntimeDependencies } from '../../packages/zotero/src/runtime/agent-runtime.ts';
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function fixture() {
  const process: ManagedProcess = { stdout: { async *[Symbol.asyncIterator]() { yield await Promise.resolve(''); } }, writeStdin: () => Promise.resolve(), wait: () => Promise.resolve({ exitCode: 0 }), terminate: vi.fn(() => Promise.resolve()) };
  let failed: (() => void) | null = null;
  const connection: CodexConnection = {
    request: vi.fn(() => Promise.resolve({})), requestOptional: vi.fn(() => Promise.resolve({})), notify: vi.fn(() => Promise.resolve()),
    respond: vi.fn(() => Promise.resolve()), rejectRequest: vi.fn(() => Promise.resolve()),
    subscribe: () => () => undefined, onFailure: listener => { failed = listener; return () => { failed = null; }; }, close: vi.fn(() => Promise.resolve()),
  };
  const prepared = { spec: { executable: '/private/codex', args: ['app-server'], cwd: '/private/scratch', env: { CODEX_HOME: '/private/account' } as Record<string, string> }, codexVersion: '0.156.1' };
  const dependencies: AgentRuntimeDependencies = { prepare: vi.fn(() => Promise.resolve(prepared)), process: { spawn: vi.fn(() => Promise.resolve(process)) }, connect: vi.fn(() => Promise.resolve(connection)) };
  return { dependencies, process, connection, prepared, fail: () => failed?.() };
}
it('does no Codex work until a connection is requested', async () => {
  const f = fixture(); const runtime = new AgentRuntime(f.dependencies);
  await new Promise(r => setTimeout(r, 0));
  expect(runtime.currentConnection()).toBeNull();
  expect(f.dependencies.prepare).not.toHaveBeenCalled();
  expect(f.dependencies.process.spawn).not.toHaveBeenCalled();
  expect(f.dependencies.connect).not.toHaveBeenCalled();
  await runtime.connection();
  expect(f.dependencies.prepare).toHaveBeenCalledTimes(1);
});
it('shares one startup and reuses the live channel', async () => {
  const f = fixture(); const connected = deferred<void>(); f.dependencies.connect = () => connected.promise.then(() => f.connection);
  const runtime = new AgentRuntime(f.dependencies); const a = runtime.connection(); const b = runtime.connection();
  let ready = false; void a.then(() => { ready = true; }, () => undefined); await new Promise(r => setTimeout(r, 0)); expect(ready).toBe(false);
  connected.resolve(); expect(await a).toBe(f.connection); expect(await b).toBe(f.connection);
  expect(await runtime.connection()).toBe(f.connection);
  expect(f.dependencies.process.spawn).toHaveBeenCalledTimes(1);
  await runtime.stop(); expect(f.connection.close).toHaveBeenCalledTimes(1); expect(f.process.terminate).toHaveBeenCalledTimes(1);
});
it('passes the prepared runtime to the handshake', async () => {
  const f = fixture(); const runtime = new AgentRuntime(f.dependencies); await runtime.connection();
  expect(f.dependencies.connect).toHaveBeenCalledWith(f.process, expect.objectContaining({ codexVersion: '0.156.1', cwd: '/private/scratch' }));
  await runtime.stop();
});
it('stop during extraction prevents any spawn and further start', async () => {
  const f = fixture(); const prepared = deferred<typeof f.prepared>(); f.dependencies.prepare = () => prepared.promise;
  const runtime = new AgentRuntime(f.dependencies); const start = runtime.connection(); const rejection = expect(start).rejects.toThrow('Agent runtime stopped');
  const stop = runtime.stop(); prepared.resolve(f.prepared); await rejection; await stop;
  expect(f.dependencies.process.spawn).not.toHaveBeenCalled(); await expect(runtime.connection()).rejects.toThrow('Agent runtime stopped');
});
it('stop during handshake terminates its handle and closes a late connection exactly once', async () => {
  const f = fixture(); const connected = deferred<CodexConnection>(); f.dependencies.connect = () => connected.promise;
  const runtime = new AgentRuntime(f.dependencies); const start = runtime.connection(); const rejection = expect(start).rejects.toThrow('Agent runtime stopped');
  await new Promise(r => setTimeout(r, 0)); const stop = runtime.stop(); connected.resolve(f.connection); await stop; await rejection;
  expect(f.process.terminate).toHaveBeenCalledTimes(1); expect(f.connection.close).toHaveBeenCalledTimes(1);
});
it('failed startup cleans the owned process and permits an explicit retry', async () => {
  const f = fixture(); let attempts = 0; f.dependencies.connect = () => ++attempts === 1 ? Promise.reject(new Error('raw authentication secret')) : Promise.resolve(f.connection);
  const runtime = new AgentRuntime(f.dependencies); await expect(runtime.connection()).rejects.toThrow('Unable to initialize bundled Codex');
  expect(f.process.terminate).toHaveBeenCalledTimes(1); expect(await runtime.connection()).toBe(f.connection); await runtime.stop();
});
it('keeps ownership of a process whose termination failed and retries termination instead of spawning', async () => {
  const f = fixture(); let attempts = 0; f.dependencies.connect = () => ++attempts === 1 ? Promise.reject(new Error('handshake')) : Promise.resolve(f.connection);
  let kills = 0; f.process.terminate = vi.fn(() => ++kills < 3 ? Promise.reject(new Error('raw kill failure')) : Promise.resolve());
  const runtime = new AgentRuntime(f.dependencies);
  await expect(runtime.connection()).rejects.toThrow('Unable to initialize bundled Codex');
  await expect(runtime.connection()).rejects.toThrow('Unable to stop the previous Codex process');
  expect(f.dependencies.process.spawn).toHaveBeenCalledTimes(1); expect(f.process.terminate).toHaveBeenCalledTimes(2);
  expect(await runtime.connection()).toBe(f.connection);
  expect(f.dependencies.process.spawn).toHaveBeenCalledTimes(2); expect(f.process.terminate).toHaveBeenCalledTimes(3); await runtime.stop();
});
it('a dead channel is not handed out again and its process is replaced before reuse', async () => {
  const f = fixture(); const runtime = new AgentRuntime(f.dependencies); await runtime.connection();
  f.fail();
  expect(runtime.currentConnection()).toBeNull();
  expect(await runtime.connection()).toBe(f.connection);
  expect(f.dependencies.process.spawn).toHaveBeenCalledTimes(2); expect(f.connection.close).toHaveBeenCalledTimes(1);
  expect(f.process.terminate).toHaveBeenCalledTimes(1);
  await runtime.stop();
});
it('failed cleanup of an errored runtime blocks replacement, keeps the handle for stop and never spawns twice', async () => {
  const f = fixture(); const runtime = new AgentRuntime(f.dependencies); await runtime.connection();
  f.process.terminate = vi.fn(() => Promise.reject(new Error('raw kill failure')));
  f.fail();
  await expect(runtime.connection()).rejects.toThrow('Unable to stop the previous Codex process');
  expect(f.dependencies.process.spawn).toHaveBeenCalledTimes(1); expect(f.connection.close).toHaveBeenCalledTimes(1);
  await expect(runtime.stop()).rejects.toThrow('Unable to stop owned Codex process');
  expect(f.process.terminate).toHaveBeenCalledTimes(2);
});
it('surfaces deliberate runtime failures from the core and keeps other errors generic', async () => {
  const f = fixture(); f.dependencies.connect = () => Promise.reject(new RuntimeFailure('Reader policy unavailable: a managed or project configuration layer is active'));
  const runtime = new AgentRuntime(f.dependencies);
  await expect(runtime.connection()).rejects.toThrow('Reader policy unavailable: a managed or project configuration layer is active');
  f.dependencies.prepare = () => Promise.reject(new Error('/Users/private/profile: EACCES'));
  await expect(runtime.connection()).rejects.toThrow('Unable to prepare the bundled Codex runtime');
});
it('never spawns a runtime that lacks a dedicated account directory', async () => {
  const f = fixture(); f.prepared.spec = { ...f.prepared.spec, env: { HOME: '/private/home' } };
  const runtime = new AgentRuntime(f.dependencies);
  await expect(runtime.connection()).rejects.toThrow('Unable to prepare the bundled Codex runtime');
  expect(f.dependencies.process.spawn).not.toHaveBeenCalled();
});
it('retains ownership after a failed shutdown and retries termination on the next stop', async () => {
  const f = fixture(); const runtime = new AgentRuntime(f.dependencies); await runtime.connection();
  let attempts = 0; f.process.terminate = vi.fn(() => ++attempts === 1 ? Promise.reject(new Error('Native stop failed')) : Promise.resolve());
  await expect(runtime.stop()).rejects.toThrow('Unable to stop');
  await expect(runtime.stop()).resolves.toBeUndefined();
  expect(f.process.terminate).toHaveBeenCalledTimes(2); expect(f.dependencies.process.spawn).toHaveBeenCalledTimes(1);
});
