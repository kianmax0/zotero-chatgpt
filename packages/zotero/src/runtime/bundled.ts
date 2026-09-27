import { selectRuntime } from '../../../../runtime/manifest.ts';
import { checkPath, privateDirectory, type FileHost } from './storage.ts';
export interface RuntimeManifest { codexVersion: string; platform: string; architecture: string; entry: string; size: number; sha256: string }
export interface AssetHost extends FileHost { os: string; abi: string; load(url: string): Promise<Uint8Array> }
export function validateRuntime(host: AssetHost, manifest: RuntimeManifest): void {
  const pinned = selectRuntime(host.os, host.abi);
  if (manifest.codexVersion !== pinned.codexVersion || manifest.platform !== pinned.platform || manifest.architecture !== pinned.architecture || manifest.entry !== pinned.entry || !Number.isSafeInteger(manifest.size) || manifest.size <= 0 || !/^[a-f0-9]{64}$/u.test(manifest.sha256)) throw new Error('Invalid bundled runtime manifest');
}
export async function ensureBundledRuntime(host: AssetHost, rootURI: string, privateRoot: string, manifest: RuntimeManifest = selectRuntime(host.os, host.abi)): Promise<string> {
  validateRuntime(host, manifest);
  // rootURI comes only from Zotero's installed add-on, never from UI or storage.
  if (!rootURI.endsWith('/') || !/^(jar:file:|file:)/u.test(rootURI)) throw new Error('Invalid extension resource root');
  let staging: string | null = null;
  try {
    const directory = await privateDirectory(host, privateRoot, `runtime/${manifest.codexVersion}-${manifest.platform}-${manifest.architecture}/${manifest.sha256}`);
    const target = host.join(directory, 'codex');
    const verify = async (file: string) => {
      if (!await checkPath(host, file, 'regular')) throw new Error('Missing executable');
      if ((await host.io.stat(file)).size !== manifest.size || await host.io.computeHexDigest(file, 'sha256') !== manifest.sha256) throw new Error('Runtime integrity mismatch');
    };
    const token = host.uuid(); if (!/^[a-zA-Z0-9-]+$/u.test(token)) throw new Error('Invalid temporary identifier');
    let cached = await checkPath(host, target, 'regular');
    if (cached) {
      try { await verify(target); }
      catch {
        // The immutable path must hold exactly the pinned bytes. Retain the corrupt file as
        // evidence and extract the packaged copy again. This runs only while the Agent runtime
        // prepares a spawn, i.e. before it owns any process that could still be executing the old
        // inode; renaming never alters an inode another process might still be running.
        await host.io.move(target, host.join(directory, `corrupt-${token}`), { noOverwrite: true });
        cached = false;
      }
    }
    if (!cached) {
      staging = await privateDirectory(host, directory, `staging-${token}`);
      const file = host.join(staging, 'codex');
      const bytes = await host.load(rootURI + manifest.entry);
      if (bytes.byteLength !== manifest.size) throw new Error('Runtime size mismatch');
      const written = await host.io.write(file, bytes, { mode: 'create', flush: true });
      if (written !== bytes.byteLength) throw new Error('Incomplete runtime write');
      await verify(file);
      await host.io.setPermissions(file, 0o700, false);
      await host.io.move(file, target, { noOverwrite: true });
    }
    await host.io.setPermissions(target, 0o700, false);
    if ((await host.io.stat(target)).permissions !== 0o700) throw new Error('Runtime permission mismatch');
    return target;
  } catch { throw new Error('Bundled runtime preparation failed; the packaged Codex could not be extracted or verified in this Zotero profile'); }
  finally { if (staging) await host.io.remove(staging, { recursive: true, ignoreAbsent: true }).catch(() => undefined); }
}
