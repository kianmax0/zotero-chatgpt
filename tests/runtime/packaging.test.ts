import { expect, it, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PINNED_RUNTIME, LINUX_RUNTIME } from '../../runtime/manifest.ts';
const execute = promisify(execFile); const roots: string[] = [];
const manifest = { codexVersion: PINNED_RUNTIME.codexVersion, platform: 'darwin', architecture: 'arm64', entry: 'content/runtime/codex-aarch64-apple-darwin', size: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', archive: { entry: 'codex-aarch64-apple-darwin' }, licenses: ['LICENSE', 'NOTICE', 'RATATUI-LICENSE', 'WEZTERM-LICENSE'] };
const moduleURL = new URL('../../scripts/runtime-assets.mjs', import.meta.url).href;
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function setup() { const root = await mkdtemp(path.join(tmpdir(), 'zchatgpt-runtime-build-')); roots.push(root); return root; }
function run(code: string) { return execute(process.execPath, ['--input-type=module', '-e', `import { copyBundledRuntime, validatePackagedRuntime } from ${JSON.stringify(moduleURL)}; const manifest = ${JSON.stringify(manifest)}; ${code}`]); }
it('build copies only a hash-verified runtime and declared licenses then packaging revalidates it', async () => {
  const root = await setup(); const cache = path.join(root, 'cache'); const out = path.join(root, 'out'); await mkdir(cache); await writeFile(path.join(cache, manifest.archive.entry), 'abc');
  await run(`await copyBundledRuntime(${JSON.stringify(out)}, {cacheDirectory:${JSON.stringify(cache)}, manifest}); await validatePackagedRuntime(${JSON.stringify(out)}, manifest);`);
  expect(await readFile(path.join(out, manifest.entry), 'utf8')).toBe('abc'); expect(JSON.parse(await readFile(path.join(out, 'content/runtime/manifest.json'), 'utf8'))).toEqual(manifest);
  await writeFile(path.join(out, manifest.entry), 'bad');
  await expect(run(`await validatePackagedRuntime(${JSON.stringify(out)}, manifest);`)).rejects.toThrow();
});
it('build fails on a missing, truncated or hash-mismatched cache instead of producing a shell-only package', async () => {
  for (const data of [null, 'ab', 'bad']) {
    const root = await setup(); if (data !== null) await writeFile(path.join(root, manifest.archive.entry), data);
    await expect(run(`await copyBundledRuntime(${JSON.stringify(path.join(root, 'out'))}, {cacheDirectory:${JSON.stringify(root)}, manifest});`)).rejects.toThrow('Bundled runtime');
  }
});

it('packages both targets and refuses a missing, altered or unlisted Linux asset', async () => {
  const root = await setup(); const cache = path.join(root, 'cache'); const out = path.join(root, 'out'); await mkdir(cache);
  const linux = { ...LINUX_RUNTIME, size: manifest.size, sha256: manifest.sha256 };
  const both = [manifest, linux];
  await writeFile(path.join(cache, manifest.archive.entry), 'abc');
  const copy = `await copyBundledRuntime(${JSON.stringify(out)}, { cacheDirectory: ${JSON.stringify(cache)}, manifest: ${JSON.stringify(both)} });`;
  const verify = `await validatePackagedRuntime(${JSON.stringify(out)}, ${JSON.stringify(both)});`;
  await expect(run(copy)).rejects.toThrow('Bundled runtime');
  await writeFile(path.join(cache, linux.archive.entry), 'abc');
  await run(copy + verify);
  expect(JSON.parse(await readFile(path.join(out, 'content/runtime/manifest.json'), 'utf8'))).toEqual(both);
  expect(await readFile(path.join(out, linux.entry), 'utf8')).toBe('abc');
  await writeFile(path.join(out, linux.entry), 'bad');
  await expect(run(verify)).rejects.toThrow('Bundled runtime');
  await run(copy);
  await rm(path.join(out, linux.entry));
  await expect(run(verify)).rejects.toThrow('Bundled runtime');
  await run(copy);
  await writeFile(path.join(out, 'content/runtime/manifest.json'), JSON.stringify(manifest));
  await expect(run(verify)).rejects.toThrow('Bundled runtime manifest mismatch');
});
