import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const script = path.join(repositoryRoot, 'scripts/install-lifecycle.mjs');
const subjectID = '{90909501-7b5b-4985-9f55-566e9890746c}';
const currentManifest = JSON.parse(readFileSync(path.join(repositoryRoot, 'packages/zotero/manifest.json'), 'utf8')) as { version: string };
const packagedXpi = path.join(repositoryRoot, `dist/zotero-chatgpt-${currentManifest.version}-dev.xpi`);
const packagedXpiPresent = existsSync(packagedXpi);
const temporaryDirectories: string[] = [];
let fixtureSource = '';

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'zchatgpt-install-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

function failureMessage(error: unknown): string {
  if (error instanceof Error && 'stderr' in error && typeof error.stderr === 'string' && error.stderr.trim()) return error.stderr;
  if (error instanceof Error && 'stdout' in error && typeof error.stdout === 'string' && error.stdout.trim()) return error.stdout;
  if (error instanceof Error) return error.message;
  return String(error);
}

async function run(args: string[], cwd = repositoryRoot): Promise<Record<string, unknown>> {
  const { stdout } = await execFileAsync(process.execPath, [script, ...args, '--json'], { cwd });
  return JSON.parse(stdout) as Record<string, unknown>;
}

async function packageFixture(sourceDirectory: string, archivePath: string, version: string): Promise<string> {
  const manifestPath = path.join(sourceDirectory, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { version: string };
  manifest.version = version;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await execFileAsync(process.execPath, ['tests/runtime/package-fixture.mjs', 'package', '--source', sourceDirectory, '--output', archivePath], { cwd: repositoryRoot });
  return archivePath;
}

beforeAll(async () => {
  fixtureSource = await makeTemporaryDirectory();
  await execFileAsync(process.execPath, ['tests/runtime/package-fixture.mjs', 'build', '--outdir', fixtureSource], { cwd: repositoryRoot });
});

afterAll(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })));
});

afterEach(async () => {
  const extras = temporaryDirectories.splice(1);
  await Promise.all(extras.map(directory => rm(directory, { force: true, recursive: true })));
});

describe('clean-environment install layout', () => {
  it('refuses the user regular Zotero profile directory', async () => {
    const regular = path.join(tmpdir(), 'Library/Application Support/Zotero/Profiles/aaaa1111.default');
    await mkdir(regular, { recursive: true });
    temporaryDirectories.push(regular);
    await expect(run(['prepare', '--root', regular, '--xpi', path.join(fixtureSource, 'missing.xpi')])).rejects.toSatisfy((error: unknown) => /regular Zotero profile/i.test(failureMessage(error)));
  });

  it('refuses the signed-in .zotero-chatgpt-dev/profile tree', async () => {
    const signedIn = path.join(repositoryRoot, '.zotero-chatgpt-dev/profile');
    await expect(run(['prepare', '--root', signedIn, '--xpi', path.join(fixtureSource, 'missing.xpi')])).rejects.toSatisfy((error: unknown) => /signed-in development profile/i.test(failureMessage(error)));
  });

  it('lets dedicated host restage write the signed-in tree while still refusing a regular profile', async () => {
    const lifecycle = pathToFileURL(script).href;
    const signedIn = path.join(repositoryRoot, '.zotero-chatgpt-dev/profile');
    const { stdout } = await execFileAsync(process.execPath, [
      '--input-type=module',
      '-e',
      `import { assertNotRegularProfile, assertIsolatedRoot } from ${JSON.stringify(lifecycle)};
       console.log(assertNotRegularProfile(${JSON.stringify(signedIn)}));
       try { assertIsolatedRoot(${JSON.stringify(signedIn)}); console.log('isolated-allowed'); }
       catch (error) { console.log(error instanceof Error ? error.message : String(error)); }`,
    ], { cwd: repositoryRoot });
    const lines = stdout.trim().split('\n');
    expect(lines[0]).toBe(path.resolve(signedIn));
    expect(lines[1]).toMatch(/signed-in development profile/i);
    await expect(execFileAsync(process.execPath, [
      '--input-type=module',
      '-e',
      `import { assertNotRegularProfile } from ${JSON.stringify(lifecycle)};
       assertNotRegularProfile(${JSON.stringify(path.join(tmpdir(), 'Library/Application Support/Zotero/Profiles/aaaa1111.default'))});`,
    ], { cwd: repositoryRoot })).rejects.toSatisfy((error: unknown) => /regular Zotero profile/i.test(failureMessage(error)));
  });

  it('installs one XPI into a virgin profile without records or Node runtimes', async () => {
    const root = await makeTemporaryDirectory();
    const archivePath = path.join(root, 'plugin.xpi');
    await packageFixture(fixtureSource, archivePath, '0.3.0a1');
    const result = await run(['prepare', '--root', path.join(root, 'profile'), '--data', path.join(root, 'data'), '--xpi', archivePath]);
    expect(result.ok).toBe(true);
    expect(result.addonId).toBe(subjectID);
    expect(result.version).toBe('0.3.0a1');
    const installed = await readFile(path.join(root, 'profile/extensions', `${subjectID}.xpi`));
    expect(createHash('sha256').update(installed).digest('hex')).toBe(result.sha256);
    const prefs = await readFile(path.join(root, 'profile/user.js'), 'utf8');
    expect(prefs).toContain(path.join(root, 'data'));
    expect(prefs).toContain('extensions.zotero.useDataDir');
    await expect(readFile(path.join(root, 'profile/zotero-chatgpt/v1/records/conversations/none.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(result.records).toEqual([]);
    expect(result.nodeRuntimePresent).toBe(false);
  });
});

describe('upgrade and rollback without a GitHub download', () => {
  const conversation = {
    schemaVersion: 1,
    logSeq: 0,
    id: '11111111-0000-4000-8000-000000000001',
    paper: { clientId: '22222222-0000-4000-8000-000000000002', libraryId: 1, attachmentKey: 'PDFONE01' },
    title: 'Synthetic paper A',
    settings: { model: 'catalog-default', serviceTier: null, effort: 'low' },
    activeRequestId: null,
    messages: [],
    lastSeq: 0,
    createdAt: '2026-09-09T08:00:00.000Z',
    updatedAt: '2026-09-09T08:00:00.000Z',
    upstream: { threadId: null },
    requests: [],
  };

  it('replaces the XPI and keeps conversation records', async () => {
    const root = await makeTemporaryDirectory();
    const older = path.join(root, 'older.xpi');
    const newer = path.join(root, 'newer.xpi');
    await packageFixture(fixtureSource, older, '0.3.0a1');
    await packageFixture(fixtureSource, newer, '0.3.0a2');
    const profile = path.join(root, 'profile');
    await run(['prepare', '--root', profile, '--data', path.join(root, 'data'), '--xpi', older]);
    await run(['seed-records', '--root', profile, '--conversation', JSON.stringify(conversation)]);
    const before = await readFile(path.join(profile, 'zotero-chatgpt/v1/records/conversations', `${conversation.id}.json`));
    const upgraded = await run(['upgrade', '--root', profile, '--xpi', newer]);
    expect(upgraded.previousVersion).toBe('0.3.0a1');
    expect(upgraded.version).toBe('0.3.0a2');
    expect(upgraded.sameAddonId).toBe(true);
    expect(await readFile(path.join(profile, 'zotero-chatgpt/v1/records/conversations', `${conversation.id}.json`))).toEqual(before);
  });

  it('rolls the previous XPI back without deleting records', async () => {
    const root = await makeTemporaryDirectory();
    const older = path.join(root, 'older.xpi');
    const newer = path.join(root, 'newer.xpi');
    await packageFixture(fixtureSource, older, '0.3.0a1');
    await packageFixture(fixtureSource, newer, '0.3.0a2');
    const profile = path.join(root, 'profile');
    await run(['prepare', '--root', profile, '--data', path.join(root, 'data'), '--xpi', older]);
    await run(['seed-records', '--root', profile, '--conversation', JSON.stringify(conversation)]);
    const originalDigest = createHash('sha256').update(await readFile(older)).digest('hex');
    await run(['upgrade', '--root', profile, '--xpi', newer]);
    const rolled = await run(['rollback', '--root', profile, '--xpi', older]);
    expect(rolled.version).toBe('0.3.0a1');
    expect(rolled.sha256).toBe(originalDigest);
    expect(rolled.records).toEqual([`${conversation.id}.json`]);
  });

  it('detects a busy dedicated profile from process listings', async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      '--input-type=module',
      '-e',
      `import { profileIsBusy } from ${JSON.stringify(pathToFileURL(script).href)};
       const profile = '/tmp/zchatgpt-clean/profile';
       const busy = '123 /Applications/Zotero.app/Contents/MacOS/zotero -no-remote -profile /tmp/zchatgpt-clean/profile -datadir /tmp/zchatgpt-clean/data';
       const idle = '64338 /Applications/Zotero.app/Contents/MacOS/zotero';
       console.log(JSON.stringify({ busy: profileIsBusy(busy, profile), idle: profileIsBusy(idle, profile) }));`,
    ], { cwd: repositoryRoot });
    expect(JSON.parse(stdout)).toEqual({ busy: true, idle: false });
  });

  it('refuses to replace the XPI while that dedicated profile is busy', async () => {
    const root = await makeTemporaryDirectory();
    const older = path.join(root, 'older.xpi');
    const newer = path.join(root, 'newer.xpi');
    await packageFixture(fixtureSource, older, '0.3.0a1');
    await packageFixture(fixtureSource, newer, '0.3.0a2');
    const profile = path.join(root, 'profile');
    await run(['prepare', '--root', profile, '--data', path.join(root, 'data'), '--xpi', older]);
    await expect(execFileAsync(process.execPath, [
      '--input-type=module',
      '-e',
      `import { replaceInstalledXpi } from ${JSON.stringify(pathToFileURL(script).href)};
       const profile = ${JSON.stringify(profile)};
       const busy = '123 /Applications/Zotero.app/Contents/MacOS/zotero -no-remote -profile ' + profile;
       await replaceInstalledXpi(profile, ${JSON.stringify(newer)}, busy);`,
    ], { cwd: repositoryRoot })).rejects.toSatisfy((error: unknown) => /Close the dedicated Zotero/i.test(failureMessage(error)));
  });
});

describe('isolated data directory and local-only XPI sources', () => {
  it('refuses the signed-in .zotero-chatgpt-dev/data directory', async () => {
    const root = await makeTemporaryDirectory();
    const archivePath = path.join(root, 'plugin.xpi');
    await packageFixture(fixtureSource, archivePath, '0.3.0a1');
    await expect(run(['prepare', '--root', path.join(root, 'profile'), '--data', path.join(repositoryRoot, '.zotero-chatgpt-dev/data'), '--xpi', archivePath])).rejects.toSatisfy((error: unknown) => /signed-in development data directory/i.test(failureMessage(error)));
  });

  it('installs into a .zotero-chatgpt-dev/clean tree without touching the signed-in profile', async () => {
    const clean = path.join(repositoryRoot, '.zotero-chatgpt-dev/clean', path.basename(await makeTemporaryDirectory()));
    temporaryDirectories.push(clean);
    const archivePath = path.join(clean, 'plugin.xpi');
    await mkdir(clean, { recursive: true });
    await packageFixture(fixtureSource, archivePath, '0.3.0a1');
    const result = await run(['prepare', '--root', path.join(clean, 'profile'), '--data', path.join(clean, 'data'), '--xpi', archivePath]);
    expect(result.ok).toBe(true);
    expect(result.profile).toBe(path.join(clean, 'profile'));
    expect(result.dataDir).toBe(path.join(clean, 'data'));
  });

  it('refuses a GitHub Release download URL in place of a local XPI', async () => {
    const root = await makeTemporaryDirectory();
    await expect(run(['prepare', '--root', path.join(root, 'profile'), '--xpi', 'https://github.com/example/zotero-chatgpt/releases/download/v0.1.0/plugin.xpi'])).rejects.toSatisfy((error: unknown) => /GitHub Release download is not authorized/i.test(failureMessage(error)));
  });

  it('refuses a remote https XPI URL', async () => {
    const root = await makeTemporaryDirectory();
    await expect(run(['prepare', '--root', path.join(root, 'profile'), '--xpi', 'https://example.com/plugin.xpi'])).rejects.toSatisfy((error: unknown) => /GitHub Release download is not authorized|local XPI path/i.test(failureMessage(error)));
  });
});

describe('path-safe extract and local updates.json', () => {
  it('extracts bootstrap and the runtime into a directory with spaces and 中文', async () => {
    const root = await makeTemporaryDirectory();
    const archivePath = path.join(root, 'plugin.xpi');
    await packageFixture(fixtureSource, archivePath, '0.3.0a1');
    const destination = path.join(root, 'install path', '中文目录');
    const result = await run(['extract', '--xpi', archivePath, '--out', destination]);
    expect(result.ok).toBe(true);
    expect(result.bootstrap).toBe(true);
    expect(result.manifest).toBe(true);
    await stat(path.join(destination, 'bootstrap.js'));
    await stat(path.join(destination, 'manifest.json'));
    expect(await readFile(path.join(destination, 'content/runtime/codex-aarch64-apple-darwin'), 'utf8')).toBe('abc');
    expect(result.nodeRuntimePresent).toBe(false);
  });

  it('writes updates.json from a local XPI and SHA256SUMS without a GitHub Release URL', async () => {
    const root = await makeTemporaryDirectory();
    const archivePath = path.join(root, 'zotero-chatgpt-0.3.0a1-dev.xpi');
    await packageFixture(fixtureSource, archivePath, '0.3.0a1');
    const digest = createHash('sha256').update(await readFile(archivePath)).digest('hex');
    const sums = path.join(root, 'SHA256SUMS');
    await writeFile(sums, `${digest}  zotero-chatgpt-0.3.0a1-dev.xpi\n`);
    const output = path.join(root, 'updates.json');
    const result = await run(['updates-json', '--xpi', archivePath, '--sums', sums, '--out', output]);
    expect(result.ok).toBe(true);
    const document = JSON.parse(await readFile(output, 'utf8')) as {
      addons: Record<string, { updates: Array<{ version: string; update_link: string; update_hash: string; applications: { zotero: { strict_min_version: string; strict_max_version: string } } }> }>;
    };
    const update = document.addons[subjectID]?.updates[0];
    expect(update).toEqual({
      version: '0.3.0a1',
      update_link: 'https://zotero-chatgpt-dev.invalid/zotero-chatgpt-0.3.0a1-dev.xpi',
      update_hash: `sha256:${digest}`,
      applications: { zotero: { strict_min_version: '9.0.6', strict_max_version: '10.0.*' } },
    });
    expect(update?.update_link).not.toMatch(/github\.com/i);
    expect(result.updateLink).toBe(update?.update_link);
  });

  it('writes local build-info.json without a GitHub Release URL', async () => {
    const root = await makeTemporaryDirectory();
    const archivePath = path.join(root, 'zotero-chatgpt-0.3.0a1-dev.xpi');
    await packageFixture(fixtureSource, archivePath, '0.3.0a1');
    const digest = createHash('sha256').update(await readFile(archivePath)).digest('hex');
    const output = path.join(root, 'build-info.json');
    const result = await run(['build-info', '--xpi', archivePath, '--out', output]);
    expect(result.ok).toBe(true);
    const info = JSON.parse(await readFile(output, 'utf8')) as Record<string, unknown>;
    expect(info.addonId).toBe(subjectID);
    expect(info.version).toBe('0.3.0a1');
    expect(info.sha256).toBe(digest);
    expect(info.platform).toBe('multi');
    expect(info.runtimes).toEqual([expect.objectContaining({ platform: 'darwin', architecture: 'arm64' }), expect.objectContaining({ platform: 'linux', architecture: 'x64' })]);
    expect(info.architecture).toBe('multi');
    expect(info.githubRelease).toBeNull();
    expect(info.updateChannel).toBe('none');
    expect(info.source).toBe('local-xpi');
  });
});

describe('packaged development XPI without rebuilding', () => {
  it.skipIf(!packagedXpiPresent)('copies the existing packaged XPI into a virgin isolated tree', async () => {
    const root = await makeTemporaryDirectory();
    const result = await run(['prepare', '--root', path.join(root, 'profile'), '--data', path.join(root, 'data'), '--xpi', packagedXpi]);
    expect(result.ok).toBe(true);
    expect(result.version).toBe(currentManifest.version);
    expect(result.records).toEqual([]);
    const expected = (await readFile(path.join(repositoryRoot, 'dist/SHA256SUMS'), 'utf8')).slice(0, 64);
    expect(result.sha256).toBe(expected);
  });

  it.skipIf(!packagedXpiPresent || process.platform !== 'darwin')('verifies the Apple signature of the Codex binary inside the existing XPI', async () => {
    const root = await makeTemporaryDirectory();
    const destination = path.join(root, 'extracted runtime');
    const result = await run(['extract', '--xpi', packagedXpi, '--out', destination, '--entry', 'content/runtime/codex-aarch64-apple-darwin']);
    expect(result.ok).toBe(true);
    const binary = path.join(destination, 'content/runtime/codex-aarch64-apple-darwin');
    await execFileAsync('/usr/bin/codesign', ['--verify', '--strict', binary]);
  });
});

describe('npm verify:install entry', () => {
  it('runs the lifecycle CLI through npm run verify:install', async () => {
    const root = await makeTemporaryDirectory();
    const archivePath = path.join(root, 'plugin.xpi');
    await packageFixture(fixtureSource, archivePath, '0.3.0a1');
    const { stdout } = await execFileAsync('npm', ['run', 'verify:install', '--', 'prepare', '--root', path.join(root, 'profile'), '--data', path.join(root, 'data'), '--xpi', archivePath, '--json'], { cwd: repositoryRoot });
    const line = stdout.trim().split('\n').at(-1) ?? '';
    const result = JSON.parse(line) as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(result.version).toBe('0.3.0a1');
  });
});
