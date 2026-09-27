import { execFile } from 'node:child_process';
import { mkdir, lstat, mkdtemp, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { PINNED_RUNTIMES, runtimeCache, verifyRuntimeFile } from './runtime-assets.mjs';
const execute = promisify(execFile);
if (process.versions.node.split('.')[0] !== '24') throw new Error('Node 24 is required');
await mkdir(runtimeCache, { recursive: true, mode: 0o700 });
if ((await lstat(runtimeCache)).isSymbolicLink()) throw new Error('Runtime cache must be a real directory');
for (const manifest of PINNED_RUNTIMES) {
  const archivePath = path.join(runtimeCache, manifest.archive.filename);
  let archivePresent = true;
  try { await lstat(archivePath); }
  catch (error) { if (error.code !== 'ENOENT') throw error; archivePresent = false; }
  if (!archivePresent) {
    const partial = archivePath + '.partial';
    const file = await open(partial, 'wx', 0o600);
    try {
      const response = await fetch(manifest.archive.url);
      if (!response.ok || !response.body) throw new Error('Official runtime download failed');
      let size = 0;
      for await (const bytes of response.body) {
        size += bytes.byteLength; if (size > manifest.archive.size) throw new Error('Official runtime download size exceeded');
        await file.writeFile(bytes);
      }
      await file.sync(); await file.close();
      await verifyRuntimeFile(partial, manifest.archive); await rename(partial, archivePath);
    } finally { await file.close().catch(() => undefined); await rm(partial, { force: true }); }
  }
  await verifyRuntimeFile(archivePath, manifest.archive);
  const staging = await mkdtemp(path.join(runtimeCache, 'extract-'));
  try {
    // The archive digest is pinned before tar reads it; extract exactly one fixed entry.
    await execute('/usr/bin/tar', ['-xzf', archivePath, '-C', staging, manifest.archive.entry]);
    const binary = path.join(staging, manifest.archive.entry); await verifyRuntimeFile(binary, manifest);
    if (process.platform === 'darwin' && manifest.platform === 'darwin') await execute('/usr/bin/codesign', ['--verify', '--strict', binary]);
    await rename(binary, path.join(runtimeCache, manifest.archive.entry));
  } finally { await rm(staging, { recursive: true, force: true }); }
  console.log(`Verified bundled Codex ${manifest.codexVersion} (${manifest.platform}/${manifest.architecture}) prepared.`);
}
