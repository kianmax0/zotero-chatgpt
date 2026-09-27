import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import yauzl from 'yauzl';

// Exported so the real-profile development install tool (`scripts/install-dev-xpi.ts`) shares one
// add-on id literal with this isolated-tree lifecycle tool instead of copying it.
export const SUBJECT_ID = '{90909501-7b5b-4985-9f55-566e9890746c}';
const RECORDS_RELATIVE = 'zotero-chatgpt/v1/records';

function requireNode24() {
  if (process.versions.node.split('.')[0] !== '24') {
    throw new Error(`Node 24 is required; found ${process.versions.node}`);
  }
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return path.resolve(value);
}

function readRawOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

export function requireLocalXpi(xpi) {
  if (/^https?:\/\//iu.test(xpi) || /github\.com\/.+\/releases/iu.test(xpi)) {
    throw new Error('GitHub Release download is not authorized; pass a local XPI path');
  }
  return path.resolve(xpi);
}

/** Refuse the user's regular Zotero profile/library. Dedicated `.zotero-chatgpt-dev/` trees are allowed. */
export function assertNotRegularProfile(root) {
  const resolved = path.resolve(root);
  if (/\/Application Support\/Zotero(\/|$)/u.test(resolved) || /\/Zotero\/Profiles\//u.test(resolved)) {
    throw new Error('Refusing to write into a regular Zotero profile');
  }
  return resolved;
}

/** S6 / install-lifecycle only: also refuse the signed-in `.zotero-chatgpt-dev/profile` and `.zotero-chatgpt-dev/data`. */
export function assertIsolatedRoot(root) {
  const resolved = assertNotRegularProfile(root);
  if (resolved.endsWith(`${path.sep}.zotero-chatgpt-dev${path.sep}profile`) || resolved.includes(`${path.sep}.zotero-chatgpt-dev${path.sep}profile${path.sep}`)) {
    throw new Error('Refusing to overwrite the signed-in development profile');
  }
  if (resolved.endsWith(`${path.sep}.zotero-chatgpt-dev${path.sep}data`) || resolved.includes(`${path.sep}.zotero-chatgpt-dev${path.sep}data${path.sep}`)) {
    throw new Error('Refusing to overwrite the signed-in development data directory');
  }
  return resolved;
}

export function profileIsBusy(psOutput, profile) {
  const needle = ` -profile ${path.resolve(profile)}`;
  return String(psOutput).split('\n').some(line => line.includes('/Zotero.app/Contents/MacOS/zotero ') && line.includes(needle));
}

async function readArchiveEntry(archivePath, name) {
  const zipFile = await yauzl.openPromise(archivePath);
  for await (const entry of zipFile.eachEntry()) {
    if (entry.fileName !== name) continue;
    const chunks = [];
    const stream = await zipFile.openReadStreamPromise(entry);
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
  }
  throw new Error(`Archive is missing ${name}`);
}

async function readManifest(archivePath) {
  const raw = JSON.parse((await readArchiveEntry(archivePath, 'manifest.json')).toString('utf8'));
  const id = raw?.applications?.zotero?.id;
  const version = raw?.version;
  if (id !== SUBJECT_ID || typeof version !== 'string' || !version) throw new Error('XPI is not Zotero ChatGPT');
  return { id, version, updateUrl: raw.applications.zotero.update_url ?? null, min: raw.applications.zotero.strict_min_version ?? null, max: raw.applications.zotero.strict_max_version ?? null };
}

export async function readXpiIdentity(archivePath) {
  return readManifest(archivePath);
}

async function sha256File(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function listIfPresent(directory) {
  try {
    return await readdir(directory);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
}

function nodeRuntimePresent(files) {
  return files.some(file => file === 'node' || file.endsWith('/node') || file.includes('node_modules') || file.endsWith('codex-cli'));
}

async function listFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true }).catch(error => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  });
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(filePath, relative)));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

async function listRecords(profile) {
  const directory = path.join(profile, RECORDS_RELATIVE, 'conversations');
  return (await listIfPresent(directory)).filter(name => name.endsWith('.json')).sort();
}

async function inspectInstalled(profile) {
  const installed = path.join(profile, 'extensions', `${SUBJECT_ID}.xpi`);
  await stat(installed);
  const manifest = await readManifest(installed);
  return { ...manifest, sha256: await sha256File(installed), installed, records: await listRecords(profile) };
}

export async function seedRecords(profile, conversation) {
  requireNode24();
  const root = assertIsolatedRoot(profile);
  if (conversation?.schemaVersion !== 1 || typeof conversation.id !== 'string' || !conversation.paper) {
    throw new Error('seed-records requires a schemaVersion 1 conversation');
  }
  const conversations = path.join(root, RECORDS_RELATIVE, 'conversations');
  const papers = path.join(root, RECORDS_RELATIVE, 'papers');
  await mkdir(conversations, { recursive: true });
  await mkdir(papers, { recursive: true });
  const file = path.join(conversations, `${conversation.id}.json`);
  await writeFile(file, `${JSON.stringify(conversation)}\n`);
  const index = {
    schemaVersion: 1,
    conversations: [conversation.id],
    current: conversation.id,
  };
  const paper = conversation.paper;
  await writeFile(path.join(papers, `${paper.clientId}-${paper.libraryId}-${paper.attachmentKey}.json`), `${JSON.stringify(index)}\n`);
  return { ok: true, records: await listRecords(root) };
}

export async function replaceInstalledXpi(profile, xpi, psOutput) {
  requireNode24();
  const root = assertIsolatedRoot(profile);
  if (profileIsBusy(psOutput ?? '', root)) throw new Error('Close the dedicated Zotero instance using this profile before replacing the XPI');
  const local = requireLocalXpi(xpi);
  await stat(local);
  const next = await readManifest(local);
  const previous = await inspectInstalled(root);
  if (next.id !== previous.id) throw new Error('Upgrade/rollback XPI must keep the same add-on id');
  await copyFile(local, previous.installed);
  const current = await inspectInstalled(root);
  return {
    ok: true,
    previousVersion: previous.version,
    version: current.version,
    sha256: current.sha256,
    sameAddonId: current.id === previous.id,
    records: current.records,
  };
}

export async function prepareCleanProfile({ root, dataDir, xpi }) {
  requireNode24();
  const profile = assertIsolatedRoot(root);
  const data = path.resolve(dataDir ?? path.join(path.dirname(profile), 'data'));
  assertIsolatedRoot(data);
  const local = requireLocalXpi(xpi);
  await stat(local);
  const manifest = await readManifest(local);
  await mkdir(path.join(profile, 'extensions'), { recursive: true });
  await mkdir(data, { recursive: true });
  const installed = path.join(profile, 'extensions', `${manifest.id}.xpi`);
  await copyFile(local, installed);
  const digest = await sha256File(installed);
  const prefs = {
    'extensions.zotero.useDataDir': true,
    'extensions.zotero.dataDir': data,
    'extensions.zotero.firstRun2': false,
    'extensions.zotero.sync.autoSync': false,
    'extensions.update.enabled': false,
    'app.update.enabled': false,
    'toolkit.telemetry.enabled': false,
    'browser.shell.checkDefaultBrowser': false,
    'browser.sessionstore.resume_from_crash': false,
  };
  await writeFile(path.join(profile, 'user.js'), Object.entries(prefs).map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`).join('\n') + '\n');
  const files = await listFiles(profile);
  return {
    ok: true,
    addonId: manifest.id,
    version: manifest.version,
    sha256: digest,
    profile,
    dataDir: data,
    records: await listRecords(profile),
    nodeRuntimePresent: nodeRuntimePresent(files),
  };
}

function assertSafeExtractPath(root, destination) {
  const relative = path.relative(root, destination);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe archive path');
}

export async function extractXpi(archivePath, destination, entryName) {
  requireNode24();
  const local = requireLocalXpi(archivePath);
  const out = assertIsolatedRoot(destination);
  await stat(local);
  await mkdir(out, { recursive: true });
  const zipFile = await yauzl.openPromise(local);
  const files = [];
  const written = [];
  for await (const entry of zipFile.eachEntry()) {
    if (entry.fileName.endsWith('/')) continue;
    files.push(entry.fileName);
    if (entryName && entry.fileName !== entryName) continue;
    const dest = path.resolve(out, entry.fileName);
    assertSafeExtractPath(out, dest);
    await mkdir(path.dirname(dest), { recursive: true });
    await pipeline(await zipFile.openReadStreamPromise(entry), createWriteStream(dest));
    written.push(entry.fileName);
  }
  if (entryName && !written.includes(entryName)) throw new Error(`Archive is missing ${entryName}`);
  return {
    ok: true,
    files: written,
    bootstrap: files.includes('bootstrap.js'),
    manifest: files.includes('manifest.json'),
    nodeRuntimePresent: nodeRuntimePresent(files),
  };
}

async function digestFromSums(sumsPath, archiveName) {
  const text = await readFile(sumsPath, 'utf8');
  const line = text.split('\n').find(entry => entry.endsWith(`  ${archiveName}`) || entry.endsWith(` *${archiveName}`));
  if (!line) throw new Error(`SHA256SUMS does not list ${archiveName}`);
  const expected = line.slice(0, 64).toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(expected)) throw new Error(`SHA256SUMS digest for ${archiveName} is not SHA-256`);
  return expected;
}

export async function writeUpdatesJson(archivePath, sumsPath, outputPath) {
  requireNode24();
  const local = requireLocalXpi(archivePath);
  await stat(local);
  const output = path.resolve(outputPath);
  assertIsolatedRoot(path.dirname(output));
  const manifest = await readManifest(local);
  const digest = await sha256File(local);
  const expected = await digestFromSums(path.resolve(sumsPath), path.basename(local));
  if (digest !== expected) throw new Error('SHA256SUMS mismatch for updates.json');
  const updateLink = `https://zotero-chatgpt-dev.invalid/${path.basename(local)}`;
  if (/github\.com/iu.test(updateLink) || /\/releases\//iu.test(updateLink)) {
    throw new Error('GitHub Release download is not authorized; pass a local XPI path');
  }
  const document = {
    addons: {
      [manifest.id]: {
        updates: [
          {
            version: manifest.version,
            update_link: updateLink,
            update_hash: `sha256:${digest}`,
            applications: {
              zotero: {
                strict_min_version: manifest.min,
                strict_max_version: manifest.max,
              },
            },
          },
        ],
      },
    },
  };
  await writeFile(output, `${JSON.stringify(document, null, 2)}\n`);
  return { ok: true, addonId: manifest.id, version: manifest.version, updateLink, updateHash: `sha256:${digest}` };
}

export async function writeBuildInfo(archivePath, outputPath) {
  requireNode24();
  const local = requireLocalXpi(archivePath);
  await stat(local);
  const output = path.resolve(outputPath);
  assertIsolatedRoot(path.dirname(output));
  const manifest = await readManifest(local);
  const recorded = JSON.parse((await readArchiveEntry(local, 'content/runtime/manifest.json')).toString('utf8'));
  const runtimes = (Array.isArray(recorded) ? recorded : [recorded]).map(({ platform, architecture, codexVersion, sha256 }) => ({ platform, architecture, codexVersion, sha256 }));
  const info = {
    addonId: manifest.id,
    version: manifest.version,
    sha256: await sha256File(local),
    platform: runtimes.length === 1 ? runtimes[0].platform : 'multi',
    architecture: runtimes.length === 1 ? runtimes[0].architecture : 'multi',
    codexVersion: runtimes[0].codexVersion,
    runtimes,
    source: 'local-xpi',
    updateChannel: 'none',
    githubRelease: null,
  };
  await writeFile(output, `${JSON.stringify(info, null, 2)}\n`);
  return { ok: true, ...info };
}

function jsonMode() {
  return process.argv.includes('--json');
}

async function currentPs() {
  const { execFileSync } = await import('node:child_process');
  return execFileSync('ps', ['-axo', 'args='], { encoding: 'utf8' });
}

function emit(result, fallback) {
  if (jsonMode()) process.stdout.write(`${JSON.stringify(result)}\n`);
  else console.log(fallback);
}

async function main() {
  requireNode24();
  const command = process.argv[2];
  const root = readOption('--root');
  const xpi = readRawOption('--xpi');
  const data = readOption('--data');
  const destination = readOption('--out');
  const sums = readOption('--sums');
  const entry = readRawOption('--entry');
  if (command === 'prepare') {
    if (!root || !xpi) throw new Error('prepare requires --root and --xpi');
    const result = await prepareCleanProfile({ root, dataDir: data, xpi });
    emit(result, `Prepared clean profile ${result.profile} with ${result.version}`);
    return;
  }
  if (command === 'seed-records') {
    if (!root) throw new Error('seed-records requires --root');
    const raw = readRawOption('--conversation');
    if (!raw) throw new Error('seed-records requires --conversation');
    const result = await seedRecords(root, JSON.parse(raw));
    emit(result, `Seeded ${result.records.length} conversation file(s)`);
    return;
  }
  if (command === 'upgrade' || command === 'rollback') {
    if (!root || !xpi) throw new Error(`${command} requires --root and --xpi`);
    const result = await replaceInstalledXpi(root, xpi, await currentPs());
    emit(result, `${command} now ${result.version}`);
    return;
  }
  if (command === 'extract') {
    if (!xpi || !destination) throw new Error('extract requires --xpi and --out');
    const result = await extractXpi(xpi, destination, entry);
    emit(result, `Extracted ${result.files.length} file(s) to ${destination}`);
    return;
  }
  if (command === 'updates-json') {
    if (!xpi || !sums || !destination) throw new Error('updates-json requires --xpi, --sums and --out');
    const result = await writeUpdatesJson(xpi, sums, destination);
    emit(result, `Wrote ${destination} for ${result.version}`);
    return;
  }
  if (command === 'build-info') {
    if (!xpi || !destination) throw new Error('build-info requires --xpi and --out');
    const result = await writeBuildInfo(xpi, destination);
    emit(result, `Wrote ${destination} for ${result.version}`);
    return;
  }
  throw new Error(`Unknown command: ${command ?? '(missing)'}`);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
