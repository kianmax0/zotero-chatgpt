/**
 * Development XPI install tool for a real Zotero profile.
 *
 * Why this exists: replacing a sideloaded XPI inside a real Zotero profile is invisible to Zotero's
 * add-on bookkeeping. Zotero's compiled default is `extensions.startupScanScopes = 0`
 * (`defaults/preferences/zotero.js` inside the app's `omni.ja`), and on a same-build launch
 * `XPIProvider.checkForChanges` calls `XPIStates.scanForChanges(aAppChanged === false)`, which
 * skips every location whose scope is not in that pref — including the profile extension location
 * (`SCOPE_PROFILE = 1`). The file's mtime/size is therefore never compared, so `about:addons` and
 * the add-on `version` string keep the previous shutdown's value. Loading is unaffected: Zotero's
 * `plugins.js` reads `bootstrap.js` out of the XPI with `ignoreCache: true`, so the *executed* code
 * is always the file on disk.
 *
 * Consequences this tool is built around:
 *   - the loaded code can be verified by measurement (the running process holds the XPI open);
 *   - the reported version only changes after a launch that actually rescans the profile scope.
 *
 * Safety rules this tool follows:
 *   - it never edits `prefs.js`, `extensions.json`, `addonStartup.json.lz4` or add-on startup state;
 *   - it places exactly one XPI file and records what it replaced (version + sha256) beside it;
 *   - the rescan lever is carried by a managed `user.js` and is reverted, not left behind;
 *   - it refuses while the target profile is running, and refuses a profile it cannot identify.
 *
 * The one lever: Gecko reads `prefs.js` and then `user.js` at startup (`user.js` wins), and on exit
 * writes user-set values into `prefs.js`. So a temporary `extensions.startupScanScopes` in a managed
 * `user.js` makes the next launch rescan, and pinning it back to the compiled default (`0`) in that
 * same file makes the next exit drop the key from `prefs.js` again. `check`/`revert` drive that.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  SUBJECT_ID,
  readXpiIdentity as readXpiIdentityModule,
  requireLocalXpi as requireLocalXpiModule,
} from './install-lifecycle.mjs';

/** `AddonManager.SCOPE_PROFILE` (`modules/AddonManager.sys.mjs`). */
const SCOPE_PROFILE = 1;
/** Compiled default of `extensions.startupScanScopes` in the shipped Zotero build. */
const DEFAULT_SCAN_SCOPES = 0;
const SCAN_SCOPES_PREF = 'extensions.startupScanScopes';
const RECORD_SUFFIX = '.zchatgpt-install.json';
const BACKUP_INFIX = '.zchatgpt-bak-';
const LEVER_MARKER = '// Managed by the Zotero ChatGPT development install tool';
const DEFAULT_PROFILES_ROOT = path.join(homedir(), 'Library/Application Support/Zotero/Profiles');
const RECORD_VERSION = 1;

const readXpiIdentityUnsafe = readXpiIdentityModule as (archivePath: string) => Promise<unknown>;
const requireLocalXpiUnsafe = requireLocalXpiModule as (xpi: string) => string;

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

export interface XpiIdentity { id: string; version: string }

export interface PrefEntry { key: string; line: number; raw: string; int: number | null }

export interface EffectiveScanScopes {
  value: number;
  source: 'default' | 'prefs.js' | 'user.js';
  raw: string | null;
}

export interface LsofRow { pid: number; size: number | null; inode: string | null; name: string }

export interface CheckResult { name: string; outcome: 'pass' | 'fail' | 'not-measured'; detail: string }

export interface OpenHandleMeasurement {
  holds: boolean;
  inode: string | null;
  size: number | null;
  rows: number;
}

export type LeverState =
  | 'not-needed'
  | 'skipped'
  | 'armed'
  | 'arm-failed'
  | 'relaxing'
  | 'reverted'
  | 'manual-restore-required';

export interface LeverPlan {
  state: LeverState;
  userJsPath: string;
  detail: string;
  nextStep: string | null;
}

export interface InstallRecord {
  tool: 'zchatgpt-install-dev-xpi';
  recordVersion: number;
  addonId: string;
  profile: string;
  installedPath: string;
  artifactPath: string;
  artifactVersion: string;
  artifactSha256: string;
  artifactSize: number;
  installedSha256: string;
  installedSize: number;
  installedAt: string;
  previous: { version: string; sha256: string; size: number; backupPath: string } | null;
  lever: { state: LeverState; prefBefore: { value: number; source: EffectiveScanScopes['source'] }; createdUserJs: boolean };
}

/** Tolerant reader for Gecko `user_pref("key", value);` lines. Only integers are interpreted. */
export function parseUserPrefs(text: string): PrefEntry[] {
  const entries: PrefEntry[] = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const match = /^\s*user_pref\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*(.*?)\s*\)\s*;\s*$/u.exec(line);
    if (!match) continue;
    const raw = match[2] ?? '';
    entries.push({
      key: match[1] ?? '',
      line: index + 1,
      raw,
      int: /^-?\d+$/u.test(raw) ? Number.parseInt(raw, 10) : null,
    });
  }
  return entries;
}

/** Last `extensions.startupScanScopes` integer in a pref file, or null when the file does not set it. */
export function scanScopesInText(text: string): { value: number; line: number; raw: string } | null {
  let found: { value: number; line: number; raw: string } | null = null;
  for (const entry of parseUserPrefs(text)) {
    if (entry.key === SCAN_SCOPES_PREF && entry.int !== null) found = { value: entry.int, line: entry.line, raw: entry.raw };
  }
  return found;
}

/** Gecko loads `prefs.js` first and `user.js` second, and the later file wins. */
export function effectiveScanScopes(prefsJs: string, userJs: string | null): EffectiveScanScopes {
  if (userJs !== null) {
    const fromUserJs = scanScopesInText(userJs);
    if (fromUserJs) return { value: fromUserJs.value, source: 'user.js', raw: fromUserJs.raw };
  }
  const fromPrefsJs = scanScopesInText(prefsJs);
  if (fromPrefsJs) return { value: fromPrefsJs.value, source: 'prefs.js', raw: fromPrefsJs.raw };
  return { value: DEFAULT_SCAN_SCOPES, source: 'default', raw: null };
}

export function includesProfileScope(value: number): boolean {
  return (value & SCOPE_PROFILE) !== 0;
}

/** The managed `user.js` body. Exactly one pref, so the revert is unambiguous. */
export function leverText(value: number): string {
  return [
    `${LEVER_MARKER} (scripts/install-dev-xpi.ts).`,
    '// It only pins extensions.startupScanScopes so the next Zotero launch rescans profile-scoped',
    '// sideloads. Safe to delete: deleting it stops the pin, and Zotero drops the key from prefs.js',
    '// on the next exit because it then equals the compiled default.',
    `user_pref("extensions.startupScanScopes", ${value});`,
    '',
  ].join('\n');
}

/** True when the file is ours: our marker plus only the one pref we manage. */
export function isManagedLever(text: string): boolean {
  if (!text.includes(LEVER_MARKER)) return false;
  return parseUserPrefs(text).every((entry) => entry.key === SCAN_SCOPES_PREF);
}

export function backupFileName(addonId: string, version: string, stamp: string): string {
  return `${addonId}.xpi${BACKUP_INFIX}${stamp}-${version}`;
}

export function parseBackupFileName(fileName: string, addonId: string): { stamp: string; version: string } | null {
  const prefix = `${addonId}.xpi${BACKUP_INFIX}`;
  if (!fileName.startsWith(prefix)) return null;
  const match = /^(\d{8}-\d{6})-(.+)$/u.exec(fileName.slice(prefix.length));
  if (!match) return null;
  return { stamp: match[1] ?? '', version: match[2] ?? '' };
}

export function selectNewestBackup(fileNames: string[], addonId: string): string | null {
  const parsed: Array<{ name: string; stamp: string }> = [];
  for (const name of fileNames) {
    const info = parseBackupFileName(name, addonId);
    if (info) parsed.push({ name, stamp: info.stamp });
  }
  parsed.sort((left, right) => left.stamp.localeCompare(right.stamp) || left.name.localeCompare(right.name));
  return parsed.length ? parsed[parsed.length - 1]?.name ?? null : null;
}

/** Parse the `lsof` table. The NAME column may contain spaces, so it is the rest of the line. */
export function parseLsofRows(output: string): LsofRow[] {
  const rows: LsofRow[] = [];
  for (const line of output.split('\n')) {
    const match = /^(\S+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/u.exec(line);
    if (!match) continue;
    const pid = Number.parseInt(match[2] ?? '', 10);
    if (!Number.isFinite(pid)) continue;
    const sizeText = match[7] ?? '';
    rows.push({
      pid,
      size: /^\d+$/u.test(sizeText) ? Number.parseInt(sizeText, 10) : null,
      inode: match[8] ?? null,
      name: (match[9] ?? '').trim(),
    });
  }
  return rows;
}

export function parseLsofPids(output: string): number[] {
  return [...new Set(parseLsofRows(output).map((row) => row.pid))].sort((left, right) => left - right);
}

/**
 * `ps -axo pid,args=` fallback. An app-launched Zotero has no `-profile` in its own argv, but its
 * plugin-container/codex children do, so the profile path alone is the signal.
 */
export function parsePsProfilePids(output: string, profile: string): number[] {
  const resolved = path.resolve(profile);
  const pids = new Set<number>();
  for (const line of output.split('\n')) {
    if (!line.includes(resolved) || !/zotero/iu.test(line)) continue;
    const match = /^\s*(\d+)\s/u.exec(line);
    if (!match) continue;
    pids.add(Number.parseInt(match[1] ?? '', 10));
  }
  return [...pids].sort((left, right) => left - right);
}

/** Which of the given pids hold one of the acceptable paths open, from raw `lsof` output. */
export function measureOpenHandle(
  lsofOutput: string,
  pids: number[],
  installedPaths: string[],
): OpenHandleMeasurement {
  const accepted = new Set(installedPaths);
  const rows = parseLsofRows(lsofOutput).filter((row) => accepted.has(row.name) && pids.includes(row.pid));
  const first = rows[0];
  return { holds: rows.length > 0, inode: first?.inode ?? null, size: first?.size ?? null, rows: rows.length };
}

// ---------------------------------------------------------------------------------------------
// Host probing
// ---------------------------------------------------------------------------------------------

export interface DevInstallDeps {
  platform: string;
  now(): Date;
  /** Raw `lsof -- <target>` stdout, `''` when nothing matches, null when lsof cannot run. */
  lsof(target: string): string | null;
  /** Raw `ps -axo pid,args=` stdout. */
  ps(): string;
}

function runCapture(file: string, args: string[]): string | null {
  try {
    return execFileSync(file, args, { encoding: 'utf8' });
  } catch (error) {
    if (error && typeof error === 'object' && 'stdout' in error && typeof error.stdout === 'string') return error.stdout;
    return null;
  }
}

export function realDeps(): DevInstallDeps {
  return {
    platform: process.platform,
    now: () => new Date(),
    // `lsof` exits 1 with no output when nothing matches; it returns null (via the throw path) only
    // when it cannot run at all, which is the distinction `check` reports.
    lsof: (target) => runCapture('/usr/sbin/lsof', ['--', target]),
    ps: () => runCapture('/bin/ps', ['-axo', 'pid,args=']) ?? '',
  };
}

// ---------------------------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------------------------

async function sha256File(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function statOrNull(filePath: string): Promise<{ size: number; ino: bigint } | null> {
  try {
    const info = await stat(filePath, { bigint: true });
    return { size: Number(info.size), ino: info.ino };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readTextOrNull(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * `lsof` can report the symlink-resolved path while the tool works from the path the operator
 * passed, so accept both. The stat-based inode/size comparison still has to agree.
 */
async function acceptablePaths(filePath: string): Promise<string[]> {
  try {
    const canonical = await realpath(filePath);
    return canonical === filePath ? [filePath] : [filePath, canonical];
  } catch {
    return [filePath];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function readIdentity(xpiPath: string): Promise<XpiIdentity> {
  const raw: unknown = await readXpiIdentityUnsafe(xpiPath);
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.version !== 'string') {
    throw new Error(`Could not read the add-on identity from ${xpiPath}`);
  }
  return { id: raw.id, version: raw.version };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function timestampStamp(date: Date): string {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  );
}

// ---------------------------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------------------------

export type DevInstallCommand = 'plan' | 'install' | 'check' | 'revert' | 'rollback' | 'help';

export interface HelpOutcome { ok: true; command: 'help'; usage: string }

export interface DevInstallOutcome {
  ok: boolean;
  command: Exclude<DevInstallCommand, 'help'>;
  status: string;
  profile: string;
  addonId: string;
  installedPath: string;
  recordPath: string;
  artifactPath: string | null;
  artifactVersion: string | null;
  artifactSha256: string | null;
  installedSha256: string | null;
  previousVersion: string | null;
  backupPath: string | null;
  running: { pids: number[]; source: 'lsof-parentlock' | 'ps-args' | 'none' };
  checks: CheckResult[];
  measurements: {
    openHandle: OpenHandleMeasurement | null;
    openHandleUnavailable: string | null;
    reportedVersion: { expected: string; observed: string | null; observedPath: string; persisted: boolean } | null;
  };
  lever: LeverPlan;
  instructions: string[];
  notes: string[];
}

interface RunOptions {
  command: Exclude<DevInstallCommand, 'help'>;
  profile: string | null;
  profileName: string | null;
  profilesRoot: string;
  xpi: string | null;
  rescan: 'auto' | 'always' | 'never';
  apply: boolean;
}

// ---------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------

function detectRunning(profileDir: string, deps: DevInstallDeps): DevInstallOutcome['running'] {
  const lockPath = path.join(profileDir, '.parentlock');
  const lockOutput = deps.lsof(lockPath);
  if (lockOutput !== null) {
    const pids = parseLsofPids(lockOutput);
    if (pids.length > 0) return { pids, source: 'lsof-parentlock' };
  }
  const pids = parsePsProfilePids(deps.ps(), profileDir);
  if (pids.length > 0) return { pids, source: 'ps-args' };
  return { pids: [], source: 'none' };
}

function rollbackInstruction(profileDir: string): string {
  return `npm run install:dev -- rollback --profile "${profileDir}"`;
}

async function resolveProfileDir(options: RunOptions): Promise<string> {
  if (options.profile !== null) {
    const resolved = path.resolve(options.profile);
    const info = await statOrNull(path.join(resolved, 'prefs.js'));
    if (info === null) throw new Error(`Not a Zotero profile (no prefs.js): ${resolved}`);
    return resolved;
  }
  if (options.profileName !== null) {
    const resolved = path.join(options.profilesRoot, options.profileName);
    const info = await statOrNull(path.join(resolved, 'prefs.js'));
    if (info === null) throw new Error(`No Zotero profile named ${options.profileName} under ${options.profilesRoot}`);
    return resolved;
  }
  const entries = await readdir(options.profilesRoot, { withFileTypes: true }).catch(() => []);
  const candidates: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(options.profilesRoot, entry.name);
    const database = await readTextOrNull(path.join(candidate, 'extensions.json'));
    if (database !== null && database.includes(SUBJECT_ID)) candidates.push(candidate);
  }
  if (candidates.length === 0) {
    throw new Error(
      `Cannot find the target profile: pass --profile, or --profile-name for a profile under ${options.profilesRoot}. ` +
        'No profile there has this add-on installed.',
    );
  }
  if (candidates.length > 1) {
    throw new Error(`Cannot find a single target profile; pass --profile <path>. Candidates: ${candidates.join(', ')}`);
  }
  const [only] = candidates;
  if (only === undefined) throw new Error('Cannot find the target profile; pass --profile <path>.');
  return only;
}

async function installCommand(
  profileDir: string,
  options: RunOptions,
  deps: DevInstallDeps,
  addonId: string,
): Promise<DevInstallOutcome> {
  const installedPath = path.join(profileDir, 'extensions', `${addonId}.xpi`);
  const recordPath = `${installedPath}${RECORD_SUFFIX}`;
  const userJsPath = path.join(profileDir, 'user.js');
  const running = detectRunning(profileDir, deps);
  const notes: string[] = [];
  const instructions: string[] = [];

  const base: DevInstallOutcome = {
    ok: true,
    command: options.command,
    status: options.command === 'plan' ? 'planned' : 'awaiting-launch',
    profile: profileDir,
    addonId,
    installedPath,
    recordPath,
    artifactPath: options.xpi === null ? null : path.resolve(options.xpi),
    artifactVersion: null,
    artifactSha256: null,
    installedSha256: null,
    previousVersion: null,
    backupPath: null,
    running,
    checks: [],
    measurements: { openHandle: null, openHandleUnavailable: null, reportedVersion: null },
    lever: { state: 'not-needed', userJsPath, detail: 'No rescan needed.', nextStep: null },
    instructions,
    notes,
  };

  if (running.pids.length > 0) {
    if (options.command === 'install') {
      throw new Error(
        `The target profile is in use (pid ${running.pids.join(', ')} via ${running.source}). ` +
          'Quit that Zotero instance before installing; this tool never replaces a loaded XPI.',
      );
    }
    notes.push(`The target profile is in use (pid ${running.pids.join(', ')} via ${running.source}).`);
  }

  if (options.xpi === null) {
    if (options.command === 'install') throw new Error('install requires --xpi <local XPI path>');
    return base;
  }
  const localXpi = requireLocalXpiUnsafe(options.xpi);
  const artifactIdentity = await readIdentity(localXpi);
  if (artifactIdentity.id !== addonId) {
    throw new Error(`That XPI is for ${artifactIdentity.id}, not ${addonId}`);
  }
  base.artifactVersion = artifactIdentity.version;
  base.artifactSha256 = await sha256File(localXpi);

  const previousInfo = await statOrNull(installedPath);
  let previous: InstallRecord['previous'] = null;
  if (previousInfo !== null) {
    const previousIdentity = await readIdentity(installedPath);
    const previousSha = await sha256File(installedPath);
    const stamp = timestampStamp(deps.now());
    const backupPath = path.join(profileDir, 'extensions', backupFileName(addonId, previousIdentity.version, stamp));
    previous = { version: previousIdentity.version, sha256: previousSha, size: previousInfo.size, backupPath };
    base.previousVersion = previousIdentity.version;
    base.backupPath = backupPath;
    if (previousSha === base.artifactSha256) {
      base.status = 'already-installed';
      // Nothing is written, so do not report a backup path that was never created.
      base.backupPath = null;
      notes.push(
        `The installed file already matches this artifact byte-for-byte (${base.artifactSha256}); nothing was written.`,
      );
      return base;
    }
  }

  // Preflight the rescan lever before touching anything, so a profile we cannot revert is refused
  // while nothing has changed yet.
  const prefsJs = (await readTextOrNull(path.join(profileDir, 'prefs.js'))) ?? '';
  const userJs = await readTextOrNull(userJsPath);
  const effective = effectiveScanScopes(prefsJs, userJs);
  let leverValue: number | null = null;
  if (includesProfileScope(effective.value)) {
    base.lever = {
      state: 'not-needed',
      userJsPath,
      detail: `${SCAN_SCOPES_PREF} is already ${effective.value} (from ${effective.source}), so the profile scope is scanned.`,
      nextStep: null,
    };
  } else if (options.rescan === 'never') {
    base.lever = {
      state: 'skipped',
      userJsPath,
      detail:
        `--rescan never: ${SCAN_SCOPES_PREF} (from ${effective.source}) does not include the profile scope, ` +
        'so the reported version will stay stale until Zotero rescans for another reason (for example an app update).',
      nextStep: null,
    };
    notes.push('Reported version is expected to stay stale: the rescan lever was explicitly skipped.');
  } else if (userJs !== null && !isManagedLever(userJs)) {
    throw new Error(
      `${userJsPath} already exists and was not written by this tool, so the temporary rescan pref cannot be ` +
        `added or reverted safely. Merge it or pass --rescan never (which leaves the reported version stale).`,
    );
  } else if (effective.source === 'prefs.js' && effective.value !== DEFAULT_SCAN_SCOPES) {
    throw new Error(
      `prefs.js sets ${SCAN_SCOPES_PREF}=${effective.value} without the profile scope; this tool will not overwrite ` +
        'a deliberate preference. Change it in Zotero, or pass --rescan never.',
    );
  } else {
    leverValue = SCOPE_PROFILE;
    base.lever = {
      state: 'armed',
      userJsPath,
      detail:
        `Arms ${SCAN_SCOPES_PREF}=${SCOPE_PROFILE} in a managed user.js so the next launch rescans the profile scope ` +
        `(recorded value before: ${effective.value} from ${effective.source}).`,
      nextStep: `Start Zotero once so it rescans, then run: npm run install:dev -- check --profile "${profileDir}"`,
    };
  }

  instructions.push(`Start Zotero (the instance that uses the profile above) so the swapped XPI is loaded.`);
  instructions.push(`Then verify by measurement: npm run install:dev -- check --profile "${profileDir}"`);
  instructions.push(`Roll back the XPI at any time with: ${rollbackInstruction(profileDir)}`);

  if (!options.apply) {
    notes.push('Dry run (plan): no file was written and no preference was changed.');
    return base;
  }

  await mkdir(path.join(profileDir, 'extensions'), { recursive: true });
  if (previous !== null) {
    if ((await statOrNull(previous.backupPath)) !== null) {
      throw new Error(`Refusing to overwrite an existing backup: ${previous.backupPath}`);
    }
    await copyFile(installedPath, previous.backupPath);
  }
  await copyFile(localXpi, installedPath);
  const copied = await sha256File(installedPath);
  base.installedSha256 = copied;
  if (copied !== base.artifactSha256) {
    throw new Error(
      `The copied XPI does not match the artifact (${copied} != ${base.artifactSha256}). ` +
        `Fail loudly rather than report success. Restore with: ${rollbackInstruction(profileDir)}`,
    );
  }

  if (leverValue !== null) {
    try {
      await writeFile(userJsPath, leverText(leverValue));
    } catch (error) {
      base.lever = {
        state: 'arm-failed',
        userJsPath,
        detail: `Could not write the rescan lever: ${error instanceof Error ? error.message : String(error)}`,
        nextStep: `Without it Zotero may not rescan. Add user_pref("${SCAN_SCOPES_PREF}", ${SCOPE_PROFILE}); to ${userJsPath} by hand.`,
      };
      base.ok = false;
      base.status = 'installed-lever-failed';
    }
  }

  const record: InstallRecord = {
    tool: 'zchatgpt-install-dev-xpi',
    recordVersion: RECORD_VERSION,
    addonId,
    profile: profileDir,
    installedPath,
    artifactPath: localXpi,
    artifactVersion: artifactIdentity.version,
    artifactSha256: base.artifactSha256,
    artifactSize: (await statOrNull(localXpi))?.size ?? 0,
    installedSha256: copied,
    installedSize: (await statOrNull(installedPath))?.size ?? 0,
    installedAt: deps.now().toISOString(),
    previous,
    lever: {
      state: base.lever.state,
      prefBefore: { value: effective.value, source: effective.source },
      createdUserJs: leverValue !== null && userJs === null,
    },
  };
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`);

  if (base.status === 'awaiting-launch') {
    notes.push(
      'Installed, but NOT yet verified: the running-instance measurement and the reported version need a Zotero launch.',
    );
  }
  return base;
}

async function readRecord(recordPath: string): Promise<InstallRecord> {
  const raw = await readTextOrNull(recordPath);
  if (raw === null) {
    throw new Error(`No install record at ${recordPath}. Run install first (this tool records what it replaced).`);
  }
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || parsed.recordVersion !== RECORD_VERSION || typeof parsed.installedPath !== 'string') {
    throw new Error(`Unreadable install record: ${recordPath}`);
  }
  return parsed as unknown as InstallRecord;
}

async function readReportedVersion(profileDir: string, addonId: string): Promise<{ path: string; version: string | null }> {
  const databasePath = path.join(profileDir, 'extensions.json');
  const raw = await readTextOrNull(databasePath);
  if (raw === null) return { path: databasePath, version: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { path: databasePath, version: null };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.addons)) return { path: databasePath, version: null };
  for (const addon of parsed.addons) {
    if (isRecord(addon) && addon.id === addonId && typeof addon.version === 'string') {
      return { path: databasePath, version: addon.version };
    }
  }
  return { path: databasePath, version: null };
}

/** Reverts the managed lever, or moves it one launch closer to a full revert. */
async function revertLever(
  profileDir: string,
  record: InstallRecord | null,
  apply: boolean,
): Promise<LeverPlan> {
  const userJsPath = path.join(profileDir, 'user.js');
  const userJs = await readTextOrNull(userJsPath);
  if (userJs === null || !isManagedLever(userJs)) {
    return { state: 'reverted', userJsPath, detail: 'No managed rescan lever is present.', nextStep: null };
  }
  const prefBefore = record?.lever.prefBefore.value ?? DEFAULT_SCAN_SCOPES;
  const persisted = scanScopesInText((await readTextOrNull(path.join(profileDir, 'prefs.js'))) ?? '');
  if (persisted === null || persisted.value === DEFAULT_SCAN_SCOPES) {
    // Nothing non-default is pinned in prefs.js, so removing our file is a complete revert.
    if (apply) await rm(userJsPath, { force: true });
    return {
      state: 'reverted',
      userJsPath,
      detail:
        persisted === null
          ? 'prefs.js does not carry the pref; the managed user.js was removed.'
          : `${SCAN_SCOPES_PREF} is back at the compiled default; the managed user.js was removed.`,
      nextStep: null,
    };
  }
  if (prefBefore !== DEFAULT_SCAN_SCOPES) {
    return {
      state: 'manual-restore-required',
      userJsPath,
      detail: `prefs.js held ${SCAN_SCOPES_PREF}=${prefBefore} before this tool armed the lever, and the file is still not safe to edit by hand.`,
      nextStep: `In Zotero: Settings → Advanced → Config Editor → set ${SCAN_SCOPES_PREF} to ${prefBefore}, then delete ${userJsPath}.`,
    };
  }
  // Gecko copied the armed value into prefs.js at the last exit. Pinning the compiled default in the
  // managed user.js makes the next exit drop the key, because it then equals the default.
  if (apply) await writeFile(userJsPath, leverText(DEFAULT_SCAN_SCOPES));
  return {
    state: 'relaxing',
    userJsPath,
    detail: `prefs.js now carries ${SCAN_SCOPES_PREF}=${persisted.value}; the managed user.js pins the compiled default so Zotero drops it.`,
    nextStep: `Start Zotero once and quit it, then run: npm run install:dev -- revert --profile "${profileDir}"`,
  };
}

async function checkCommand(
  profileDir: string,
  deps: DevInstallDeps,
): Promise<DevInstallOutcome> {
  const record = await readRecord(`${path.join(profileDir, 'extensions', `${SUBJECT_ID}.xpi`)}${RECORD_SUFFIX}`);
  const running = detectRunning(profileDir, deps);
  const checks: CheckResult[] = [];
  const notes: string[] = [];
  const instructions: string[] = [];

  const installedInfo = await statOrNull(record.installedPath);
  const installedSha = installedInfo === null ? null : await sha256File(record.installedPath);
  checks.push({
    name: 'installed-file-matches-artifact-sha256',
    outcome: installedSha === record.artifactSha256 ? 'pass' : 'fail',
    detail:
      installedInfo === null
        ? `${record.installedPath} is missing`
        : `${record.installedPath} ${installedSha} vs artifact ${record.artifactSha256}`,
  });

  let openHandle: OpenHandleMeasurement | null = null;
  let openHandleUnavailable: string | null = null;
  if (deps.platform !== 'darwin') {
    openHandleUnavailable = `The running-instance measurement uses lsof, which this tool only wires up on darwin (found ${deps.platform}).`;
  } else if (running.pids.length === 0) {
    openHandleUnavailable = 'The profile is not running, so no open file handle can be measured.';
  } else {
    const output = deps.lsof(record.installedPath);
    if (output === null) {
      openHandleUnavailable = 'lsof could not be run on this host.';
    } else {
      openHandle = measureOpenHandle(output, running.pids, await acceptablePaths(record.installedPath));
      const inodeMatches = openHandle.inode !== null && installedInfo !== null && openHandle.inode === String(installedInfo.ino);
      const sizeMatches = openHandle.size === installedInfo?.size;
      checks.push({
        name: 'running-instance-holds-installed-xpi',
        outcome: openHandle.holds && inodeMatches && sizeMatches ? 'pass' : 'fail',
        detail:
          `pid ${running.pids.join(', ')} (${running.source}); lsof inode ${openHandle.inode ?? 'n/a'} size ` +
          `${openHandle.size ?? 'n/a'} vs on-disk inode ${installedInfo?.ino ?? 'n/a'} size ${installedInfo?.size ?? 'n/a'}`,
      });
    }
  }
  if (openHandleUnavailable !== null) {
    checks.push({ name: 'running-instance-holds-installed-xpi', outcome: 'not-measured', detail: openHandleUnavailable });
  }

  const reported = await readReportedVersion(profileDir, record.addonId);
  const expected = record.artifactVersion;
  let reportedPersisted = false;
  if (reported.version === null) {
    checks.push({
      name: 'reported-version-matches-artifact',
      outcome: 'not-measured',
      detail: `${reported.path} has no entry for ${record.addonId}`,
    });
  } else if (reported.version === expected) {
    reportedPersisted = true;
    checks.push({
      name: 'reported-version-matches-artifact',
      outcome: 'pass',
      detail: `${reported.path} reports ${reported.version}`,
    });
  } else if (running.pids.length > 0) {
    // Zotero writes extensions.json at shutdown, so a still-running instance keeps the previous
    // shutdown's value on disk even when the rescan already happened in memory.
    checks.push({
      name: 'reported-version-matches-artifact',
      outcome: 'not-measured',
      detail:
        `${reported.path} still reports ${reported.version} while pid ${running.pids.join(', ')} runs; ` +
        'Zotero persists this file at shutdown, so check again after quitting.',
    });
  } else {
    checks.push({
      name: 'reported-version-matches-artifact',
      outcome: 'fail',
      detail:
        `${reported.path} reports ${reported.version}, not ${expected}, and this profile is not running. ` +
        'The rescan did not reach the profile scope.',
    });
    instructions.push(
      `Set ${SCAN_SCOPES_PREF} to include the profile scope (${SCOPE_PROFILE}) through Zotero's own Config Editor, ` +
        'then start Zotero again.',
    );
  }

  const lever = await revertLever(profileDir, record, true);
  if (lever.nextStep !== null) instructions.push(lever.nextStep);
  if (lever.state === 'manual-restore-required') notes.push(lever.nextStep ?? '');

  const failed = checks.some((check) => check.outcome === 'fail');
  const measured = checks.find((check) => check.name === 'running-instance-holds-installed-xpi')?.outcome === 'pass';
  return {
    ok: !failed,
    command: 'check',
    status: failed ? 'failed' : reportedPersisted ? 'verified' : measured ? 'loaded-code-verified' : 'not-measured',
    profile: profileDir,
    addonId: record.addonId,
    installedPath: record.installedPath,
    recordPath: `${record.installedPath}${RECORD_SUFFIX}`,
    artifactPath: record.artifactPath,
    artifactVersion: record.artifactVersion,
    artifactSha256: record.artifactSha256,
    installedSha256: installedSha,
    previousVersion: record.previous?.version ?? null,
    backupPath: record.previous?.backupPath ?? null,
    running,
    checks,
    measurements: {
      openHandle,
      openHandleUnavailable,
      reportedVersion: { expected, observed: reported.version, observedPath: reported.path, persisted: reportedPersisted },
    },
    lever,
    instructions,
    notes,
  };
}

async function rollbackCommand(
  profileDir: string,
  options: RunOptions,
  deps: DevInstallDeps,
): Promise<DevInstallOutcome> {
  const addonId = SUBJECT_ID;
  const extensionsDir = path.join(profileDir, 'extensions');
  const installedPath = path.join(extensionsDir, `${addonId}.xpi`);
  const recordPath = `${installedPath}${RECORD_SUFFIX}`;
  const userJsPath = path.join(profileDir, 'user.js');
  const running = detectRunning(profileDir, deps);
  const notes: string[] = [];

  if (running.pids.length > 0) {
    throw new Error(
      `The target profile is in use (pid ${running.pids.join(', ')} via ${running.source}). ` +
        'Quit that Zotero instance before rolling back.',
    );
  }
  const backupName = selectNewestBackup(await readdir(extensionsDir).catch(() => []), addonId);
  if (backupName === null) {
    throw new Error(`No ${addonId}.xpi${BACKUP_INFIX}* backup under ${extensionsDir}; nothing to roll back.`);
  }
  const backupPath = path.join(extensionsDir, backupName);
  const backupSha = await sha256File(backupPath);
  const backupVersion = (await readIdentity(backupPath)).version;

  const base: DevInstallOutcome = {
    ok: true,
    command: 'rollback',
    status: 'awaiting-launch',
    profile: profileDir,
    addonId,
    installedPath,
    recordPath,
    artifactPath: backupPath,
    artifactVersion: backupVersion,
    artifactSha256: backupSha,
    installedSha256: null,
    previousVersion: backupVersion,
    backupPath,
    running,
    checks: [],
    measurements: { openHandle: null, openHandleUnavailable: null, reportedVersion: null },
    lever: { state: 'not-needed', userJsPath, detail: '', nextStep: null },
    instructions: [
      `Start Zotero once so the restored ${backupVersion} is loaded and reported, then run: npm run install:dev -- check --profile "${profileDir}"`,
    ],
    notes,
  };

  if (!options.apply) {
    notes.push('Dry run (plan): no file was written.');
    return base;
  }

  const prefsJs = (await readTextOrNull(path.join(profileDir, 'prefs.js'))) ?? '';
  const userJs = await readTextOrNull(userJsPath);
  const effective = effectiveScanScopes(prefsJs, userJs);
  let leverValue: number | null = null;
  if (!includesProfileScope(effective.value)) {
    if (userJs !== null && !isManagedLever(userJs)) {
      throw new Error(`${userJsPath} was not written by this tool; refusing to change it.`);
    }
    if (options.rescan === 'never') {
      base.lever = { state: 'skipped', userJsPath, detail: '--rescan never.', nextStep: null };
    } else {
      leverValue = SCOPE_PROFILE;
      base.lever = {
        state: 'armed',
        userJsPath,
        detail: `Arms ${SCAN_SCOPES_PREF}=${SCOPE_PROFILE} so the restored version is reported.`,
        nextStep: base.instructions[0] ?? null,
      };
    }
  } else {
    base.lever = { state: 'not-needed', userJsPath, detail: `${SCAN_SCOPES_PREF} already includes the profile scope.`, nextStep: null };
  }

  const outgoing = await statOrNull(installedPath);
  let previous: InstallRecord['previous'] = null;
  if (outgoing !== null) {
    const outgoingVersion = (await readIdentity(installedPath)).version;
    const outgoingBackup = path.join(
      extensionsDir,
      backupFileName(addonId, outgoingVersion, timestampStamp(deps.now())),
    );
    if ((await statOrNull(outgoingBackup)) !== null) throw new Error(`Refusing to overwrite an existing backup: ${outgoingBackup}`);
    await copyFile(installedPath, outgoingBackup);
    previous = { version: outgoingVersion, sha256: await sha256File(outgoingBackup), size: outgoing.size, backupPath: outgoingBackup };
  }
  await copyFile(backupPath, installedPath);
  const restoredSha = await sha256File(installedPath);
  base.installedSha256 = restoredSha;
  if (restoredSha !== backupSha) {
    throw new Error(`The restored XPI does not match the backup (${restoredSha} != ${backupSha}).`);
  }
  if (leverValue !== null) await writeFile(userJsPath, leverText(leverValue));
  const record: InstallRecord = {
    tool: 'zchatgpt-install-dev-xpi',
    recordVersion: RECORD_VERSION,
    addonId,
    profile: profileDir,
    installedPath,
    artifactPath: backupPath,
    artifactVersion: backupVersion,
    artifactSha256: backupSha,
    artifactSize: (await statOrNull(backupPath))?.size ?? 0,
    installedSha256: restoredSha,
    installedSize: (await statOrNull(installedPath))?.size ?? 0,
    installedAt: deps.now().toISOString(),
    previous,
    lever: { state: base.lever.state, prefBefore: { value: effective.value, source: effective.source }, createdUserJs: leverValue !== null && userJs === null },
  };
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  notes.push('Rolled back, but NOT yet verified: the running-instance measurement needs a Zotero launch.');
  return base;
}

async function revertCommand(profileDir: string, deps: DevInstallDeps): Promise<DevInstallOutcome> {
  const installedPath = path.join(profileDir, 'extensions', `${SUBJECT_ID}.xpi`);
  const recordPath = `${installedPath}${RECORD_SUFFIX}`;
  const record = await readTextOrNull(recordPath) === null ? null : await readRecord(recordPath);
  const running = detectRunning(profileDir, deps);
  const lever = await revertLever(profileDir, record, true);
  const instructions: string[] = [];
  if (lever.nextStep !== null) instructions.push(lever.nextStep);
  return {
    ok: lever.state !== 'manual-restore-required',
    command: 'revert',
    status: lever.state,
    profile: profileDir,
    addonId: SUBJECT_ID,
    installedPath,
    recordPath,
    artifactPath: null,
    artifactVersion: record?.artifactVersion ?? null,
    artifactSha256: record?.artifactSha256 ?? null,
    installedSha256: null,
    previousVersion: record?.previous?.version ?? null,
    backupPath: record?.previous?.backupPath ?? null,
    running,
    checks: [],
    measurements: { openHandle: null, openHandleUnavailable: null, reportedVersion: null },
    lever,
    instructions,
    notes: lever.state === 'relaxing' ? ['One more Zotero launch is required before the pref key disappears from prefs.js.'] : [],
  };
}

export function parseArgs(argv: string[]): RunOptions | HelpOutcome {
  const raw = argv[0] ?? 'help';
  if (!isCommand(raw)) throw new Error(`Unknown command: ${argv[0] ?? '(missing)'}. Try: help`);
  if (raw === 'help' || argv.includes('--help')) return { ok: true, command: 'help', usage: USAGE };
  const command = raw;
  const read = (name: string): string | null => {
    const index = argv.indexOf(name);
    if (index === -1) return null;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
    return value;
  };
  const profile = read('--profile');
  const profileName = read('--profile-name');
  if (profile !== null && profileName !== null) throw new Error('Pass only one of --profile and --profile-name');
  const rescan = read('--rescan') ?? 'auto';
  if (rescan !== 'auto' && rescan !== 'always' && rescan !== 'never') {
    throw new Error('--rescan must be auto, always or never');
  }
  return {
    command,
    profile,
    profileName,
    profilesRoot: read('--profiles-root') ?? DEFAULT_PROFILES_ROOT,
    xpi: read('--xpi'),
    rescan,
    apply: command !== 'plan',
  };
}

export const USAGE = `Usage: npm run install:dev -- <command> [options]

  plan     --profile <path> [--xpi <xpi>]   Show what install would do; writes nothing
  install  --profile <path> --xpi <xpi>     Back up the installed XPI, swap in the artifact, arm the rescan lever
  check    --profile <path>                 Measure the running instance and revert the lever
  revert   --profile <path>                 Revert the rescan lever only
  rollback --profile <path>                 Restore the newest recorded backup

Options: --profile <path> | --profile-name <name> | --rescan auto|always|never | --json
Rollback for any mutating step is the same command: rollback restores the newest backup.`;

export function isCommand(value: string): value is DevInstallCommand {
  return (
    value === 'plan' ||
    value === 'install' ||
    value === 'check' ||
    value === 'revert' ||
    value === 'rollback' ||
    value === 'help'
  );
}

export async function run(argv: string[], deps: DevInstallDeps = realDeps()): Promise<DevInstallOutcome | HelpOutcome> {
  const parsed = parseArgs(argv);
  if (parsed.command === 'help') return parsed;
  const options = parsed;
  const profileDir = await resolveProfileDir(options);
  if (options.command === 'rollback') return rollbackCommand(profileDir, options, deps);
  if (options.command === 'revert') return revertCommand(profileDir, deps);
  if (options.command === 'check') return checkCommand(profileDir, deps);
  return installCommand(profileDir, options, deps, SUBJECT_ID);
}

function summarize(outcome: DevInstallOutcome): string {
  const lines = [
    `${outcome.command}: ${outcome.status} (${outcome.ok ? 'ok' : 'FAILED'})`,
    `  profile:   ${outcome.profile}`,
    `  installed: ${outcome.installedPath}${outcome.installedSha256 === null ? '' : ` sha256=${outcome.installedSha256}`}`,
  ];
  if (outcome.artifactVersion !== null) lines.push(`  artifact:  ${outcome.artifactVersion} sha256=${outcome.artifactSha256 ?? 'n/a'}`);
  if (outcome.backupPath !== null) lines.push(`  backup:    ${outcome.backupPath}`);
  for (const check of outcome.checks) lines.push(`  [${check.outcome}] ${check.name}: ${check.detail}`);
  lines.push(`  lever:     ${outcome.lever.state} - ${outcome.lever.detail}`);
  for (const note of outcome.notes) lines.push(`  note:      ${note}`);
  for (const instruction of outcome.instructions) lines.push(`  next:      ${instruction}`);
  return lines.join('\n');
}

async function main(): Promise<void> {
  if (process.versions.node.split('.')[0] !== '24') {
    throw new Error(`Node 24 is required; found ${process.versions.node}`);
  }
  const argv = process.argv.slice(2).filter((value) => value !== '--json');
  const result = await run(argv);
  const json = process.argv.includes('--json');
  if (result.command === 'help') {
    process.stdout.write(`${result.usage}\n`);
    return;
  }
  if (json) process.stdout.write(`${JSON.stringify(result)}\n`);
  else process.stdout.write(`${summarize(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
