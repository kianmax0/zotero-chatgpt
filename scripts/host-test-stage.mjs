/** Exclusive dedicated-profile host stages. Product XPI contents are unchanged by this mapping. */
import { join } from 'node:path';

export const HOST_DRIVERS = {
  s5: 'tests/host/s5-driver.js',
  s6: 'tests/host/s6-driver.js',
  context: 'tests/host/context-driver.js',
  'live-core': 'tests/host/live-core-driver.js',
  'recover-organization': 'tests/host/recover-organization-driver.js',
  'web-resume': 'tests/host/web-resume-driver.js',
  // Embedded ChatGPT web surface: loads chatgpt.com in a Zotero browser surface and measures what the
  // host actually does. It never types, clicks a login control, or reads credentials.
  embed: 'tests/host/embed-driver.js',
  // Human-gated: the operator completes exactly one official login and the driver sends no model request.
  'live-model': 'tests/host/live-model-driver.js',
};

const EXCLUSIVE = ['s5', 's6', 'context', 'live-core', 'recover-organization', 'web-resume', 'embed', 'live-model'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function readOption(argv, name) {
  const positions = argv.flatMap((value, index) => value === name ? [index] : []);
  if (positions.length === 0) return undefined;
  if (positions.length !== 1) throw new Error(`Pass ${name} only once`);
  const value = argv[positions[0] + 1]; if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`); return value;
}

function readRunId(argv) {
  const positions = argv.flatMap((value, index) => value === '--run-id' ? [index] : []);
  if (positions.length === 0) return undefined;
  if (positions.length !== 1) throw new Error('Pass --run-id only once');
  const value = argv[positions[0] + 1];
  if (!value || value.startsWith('--')) throw new Error('--run-id requires a value');
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(value)) throw new Error('--run-id must be a safe lowercase identifier');
  return value;
}
function readReuseId(argv) {
  const value = readOption(argv, '--reuse-run-id');
  if (value && !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(value)) throw new Error('--reuse-run-id must name one dedicated context-runs profile');
  return value;
}
function readReportId(argv) {
  const value = readOption(argv, '--report-id');
  if (value && !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(value)) throw new Error('--report-id must be a safe lowercase identifier');
  return value;
}

function readLoginWaitSeconds(argv) {
  const positions = argv.flatMap((value, index) => value === '--login-wait-seconds' ? [index] : []);
  if (positions.length === 0) return undefined;
  if (positions.length !== 1) throw new Error('Pass --login-wait-seconds only once');
  const raw = argv[positions[0] + 1];
  if (!raw || raw.startsWith('--')) throw new Error('--login-wait-seconds requires a value');
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 3600) throw new Error('--login-wait-seconds must be between 0 and 3600');
  return value;
}

/**
 * @param {string[]} argv
 * @returns {{ stage: string, driver: string | null, installDriver: boolean }}
 */
export function selectHostStage(argv) {
  const acceptance = argv.includes('--acceptance');
  const selected = EXCLUSIVE.filter(name => argv.includes(`--${name}`));
  const runId = readRunId(argv);
  const reuseId = readReuseId(argv);
  const reportId = readReportId(argv);
  const liveCoreFlows = argv.includes('--live-core-flows');
  const liveCoreStage = selected.length === 1 && selected[0] === 'live-core';
  const recoverOrganization = selected.length === 1 && selected[0] === 'recover-organization';
  const webResume = selected.length === 1 && selected[0] === 'web-resume';
  const webLive = argv.includes('--web-live');
  const loginWaitSeconds = readLoginWaitSeconds(argv);
  if (runId && (selected.length !== 1 || selected[0] !== 'context')) throw new Error('--run-id requires --context');
  if (runId && argv.includes('--live')) throw new Error('--run-id cannot be combined with --live');
  const reusableLive = selected.length === 1 && (selected[0] === 'live-core' || (selected[0] === 'context' && argv.includes('--live') && liveCoreFlows));
  if (reuseId && (runId || !reusableLive || !reportId))
    throw new Error('--reuse-run-id requires --live-core or --context --live --live-core-flows and a unique --report-id, without --run-id');
  if (reportId && !reuseId) throw new Error('--report-id requires --reuse-run-id');
  if (liveCoreFlows && (selected.length !== 1 || selected[0] !== 'context' || !argv.includes('--live'))) throw new Error('--live-core-flows requires --context --live');
  if (loginWaitSeconds !== undefined && !liveCoreFlows && !liveCoreStage) throw new Error('--login-wait-seconds requires --live-core-flows or --live-core');
  if (webLive && (selected.length !== 1 || selected[0] !== 'embed')) throw new Error('--web-live requires --embed');
  if (webLive && ['--watch-seconds', '--surface-probes', '--capability-probe', '--url'].some(flag => argv.includes(flag))) throw new Error('--web-live cannot be combined with URL, watch, or comparison probes');
  if (recoverOrganization) {
    const conversationId = readOption(argv, '--recover-organization'); const requestId = readOption(argv, '--request-id'); const token = readOption(argv, '--expected-token'); const originVersion = readOption(argv, '--origin-version');
    if (!conversationId || !UUID.test(conversationId)) throw new Error('--recover-organization requires a valid conversation UUID');
    if (!requestId || !UUID.test(requestId)) throw new Error('--request-id requires a valid request UUID');
    if (!token || !/^RUN-[a-f0-9]{24}$/u.test(token)) throw new Error('--expected-token requires the exact synthetic RUN token');
    if (!originVersion || !/^0\.4\.0a[1-9][0-9]*$/u.test(originVersion)) throw new Error('--origin-version requires the observed Zotero development version');
  }
  if (webResume) {
    const conversationId = readOption(argv, '--web-resume'); const token = readOption(argv, '--expected-token'); const originVersion = readOption(argv, '--origin-version');
    if (!conversationId || !/^[A-Za-z0-9-]{8,128}$/u.test(conversationId)) throw new Error('--web-resume requires the exact official conversation id');
    if (!token || !/^RUN-[a-f0-9]{24}$/u.test(token)) throw new Error('--expected-token requires the original synthetic RUN token');
    if (!originVersion || !/^0\.4\.0a[1-9][0-9]*$/u.test(originVersion)) throw new Error('--origin-version requires the original web evidence version');
  }
  if (argv.includes('--native') && (acceptance || argv.includes('--live') || selected.length !== 1 || selected[0] !== 'context')) throw new Error('--native requires only the dedicated --context driver');
  if (argv.includes('--live') && (acceptance || selected.length !== 1 || selected[0] !== 'context')) throw new Error('--live requires only the dedicated --context driver');
  const manualContext = acceptance && selected.length === 1 && selected[0] === 'context';
  if (acceptance && selected.length > 0 && !manualContext) throw new Error('Pass --acceptance without --s5 or --s6');
  if (selected.length > 1) throw new Error('Pass only one of --context, --live-core, --recover-organization, --web-resume, --embed, --live-model, --s5, --s6');
  if (acceptance) return { stage: manualContext ? 'context' : 'acceptance', driver: null, installDriver: false };
  // No implicit default: preparing a profile rewrites its extensions, so the stage must be named.
  if (selected.length === 0) throw new Error('Pass one of --context, --live-core, --recover-organization, --web-resume, --embed, --live-model, --s5, --s6, or --acceptance');
  const stage = selected[0];
  return { stage, driver: argv.includes('--native') ? 'tests/host/native-action-driver.ts' : HOST_DRIVERS[stage], installDriver: true };
}

/**
 * S6 uses a virgin tree so the signed-in `.zotero-chatgpt-dev/profile` is never overwritten.
 * @param {string[]} argv
 * @param {string} repositoryRoot
 */
export function selectHostTree(argv, repositoryRoot) {
  const { stage } = selectHostStage(argv);
  const dev = join(repositoryRoot, '.zotero-chatgpt-dev');
  if (stage === 'context' || stage === 'live-core' || stage === 'recover-organization') {
    const runId = readRunId(argv);
    const reuseId = readReuseId(argv);
    const reportId = readReportId(argv);
    if (['live-core', 'recover-organization'].includes(stage) && runId) throw new Error(`--${stage} reuses the preserved context profile and does not accept --run-id`);
    const contextRoot = runId || reuseId ? join(dev, 'context-runs', runId ?? reuseId) : join(dev, 'context');
    return {
      stage,
      profile: join(contextRoot, 'profile'),
      dataDir: join(contextRoot, 'data'),
      reportPath: join(contextRoot, reuseId ? `host-live-${reportId}.json` : 'host-report.json'),
      pdfPath: join(contextRoot, 'fixtures', reuseId ? `live-reading-${reportId}.pdf` : 'reading.pdf'),
      cleanRuntimeTree: Boolean(runId),
      ...(reuseId ? { reuseExisting: true, supplementPdfPath: join(contextRoot, 'fixtures', `live-supplement-${reportId}.pdf`) } : {}),
      ...(runId ? { exclusiveRoot: contextRoot } : {}),
    };
  }
  // Browser-surface embedding experiment, isolated in its own `.zotero-chatgpt-dev/embed` tree so a
  // ChatGPT session created there is never confused with the product acceptance profile.
  if (stage === 'embed') return { stage, profile: join(dev, 'embed/profile'), dataDir: join(dev, 'embed/data'), reportPath: join(dev, 'embed/host-report.json'), pdfPath: join(dev, 'embed/fixtures/reading.pdf') };
  if (stage === 'web-resume') return { stage, profile: join(dev, 'embed/profile'), dataDir: join(dev, 'embed/data'), reportPath: join(dev, 'embed/host-report.json'), pdfPath: join(dev, 'embed/fixtures/reading.pdf') };
  // Human-gated model-catalog measurement, isolated in its own `.zotero-chatgpt-dev/live` tree.
  if (stage === 'live-model') return { stage, profile: join(dev, 'live/profile'), dataDir: join(dev, 'live/data'), reportPath: join(dev, 'live/host-report.json'), pdfPath: join(dev, 'live/fixtures/reading.pdf') };
  if (stage === 's6') {
    const twoVersion = argv.includes('--upgrade-xpi') && argv.includes('--rollback-xpi');
    const root = join(dev, twoVersion ? 's6-upgrade' : 's6-virgin');
    return {
      stage,
      profile: join(root, 'profile'),
      dataDir: join(root, 'data'),
      reportPath: join(root, 'host-report.json'),
      pdfPath: join(root, 'fixtures', 'reading.pdf'),
    };
  }
  return {
    stage,
    profile: join(dev, 'profile'),
    dataDir: join(dev, 'data'),
    reportPath: join(dev, 'host-report.json'),
    pdfPath: join(dev, 'fixtures', 'reading.pdf'),
  };
}
