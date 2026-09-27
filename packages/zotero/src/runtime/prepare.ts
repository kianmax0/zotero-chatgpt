import { selectRuntime } from '../../../../runtime/manifest.ts';
import { codexLaunchArgs } from '../../../core/src/codex/reader-policy.ts';
import type { ProcessSpec } from '../../../contracts/src/runtime.ts';
import { ensureBundledRuntime, validateRuntime, type AssetHost, type RuntimeManifest } from './bundled.ts';
import { GeckoStorage, privateDirectory } from './storage.ts';
export interface RuntimeHost extends AssetHost {
  profileDir: string;
  /** Read on Agent preparation only; never enumerate or inherit the entire environment. */
  getEnvironmentVariable?: (name: string) => string;
}
export interface PreparedRuntime { spec: ProcessSpec; codexVersion: string }
/**
 * The private runtime paths, computed without touching the filesystem.
 *
 * The shared reader client needs the scratch `cwd` at construction, but must not create the Codex
 * runtime directories or extract the bundled executable until Agent work actually starts. These are
 * therefore pure path strings; `prepareRuntime` is what creates the directories, and only lazily.
 */
export interface RuntimePaths { root: string; home: string; account: string; cwd: string; temporary: string; records: string; config: string; cache: string; data: string }
export function runtimePaths(host: RuntimeHost): RuntimePaths {
  // `PathUtils.join` requires each component to be a single path segment, so the tree is joined stepwise.
  const root = host.join(host.join(host.profileDir, 'zotero-chatgpt'), 'v1');
  const home = host.join(root, 'home');
  return {
    root,
    home,
    account: host.join(root, 'account'),
    cwd: host.join(root, 'scratch'),
    temporary: host.join(root, 'tmp'),
    records: host.join(root, 'records'),
    config: host.join(home, 'config'),
    cache: host.join(home, 'cache'),
    data: host.join(home, 'data'),
  };
}
/** Creates the private runtime environment and the bundled executable. Agent-only; never at bootstrap. */
export async function prepareRuntime(host: RuntimeHost, rootURI: string, manifest: RuntimeManifest = selectRuntime(host.os, host.abi)): Promise<PreparedRuntime> {
  validateRuntime(host, manifest);
  const proxies: Record<string, string> = {};
  // Preserve both spellings and NO_PROXY semantics; the native HTTP client owns precedence.
  // Values can contain proxy credentials, so never log or persist them.
  for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy']) {
    const value = host.getEnvironmentVariable?.(name);
    if (value) proxies[name] = value;
  }
  const paths = runtimePaths(host);
  const root = await privateDirectory(host, host.profileDir, 'zotero-chatgpt/v1');
  // The computed paths and the created ones must be the same directory tree.
  if (root !== paths.root) throw new Error('Runtime path mismatch');
  const home = await privateDirectory(host, root, 'home');
  const account = await privateDirectory(host, root, 'account');
  const cwd = await privateDirectory(host, root, 'scratch');
  const temporary = await privateDirectory(host, root, 'tmp');
  const config = await privateDirectory(host, home, 'config');
  const cache = await privateDirectory(host, home, 'cache');
  const data = await privateDirectory(host, home, 'data');
  const codexHome = account;
  const settings = new GeckoStorage(host, account);
  // This account directory is exclusively ours. Only the official login flow writes credentials.
  await settings.writeAtomic('config.toml', new Uint8Array());
  // Empty execution environment catalog removes built-in file and command tools.
  await settings.writeAtomic('environments.toml', new TextEncoder().encode('include_local = false\n'));
  const executable = await ensureBundledRuntime(host, rootURI, root, manifest);
  return {
    codexVersion: manifest.codexVersion,
    spec: { executable, args: codexLaunchArgs(), cwd, env: { ...proxies, HOME: home, CODEX_HOME: codexHome, TMPDIR: temporary + '/', XDG_CONFIG_HOME: config, XDG_CACHE_HOME: cache, XDG_DATA_HOME: data, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', CODEX_EXEC_SERVER_URL: 'none', CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: '1' } },
  };
}
