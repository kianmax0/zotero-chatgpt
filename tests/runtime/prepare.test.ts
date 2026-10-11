import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { prepareRuntime, runtimePaths, type RuntimeHost } from '../../packages/zotero/src/runtime/prepare.ts';
import { PINNED_RUNTIME, LINUX_RUNTIME } from '../../runtime/manifest.ts';
import { nodeFiles } from './files-fixture.ts';
import type { FileHost } from '../../packages/zotero/src/runtime/storage.ts';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
/**
 * `PathUtils.join` refuses a component that contains a separator with
 * `NS_ERROR_FILE_UNRECOGNIZED_PATH`, while Node's `path.join` silently flattens one. The private
 * runtime tree is described in multi-segment relative paths, so the strict host contract — not the
 * lenient Node fixture — is what must be asserted here.
 */
function strictJoin<T extends FileHost>(host: T): T {
  return {
    ...host,
    join: (...parts: string[]) => {
      // The first component is the base path and may be absolute; every later component is appended
      // and must therefore be a single name.
      for (const part of parts.slice(1)) if (part.includes('/')) throw new Error('PathUtils.join: Could not append to path: NS_ERROR_FILE_UNRECOGNIZED_PATH');
      return host.join(...parts);
    },
  };
}
it('builds every private runtime path from single-segment components the host can join', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'zchatgpt-join-')); roots.push(profile);
  const host = strictJoin({ ...nodeFiles(), os: 'Darwin', abi: 'aarch64-gcc3', profileDir: profile, load: () => Promise.resolve(new TextEncoder().encode('abc')) });
  const paths = runtimePaths(host);
  expect(paths.root).toBe(path.join(profile, 'zotero-chatgpt/v1'));
  expect(paths.cwd).toBe(path.join(paths.root, 'scratch'));
  expect(paths.config).toBe(path.join(paths.home, 'config'));
  const manifest = { codexVersion: PINNED_RUNTIME.codexVersion, platform: 'darwin', architecture: 'arm64', entry: 'content/runtime/codex-aarch64-apple-darwin', size: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' };
  const prepared = await prepareRuntime(host, 'jar:file:///extension.xpi!/', manifest);
  expect(prepared.spec.cwd).toBe(paths.cwd);
  expect(prepared.spec.env.CODEX_HOME).toBe(paths.account);
});
it('prepares only private profile state and resets executable environments before every spawn', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'zchatgpt-私有 profile-')); roots.push(profile);
  const host: RuntimeHost = { ...nodeFiles(), os: 'Darwin', abi: 'aarch64-gcc3', profileDir: profile, load: () => Promise.resolve(new TextEncoder().encode('abc')) };
  const manifest = { codexVersion: PINNED_RUNTIME.codexVersion, platform: 'darwin', architecture: 'arm64', entry: 'content/runtime/codex-aarch64-apple-darwin', size: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' };
  const prepared = await prepareRuntime(host, 'jar:file:///extension.xpi!/', manifest);
  const { env, cwd, executable } = prepared.spec; const privateRoot = path.join(profile, 'zotero-chatgpt/v1');
  expect(cwd).toBe(path.join(privateRoot, 'scratch')); expect(executable.startsWith(privateRoot + '/runtime/')).toBe(true);
  expect(env).toEqual({ HOME: path.join(privateRoot, 'home'), CODEX_HOME: path.join(privateRoot, 'account'), TMPDIR: path.join(privateRoot, 'tmp') + '/', XDG_CONFIG_HOME: path.join(privateRoot, 'home/config'), XDG_CACHE_HOME: path.join(privateRoot, 'home/cache'), XDG_DATA_HOME: path.join(privateRoot, 'home/data'), LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', CODEX_EXEC_SERVER_URL: 'none', CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: '1' });
  expect(await readFile(path.join(env.CODEX_HOME!, 'environments.toml'), 'utf8')).toBe('include_local = false\n');
  await writeFile(path.join(env.CODEX_HOME!, 'environments.toml'), 'include_local = true\n');
  await writeFile(path.join(env.CODEX_HOME!, 'config.toml'), 'mcp_servers.bad = {}\n');
  await writeFile(path.join(env.CODEX_HOME!, 'auth.json'), 'synthetic credentials marker');
  await prepareRuntime(host, 'jar:file:///extension.xpi!/', manifest);
  expect(await readFile(path.join(env.CODEX_HOME!, 'environments.toml'), 'utf8')).toBe('include_local = false\n');
  expect(await readFile(path.join(env.CODEX_HOME!, 'config.toml'), 'utf8')).toBe('');
  expect(await readFile(path.join(env.CODEX_HOME!, 'auth.json'), 'utf8')).toBe('synthetic credentials marker');
  // Local records belong to `openLocalStorage`, not to the Agent-only preparation: preparing Codex
  // must not create or touch the shared records directory.
  await expect(readdir(path.join(privateRoot, 'records'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it('uses the Linux bundle even when a legacy host offers a system CLI', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'zchatgpt-linux-')); roots.push(profile);
  const codexHome = path.join(profile, 'zotero-chatgpt', 'v1', 'account');
  const host = {
    ...nodeFiles(), os: 'Linux', abi: 'x86_64-gcc3', profileDir: profile,
    load: () => Promise.resolve(new TextEncoder().encode('abc')),
    findSystemCodex: () => Promise.resolve({ executable: '/home/test/.local/bin/codex', home: '/home/test' }),
  };
  const prepared = await prepareRuntime(host, 'jar:file:///extension.xpi!/', { ...LINUX_RUNTIME, size: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' });
  expect(prepared.codexVersion).toBe(LINUX_RUNTIME.codexVersion);
  expect(prepared.spec.executable).toContain('/runtime/' + LINUX_RUNTIME.codexVersion + '-linux-x64/');
  expect(prepared.spec.env.HOME).toBe(runtimePaths(host).home);
  expect(prepared.spec.env.CODEX_HOME).toBe(codexHome);
  expect(prepared.spec.env.XDG_CONFIG_HOME).toContain('/zotero-chatgpt/v1/home/config');
});
it('prepares the bundled Linux runtime without a system CLI or imported login', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'zchatgpt-linux-')); roots.push(profile);
  const legacyLookup = vi.fn(() => { throw new Error('must not search the system'); });
  const legacyAuth = vi.fn(() => { throw new Error('must not import credentials'); });
  const host = strictJoin({
    ...nodeFiles(), os: 'Linux', abi: 'x86_64-gcc3', profileDir: profile,
    load: vi.fn(() => Promise.resolve(new TextEncoder().encode('abc'))),
    findSystemCodex: legacyLookup, copySystemCodexAuth: legacyAuth,
  });
  const manifest = { ...PINNED_RUNTIME, platform: 'linux', architecture: 'x64', entry: 'content/runtime/codex-x86_64-unknown-linux-musl', size: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' };
  const prepared = await prepareRuntime(host, 'jar:file:///extension.xpi!/', manifest);
  const paths = runtimePaths(host);
  expect(prepared.codexVersion).toBe(PINNED_RUNTIME.codexVersion);
  expect(prepared.spec.executable).toContain(`/runtime/${manifest.codexVersion}-linux-x64/${manifest.sha256}/codex`);
  expect(prepared.spec.env.HOME).toBe(paths.home);
  expect(prepared.spec.env.CODEX_HOME).toBe(paths.account);
  expect(host.load.mock.calls[0]).toEqual(['jar:file:///extension.xpi!/' + manifest.entry]);
  expect(legacyLookup).not.toHaveBeenCalled();
  expect(legacyAuth).not.toHaveBeenCalled();
  expect(await readdir(paths.account)).toEqual(['config.toml', 'environments.toml']);
});
it('rejects a runtime for a different platform before creating private state', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'zchatgpt-mismatch-')); roots.push(profile);
  const host = { ...nodeFiles(), os: 'Linux', abi: 'x86_64-gcc3', profileDir: profile, load: vi.fn() };
  await expect(prepareRuntime(host, 'jar:file:///extension.xpi!/', PINNED_RUNTIME)).rejects.toThrow('Invalid bundled runtime manifest');
  expect(await readdir(profile)).toEqual([]);
  expect(host.load).not.toHaveBeenCalled();
});

it('inherits only standard proxy variables, preserving case and bypass rules', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'zchatgpt-proxy-')); roots.push(profile);
  const parent: Record<string, string> = {
    HTTP_PROXY: 'http://upper.invalid:8080', HTTPS_PROXY: 'http://user:synthetic@secure.invalid:8081',
    ALL_PROXY: 'socks5h://all.invalid:1080', NO_PROXY: 'localhost,127.0.0.1,::1,.example.test',
    http_proxy: 'http://lower.invalid:8082', https_proxy: 'http://lower-secure.invalid:8083',
    all_proxy: 'socks5://lower-all.invalid:1081', no_proxy: 'localhost,.internal.test',
    HOME: '/external', CODEX_HOME: '/external/account', OPENAI_API_KEY: 'synthetic-key',
    PATH: '/external/bin', NODE_OPTIONS: '--inspect', CODEX_EXEC_SERVER_URL: 'external',
  };
  const read = vi.fn((name: string) => parent[name] ?? '');
  const host = { ...nodeFiles(), os: 'Linux', abi: 'x86_64-gcc3', profileDir: profile,
    getEnvironmentVariable: read, load: () => Promise.resolve(new TextEncoder().encode('abc')) };
  const manifest = { ...LINUX_RUNTIME, size: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' };
  expect(runtimePaths(host).root).toContain('zotero-chatgpt');
  expect(read).not.toHaveBeenCalled();
  const { spec } = await prepareRuntime(host, 'jar:file:///extension.xpi!/', manifest);
  const keys = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'];
  expect(read.mock.calls.map(call => call[0]).sort()).toEqual([...keys].sort());
  for (const key of keys) expect(spec.env[key]).toBe(parent[key]);
  expect(spec.env.HOME).toBe(runtimePaths(host).home);
  expect(spec.env.CODEX_HOME).toBe(runtimePaths(host).account);
  expect(spec.env.CODEX_EXEC_SERVER_URL).toBe('none');
  for (const key of ['OPENAI_API_KEY', 'PATH', 'NODE_OPTIONS']) expect(spec.env).not.toHaveProperty(key);
  // A retry rereads the parent's environment; empty/missing entries remain absent.
  for (const key of keys) parent[key] = '';
  parent.https_proxy = 'http://new.invalid:8080';
  const retry = await prepareRuntime(host, 'jar:file:///extension.xpi!/', manifest);
  expect(retry.spec.env.https_proxy).toBe(parent.https_proxy);
  for (const key of keys.filter(key => key !== 'https_proxy')) expect(retry.spec.env).not.toHaveProperty(key);
});
