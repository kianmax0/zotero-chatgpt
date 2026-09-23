import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import yauzl from 'yauzl';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const stageModule = pathToFileURL(path.join(repositoryRoot, 'scripts/host-test-stage.mjs')).href;

async function prepareScriptSandbox(): Promise<{ root: string; script: string; xpi: string }> {
  const root = await mkdtemp(path.join(repositoryRoot, '.zotero-chatgpt-dev/prepare-host-test-'));
  await Promise.all([
    mkdir(path.join(root, 'scripts'), { recursive: true }),
    mkdir(path.join(root, 'tests/fixtures'), { recursive: true }),
    mkdir(path.join(root, 'tests/host'), { recursive: true }),
    mkdir(path.join(root, 'packages/zotero'), { recursive: true }),
    mkdir(path.join(root, 'runtime'), { recursive: true }),
  ]);
  await Promise.all([
    ...['prepare-host-test.mjs', 'host-test-stage.mjs', 'install-lifecycle.mjs', 'runtime-assets.mjs']
      .map(file => cp(path.join(repositoryRoot, 'scripts', file), path.join(root, 'scripts', file))),
    cp(path.join(repositoryRoot, 'tests/fixtures/create-pdf.mjs'), path.join(root, 'tests/fixtures/create-pdf.mjs')),
    cp(path.join(repositoryRoot, 'tests/host/context-driver.js'), path.join(root, 'tests/host/context-driver.js')),
    cp(path.join(repositoryRoot, 'tests/host/live-core-driver.js'), path.join(root, 'tests/host/live-core-driver.js')),
    cp(path.join(repositoryRoot, 'tests/host/recover-organization-driver.js'), path.join(root, 'tests/host/recover-organization-driver.js')),
    cp(path.join(repositoryRoot, 'tests/host/web-resume-driver.js'), path.join(root, 'tests/host/web-resume-driver.js')),
    cp(path.join(repositoryRoot, 'tests/host/embed-driver.js'), path.join(root, 'tests/host/embed-driver.js')),
    cp(path.join(repositoryRoot, 'tests/host/web-acceptance-actor.mjs'), path.join(root, 'tests/host/web-acceptance-actor.mjs')),
    cp(path.join(repositoryRoot, 'runtime/manifest.ts'), path.join(root, 'runtime/manifest.ts')),
    writeFile(path.join(root, 'packages/zotero/manifest.json'), JSON.stringify({ version: '0.0.0-test' })),
    writeFile(path.join(root, 'subject.xpi'), 'synthetic test artifact'),
  ]);
  return { root, script: path.join(root, 'scripts/prepare-host-test.mjs'), xpi: path.join(root, 'subject.xpi') };
}

async function readArchiveEntry(filePath: string, entryName: string): Promise<string> {
  const zipFile = await yauzl.openPromise(filePath);
  for await (const entry of zipFile.eachEntry()) {
    if (entry.fileName !== entryName) continue;
    const chunks: Buffer[] = [];
    const stream = await zipFile.openReadStreamPromise(entry);
    for await (const chunk of stream as AsyncIterable<Buffer>) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
  }
  throw new Error(`Missing archive entry ${entryName}`);
}

async function listArchiveEntries(filePath: string): Promise<string[]> {
  const zipFile = await yauzl.openPromise(filePath);
  const entries: string[] = [];
  for await (const entry of zipFile.eachEntry()) entries.push(entry.fileName);
  return entries;
}

async function select(argv: string[]): Promise<{ stage: string; driver: string | null; installDriver: boolean }> {
  const { stdout } = await execFileAsync(process.execPath, [
    '--input-type=module',
    '-e',
    `import { selectHostStage } from ${JSON.stringify(stageModule)}; console.log(JSON.stringify(selectHostStage(${JSON.stringify(argv)})));`,
  ], { cwd: repositoryRoot });
  return JSON.parse(stdout) as { stage: string; driver: string | null; installDriver: boolean };
}

async function selectTree(argv: string[], root = repositoryRoot): Promise<{ stage: string; profile: string; dataDir: string; reportPath: string; pdfPath: string; cleanRuntimeTree?: boolean; exclusiveRoot?: string; reuseExisting?: boolean; supplementPdfPath?: string }> {
  const { stdout } = await execFileAsync(process.execPath, [
    '--input-type=module',
    '-e',
    `import { selectHostTree } from ${JSON.stringify(stageModule)}; console.log(JSON.stringify(selectHostTree(${JSON.stringify(argv)}, ${JSON.stringify(root)})));`,
  ], { cwd: repositoryRoot });
  return JSON.parse(stdout) as { stage: string; profile: string; dataDir: string; reportPath: string; pdfPath: string; cleanRuntimeTree?: boolean; exclusiveRoot?: string; reuseExisting?: boolean; supplementPdfPath?: string };
}

function failureMessage(error: unknown): string {
  if (error instanceof Error && 'stderr' in error && typeof error.stderr === 'string') return error.stderr;
  if (error instanceof Error) return error.message;
  return String(error);
}

describe('dedicated host-test stage selection', () => {
  it('preserves existing private runtime records and account files during routine context preparation', async () => {
    const sandbox = await prepareScriptSandbox();
    const runtimeRoot = path.join(sandbox.root, '.zotero-chatgpt-dev/context/profile/zotero-chatgpt');
    const recordPath = path.join(runtimeRoot, 'v1/records/conversations/prior.json');
    const accountPath = path.join(runtimeRoot, 'v1/account/private.bin');
    const dataPath = path.join(sandbox.root, '.zotero-chatgpt-dev/context/data/prior-library.bin');
    try {
      await Promise.all([
        mkdir(path.dirname(recordPath), { recursive: true }),
        mkdir(path.dirname(accountPath), { recursive: true }),
        mkdir(path.dirname(dataPath), { recursive: true }),
      ]);
      await Promise.all([
        writeFile(recordPath, 'prior conversation bytes'),
        writeFile(accountPath, 'private account bytes'),
        writeFile(dataPath, 'prior library bytes'),
      ]);

      await execFileAsync(process.execPath, [sandbox.script, '--context', '--acceptance', sandbox.xpi], { cwd: sandbox.root });

      expect(await readFile(recordPath, 'utf8')).toBe('prior conversation bytes');
      expect((await stat(accountPath)).size).toBe(Buffer.byteLength('private account bytes'));
      expect(await readFile(dataPath, 'utf8')).toBe('prior library bytes');
    } finally {
      await rm(sandbox.root, { recursive: true, force: true });
    }
  });

  it('maps an explicit run id to a verified-new context tree below the development root', async () => {
    const tree = await selectTree(['--context', '--run-id', 'lazy-runtime-a18']);
    const runRoot = path.join(repositoryRoot, '.zotero-chatgpt-dev/context-runs/lazy-runtime-a18');
    expect(tree).toMatchObject({
      stage: 'context',
      profile: path.join(runRoot, 'profile'),
      dataDir: path.join(runRoot, 'data'),
      reportPath: path.join(runRoot, 'host-report.json'),
      pdfPath: path.join(runRoot, 'fixtures/reading.pdf'),
      cleanRuntimeTree: true,
      exclusiveRoot: runRoot,
    });
  });

  it('rejects unsafe or ambiguous run ids and mode combinations', async () => {
    await expect(select(['--context', '--run-id', '../escape'])).rejects.toThrow(/safe lowercase identifier/u);
    await expect(select(['--context', '--run-id', 'UPPER'])).rejects.toThrow(/safe lowercase identifier/u);
    await expect(select(['--run-id', 'clean'])).rejects.toThrow(/requires --context/u);
    await expect(select(['--context', '--live', '--run-id', 'clean'])).rejects.toThrow(/cannot be combined with --live/u);
  });

  it('refuses to prepare a named new context tree that already exists without changing it', async () => {
    const sandbox = await prepareScriptSandbox();
    const runRoot = path.join(sandbox.root, '.zotero-chatgpt-dev/context-runs/already-there');
    const sentinel = path.join(runRoot, 'ownership-unknown.bin');
    try {
      await mkdir(runRoot, { recursive: true });
      await writeFile(sentinel, 'do not overwrite');

      await expect(execFileAsync(process.execPath, [
        sandbox.script,
        '--context',
        '--acceptance',
        '--run-id',
        'already-there',
        sandbox.xpi,
      ], { cwd: sandbox.root })).rejects.toSatisfy((error: unknown) => /already exists; choose a new --run-id/u.test(failureMessage(error)));

      expect(await readFile(sentinel, 'utf8')).toBe('do not overwrite');
    } finally {
      await rm(sandbox.root, { recursive: true, force: true });
    }
  });

  it('gives each prepared context run a fresh PDF token and passes that exact token to the driver', async () => {
    const sandbox = await prepareScriptSandbox();
    try {
      const observed: string[] = [];
      for (const runId of ['token-one', 'token-two']) {
        await execFileAsync(process.execPath, [sandbox.script, '--context', '--run-id', runId, sandbox.xpi], { cwd: sandbox.root });
        const runRoot = path.join(sandbox.root, '.zotero-chatgpt-dev/context-runs', runId);
        const pdf = (await readFile(path.join(runRoot, 'fixtures/reading.pdf'))).toString('latin1');
        const token = /Hidden verification token on this page: (RUN-[a-f0-9]{24})\./u.exec(pdf)?.[1];
        expect(token).toMatch(/^RUN-[a-f0-9]{24}$/u);
        const driverXpi = path.join(runRoot, 'profile/extensions/zchatgpt-host-test@local.xpi');
        const bootstrap = await readArchiveEntry(driverXpi, 'bootstrap.js');
        const driverSource = await readArchiveEntry(driverXpi, 'driver.js');
        const driverManifest = JSON.parse(await readArchiveEntry(driverXpi, 'manifest.json')) as { version: string };
        const driverSourceHash = createHash('sha256').update(driverSource).digest('hex');
        expect(bootstrap).toContain(`"verificationToken":"${token}"`);
        expect(bootstrap).toContain('loadSubScriptWithOptions');
        expect(bootstrap).toContain('ignoreCache: true');
        expect(bootstrap).toContain(`"driverSourceHash":"${driverSourceHash}"`);
        expect(driverManifest.version).toMatch(/^0\.0\.[1-9][0-9]*$/u);
        expect(driverManifest.version).not.toBe('0.0.1');
        observed.push(token!);
      }
      expect(new Set(observed).size).toBe(2);
    } finally {
      await rm(sandbox.root, { recursive: true, force: true });
    }
  });

  it('isolates full-PDF host validation from every existing profile', async () => {
    await expect(select(['--context'])).resolves.toMatchObject({ stage: 'context', driver: 'tests/host/context-driver.js' });
    const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', `import { selectHostTree } from ${JSON.stringify(stageModule)}; console.log(JSON.stringify(selectHostTree(['--context'], ${JSON.stringify(repositoryRoot)})));`]);
    expect((JSON.parse(stdout) as { profile: string }).profile).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/context/profile'));
  });
  it('can stage the context profile for human use without auto-running tests', async () => {
    await expect(select(['--context', '--acceptance'])).resolves.toEqual({ stage: 'context', driver: null, installDriver: false });
  });
  it('requires the dedicated context driver for live model checks', async () => {
    await expect(select(['--live'])).rejects.toThrow();
    await expect(select(['--context', '--acceptance', '--live'])).rejects.toThrow();
    await expect(select(['--context', '--live'])).resolves.toMatchObject({ stage: 'context', installDriver: true });
  });

  it('gates installed-XPI live core flows behind explicit live mode and a bounded login wait', async () => {
    await expect(select(['--context', '--live', '--live-core-flows', '--login-wait-seconds', '900'])).resolves.toMatchObject({ stage: 'context', driver: 'tests/host/context-driver.js', installDriver: true });
    await expect(select(['--context', '--live-core-flows'])).rejects.toThrow(/requires --context --live/u);
    await expect(select(['--context', '--live', '--login-wait-seconds', '30'])).rejects.toThrow(/requires --live-core-flows/u);
    await expect(select(['--context', '--live', '--live-core-flows', '--login-wait-seconds', '3601'])).rejects.toThrow(/between 0 and 3600/u);
  });

  it('stages live core checks in an existing named test profile without touching its saved account or preferences', async () => {
    const args = ['--context', '--live', '--live-core-flows', '--reuse-run-id', 'signed-test', '--report-id', 'sol-check'];
    await expect(select(args)).resolves.toMatchObject({ stage: 'context', installDriver: true });
    const tree = await selectTree(args);
    expect(tree.reuseExisting).toBe(true);
    expect(tree.reportPath).toMatch(/signed-test\/host-live-sol-check\.json$/u);
    await expect(select(['--context', '--live', '--reuse-run-id', 'signed-test', '--report-id', 'sol-check'])).rejects.toThrow(/requires --live-core or --context --live --live-core-flows/u);
    const focused = await selectTree(['--live-core', '--reuse-run-id', 'signed-test', '--report-id', 'focused-sol']);
    expect(focused).toMatchObject({ reuseExisting: true, profile: tree.profile, reportPath: path.join(repositoryRoot, '.zotero-chatgpt-dev/context-runs/signed-test/host-live-focused-sol.json') });
    await expect(select([...args, '--run-id', 'other'])).rejects.toThrow();
    await expect(select(['--context', '--live', '--live-core-flows', '--report-id', 'sol-check'])).rejects.toThrow(/requires --reuse-run-id/u);
    const sandbox = await prepareScriptSandbox();
    const profile = path.join(sandbox.root, '.zotero-chatgpt-dev/context-runs/signed-test/profile');
    const data = path.join(sandbox.root, '.zotero-chatgpt-dev/context-runs/signed-test/data');
    const installed = path.join(profile, 'extensions/{90909501-7b5b-4985-9f55-566e9890746c}.xpi');
    const preference = path.join(profile, 'user.js');
    const account = path.join(profile, 'zotero-chatgpt/v1/account/sentinel.bin');
    try {
      await Promise.all([mkdir(path.dirname(installed), { recursive: true }), mkdir(data, { recursive: true }), mkdir(path.dirname(account), { recursive: true })]);
      await Promise.all([cp(sandbox.xpi, installed), writeFile(preference, 'existing preferences'), writeFile(account, 'unchanged synthetic sentinel')]);
      await execFileAsync(process.execPath, [sandbox.script, ...args, sandbox.xpi], { cwd: sandbox.root });
      expect(await readFile(preference, 'utf8')).toBe('existing preferences');
      expect(await readFile(account, 'utf8')).toBe('unchanged synthetic sentinel');
      expect(await readFile(installed, 'utf8')).toBe('synthetic test artifact');
      const driverXpi = path.join(profile, 'extensions/zchatgpt-host-test@local.xpi');
      const bootstrap = await readArchiveEntry(driverXpi, 'bootstrap.js');
      expect(bootstrap).toContain('"liveCoreFlows":true');
      expect(bootstrap).toContain('host-live-sol-check.json');
      expect(bootstrap).toContain('live-reading-sol-check.pdf');
    } finally { await rm(sandbox.root, { recursive: true, force: true }); }
  });

  it('selects a minimal live-core rerun on the preserved context tree', async () => {
    await expect(select(['--live-core', '--login-wait-seconds', '900'])).resolves.toEqual({ stage: 'live-core', driver: 'tests/host/live-core-driver.js', installDriver: true });
    const tree = await selectTree(['--live-core', '--login-wait-seconds', '900']);
    expect(tree.profile).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/context/profile'));
    expect(tree.dataDir).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/context/data'));
    await expect(select(['--live-core', '--context'])).rejects.toThrow(/only one/u);
    await expect(select(['--live-core', '--acceptance'])).rejects.toThrow();
  });

  it('packages live-core as an explicit two-turn driver without clearing the context tree', async () => {
    const sandbox = await prepareScriptSandbox();
    try {
      await execFileAsync(process.execPath, [sandbox.script, '--live-core', '--login-wait-seconds', '900', sandbox.xpi], { cwd: sandbox.root });
      const driverXpi = path.join(sandbox.root, '.zotero-chatgpt-dev/context/profile/extensions/zchatgpt-host-test@local.xpi');
      const bootstrap = await readArchiveEntry(driverXpi, 'bootstrap.js'); const driver = await readArchiveEntry(driverXpi, 'driver.js');
      expect(bootstrap).toContain('"live":true'); expect(bootstrap).toContain('"liveCoreFlows":true'); expect(bootstrap).toContain('"loginWaitSeconds":900');
      expect(driver).toContain("stage: 'live-core'"); expect(driver).toContain('modelTurnsAuthorized: 2');
    } finally { await rm(sandbox.root, { recursive: true, force: true }); }
  });

  it('selects a zero-model organization recovery with explicit stored identities', async () => {
    const argv = ['--recover-organization', '63696cbf-01e2-46b6-be36-2f539813e656', '--request-id', '04e67795-84e6-4fa3-b4fb-e4d16bc52812', '--expected-token', 'RUN-9215a529dbec36ea9698a1fc', '--origin-version', '0.4.0a25'];
    await expect(select(argv)).resolves.toEqual({ stage: 'recover-organization', driver: 'tests/host/recover-organization-driver.js', installDriver: true });
    const tree = await selectTree(argv);
    expect(tree.profile).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/context/profile'));
    expect(tree.dataDir).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/context/data'));
    await expect(select(['--recover-organization', 'not-a-uuid', '--request-id', argv[3]!, '--expected-token', argv[5]!])).rejects.toThrow(/valid conversation UUID/u);
    await expect(select(['--recover-organization', argv[1]!, '--request-id', argv[3]!])).rejects.toThrow(/expected-token/u);
  });

  it('packages organization recovery without injecting a new PDF fixture', async () => {
    const sandbox = await prepareScriptSandbox(); const argv = ['--recover-organization', '63696cbf-01e2-46b6-be36-2f539813e656', '--request-id', '04e67795-84e6-4fa3-b4fb-e4d16bc52812', '--expected-token', 'RUN-9215a529dbec36ea9698a1fc', '--origin-version', '0.4.0a25'];
    try {
      await execFileAsync(process.execPath, [sandbox.script, ...argv, sandbox.xpi], { cwd: sandbox.root });
      await expect(stat(path.join(sandbox.root, '.zotero-chatgpt-dev/context/fixtures/reading.pdf'))).rejects.toMatchObject({ code: 'ENOENT' });
      const driverXpi = path.join(sandbox.root, '.zotero-chatgpt-dev/context/profile/extensions/zchatgpt-host-test@local.xpi'); const bootstrap = await readArchiveEntry(driverXpi, 'bootstrap.js');
      expect(bootstrap).toContain('"recoveryConversationId":"63696cbf-01e2-46b6-be36-2f539813e656"'); expect(bootstrap).toContain('"recoveryRequestId":"04e67795-84e6-4fa3-b4fb-e4d16bc52812"'); expect(bootstrap).toContain('"recoveryOriginVersion":"0.4.0a25"');
    } finally { await rm(sandbox.root, { recursive: true, force: true }); }
  });

  it('registers the human-gated live model-catalog stage on its own isolated tree', async () => {
    await expect(select(['--live-model'])).resolves.toMatchObject({ stage: 'live-model', driver: 'tests/host/live-model-driver.js', installDriver: true });
    const { stdout } = await execFileAsync(process.execPath, [
      '--input-type=module',
      '-e',
      `import { selectHostTree } from ${JSON.stringify(stageModule)};
       console.log(JSON.stringify(selectHostTree(['--live-model'], ${JSON.stringify(repositoryRoot)})));`,
    ], { cwd: repositoryRoot });
    const tree = JSON.parse(stdout) as { stage: string; profile: string; dataDir: string; reportPath: string };
    expect(tree.stage).toBe('live-model');
    expect(tree.profile).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/live/profile'));
    expect(tree.dataDir).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/live/data'));
    expect(tree.reportPath).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/live/host-report.json'));
    expect(tree.profile).not.toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/profile'));
  });

  it('refuses the live model-catalog stage in acceptance, native and model-request modes', async () => {
    await expect(select(['--live-model', '--acceptance'])).rejects.toThrow();
    await expect(select(['--live-model', '--native'])).rejects.toThrow();
    await expect(select(['--live-model', '--live'])).rejects.toThrow();
    await expect(select(['--context', '--live-model'])).rejects.toThrow();
  });

  it('keeps every host driver file reachable from a stage registration', async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      '--input-type=module',
      '-e',
      `import { HOST_DRIVERS } from ${JSON.stringify(stageModule)}; console.log(JSON.stringify(HOST_DRIVERS));`,
    ], { cwd: repositoryRoot });
    const registered = new Set<string>(Object.values(JSON.parse(stdout) as Record<string, string>));
    // Selected by --native rather than by HOST_DRIVERS.
    registered.add('tests/host/native-action-driver.ts');
    const files = readdirSync(path.join(repositoryRoot, 'tests/host'))
      .filter(name => /-driver\.(js|ts)$/u.test(name))
      .map(name => `tests/host/${name}`);
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter(file => !registered.has(file))).toEqual([]);
  });
  it('isolates native task checks and forbids combining their automatic driver with live or manual mode', async () => {
    await expect(select(['--context', '--native'])).resolves.toMatchObject({ stage: 'context', driver: 'tests/host/native-action-driver.ts' });
    await expect(select(['--native'])).rejects.toThrow();
    await expect(select(['--context', '--native', '--live'])).rejects.toThrow();
    await expect(select(['--context', '--native', '--acceptance'])).rejects.toThrow();
  });
  it('refuses to prepare a profile without an explicit stage', async () => {
    await expect(select([])).rejects.toSatisfy((error: unknown) => /Pass one of --context, --live-core, --recover-organization, --web-resume, --embed, --live-model, --s5, --s6, or --acceptance/.test(failureMessage(error)));
  });

  it('registers the embedded ChatGPT probe on its own isolated tree', async () => {
    await expect(select(['--embed'])).resolves.toMatchObject({ stage: 'embed', driver: 'tests/host/embed-driver.js', installDriver: true });
    const { stdout } = await execFileAsync(process.execPath, [
      '--input-type=module',
      '-e',
      `import { selectHostTree } from ${JSON.stringify(stageModule)};
       console.log(JSON.stringify(selectHostTree(['--embed'], ${JSON.stringify(repositoryRoot)})));`,
    ], { cwd: repositoryRoot });
    const tree = JSON.parse(stdout) as { stage: string; profile: string; dataDir: string; reportPath: string };
    expect(tree.stage).toBe('embed');
    expect(tree.profile).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/embed/profile'));
    expect(tree.dataDir).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/embed/data'));
    expect(tree.reportPath).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/embed/host-report.json'));
    expect(tree.profile).not.toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/profile'));
  });

  it('refuses to auto-run the embedded ChatGPT probe as acceptance, native action or live verification', async () => {
    await expect(select(['--embed', '--acceptance'])).rejects.toThrow();
    await expect(select(['--embed', '--native'])).rejects.toThrow();
    await expect(select(['--embed', '--live'])).rejects.toThrow();
    await expect(select(['--context', '--embed'])).rejects.toThrow();
  });

  it('gates one official-web acceptance turn behind an explicit isolated embed mode', async () => {
    await expect(select(['--embed', '--web-live'])).resolves.toMatchObject({ stage: 'embed', driver: 'tests/host/embed-driver.js', installDriver: true });
    await expect(select(['--web-live'])).rejects.toThrow(/requires --embed/u);
    await expect(select(['--context', '--web-live'])).rejects.toThrow(/requires --embed/u);
    await expect(select(['--embed', '--web-live', '--watch-seconds', '30'])).rejects.toThrow(/cannot be combined/u);
  });

  it('packages the test-only web actor only for the explicit web-live run', async () => {
    const sandbox = await prepareScriptSandbox();
    try {
      const driverXpi = path.join(sandbox.root, '.zotero-chatgpt-dev/embed/profile/extensions/zchatgpt-host-test@local.xpi');
      await execFileAsync(process.execPath, [sandbox.script, '--embed', sandbox.xpi], { cwd: sandbox.root });
      expect(await listArchiveEntries(driverXpi)).not.toContain('content/web-acceptance/web-acceptance-actor.mjs');

      await execFileAsync(process.execPath, [sandbox.script, '--embed', '--web-live', sandbox.xpi], { cwd: sandbox.root });
      expect(await listArchiveEntries(driverXpi)).toContain('content/web-acceptance/web-acceptance-actor.mjs');
      const bootstrap = await readArchiveEntry(driverXpi, 'bootstrap.js');
      expect(bootstrap).toContain('ZoteroChatGPTWebAcceptance');
      expect(bootstrap).toContain('resource://zotero-chatgpt-web-acceptance/web-acceptance-actor.mjs');
      expect(bootstrap).toContain('setSubstitutionWithFlags');
      expect(bootstrap).toContain('"webLive":true');
    } finally {
      await rm(sandbox.root, { recursive: true, force: true });
    }
  });

  it('selects existing official-conversation resume with an optional single stop turn', async () => {
    const argv = ['--web-resume', '6aae72c2-a440-83ea-8ca7-cc87eb75b85c', '--expected-token', 'RUN-0123456789abcdef01234567', '--origin-version', '0.4.0a28', '--stop-test'];
    await expect(select(argv)).resolves.toEqual({ stage: 'web-resume', driver: 'tests/host/web-resume-driver.js', installDriver: true });
    const tree = await selectTree(argv); expect(tree.profile).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/embed/profile')); expect(tree.dataDir).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/embed/data'));
    await expect(select(['--web-resume', 'short', '--expected-token', argv[3]!, '--origin-version', argv[5]!])).rejects.toThrow(/conversation id/u);
    await expect(select(['--web-resume', argv[1]!])).rejects.toThrow(/expected-token/u);
  });

  it('packages web resume with the observer actor and no replacement fixture', async () => {
    const sandbox = await prepareScriptSandbox(); const argv = ['--web-resume', '6aae72c2-a440-83ea-8ca7-cc87eb75b85c', '--expected-token', 'RUN-0123456789abcdef01234567', '--origin-version', '0.4.0a28', '--stop-test'];
    try {
      await execFileAsync(process.execPath, [sandbox.script, ...argv, sandbox.xpi], { cwd: sandbox.root });
      await expect(stat(path.join(sandbox.root, '.zotero-chatgpt-dev/embed/fixtures/reading.pdf'))).rejects.toMatchObject({ code: 'ENOENT' });
      const driverXpi = path.join(sandbox.root, '.zotero-chatgpt-dev/embed/profile/extensions/zchatgpt-host-test@local.xpi'); expect(await listArchiveEntries(driverXpi)).toContain('content/web-acceptance/web-acceptance-actor.mjs');
      const bootstrap = await readArchiveEntry(driverXpi, 'bootstrap.js'); expect(bootstrap).toContain('"webResumeConversationId":"6aae72c2-a440-83ea-8ca7-cc87eb75b85c"'); expect(bootstrap).toContain('"webStopTest":true');
    } finally { await rm(sandbox.root, { recursive: true, force: true }); }
  });

  it('selects the S5 restart driver', async () => {
    await expect(select(['--s5'])).resolves.toEqual({ stage: 's5', driver: 'tests/host/s5-driver.js', installDriver: true });
  });

  it('selects the S6 virgin-profile driver', async () => {
    await expect(select(['--s6'])).resolves.toEqual({ stage: 's6', driver: 'tests/host/s6-driver.js', installDriver: true });
  });

  it('stages human acceptance without an auto-running host driver', async () => {
    await expect(select(['--acceptance'])).resolves.toEqual({ stage: 'acceptance', driver: null, installDriver: false });
  });

  it('rejects combining --acceptance with a host-driver stage', async () => {
    await expect(select(['--acceptance', '--s5'])).rejects.toSatisfy((error: unknown) => /Pass --acceptance without --s5 or --s6/.test(failureMessage(error)));
    await expect(select(['--acceptance', '--s6'])).rejects.toSatisfy((error: unknown) => /Pass --acceptance without --s5 or --s6/.test(failureMessage(error)));
  });

  it('puts S6 in .zotero-chatgpt-dev/s6-virgin, not the signed-in profile', async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      '--input-type=module',
      '-e',
      `import { selectHostTree } from ${JSON.stringify(stageModule)};
       console.log(JSON.stringify(selectHostTree(['--s6'], ${JSON.stringify(repositoryRoot)})));`,
    ], { cwd: repositoryRoot });
    const tree = JSON.parse(stdout) as { profile: string; dataDir: string; reportPath: string };
    expect(tree.profile).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/s6-virgin/profile'));
    expect(tree.dataDir).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/s6-virgin/data'));
    expect(tree.reportPath).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/s6-virgin/host-report.json'));
    expect(tree.profile).not.toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/profile'));
    expect(tree.dataDir).not.toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/data'));
  });

  it('puts S6 two-version upgrade in .zotero-chatgpt-dev/s6-upgrade, not the signed-in profile', async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      '--input-type=module',
      '-e',
      `import { selectHostTree } from ${JSON.stringify(stageModule)};
       console.log(JSON.stringify(selectHostTree(['--s6', '--upgrade-xpi', '/tmp/newer.xpi', '--rollback-xpi', '/tmp/older.xpi'], ${JSON.stringify(repositoryRoot)})));`,
    ], { cwd: repositoryRoot });
    const tree = JSON.parse(stdout) as { profile: string; dataDir: string; reportPath: string };
    expect(tree.profile).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/s6-upgrade/profile'));
    expect(tree.dataDir).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/s6-upgrade/data'));
    expect(tree.reportPath).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/s6-upgrade/host-report.json'));
    expect(tree.profile).not.toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/profile'));
    expect(tree.dataDir).not.toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/data'));
    expect(tree.profile).not.toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/s6-virgin/profile'));
  });

  it('puts --acceptance on the signed-in tree, not s6-virgin', async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      '--input-type=module',
      '-e',
      `import { selectHostTree } from ${JSON.stringify(stageModule)};
       console.log(JSON.stringify(selectHostTree(['--acceptance'], ${JSON.stringify(repositoryRoot)})));`,
    ], { cwd: repositoryRoot });
    const tree = JSON.parse(stdout) as { stage: string; profile: string; dataDir: string; pdfPath: string };
    expect(tree.stage).toBe('acceptance');
    expect(tree.profile).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/profile'));
    expect(tree.dataDir).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/data'));
    expect(tree.pdfPath).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/fixtures/reading.pdf'));
    expect(tree.profile).not.toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/s6-virgin/profile'));
  });

  it('rejects combining exclusive stage flags', async () => {
    await expect(select(['--s5', '--s6'])).rejects.toSatisfy((error: unknown) => /Pass only one of --context, --live-core, --recover-organization, --web-resume, --embed, --live-model, --s5, --s6/.test(failureMessage(error)));
    await expect(select(['--context', '--s6'])).rejects.toSatisfy((error: unknown) => /Pass only one of --context, --live-core, --recover-organization, --web-resume, --embed, --live-model, --s5, --s6/.test(failureMessage(error)));
  });
});
