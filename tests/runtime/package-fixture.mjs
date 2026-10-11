// Test-only 3-byte runtime. Production build/package CLIs always use the pinned release.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PINNED_RUNTIMES } from '../../runtime/manifest.ts';
const manifest = PINNED_RUNTIMES.map(item => ({ ...item, size: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' }));
const option = key => { const index = process.argv.indexOf(key); return index === -1 ? undefined : process.argv[index + 1]; };
if (process.argv[2] === 'build') {
  const { buildDevelopmentExtension } = await import('../../scripts/build.mjs');
  const cacheDirectory = await mkdtemp(path.join(tmpdir(), 'zchatgpt-fixture-cache-'));
  try { for (const item of manifest) await writeFile(path.join(cacheDirectory, item.archive.entry), 'abc'); await buildDevelopmentExtension(option('--outdir'), { runtime: { manifest, cacheDirectory } }); }
  finally { await rm(cacheDirectory, { recursive: true, force: true }); }
} else {
  const { packageExtension } = await import('../../scripts/package.mjs');
  await packageExtension(option('--source'), option('--output'), { runtimeManifest: manifest, repositoryRoot: option('--repository') });
}
