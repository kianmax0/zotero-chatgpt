/* global Zotero, ChromeUtils, PathUtils, IOUtils, Cu */
// Current-PDF local preparation, citation source, consent, refusal, attachment identity and UI
// performance on a real host. Only --live sends bounded synthetic requests.
async function runHostSmoke(config) {
  const verificationToken = typeof config.verificationToken === 'string' && /^RUN-[a-f0-9]{24}$/u.test(config.verificationToken) ? config.verificationToken : 'ORCHID-72';
  const report = { startedAt: new Date().toISOString(), stage: 'current-pdf', status: 'running', checks: [], notRun: ['real-model-answer', 'live-status-shows-responding-and-waiting-seconds', 'official-login', 'in-flight-model-stop', 'long-term-memory', 'image-understanding'], build: { version: config.subjectVersion, sha256: config.artifactHash, driverSourceHash: config.driverSourceHash ?? null }, fixture: { verificationToken } };
  const delay = ms => Zotero.Promise.delay(ms);
  const save = () => Zotero.File.putContentsAsync(config.reportPath, JSON.stringify(report, null, 2));
  let step = 'startup';
  const until = async (predicate, label, timeout = 20000) => {
    step = label; const start = Date.now();
    while (Date.now() - start < timeout) { const value = await predicate(); if (value) return value; await delay(10); }
    throw new Error(`Timed out: ${label}`);
  };
  const check = async (name, ok, details = {}) => { step = name; report.checks.push({ name, ok: Boolean(ok), details }); await save(); if (!ok) throw new Error(`Check failed: ${name}`); };
  // A genuinely absent capability is recorded as not-run with its reason, never as a pass.
  const skip = async (name, reason) => { if (!report.notRun.includes(name)) report.notRun.push(name); report.skips = { ...(report.skips || {}), [name]: reason }; await save(); };
  const click = node => { if (!node) throw new Error('Expected UI control is missing'); node.focus(); node.click(); };
  // A single-page PDF with an empty content stream: the host loads it, extracts no text and the
  // request boundary must refuse it out loud instead of sending an empty context.
  const blankPdfText = () => {
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>', '<< /Length 0 >>\nstream\n\nendstream'];
    let output = '%PDF-1.4\n'; const offsets = [0];
    for (const [index, body] of objects.entries()) { offsets.push(output.length); output += `${index + 1} 0 obj\n${body}\nendobj\n`; }
    const xref = output.length;
    output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
    output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return output;
  };
  let restoreInstrumentation = () => {};
  const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
  try {
    await Zotero.initializationPromise;
    const contextProfile = String(config.profile).match(/^(.*\/\.zotero-chatgpt-dev\/(?:context|context-runs\/[a-z0-9][a-z0-9-]{0,63}))\/profile$/u);
    await check('isolated-context-profile', PathUtils.profileDir === config.profile && Boolean(contextProfile) && config.dataDir === `${contextProfile?.[1]}/data` && Zotero.DataDirectory.dir === config.dataDir);
    const win = await until(() => Zotero.getMainWindow(), 'main-window');
    report.environment = { zotero: Zotero.version, width: win.innerWidth, height: win.innerHeight, devicePixelRatio: win.devicePixelRatio };
    await until(() => win.ZoteroPane?.loaded && win.ZoteroPane?.itemsView, 'library-ready');
    await Zotero.Libraries.get(Zotero.Libraries.userLibraryID).waitForDataLoad('item');
    const addon = await AddonManager.getAddonByID(config.subjectID); if (addon?.userDisabled) await addon.enable();
    await check('full-xpi-active', addon?.isActive && addon.version === config.subjectVersion);
    const libraryAgentEntry = await until(() => win.document.querySelector('[data-zchatgpt-library-agent]'), 'library-agent-entry');
    await check('library-agent-entry-visible-without-reader', Boolean(libraryAgentEntry && !libraryAgentEntry.hidden), { openReaders: Zotero.Reader._readers.length });
    click(libraryAgentEntry);
    const libraryAgentPanel = await until(() => win.document.querySelector('[data-zchatgpt-library-agent-panel]:not([hidden])'), 'library-agent-panel');
    await check('library-agent-opens-without-reader', Boolean(libraryAgentPanel), { openReaders: Zotero.Reader._readers.length });
    click(libraryAgentPanel.querySelector('[aria-label="Close Zotero Agent"]'));
    const title = 'ZCHATGPT current-PDF synthetic context and native interaction test';
    const parent = new Zotero.Item('journalArticle'); parent.setField('title', title);
    let organizationFixture = null;
    if (config.liveCoreFlows) {
      const libraryID = Zotero.Libraries.userLibraryID;
      const controlCollection = new Zotero.Collection(); controlCollection.libraryID = libraryID; controlCollection.name = `Synthetic preserved collection ${verificationToken}`; await controlCollection.saveTx();
      const targetCollection = new Zotero.Collection(); targetCollection.libraryID = libraryID; targetCollection.name = `Synthetic target collection ${verificationToken}`; await targetCollection.saveTx();
      parent.addTag(`preserve-parent-${verificationToken}`); parent.addToCollection(controlCollection.key);
      organizationFixture = { controlCollection, targetCollection, peer: null };
    }
    const queue = new Zotero.Notifier.Queue(); await parent.saveTx({ notifierQueue: queue });
    if (organizationFixture) {
      const peer = new Zotero.Item('journalArticle'); peer.libraryID = Zotero.Libraries.userLibraryID; peer.setField('title', `Synthetic selected peer ${verificationToken}`); peer.addTag(`preserve-peer-${verificationToken}`); peer.addToCollection(organizationFixture.controlCollection.key); await peer.saveTx({ notifierQueue: queue }); organizationFixture.peer = peer;
    }
    const a = await Zotero.Attachments.importFromFile({ file: config.pdfPath, parentItemID: parent.id, title: 'Main synthetic PDF', saveOptions: { notifierQueue: queue } });
    const b = await Zotero.Attachments.importFromFile({ file: config.supplementPdfPath ?? config.pdfPath, parentItemID: parent.id, title: 'Supplement synthetic PDF', saveOptions: { notifierQueue: queue } });
    await Promise.all([parent.loadAllData(), a.loadAllData(), b.loadAllData(), ...(organizationFixture?.peer ? [organizationFixture.peer.loadAllData()] : [])]); await Zotero.Notifier.commit(queue);
    win.Zotero_Tabs.closeAll(); await until(() => Zotero.Reader._readers.length === 0, 'close-only-this-profile-tabs');
    Zotero.Prefs.set('extensions.zchatgpt.automaticPdfText', true, true);
    Zotero.Prefs.set('extensions.zchatgpt.pdfTextDisclosureSeen', false, true);
    // Falsifiability control, off unless its marker file is present: with the product's own opt-out
    // stored before the reader opens, its presenter is built with document reading disabled and must
    // not read this PDF at all. The run then fails at the preparation check with no host observation,
    // which is what keeps that check able to fail. Nothing else about the driver changes.
    const optOutControl = await IOUtils.exists(PathUtils.join(config.profile, 'zchatgpt-control-opt-out'));
    if (optOutControl) Zotero.Prefs.set('extensions.zchatgpt.automaticPdfText', false, true);
    // --- The product's own automatic whole-PDF preparation, observed with nothing of the driver's on the
    // document ---
    // What a3 measured here was its own instrument. It wrapped `getPageData`/`getPageLabels2` on the
    // reader's PDF object, proved by a call through that same object that its wrapper was reachable, and
    // then waited for the product's page calls. The control proved only that the driver's own access path
    // lands in the wrapper; it said nothing about the product's. Measured without any wrapper, the
    // product's preparation completes on this host, while every run with the wrapper installed recorded
    // the product's read failing (`Permission denied to access property "length"` on the wrapped object)
    // and, later, every PDF-dependent check in the stage failing behind it. The instrument was the fault,
    // and the earlier "observable" control could not have detected that.
    // What is observed instead are two host objects the product looks up on its own, with no replacement
    // of any reader method:
    //   * `io.stat(path)` and `io.computeHexDigest(path, 'sha256')` are the revision gate of the product's
    //     `capture()`; `capture()` runs once per `prepare()` and once more from `validate()`, and
    //     `validate()` is only reached after the whole-document read returned a document. So a second
    //     resolved digest for this file is the product having read and prepared this PDF by itself, with
    //     the sidebar opened and nothing sent.
    // The driver's own disk probe runs before the trigger and is excluded by `driverProbeAt`, so what is
    // counted is only the product's work; arming is verified by identity, so a refused replacement fails
    // the check out loud rather than silently degrading it into a pass.
    // `TextEncoder.prototype.encode` is still counted for information, but it cannot carry the assertion:
    // the plugin's `TextEncoder` is injected from the bootstrap scope, so the product's page-text
    // measurements never reach this driver's prototype (0 observed while preparation demonstrably ran).
    const t0 = Date.now();
    const observations = [];
    const counts = { stat: 0, digest: 0, encode: 0, encodePageText: 0, encodeJson: 0, statExpected: 0, digestExpected: 0 };
    // The driver's own revision probe below also stats and hashes this file. That probe is not the
    // product, so the product's own gate is counted only from after it, never including it.
    let driverProbeAt = Infinity;
    const prefReads = [];
    const logErrors = [];
    const restoreHost = [];
    const OBSERVATION_LIMIT = 240;
    const frames = () => { try { return String(new Error().stack || '').split('\n').slice(1, 4).map(line => line.trim().replace(/^at\s+/u, '').slice(0, 110)); } catch { return []; } };
    const observeHost = (target, name, label, detail, keep) => {
      const original = target[name];
      if (typeof original !== 'function') return false;
      const wrapper = function (...args) {
        const entry = { label, ms: Date.now() - t0 };
        try { Object.assign(entry, detail(args) ?? {}); } catch { /* the detail is best effort */ }
        if (observations.length < OBSERVATION_LIMIT && keep(entry, args)) { if (!('stack' in entry) && keep !== undefined) entry.stack = frames(); observations.push(entry); }
        let result;
        try { result = original.apply(this, args); } catch (error) { entry.error = String((error && error.message) || error); throw error; }
        if (result && typeof result.then === 'function') return result.then(value => { entry.ok = true; return value; }, error => { entry.error = String((error && error.message) || error); throw error; });
        entry.ok = true; return result;
      };
      try { target[name] = wrapper; } catch { return false; }
      if (target[name] !== wrapper) return false;
      restoreHost.push(() => { target[name] = original; });
      return true;
    };
    const nativePrefGet = Zotero.Prefs.get;
    Zotero.Prefs.get = function (pref, global) { const value = nativePrefGet.call(this, pref, global); if (String(pref).includes('automaticPdfText')) prefReads.push({ ms: Date.now() - t0, enabled: value !== false }); return value; };
    const nativeLogError = Zotero.logError;
    Zotero.logError = function (error) { logErrors.push({ ms: Date.now() - t0, message: String((error && error.message) || error), stack: String((error && error.stack) || '').split('\n').slice(1, 4).map(line => line.trim()) }); return nativeLogError.call(this, error); };
    restoreInstrumentation = () => { Zotero.Prefs.get = nativePrefGet; Zotero.logError = nativeLogError; for (const restore of restoreHost.reverse()) restore(); };
    const expectedFile = String((await Zotero.Items.get(a.id).getFilePathAsync()) ?? '').split('/').pop();
    const armed = {
      stat: observeHost(IOUtils, 'stat', 'stat', args => ({ file: String(args[0] ?? '').split('/').pop() }), entry => { counts.stat += 1; if (entry.file === expectedFile && entry.ms > driverProbeAt) counts.statExpected += 1; return entry.file === expectedFile || observations.filter(item => item.label === 'stat').length < 10; }),
      digest: observeHost(IOUtils, 'computeHexDigest', 'computeHexDigest', args => ({ file: String(args[0] ?? '').split('/').pop(), algorithm: args[1] ?? null }), entry => { counts.digest += 1; if (entry.file === expectedFile && entry.ms > driverProbeAt) counts.digestExpected += 1; return entry.file === expectedFile; }),
      encode: observeHost(TextEncoder.prototype, 'encode', 'encode', args => ({ characters: typeof args[0] === 'string' ? args[0].length : null, jsonShaped: typeof args[0] === 'string' && /^[[{]/u.test(args[0]), head: typeof args[0] === 'string' ? args[0].slice(0, 40) : null }), (entry, args) => {
        counts.encode += 1;
        const text = typeof args[0] === 'string' ? args[0] : '';
        if (entry.jsonShaped) counts.encodeJson += 1;
        const pageText = !entry.jsonShaped && text.length >= 200;
        if (pageText) counts.encodePageText += 1;
        // Keep the page-sized, non-JSON encodings (the product measuring extracted page text) and the
        // small handful of others, but never the flood of per-character measurements `clipToBytes` makes.
        return pageText ? counts.encodePageText <= 8 : (entry.characters ?? 0) >= 200 && observations.filter(item => item.label === 'encode').length < 12;
      }),
    };
    const observedGate = () => observations.find(entry => entry.label === 'stat' && entry.file === expectedFile) && observations.find(entry => entry.label === 'computeHexDigest' && entry.file === expectedFile && entry.algorithm === 'sha256' && entry.ok);
    const observedPageTexts = () => observations.filter(entry => entry.label === 'encode' && entry.jsonShaped === false && (entry.characters ?? 0) >= 200);
    await check('read-observation-armed-on-shared-host-apis', Boolean(armed.stat && armed.digest && expectedFile), { armed, file: expectedFile, optOutControl, note: 'The encode counter is informational: the plugin TextEncoder is a different object from this scope\'s, so it cannot be required.' });
    const preparation = {
      expectedFile,
      optOutControl,
      automaticPdfTextReads: prefReads,
      productLoggedErrors: logErrors,
      note: 'Assertion source: IOUtils.stat + IOUtils.computeHexDigest + TextEncoder.prototype.encode, all called by the product on this PDF. This driver never calls them on this PDF.',
    };
    report.preparation = preparation;
    const opened = await Zotero.Reader.open(a.id); let tabId = opened.tabID;
    const openedMs = Date.now() - t0;
    const reader = () => Zotero.Reader.getByTabID(tabId);
    const rdoc = () => reader()?._iframeWindow?.document;
    const panel = () => rdoc()?.querySelector('[data-zchatgpt-chat]');
    const shell = () => rdoc()?.querySelector('[data-zchatgpt-sidebar]');
    const toggle = () => rdoc()?.querySelector('[data-zchatgpt-toggle]');
    const input = () => panel()?.querySelector('[data-zchatgpt-input]');
    const pdf = () => reader()._internalReader._primaryView._iframeWindow.PDFViewerApplication;
    const pdfViewer = () => pdf().pdfViewer;
    const view = () => reader()._internalReader._primaryView;
    const viewWin = () => view()._iframeWindow;
    const contextRing = () => panel()?.querySelector('[data-zchatgpt-context-usage]');
    // The active citation line lives in `More → Paper & context details`, which is part of the common
    // shell, not of the chat section the ring is mounted in.
    const contextSource = () => shell()?.querySelector('[data-zchatgpt-context-source]');
    const disclosure = () => rdoc()?.querySelector('[data-zchatgpt-context-disclosure]');
    const refusalAlert = () => panel()?.querySelector('p.zchatgpt-error:not([data-zchatgpt-view-error])');
    const contextScale = () => shell()?.style.getPropertyValue('--zchatgpt-chat-text-scale') ?? '';
    // Every selector that belonged to the deleted PDF-context panel. None may ever render again.
    const REMOVED_PANEL_SELECTORS = ['[data-zchatgpt-document-context]', '.zchatgpt-document-panel', '.zchatgpt-context-range', '[data-zchatgpt-context-summary]', '[data-zchatgpt-automatic-pdf]'];
    const panelSelectorsAbsent = () => { const doc = rdoc(); return Boolean(doc) && REMOVED_PANEL_SELECTORS.every(selector => !doc.querySelector(selector)); };
    await until(() => reader()?._internalReader?._primaryView?._iframeWindow?.PDFViewerApplication?.pdfDocument, 'pdf-loaded');
    await until(() => toggle(), 'toolbar-toggle');
    // --- Diagnostic: the disk side of the product's own revision precondition ---
    // capture() compares a sha256 of the whole loaded PDF against a sha256 of the file on disk, and a
    // non-match rejects the preparation with "The PDF file changed while this reader was open." This
    // records the disk side only. The loaded side is deliberately left to the product's own `getData`
    // call below, so this driver never reads the document data itself and cannot consume a read the
    // product would then be the first to perform.
    try {
      const nativePath = await Zotero.Items.get(a.id).getFilePathAsync();
      const nativeStat = await IOUtils.stat(nativePath);
      const diskSha = await IOUtils.computeHexDigest(nativePath, 'sha256');
      report.revisionPrecondition = { file: nativePath.split('/').pop(), diskSize: nativeStat.size, diskSha, loadedSide: "observed from the product's own getData call below" };
    } catch (error) { report.revisionPrecondition = { error: String((error && error.message) || error) }; } finally { driverProbeAt = Date.now() - t0; }
    // --- a3's own instrument, re-armed where a3 armed it, widened to record the whole product read ---
    // a3 wrapped only `getPageData`/`getPageLabels2`, and it armed them after reading both pages itself,
    // so a hit meant "the product read again after this point". This run keeps that wrapper and adds the
    // rest of the product's read path on the same reader object (`getData`, the revision fields, the
    // labels call), because the archived run's own host observations show the product's capture() gate
    // (stat + sha256 of this file) running and then no page call. Everything recorded below belongs to
    // the product; the probe is a3's own reachability check and its record is cleared the same way.
    const legacy = { wrapMs: Date.now() - t0, probeRecorded: false, armed: false, calls: { getData: 0, labels: 0, pageData: [], numPages: 0, fingerprints: 0 }, order: [] };
    // Replacing a method on this object is not observationally neutral, so it is off unless its marker is
    // present. Every run that installed the wrapper also reported the product's read failing, and the one
    // archived run that installed nothing (`host-report-0.4.0a3-DIAG4`) counted the product's own
    // preparation as working; the default run therefore observes only host APIs the product looks up
    // itself, and the wrapper is kept for a marked diagnostic run.
    const wrapPdfInstrument = await IOUtils.exists(PathUtils.join(config.profile, 'zchatgpt-control-wrap-pdf'));
    if (wrapPdfInstrument) {
      const pdfObject = pdf().pdfDocument;
      const native = { getData: pdfObject.getData, getPageLabels2: pdfObject.getPageLabels2, getPageData: pdfObject.getPageData };
      const descriptors = {
        numPages: Object.getOwnPropertyDescriptor(pdfObject, 'numPages') ?? null,
        fingerprints: Object.getOwnPropertyDescriptor(pdfObject, 'fingerprints') ?? null,
      };
      const numPagesValue = pdfObject.numPages; const fingerprintsValue = [...(pdfObject.fingerprints ?? [])];
      const note = entry => legacy.order.push({ ...entry, ms: Date.now() - t0, stack: frames().slice(0, 3) });
      // A second consumer of the same promise: the product's own reference is returned untouched.
      const watch = (result, onValue) => { void (async () => { try { onValue(await result); } catch (error) { legacy.watchError = String((error && error.message) || error); } })(); };
      const previousRestore = restoreInstrumentation;
      try {
        pdfObject.getData = function (...args) {
          legacy.calls.getData += 1;
          const record = note({ call: 'getData' });
          let result;
          try { result = native.getData.apply(this, args); } catch (error) { record.error = String((error && error.message) || error); throw error; }
          record.isThenable = Boolean(result && typeof result.then === 'function');
          void watch(result, value => {
            record.settled = true; record.byteLength = value?.byteLength ?? null; record.tag = Object.prototype.toString.call(value);
          });
          return result;
        };
        pdfObject.getPageLabels2 = function (...args) {
          legacy.calls.labels += 1;
          const record = note({ call: 'getPageLabels2' });
          const result = native.getPageLabels2.apply(this, args);
          void watch(result, value => { record.settled = true; try { record.labels = Array.isArray(value) ? value.length : null; } catch (error) { record.labelsError = String((error && error.message) || error); } });
          return result;
        };
        pdfObject.getPageData = function (...args) {
          const pageIndex = args[0]?.pageIndex ?? null; legacy.calls.pageData.push(pageIndex);
          const record = note({ call: 'getPageData', pageIndex });
          const result = native.getPageData.apply(this, args);
          void watch(result, value => {
            record.settled = true;
            // The resolved value is a native object; reading its array across Xrays can be refused. The
            // refusal must be recorded, never thrown from this observer, or it would kill the run.
            try {
              const chars = Array.isArray(value?.chars) ? value.chars : Cu.waiveXrays(value?.chars);
              record.chars = Array.isArray(chars) ? chars.length : null;
              record.textCharacters = Array.isArray(chars) ? chars.reduce((total, char) => total + (char.ignorable ? 0 : 1), 0) : null;
            } catch (error) { record.charsError = String((error && error.message) || error); }
          });
          return result;
        };
        Object.defineProperty(pdfObject, 'numPages', { configurable: true, get() { legacy.calls.numPages += 1; note({ call: 'numPages' }); return numPagesValue; } });
        Object.defineProperty(pdfObject, 'fingerprints', { configurable: true, get() { legacy.calls.fingerprints += 1; note({ call: 'fingerprints' }); return fingerprintsValue; } });
      } catch { /* keep whatever could not be wrapped; the records then show only that */ }
      restoreInstrumentation = () => {
        previousRestore();
        pdfObject.getData = native.getData; pdfObject.getPageLabels2 = native.getPageLabels2; pdfObject.getPageData = native.getPageData;
        for (const [name, descriptor] of Object.entries(descriptors)) { try { if (descriptor) Object.defineProperty(pdfObject, name, descriptor); else delete pdfObject[name]; } catch { /* the reader may already be gone */ } }
      };
      legacy.armed = true; legacy.armedMs = Date.now() - t0;
    }
    report.nativePreparation = wrapPdfInstrument ? 'pdf-object-wrapper-armed-by-marker' : 'host-apis-only';
    // Everything the product-side preparation assertion reports. Written before the trigger so a run
    // that dies inside the wait still leaves the instrument state on disk.
    report.backgroundPreparation = {
      expectedFile,
      control: optOutControl ? 'automaticPdfText-off' : null,
      openedMs,
      legacyWrapMs: legacy.wrapMs,
      legacyProbeRecorded: legacy.probeRecorded,
      automaticPdfTextReads: prefReads,
      productLoggedErrors: logErrors,
      counts: { ...counts },
      productVisible: {
        sidebarOpen: Boolean(panel()),
        runtime: panel()?.dataset.zchatgptRuntime ?? null,
        auth: panel()?.dataset.zchatgptAuth ?? null,
        contextState: contextRing()?.dataset.zchatgptContextState ?? null,
      },
      wrapPdfInstrument,
      note: 'Assertion source: the product\'s own revision gates for this file (IOUtils.stat + computeHexDigest, counted only after the driver\'s own disk probe). A second gate means the product reached its own validate() after reading the whole document. The driver never calls those on this PDF.',
    };
    // --- The product's own trigger: its toolbar toggle opens the sidebar, whose own copy says that
    // opening it prepares local text (chat/view.ts). a3 clicked here and then waited for the product's
    // page calls; this driver observes the product's host APIs across the same click, so the wait now
    // rests on evidence the product itself produced instead of on the reader object a3 wrapped. ---
    report.toggleClickedMs = Date.now() - t0;
    const coldStart = win.performance.now(); toggle().click();
    await until(() => input(), 'immediate-input');
    report.coldInputMs = win.performance.now() - coldStart;
    // KaTeX must load through the add-on's narrow resource mapping inside the real reader document.
    // `link.sheet` and readable rules are host evidence; a source-string href alone cannot prove CSS
    // or fonts survived Gecko's security boundary.
    const katexLink = await until(() => rdoc()?.querySelector('link[data-zchatgpt-katex-css]'), 'katex-stylesheet-link', 30000);
    await until(() => katexLink.sheet, 'katex-stylesheet-loaded', 30000);
    const katexStyle = { href: katexLink.getAttribute('href'), sheet: Boolean(katexLink.sheet), rulesAccessible: false, ruleCount: 0, hasKatexRule: false, accessError: null };
    try {
      const rules = [...katexLink.sheet.cssRules]; katexStyle.rulesAccessible = true; katexStyle.ruleCount = rules.length;
      katexStyle.hasKatexRule = rules.some(rule => rule.type === 5 || /@font-face|\.katex\b/u.test(String(rule.cssText ?? '')));
    } catch (error) { katexStyle.accessError = String(error?.name ?? 'UnknownError').slice(0, 80); }
    await check('katex-stylesheet-loads-through-scoped-resource',
      katexStyle.href === 'resource://zotero-chatgpt-katex/katex.min.css' && katexStyle.sheet && katexStyle.rulesAccessible && katexStyle.ruleCount > 0 && katexStyle.hasKatexRule,
      katexStyle);
    // --- The composer's Chat / Agent routing control, in the real dock ---
    // The unit DOM cannot reproduce this: the option's pressed fill and pill geometry are
    // `.zchatgpt-mode-option[...]`, so rendering the options with the generic `.zchatgpt-button`
    // skin (the regression this observes) leaves the selected mode invisible and the control
    // looking like two plain buttons. `aria-pressed` is painted from presenter state, so a real
    // click that does not move it means the switch is not wired. Nothing here sends a request.
    const modeSwitch = () => shell()?.querySelector('[data-zchatgpt-mode-switch]');
    const modeButton = mode => modeSwitch()?.querySelector(`[data-zchatgpt-action="mode-${mode}"]`);
    const pressed = mode => modeButton(mode)?.getAttribute('aria-pressed') === 'true';
    await until(() => modeSwitch() && modeButton('chat') && modeButton('agent'), 'mode-switch-rendered');
    const modeShape = {
      role: modeSwitch().getAttribute('role'),
      groupLabel: modeSwitch().getAttribute('aria-label'),
      chatText: (modeButton('chat').textContent ?? '').trim(),
      mode: modeSwitch().dataset.zchatgptMode,
      chatPressed: pressed('chat'), agentPressed: pressed('agent'),
      chatSegmented: modeButton('chat').classList.contains('zchatgpt-mode-option') && modeButton('agent').classList.contains('zchatgpt-mode-option'),
      genericButtonSkin: modeButton('chat').classList.contains('zchatgpt-button') || modeButton('agent').classList.contains('zchatgpt-button'),
      visible: !modeSwitch().closest('[hidden]'),
      // UI-01: the switch is fixed in the common shell bar in both modes, never reparented into
      // the hosted Chat bar or the composer.
      inShellBar: Boolean(modeSwitch()?.closest('[data-zchatgpt-shell-bar]')),
      inComposer: Boolean(modeSwitch()?.closest('[data-zchatgpt-composer-leading]')),
      inEmbedNotice: Boolean(modeSwitch()?.closest('[data-zchatgpt-embed-notice]')),
      // P-01: the normal header is one row. No permanent context row, no legacy action strip.
      contextRow: Boolean(shell()?.querySelector('[data-zchatgpt-shell-context]')),
      documentStatus: Boolean(shell()?.querySelector('[data-zchatgpt-document-status]')),
      legacyEmbedBar: Boolean(shell()?.querySelector('[data-zchatgpt-embed-bar]')),
      shellBars: shell()?.querySelectorAll('[data-zchatgpt-shell-bar]').length ?? 0,
      paperActions: [...(shell()?.querySelectorAll('[data-zchatgpt-paper-actions] button') ?? [])].map(node => node.dataset.zchatgptAction ?? ''),
    };
    await check('mode-selector-defaults-to-chat-with-segmented-options',
      modeShape.role === 'group' && Boolean(modeShape.groupLabel) && modeShape.mode === 'chat' && modeShape.chatPressed && !modeShape.agentPressed
        && modeShape.chatSegmented && !modeShape.genericButtonSkin && modeShape.visible && modeShape.inShellBar && !modeShape.inComposer && !modeShape.inEmbedNotice,
      modeShape);
    await check('single-row-common-header-with-the-two-paper-actions',
      modeShape.shellBars === 1 && !modeShape.contextRow && !modeShape.documentStatus && !modeShape.legacyEmbedBar
        && !modeShape.paperActions.includes('copy-selection')
        && (modeShape.paperActions.length === 0
          || (modeShape.paperActions.length === 2 && modeShape.paperActions.includes('copy-paper-context') && modeShape.paperActions.includes('copy-pdf-file'))),
      modeShape);
    // --- Chat is not an Agent path, observed on the real dock ---
    // There is no supported Chat transport in this build, so Chat mode must state that itself rather
    // than borrow the Agent sign-in line, and it must not render Agent-only chrome (sign-in, retry).
    // `aria-hidden`/`hidden` reading is why this belongs to the real dock: the presenter state can be
    // right while the painted chrome is not.
    const statusLine = () => panel()?.querySelector('p.zchatgpt-status-line');
    const authButton = action => panel()?.querySelector(`[data-zchatgpt-action="${action}"]`);
    const timingRow = () => panel()?.querySelector('[data-zchatgpt-request-timing]');
    const timingText = () => timingRow()?.querySelector('[data-zchatgpt-request-timing-text]')?.textContent ?? '';
    const CHAT_UNAVAILABLE_COPY = ['Chat is unavailable in this build. Use Agent mode.', '此版本未集成 Chat 通道，请使用 Agent 模式。'];
    // The shared client resolves asynchronously, so Chat's own status is observed after the panel has
    // settled on its runtime, not at the instant the input appears. The observed state and the panel's
    // own alert are recorded either way: a failure here must name what the dock actually showed.
    const settled = await until(() => ['ready', 'error'].includes(panel()?.dataset.zchatgptRuntime ?? ''), 'chat-runtime-settled', 30000).catch(() => null);
    const settledState = {
      runtime: panel()?.dataset.zchatgptRuntime ?? null,
      auth: panel()?.dataset.zchatgptAuth ?? null,
      status: statusLine()?.textContent ?? null,
      alert: panel()?.querySelector('p.zchatgpt-error:not([data-zchatgpt-view-error])')?.textContent ?? null,
    };
    await check('chat-runtime-settles-without-codex', settled !== null && settledState.runtime === 'ready', settledState);
    await until(() => CHAT_UNAVAILABLE_COPY.includes(statusLine()?.textContent ?? ''), 'chat-mode-status', 30000).catch(() => undefined);
    const chatModeUi = {
      mode: modeSwitch().dataset.zchatgptMode,
      status: statusLine()?.textContent ?? null,
      loginHidden: authButton('login')?.hidden ?? null,
      retryHidden: authButton('retry')?.hidden ?? null,
      sendDisabled: authButton('send')?.disabled ?? null,
      timingHidden: timingRow()?.hidden ?? null,
      timingText: timingText(),
    };
    await check('chat-mode-states-its-own-unavailable-transport',
      chatModeUi.mode === 'chat' && CHAT_UNAVAILABLE_COPY.includes(chatModeUi.status)
        && chatModeUi.loginHidden === true && chatModeUi.retryHidden === true && chatModeUi.sendDisabled === true,
      chatModeUi);
    // Nothing was sent, so the shared timing row must stay hidden instead of inventing an elapsed
    // value. The row is rendered from `conversation.requestTiming` alone, for both modes.
    await check('chat-mode-shows-no-invented-request-timing', chatModeUi.timingHidden === true && chatModeUi.timingText === '', chatModeUi);
    // --- Lazy Codex, observed on the real filesystem and in the real process list ---
    // `prepareRuntime` is the only writer of these private directories and the only caller of the
    // bundled executable, and it runs only when an Agent action asks for the Codex channel.
    // `records/` is created by local chat storage and is deliberately not probed; nothing here reads
    // account/ contents, only whether the directory exists. The process probe matches a Codex command
    // line by this profile's own runtime path, so the owner's normal Zotero session (a different
    // profile) can never be mistaken for it. The settle delay is part of the check: the eager start
    // this refactor removed was asynchronous, so a probe taken the instant the panel appears could
    // miss it and report a lazy start that had not happened yet.
    const runtimeRoot = PathUtils.join(PathUtils.join(config.profile, 'zotero-chatgpt'), 'v1');
    const runtimeDir = name => IOUtils.exists(PathUtils.join(runtimeRoot, name));
    const { Subprocess } = ChromeUtils.importESModule('resource://gre/modules/Subprocess.sys.mjs');
    const codexProcesses = async () => {
      const child = await Subprocess.call({ command: '/bin/ps', arguments: ['-axo', 'pid=,args='], stderr: 'pipe' });
      const decoder = new TextDecoder(); let text = '';
      for (let bytes = await child.stdout.read(); bytes.byteLength !== 0; bytes = await child.stdout.read()) text += decoder.decode(bytes, { stream: true });
      text += decoder.decode(); await child.wait();
      return text.split('\n').filter(line => line.includes(`${runtimeRoot}/runtime/`) && line.includes('app-server')).map(line => line.trim().slice(0, 220));
    };
    await delay(5000);
    let codexBefore = null;
    try { codexBefore = await codexProcesses(); }
    catch (error) { await skip('chat-only-sidebar-use-starts-no-codex-process', `The process probe itself failed: ${String((error && error.message) || error)}`); }
    if (codexBefore !== null) {
      await check('chat-only-sidebar-use-starts-no-codex-process', codexBefore.length === 0, { matches: codexBefore, runtimeRoot });
      const chatOnlyDirs = { home: await runtimeDir('home'), scratch: await runtimeDir('scratch'), account: await runtimeDir('account'), tmp: await runtimeDir('tmp') };
      // A `--live` run is already signed in, so that tree existed before the sidebar opened and its
      // presence proves nothing about lazy startup. Report that instead of asserting a precondition
      // the run does not satisfy; the process check above still applies unchanged.
      if (config.cleanRuntimeTree === true) await check('chat-only-sidebar-use-does-not-prepare-codex', Object.values(chatOnlyDirs).every(exists => exists === false), { runtimeRoot, ...chatOnlyDirs });
      else await skip('chat-only-sidebar-use-does-not-prepare-codex', `The private runtime tree must already exist for this run (signed in for --live), so the virgin-tree precondition does not hold: ${JSON.stringify(chatOnlyDirs)}`);
    }
    click(modeButton('agent'));
    await until(() => pressed('agent') && modeSwitch().dataset.zchatgptMode === 'agent', 'mode-agent-selected');
    await check('mode-selector-click-selects-agent', pressed('agent') && !pressed('chat'), { mode: modeSwitch().dataset.zchatgptMode, agentPressed: pressed('agent') });
    // Selecting Agent is the first Agent action, and it is what lazily prepares the Codex runtime.
    const agentPrepared = await until(async () => {
      const dirs = { home: await runtimeDir('home'), scratch: await runtimeDir('scratch'), account: await runtimeDir('account') };
      return Object.values(dirs).every(Boolean) ? dirs : null;
    }, 'agent-mode-prepares-codex-lazily', 120000).catch(() => null);
    await check('agent-mode-prepares-codex-lazily', agentPrepared !== null,
      { prepared: agentPrepared, runtime: panel()?.dataset.zchatgptRuntime ?? null, alert: panel()?.querySelector('p.zchatgpt-error:not([data-zchatgpt-view-error])')?.textContent ?? null });
    if (codexBefore !== null) {
      const codexAfter = await until(async () => { const matches = await codexProcesses(); return matches.length ? matches : null; }, 'agent-mode-starts-codex-lazily', 60000).catch(() => null);
      await check('agent-mode-starts-codex-lazily', codexAfter !== null, { matches: codexAfter, runtimeRoot });
    }
    click(modeButton('chat'));
    await until(() => pressed('chat') && modeSwitch().dataset.zchatgptMode === 'chat', 'mode-chat-restored');
    await check('mode-selector-click-returns-to-chat', pressed('chat') && !pressed('agent'), { mode: modeSwitch().dataset.zchatgptMode, chatPressed: pressed('chat') });
    // Chat keeps its own status after Agent has started: the switch is not sticky in either direction.
    await check('chat-mode-keeps-its-own-status-after-agent',
      CHAT_UNAVAILABLE_COPY.includes(statusLine()?.textContent ?? '') && authButton('login')?.hidden === true,
      { status: statusLine()?.textContent ?? null, loginHidden: authButton('login')?.hidden ?? null });
    // Every request boundary below this point is an Agent request. This build has no ChatTransport,
    // so a Chat send can only be refused before it reaches any request logic; the blank-context
    // refusal and the live model turn must therefore run with Agent selected. Selecting it here is
    // also harmless in a signed-out run: the runtime is already started and is reused.
    click(modeButton('agent'));
    await until(() => pressed('agent') && modeSwitch().dataset.zchatgptMode === 'agent', 'mode-agent-restored-for-request-boundaries');
    await check('agent-mode-restored-before-request-boundaries', pressed('agent') && !pressed('chat'), { mode: modeSwitch().dataset.zchatgptMode });
    // The unsent tab is the new-session copy for the mode on screen — `New chat` in Chat, `New agent`
    // in Agent (UI-05) — in either interface language. It must not be named after the paper: paper
    // identity is carried by the attachment/context system, not by a tab label. The tab strip lives
    // in the common shell (beside the hosted Chat surface it is hidden), so this reads the shell
    // root: `panel()` is the chat section and does not contain the header.
    const unsentTab = () => shell()?.querySelector('[data-zchatgpt-current-title]');
    const NEW_SESSION_COPY = { chat: ['New chat', '新建对话'], agent: ['New agent', '新建 Agent 会话'] };
    const expectedNewCopy = NEW_SESSION_COPY[pressed('agent') ? 'agent' : 'chat'];
    await check('new-chat-tab-before-or-with-connection',
      unsentTab()?.dataset.zchatgptConversationId === 'new-chat'
        && expectedNewCopy.includes((unsentTab()?.querySelector('[data-zchatgpt-pane-label]')?.textContent ?? '').trim())
        && !unsentTab()?.textContent?.includes(title),
      { tabId: unsentTab()?.dataset.zchatgptConversationId ?? null, label: unsentTab()?.querySelector('[data-zchatgpt-pane-label]')?.textContent ?? null, expectedCopy: expectedNewCopy, articleTitle: title });
    // Wait for the product's own gate sequence for this file: one gate from `prepare()`, a second from
    // `validate()`, which it can only reach after the whole-document read returned. Nothing of the
    // driver's is on the document, and the wait can fail honestly.
    const readObserved = await until(() => counts.statExpected >= 1 && counts.digestExpected >= 2, 'automatic-background-preparation', 60000).catch(() => null);
    // Snapshot the live state again: the pre-trigger copy above cannot contain the product's own errors.
    report.preparation.productLoggedErrors = logErrors;
    report.preparation.prefReads = prefReads;
    report.preparation.counts = { ...counts };
    const pageTexts = observedPageTexts();
    const productPageCalls = legacy.order.filter(entry => entry.call === 'getPageData').map(entry => ({ pageIndex: entry.pageIndex, settled: entry.settled ?? false, chars: entry.chars ?? null, ms: entry.ms }));
    const productGetData = legacy.order.filter(entry => entry.call === 'getData').map(entry => ({ ms: entry.ms, settled: entry.settled ?? false, byteLength: entry.byteLength ?? null, error: entry.error ?? null }));
    const pageTextEvidence = pageTexts.map(entry => ({ ms: entry.ms, characters: entry.characters, head: entry.head }));
    const gateMs = observations.find(entry => entry.label === 'computeHexDigest' && entry.file === expectedFile && entry.ok && entry.ms > driverProbeAt)?.ms ?? null;
    const statMs = observations.find(entry => entry.label === 'stat' && entry.file === expectedFile && entry.ok && entry.ms > driverProbeAt)?.ms ?? null;
    const recorded = legacy.calls.pageData;
    const legacyVerdict = !wrapPdfInstrument
      ? 'wrapper not armed: the product was observed only through the host APIs it looks up itself'
      : recorded.includes(0) && recorded.includes(1)
        ? 'the a3 wrapper does see the product page calls; reachability was not the a3 problem'
        : productPageCalls.length === 0
          ? 'the product made no page call at all after its trigger: the read never started (see productGetData/productGate)'
          : 'the product read pages while the a3 wrapper recorded none of them';
    // --- a3's own reachability control, only meaningful while its wrapper is armed, and now run after the
    // product's turn so it cannot consume the read the product was about to perform.
    if (wrapPdfInstrument) {
      try {
        await pdf().pdfDocument.getPageData(Cu.cloneInto({ pageIndex: 0 }, viewWin()));
      } catch (error) { report.reachabilityError = String((error && error.message) || error); }
      legacy.probeRecorded = legacy.calls.pageData.includes(0);
      if (legacy.probeRecorded) { legacy.calls = { getData: 0, labels: 0, pageData: [], numPages: 0, fingerprints: 0 }; legacy.order = []; }
      report.nativePreparation = legacy.probeRecorded ? 'observable' : 'not-observable';
    }
    // --- Mechanism probe, run only after the product's own verdict is decided ---
    // Is the loaded-bytes read unavailable to everyone at this moment, or only to the product? The
    // driver asks the same host method twice: once right now, once after a page read has made the
    // document serviceable. A bounded race keeps a hang from stalling the rest of the stage.
    const probes = [];
    const probe = async label => {
      let timer = null;
      try {
        const work = Promise.resolve(pdf().pdfDocument.getData());
        const deadline = new Promise(resolve => { timer = Zotero.Promise.delay(20000).then(() => resolve('timeout')); });
        const size = value => { try { return value?.byteLength ?? (Array.isArray(value) ? value.length : 'value'); } catch (error) { return `size-denied:${(error && error.message) || error}`; } };
        const settled = work.then(value => `settled:${size(value)}`, error => `error:${(error && error.message) || error}`);
        probes.push(`${label}=${await Promise.race([settled, deadline])}`);
      } catch (error) { probes.push(`${label}=threw:${(error && error.message) || error}`); }
      finally { if (timer) clearTimeout(timer); }
    };
    if (wrapPdfInstrument) {
      await probe('getData-before-page-read');
      try { await pdf().pdfDocument.getPageData(Cu.cloneInto({ pageIndex: 0 }, viewWin())); } catch (error) { report.mechanismPageError = String((error && error.message) || error); }
      await probe('getData-after-page-read');
      report.mechanismProbe = probes;
    }
    // --- The driver's own native read, for comparison: same calls, but after the product's turn ---
    const extractPage = async pageIndex => {
      const raw = await pdf().pdfDocument.getPageData(Cu.cloneInto({ pageIndex }, viewWin()));
      return (raw?.chars ?? []).map(char => char.ignorable ? '' : char.c + (char.paragraphBreakAfter ? '\n\n' : char.lineBreakAfter ? '\n' : char.spaceAfter ? ' ' : '')).join('').trim();
    };
    const labels = await pdf().pdfDocument.getPageLabels2();
    const pageOne = await extractPage(0); const pageTwo = await extractPage(1);
    await check('two-pages-extracted', pdf().pdfDocument.numPages === 2 && labels?.length === 2, { numPages: pdf().pdfDocument.numPages, labels });
    report.nativeExtraction = { labels, pageOneCharacters: pageOne.length, pageTwoCharacters: pageTwo.length, pageTwoHasToken: pageTwo.includes(verificationToken) };
    await check('text-from-both-pages-and-page-labels', pageOne.includes('Synthetic page 1') && pageTwo.includes('Synthetic page 2') && pageTwo.includes(verificationToken) && labels[0] === 'i' && labels[1] === '1', report.nativeExtraction);
    // The assertion rests only on what the product itself did: its revision gate for this file and the
    // per-page text it measured. `counts.*Expected` counts only after the driver's own disk probe, and
    // the driver has not read any of this document with the wrapper off.
    const preparationObserved = counts.statExpected >= 1 && counts.digestExpected >= 2;
    report.backgroundPreparation.preparationObserved = preparationObserved;
    report.backgroundPreparation.pageTextEvidence = pageTextEvidence;
    report.backgroundPreparation.pageTextEncodings = pageTexts.length;
    report.backgroundPreparation.productGate = { statCalls: counts.statExpected, digestCalls: counts.digestExpected };
    report.backgroundPreparation.productPageCalls = productPageCalls;
    report.backgroundPreparation.productGetData = productGetData;
    report.backgroundPreparation.legacyVerdict = legacyVerdict;
    report.backgroundPreparation.legacyGetters = { ...legacy.calls };
    report.backgroundPreparation.nonFatal = await IOUtils.exists(PathUtils.join(config.profile, 'zchatgpt-control-nonfatal-prep'));
    if (report.backgroundPreparation.nonFatal) await skip('automatic-whole-pdf-background-preparation-without-panel', `DIAGNOSTIC RUN (non-fatal): ${JSON.stringify({ counts, preparationObserved, gateMs: observations.find(entry => entry.label === 'computeHexDigest' && entry.file === expectedFile)?.ms ?? null, legacy: legacy.order.slice(0, 12) })}`);
    else await check('automatic-whole-pdf-background-preparation-without-panel', preparationObserved, report.backgroundPreparation);
    await check('removed-document-panel-stays-off-the-chat-surface', panelSelectorsAbsent(), { removedSelectorsAbsent: REMOVED_PANEL_SELECTORS });
    // --- The context ring is honest: unknown is a solid neutral ring, never a percentage or empty arc ---
    await until(() => contextRing(), 'context-ring');
    const ringLabel = contextRing()?.getAttribute('aria-label') ?? '';
    await check('context-ring-reports-honest-unknown-state',
      contextRing().className === 'zchatgpt-context-ring' && contextRing().dataset.zchatgptContextState === 'unknown' && contextRing().querySelector('.zchatgpt-context-ring-fill')?.getAttribute('stroke-dasharray') === 'none' && /unknown/i.test(ringLabel) && !ringLabel.includes('%'),
      { state: contextRing().dataset.zchatgptContextState, strokeDasharray: contextRing().querySelector('.zchatgpt-context-ring-fill')?.getAttribute('stroke-dasharray'), label: ringLabel });
    // The panel's runtime state is the shared client's, and the shared client is usable without Codex.
    // The Agent channel itself is asserted above by the lazy filesystem/process checks; this is the
    // guard that the dock settled on a usable runtime instead of failing to connect.
    await until(() => ['ready', 'error'].includes(panel()?.dataset.zchatgptRuntime), 'native-runtime-initialization', 90000);
    await check('sidebar-runtime-ready-after-the-explicit-agent-action', panel()?.dataset.zchatgptRuntime === 'ready', { visibleStatus: panel()?.querySelector('[role="status"]')?.textContent, visibleError: refusalAlert()?.textContent });
    // Opening the dock is a local tab, not a stored chat: first-open has no conversation id until
    // the first send. signedOut still disables the picker; signedIn with an unbound composer is the
    // same login-independent local surface the next check records.
    await until(() => {
      const chat = panel();
      if (!chat) return false;
      if (chat.dataset.zchatgptConversation) return true;
      if (chat.querySelector('[data-zchatgpt-action="picker"]')?.disabled) return true;
      return ['signedIn', 'signedOut'].includes(chat.dataset.zchatgptAuth);
    }, 'native-conversation-or-signed-out', 30000);
    await check('local-conversation-independent-of-login', ['signedIn', 'signedOut'].includes(panel().dataset.zchatgptAuth), { auth: panel().dataset.zchatgptAuth, conversation: panel().dataset.zchatgptConversation || null });
    const conversationA = panel().dataset.zchatgptConversation || '';
    // The removed panel no longer wraps the page indicator; the source row is a bare chat sibling.
    await until(() => contextSource()?.hidden === true, 'context-source-hidden-without-a-citation', 15000);
    await check('context-source-hidden-without-a-citation', Boolean(contextSource()) && contextSource().hidden === true && Boolean(contextSource().closest('[data-zchatgpt-context-panel]')) && !contextSource().closest('.zchatgpt-document-panel'), { source: contextSource()?.textContent ?? '' });
    input().value = 'Unsent synthetic question about the current PDF'; input().dispatchEvent(new (reader()._iframeWindow.Event)('input', { bubbles: true }));
    // --- Real selection on physical page 2 becomes the cited page the source row and reader follow ---
    const selectionPopup = () => rdoc()?.querySelector('.selection-popup');
    const selectionBar = () => rdoc()?.querySelector('[data-zchatgpt-selection-bar]');
    const selectOnPage = async pageNumber => {
      await until(() => view()?._pdfPages?.[pageNumber - 1]?.chars?.length > 8, `page-${pageNumber}-characters`, 30000);
      const w = viewWin(); w.PDFViewerApplication.pdfViewer.currentPageNumber = pageNumber; await delay(400);
      const spans = await until(() => {
        const nodes = Array.from(w.document.querySelectorAll(`.page[data-page-number="${pageNumber}"] .textLayer span`)).filter(node => { const rect = node.getBoundingClientRect(); return node.textContent.trim().length > 2 && rect.width > 0 && rect.top > 8 && rect.bottom < w.innerHeight - 8 && rect.left >= 0 && rect.right <= w.innerWidth; });
        return nodes.length >= 3 ? nodes : null;
      }, `visible-text-layer-${pageNumber}`, 30000);
      const first = spans[0].getBoundingClientRect(); const last = spans[2].getBoundingClientRect();
      const start = { x: first.left + 2, y: first.top + first.height / 2 }; const end = { x: last.right - 2, y: last.top + last.height / 2 };
      const target = w.document.elementFromPoint(start.x, start.y) || spans[0];
      const nativeView = view();
      const event = (x, y, extra = {}) => Cu.cloneInto({ target, clientX: x, clientY: y, button: 0, buttons: 1, detail: 1, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, preventDefault() {}, stopPropagation() {}, ...extra }, w, { cloneFunctions: true, wrapReflectors: true });
      nativeView._pointerDownTriggered = false; nativeView._handlePointerDown(event(start.x, start.y));
      await delay(60); nativeView._handlePointerMove(event(end.x, end.y, { dataTransfer: null })); await delay(120);
      nativeView._handlePointerUp(event(end.x, end.y, { button: 0 }));
      await until(() => selectionPopup(), `selection-popup-${pageNumber}`, 4000).catch(() => null);
      // Some host builds route the drag through the DOM instead of the direct pointer handlers.
      if (!selectionPopup()) {
        target.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, detail: 1, clientX: start.x, clientY: start.y }));
        await delay(80);
        target.dispatchEvent(new w.PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', buttons: 1, clientX: end.x, clientY: end.y }));
        await delay(120);
        target.dispatchEvent(new w.PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse', button: 0, clientX: end.x, clientY: end.y }));
        await until(() => selectionPopup(), `selection-popup-after-drag-${pageNumber}`, 4000).catch(() => null);
      }
      if (!selectionPopup()) throw new Error(`Native selection popup did not appear on page ${pageNumber}`);
      return until(() => selectionBar(), 'selection-action-bar', 5000);
    };
    let selected = false;
    for (let attempt = 0; attempt < 3 && !selected; attempt++) { try { await selectOnPage(2); selected = true; } catch (error) { report.selectionAttempt = String(error); await save(); await delay(500); } }
    if (selected) {
      click(selectionBar().querySelector('[data-zchatgpt-action="ask"]'));
      await until(() => panel()?.querySelectorAll('[data-zchatgpt-draft-citations] [data-zchatgpt-citation]').length === 1, 'draft-citation-from-ask', 15000);
      await until(() => contextSource() && !contextSource().hidden && /\bp\.\s*\S+/u.test(contextSource().textContent || ''), 'context-source-follows-the-cited-page', 15000);
      await check('context-source-points-at-the-selected-page', !contextSource().hidden && /\bp\.\s*\S+/u.test(contextSource().textContent || '') && Boolean(contextSource().querySelector('[data-zchatgpt-action="open-citation"]')), { source: contextSource().textContent });
      pdfViewer().currentPageNumber = 1; await until(() => pdfViewer().currentPageNumber === 1, 'reset-viewer-to-page-1');
      const navigationSource = contextSource().textContent;
      click(contextSource().querySelector('[data-zchatgpt-action="open-citation"]'));
      const navigated = await until(() => pdfViewer().currentPageNumber === 2, 'source-navigation-to-cited-page', 20000).catch(() => null);
      if (!navigated) {
        // Report what the owner would see instead of navigating, so a product failure is not mistaken
        // for a driver timing complaint.
        report.navigationProbe = { source: navigationSource, visibleAlert: refusalAlert()?.textContent ?? '', productLoggedErrors: logErrors.slice(-4), currentPage: pdfViewer().currentPageNumber, locationPage: pdfViewer()._location?.pageNumber ?? null };
        await check('context-source-returns-to-the-cited-page', false, report.navigationProbe);
      } else {
        await check('context-source-returns-to-the-cited-page', pdfViewer().currentPageNumber === 2, { pageNumber: pdfViewer().currentPageNumber, locationPage: pdfViewer()._location?.pageNumber });
      }
    } else {
      await skip('context-source-points-at-the-selected-page', 'No synthetic text selection could be simulated in the real reader view.');
      await skip('context-source-returns-to-the-cited-page', 'No synthetic text selection could be simulated in the real reader view.');
    }
    // --- Consent stays reachable without the removed panel: an explain that needs consent surfaces it ---
    let explainSelected = false;
    for (let attempt = 0; attempt < 3 && !explainSelected; attempt++) { try { await selectOnPage(2); explainSelected = true; } catch (error) { report.selectionAttempt = String(error); await save(); await delay(500); } }
    if (explainSelected) {
      click(selectionBar().querySelector('[data-zchatgpt-action="explain"]'));
      await until(() => disclosure() && !disclosure().hidden, 'consent-line-for-pending-explain', 15000);
      const acknowledge = disclosure().querySelector('[data-zchatgpt-action="acknowledge-context"]');
      await check('consent-path-reachable-without-the-removed-panel', !disclosure().hidden && Boolean(acknowledge) && acknowledge.hidden === false && Zotero.Prefs.get('extensions.zchatgpt.pdfTextDisclosureSeen', true) !== true, { copy: disclosure().querySelector('p')?.textContent?.slice(0, 80) });
      await skip('acknowledge-context-resumes-the-pending-explain', 'Acknowledging re-runs the pending explain, which starts the official login (signed out) or a real model request (signed in). --context must do neither, so the resume click is deliberately not executed.');
    } else {
      await skip('consent-path-reachable-without-the-removed-panel', 'No synthetic text selection could be simulated in the real reader view.');
      await skip('acknowledge-context-resumes-the-pending-explain', 'No synthetic text selection could be simulated in the real reader view.');
    }
    // The consent probe above intentionally created a pending Agent Explain owned by this driver.
    // Revoke it through the visible mode control before any login wait: switching to Chat preserves
    // the frozen selection in the draft and clears auto-resume, then returning to Agent restores the
    // mode needed by later request-boundary checks without sending anything.
    if (explainSelected) {
      click(modeButton('chat')); await until(() => pressed('chat') && modeSwitch().dataset.zchatgptMode === 'chat' && disclosure()?.hidden === true, 'pending-explain-revoked-in-chat', 30000);
      await check('pending-explain-revoked-without-request', disclosure()?.hidden === true && pressed('chat'), { mode: modeSwitch().dataset.zchatgptMode, disclosureHidden: disclosure()?.hidden ?? null });
      click(modeButton('agent')); await until(() => pressed('agent') && modeSwitch().dataset.zchatgptMode === 'agent', 'agent-restored-after-pending-explain-revocation', 30000);
    }
    toggle().click(); await until(() => !panel(), 'close-sidebar');
    await check('close-preserves-current-page', pdfViewer().currentPageNumber === 2, {
      page: pdfViewer().currentPageNumber,
      location: pdfViewer()._location && { pageNumber: pdfViewer()._location.pageNumber, left: pdfViewer()._location.left, top: pdfViewer()._location.top, scale: pdfViewer()._location.scale },
      dock: Boolean(rdoc()?.querySelector('[data-zchatgpt-dock]')),
      sidebarCollapsed: win.ZoteroContextPane?.collapsed,
    });
    toggle().click(); await until(() => input() && !input().disabled && panel()?.dataset.zchatgptConversation === conversationA, 'same-conversation-restored');
    await check('reopen-keeps-current-page', pdfViewer().currentPageNumber === 2, {
      page: pdfViewer().currentPageNumber,
      locationPage: pdfViewer()._location?.pageNumber,
    });
    await check('draft-preserved', input().value === 'Unsent synthetic question about the current PDF');
    // --- Same-title attachments keep their own reader identity and draft, with no cross-bleed ---
    const other = await Zotero.Reader.open(b.id); tabId = other.tabID;
    await until(() => toggle(), 'sibling-toolbar'); toggle().click();
    await until(() => shell()?.dataset.attachmentKey === b.key && input(), 'sibling-sidebar', 60000);
    const siblingConversation = panel()?.dataset.zchatgptConversation || '';
    // Same-title attachments are different papers. The proof is the reader binding, not a tab label:
    // the tab is the `New chat` copy now, so assert the shell is bound to the sibling attachment, its
    // composer is empty (the main attachment's draft did not bleed across), the main attachment's own
    // chat is not reused, and the main draft text never appears in the sibling surface.
    await check('same-title-attachments-separated',
      shell().dataset.attachmentKey === b.key && a.key !== b.key && input().value === ''
        && (!conversationA || siblingConversation !== conversationA)
        && !panel().textContent.includes('Unsent synthetic question about the current PDF'),
      { attachmentKey: shell().dataset.attachmentKey ?? null, siblingAttachmentKey: b.key, mainAttachmentKey: a.key, siblingConversation: siblingConversation || null, conversationA: conversationA || null });
    tabId = opened.tabID; win.Zotero_Tabs.select(tabId);
    await until(() => shell()?.dataset.attachmentKey === a.key && input(), 'main-attachment-restored', 60000);
    await check('attachment-switch-keeps-draft', input().value === 'Unsent synthetic question about the current PDF');
    // --- PDF zoom must never drive chat type: the two text sizes stay independent ---
    const scaleBefore = pdfViewer().currentScale; const scaleBeforeVariable = contextScale();
    shell().dispatchEvent(new (reader()._iframeWindow.KeyboardEvent)('keydown', { key: '=', code: 'Equal', metaKey: true, bubbles: true, cancelable: true }));
    await until(() => pdfViewer().currentScale > scaleBefore + 0.01, 'reader-zoom-from-meta-plus', 10000);
    await check('reader-zoom-keeps-chat-text-scale-independent', contextScale() === scaleBeforeVariable && pdfViewer().currentScale > scaleBefore, { scaleBefore, scaleAfter: pdfViewer().currentScale, chatScaleBefore: scaleBeforeVariable, chatScaleAfter: contextScale() });
    // Measure input-ready reopen and a state-changing local control, not an animation. The
    // three-dot settings menu is gone; history is the remaining chrome popover that works whether
    // or not the account is signed in.
    const warm = []; const local = [];
    const warmReady = () => input() && !input().disabled && (!conversationA || panel()?.dataset.zchatgptConversation === conversationA);
    for (let n = 0; n < 30; n++) {
      toggle().click(); await until(() => !panel(), 'perf-close');
      const start = win.performance.now(); toggle().click();
      await until(warmReady, 'perf-input-ready'); warm.push(win.performance.now() - start);
      // `+` / history are shell-level navigation now, so they are read from the shell root.
      const history = shell().querySelector('[data-zchatgpt-action="history"]');
      const historyPanel = panel().querySelector('[data-zchatgpt-history]');
      step = 'perf-local-feedback';
      const feedback = win.performance.now(); history.click();
      await until(() => historyPanel && !historyPanel.hidden, 'perf-state-feedback'); local.push(win.performance.now() - feedback);
      history.click(); await until(() => historyPanel.hidden, 'perf-menu-closed');
    }
    const metrics = values => ({ n: values.length, p95: [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1], max: Math.max(...values), samplesMs: values });
    report.performance = { cachedOpen: metrics(warm), localInteraction: metrics(local), method: 'performance.now; poll 10ms until enabled input (and restored conversation when one is bound) or the history panel opens; same synthetic 2-page PDF; 30 cycles; runtime warmed; no model' };
    await check('warm-open-p95-under-250ms', report.performance.cachedOpen.p95 <= 250, { p95: report.performance.cachedOpen.p95 });
    await check('local-feedback-p95-under-100ms', report.performance.localInteraction.p95 <= 100, { p95: report.performance.localInteraction.p95 });
    await check('single-dock-and-toggle-after-cycles', rdoc().querySelectorAll('[data-zchatgpt-dock]').length === 1 && rdoc().querySelectorAll('[data-zchatgpt-toggle]').length === 1);
    step = 'inspect-request-records';
    const records = PathUtils.join(config.profile, 'zotero-chatgpt', 'v1', 'records', 'conversations');
    // A profile that ran no conversation yet owns no records directory at all; the product lists a
    // missing directory as empty, and this probe must read the same way.
    const countStoredRequests = async () => {
      const files = await IOUtils.exists(records) ? await IOUtils.getChildren(records) : []; let total = 0;
      for (const file of files) if (file.endsWith('.json') && !file.endsWith('.source.json')) total += JSON.parse(await IOUtils.readUTF8(file)).requests.length;
      return total;
    };
    const newestStoredRequestModel = async () => {
      const files = await IOUtils.exists(records) ? await IOUtils.getChildren(records) : [];
      const rows = [];
      for (const file of files) {
        if (!file.endsWith('.json') || file.endsWith('.source.json')) continue;
        const record = JSON.parse(await IOUtils.readUTF8(file));
        for (const request of record.requests ?? []) {
          const user = (record.messages ?? []).find(message => message.role === 'user' && message.requestId === request.requestId);
          rows.push({ at: request.createdAt, model: user?.settings?.model ?? null });
        }
      }
      return rows.sort((a, b) => b.at.localeCompare(a.at))[0]?.model ?? null;
    };
    const requests = await countStoredRequests();
    report.recordedRequests = requests;
    if (!config.live) {
      const currentRequests = conversationA
        ? JSON.parse(await IOUtils.readUTF8(PathUtils.join(records, `${conversationA}.json`))).requests.length
        : requests;
      await check('no-model-request-in-this-conversation', currentRequests === 0, { recordedRequests: requests, conversation: conversationA || null });
    }
    // --- With no readable text the request boundary must refuse out loud, never send an empty context ---
    step = 'not-ready-refusal';
    let blankReady = false; let blankSetupError = null;
    try {
      const blankPath = PathUtils.join(config.dataDir, 'blank-context.pdf');
      await IOUtils.writeUTF8(blankPath, blankPdfText());
      const blankQueue = new Zotero.Notifier.Queue();
      const blank = await Zotero.Attachments.importFromFile({ file: blankPath, parentItemID: parent.id, title: 'Blank synthetic PDF', saveOptions: { notifierQueue: blankQueue } });
      await blank.loadAllData(); await Zotero.Notifier.commit(blankQueue);
      const blankOpened = await Zotero.Reader.open(blank.id); tabId = blankOpened.tabID;
      await until(() => toggle(), 'blank-toolbar');
      if (!panel()) { toggle().click(); }
      await until(() => input(), 'blank-input');
      await until(() => ['ready', 'error'].includes(panel()?.dataset.zchatgptRuntime), 'blank-runtime', 90000);
      await until(() => panel()?.dataset.zchatgptAuth, 'blank-auth', 30000);
      blankReady = true;
    } catch (error) { blankSetupError = String(error); await save(); }
    if (blankReady) {
      input().value = 'Synthetic question with no extractable PDF text';
      input().dispatchEvent(new (reader()._iframeWindow.Event)('input', { bubbles: true }));
      const blankSend = panel().querySelector('[data-zchatgpt-action="send"]');
      if (panel().dataset.zchatgptAuth === 'signedIn' && !blankSend.disabled) {
        click(blankSend);
        // The predicate must return the element, not a boolean, or the check reads attributes off `true`.
        const refused = await until(() => { const alert = refusalAlert(); return alert && !alert.hidden ? alert : null; }, 'not-ready-refusal-alert', 30000);
        await check('not-ready-send-refuses-with-error-alert',
          refused.getAttribute('role') === 'alert' && /No extractable text/iu.test(refused.textContent || '') && panel().dataset.zchatgptGenerating !== 'true',
          { message: refused.textContent });
      } else {
        await check('not-ready-send-cannot-silently-reach-a-model', blankSend.disabled === true, { auth: panel().dataset.zchatgptAuth, sendDisabled: blankSend.disabled });
        await skip('not-ready-send-refuses-with-error-alert', 'Only a signed-in runtime reaches the request boundary that refuses an unreadable PDF; this dedicated profile is signed out, so no real login or model call was made to observe the refusal copy.');
      }
    } else {
      await skip('not-ready-send-refuses-with-error-alert', `The blank synthetic PDF reader could not be prepared in this host: ${blankSetupError}`);
      await skip('not-ready-send-cannot-silently-reach-a-model', `The blank synthetic PDF reader could not be prepared in this host: ${blankSetupError}`);
    }
    tabId = opened.tabID; win.Zotero_Tabs.select(tabId);
    await until(() => shell()?.dataset.attachmentKey === a.key, 'restore-main-attachment', 60000);
    if (config.live) {
      report.notRun = report.notRun.filter(name => !['real-model-answer', 'live-status-shows-responding-and-waiting-seconds', 'in-flight-model-stop'].includes(name));
      if (config.liveCoreFlows) {
        const requestsBeforeLogin = await countStoredRequests();
        report.liveCoreFlows = { status: 'waiting-for-official-login', loginWaitSeconds: config.loginWaitSeconds ?? 0, driverClickedLogin: false, driverReadAuthFiles: false, modelTurns: 0, requestsBeforeLogin };
        await save();
        const waitStarted = Date.now();
        while (panel().dataset.zchatgptAuth !== 'signedIn' && Date.now() - waitStarted < (config.loginWaitSeconds ?? 0) * 1000) { await delay(500); }
        if (panel().dataset.zchatgptAuth !== 'signedIn') {
          report.liveCoreFlows.status = 'blocked'; report.liveCoreFlows.reason = 'official-login-required'; report.status = 'blocked'; report.finishedAt = new Date().toISOString();
          await skip('live-core-annotation-flow', 'BLOCKED: complete the official login manually in this dedicated profile; the driver does not click login or inspect authentication files.');
          await skip('live-core-organization-flow', 'BLOCKED: complete the official login manually in this dedicated profile; the driver does not click login or inspect authentication files.');
          await save(); return;
        }
        await delay(2500);
        const requestsAfterLogin = await countStoredRequests();
        await check('live-core-login-starts-no-incidental-request', requestsAfterLogin === requestsBeforeLogin, { requestsBeforeLogin, requestsAfterLogin });
        report.liveCoreFlows.status = 'running'; report.liveCoreFlows.loginObserved = 'signedIn'; report.liveCoreFlows.requestsAfterLogin = requestsAfterLogin; await save();
      }
      await check('live-account-signed-in', panel().dataset.zchatgptAuth === 'signedIn');
      const picker = panel().querySelector('[data-zchatgpt-picker]');
      // The preserved profile can have an old Astra draft. Never infer the test model from a
      // default or a stored conversation: explicitly choose Sol/Luna before the first live send.
      click(picker);
      const lowCostOption = await until(() => panel()?.querySelector('[data-zchatgpt-setting="model"][data-zchatgpt-value="gpt-6-sol"]')
        || panel()?.querySelector('[data-zchatgpt-setting="model"][data-zchatgpt-value="gpt-6-luna"]'), 'live-low-cost-model-option', 10000).catch(() => null);
      if (!lowCostOption || lowCostOption.disabled) {
        report.status = 'blocked'; report.blockedStage = 'sol-or-luna-model-unavailable'; report.finishedAt = new Date().toISOString();
        if (config.liveCoreFlows) report.liveCoreFlows.status = 'blocked';
        await save(); return;
      }
      click(lowCostOption);
      report.testModel = lowCostOption.dataset.zchatgptValue;
      const selectedLowCost = await until(() => new RegExp(report.testModel === 'gpt-6-sol' ? 'Sol' : 'Luna', 'u').test(picker.textContent ?? ''), 'live-low-cost-model-selected', 10000).catch(() => null);
      await check('live-low-cost-model-selected-before-send', Boolean(selectedLowCost) && ['gpt-6-sol', 'gpt-6-luna'].includes(report.testModel), { model: report.testModel, picker: picker.textContent });
      if (picker.getAttribute('aria-expanded') === 'true') click(picker);
      report.liveModel = picker.textContent;
      if (config.liveCoreFlows) {
        const tagNames = item => item.getTags().map(entry => entry.tag).sort();
        const collectionKeys = item => item.getCollections().map(id => Zotero.Collections.get(id)).filter(Boolean).map(collection => collection.key).sort();
        const taskCard = label => [...panel().querySelectorAll('[data-zchatgpt-task-id]')].find(card => String(card.querySelector('summary')?.textContent ?? '').includes(label));
        const sendAgent = async (question, label, afterClick) => {
          if (modeSwitch().dataset.zchatgptMode !== 'agent') { click(modeButton('agent')); await until(() => modeSwitch().dataset.zchatgptMode === 'agent', `${label}-agent-mode`); }
          input().value = question; input().dispatchEvent(new (reader()._iframeWindow.Event)('input', { bubbles: true }));
          const send = panel().querySelector('[data-zchatgpt-action="send"]'); await until(() => !send.disabled, `${label}-send-enabled`, 30000);
          await check(`${label}-visible-reader-send`, win.Zotero_Tabs.selectedID === tabId && send.isConnected && !send.hidden && Boolean(panel()), { selectedTab: win.Zotero_Tabs.selectedID, readerTab: tabId, sendHidden: send.hidden });
          click(send); if (afterClick) await afterClick();
          await until(() => panel()?.dataset.zchatgptGenerating === 'true', `${label}-request-accepted`, 30000);
          await until(() => panel()?.dataset.zchatgptGenerating === 'false', `${label}-request-terminal`, 180000);
          const issuedModel = await newestStoredRequestModel();
          await check(`${label}-uses-selected-low-cost-model`, issuedModel === report.testModel, { expected: report.testModel, actual: issuedModel });
          report.liveCoreFlows.modelTurns += 1; await save();
        };
        const annotationsBefore = a.getAnnotations().length;
        await sendAgent('Highlight the five most important scientifically meaningful sentences in the current PDF. Use native Zotero highlights and propose only exact quotations that appear verbatim in this PDF.', 'live-annotation');
        const annotationCard = await until(() => { const card = taskCard('Annotations'); return card && ['completed', 'partial', 'failed'].includes(card.dataset.state) ? card : null; }, 'live-annotation-auto-applied', 60000); await a.loadAllData();
        const createdAnnotations = a.getAnnotations().length - annotationsBefore;
        await check('live-core-annotation-auto-native-readback', ['completed', 'partial'].includes(annotationCard.dataset.state) && createdAnnotations > 0 && createdAnnotations <= 5 && annotationCard.querySelector('[data-zchatgpt-task-action="approve"]')?.hidden === true, { state: annotationCard.dataset.state, createdAnnotations, attachmentKey: a.key });
        toggle().click(); await until(() => !panel(), 'live-annotation-sidebar-closed'); toggle().click(); await until(() => ['completed', 'partial'].includes(taskCard('Annotations')?.dataset.state), 'live-annotation-sidebar-reopened', 60000);
        const reopenedAnnotationCard = taskCard('Annotations'); const viewer = pdfViewer(); viewer.currentScaleValue = 'page-width'; const scaleBeforeOutput = viewer.currentScaleValue;
        let rotationBeforeOutput = viewer.pagesRotation; if (typeof rotationBeforeOutput === 'number') { viewer.pagesRotation = (rotationBeforeOutput + 90) % 360; rotationBeforeOutput = viewer.pagesRotation; }
        click(reopenedAnnotationCard.querySelector('[data-zchatgpt-task-action="output"]')); await delay(500);
        await check('live-core-annotation-output-reopens-with-view-state', viewer.currentScaleValue === scaleBeforeOutput && viewer.pagesRotation === rotationBeforeOutput, { zoom: viewer.currentScaleValue, rotation: viewer.pagesRotation ?? null });
        click(reopenedAnnotationCard.querySelector('[data-zchatgpt-task-action="undo"]')); await until(() => reopenedAnnotationCard.dataset.state === 'undone', 'live-annotation-undone', 60000); await a.loadAllData();
        await check('live-core-annotation-undo-readback', a.getAnnotations().length === annotationsBefore, { nativeAnnotationsAfterUndo: a.getAnnotations().length, baseline: annotationsBefore });

        if (!organizationFixture?.peer) throw new Error('Live organization fixtures were not prepared.');
        const peer = organizationFixture.peer; const proposedTag = `live-organized-${verificationToken}`; const laterTag = `later-user-edit-${verificationToken}`;
        const parentExistingTag = `preserve-parent-${verificationToken}`; const peerExistingTag = `preserve-peer-${verificationToken}`;
        const selectedIDs = [parent.id, peer.id]; await win.ZoteroPane.selectItems(selectedIDs, { inLibraryRoot: true });
        await until(() => win.ZoteroPane.itemsView.getSelectedItems(true).length === 2, 'live-organization-native-selection'); win.Zotero_Tabs.select(tabId);
        await until(() => shell()?.dataset.attachmentKey === a.key && input(), 'live-organization-reader-restored');
        await sendAgent(`Organize the selected Zotero items by adding the tag ${proposedTag} and placing both items in the collection named "${organizationFixture.targetCollection.name}". Preserve every existing tag and collection.`, 'live-organization', async () => {
          await win.ZoteroPane.selectItems([parent.id], { inLibraryRoot: true, noTabSwitch: true });
        });
        const organizationCard = await until(() => taskCard('Organize library'), 'live-organization-review', 60000);
        await parent.loadAllData(); await peer.loadAllData();
        await check('live-core-organization-frozen-review-before-write', organizationCard.dataset.state === 'review' && organizationCard.querySelectorAll('[data-zchatgpt-task-item-id]').length === 2 && !tagNames(parent).includes(proposedTag) && !tagNames(peer).includes(proposedTag), { candidates: organizationCard.querySelectorAll('[data-zchatgpt-task-item-id]').length, selectedTitles: [parent.getField('title'), peer.getField('title')], selectionChangedAfterSend: true, visibleReaderSend: true });
        click(organizationCard.querySelector('[data-zchatgpt-task-action="approve"]')); await until(() => organizationCard.dataset.state === 'completed', 'live-organization-applied', 60000); await parent.loadAllData(); await peer.loadAllData();
        const targetKey = organizationFixture.targetCollection.key; const controlKey = organizationFixture.controlCollection.key;
        await check('live-core-organization-additive-native-readback', [parent, peer].every(item => tagNames(item).includes(proposedTag) && collectionKeys(item).includes(targetKey) && collectionKeys(item).includes(controlKey)) && tagNames(parent).includes(parentExistingTag) && tagNames(peer).includes(peerExistingTag), { parentTags: tagNames(parent), peerTags: tagNames(peer), parentCollections: collectionKeys(parent), peerCollections: collectionKeys(peer) });
        peer.addTag(laterTag); await peer.saveTx({ skipSelect: true }); click(organizationCard.querySelector('[data-zchatgpt-task-action="undo"]')); await until(() => organizationCard.dataset.state === 'conflict', 'live-organization-undo-conflict', 60000); await parent.loadAllData(); await peer.loadAllData();
        await check('live-core-organization-undo-preserves-later-edit', !tagNames(parent).includes(proposedTag) && !collectionKeys(parent).includes(targetKey) && tagNames(parent).includes(parentExistingTag) && tagNames(peer).includes(proposedTag) && tagNames(peer).includes(laterTag) && tagNames(peer).includes(peerExistingTag) && collectionKeys(peer).includes(targetKey) && collectionKeys(peer).includes(controlKey), { parentTags: tagNames(parent), peerTags: tagNames(peer), parentCollections: collectionKeys(parent), peerCollections: collectionKeys(peer), taskState: organizationCard.dataset.state });
        report.liveCoreFlows.status = 'passed'; report.liveCoreFlows.annotationCandidates = createdAnnotations; report.liveCoreFlows.organizationItems = 2; await save();
      } else {
      input().value = 'What is the hidden verification token on the second physical page of this synthetic PDF, and what combines prior beliefs and likelihood? Cite the page label. Answer briefly.';
      input().dispatchEvent(new (reader()._iframeWindow.Event)('input', { bubbles: true }));
      const started = win.performance.now(); panel().querySelector('[data-zchatgpt-action="send"]').click();
      await until(() => panel()?.dataset.zchatgptGenerating === 'true', 'live-request-accepted');
      // The same status text and timing row serve both execution modes. During a live Agent turn they
      // must describe the request instead of staying idle: this is the real-dock half of the
      // shared-request-state claim that the unit suite asserts only on the state shape.
      const inFlight = await until(() => /^Waiting \d+s$/u.test(timingText()) && /Responding/u.test(statusLine()?.textContent ?? ''), 'live-status-timing', 30000).catch(() => null);
      report.liveStatus = { status: statusLine()?.textContent ?? null, timing: timingText() };
      await check('live-status-shows-responding-and-waiting-seconds', inFlight !== null, report.liveStatus);
      await until(() => panel()?.dataset.zchatgptGenerating === 'false', 'live-answer-terminal', 120000);
      const record = JSON.parse(await IOUtils.readUTF8(PathUtils.join(records, `${conversationA}.json`)));
      const last = record.requests.at(-1);
      const issuedModel = record.messages.find(m => m.requestId === last?.requestId && m.role === 'user')?.settings?.model ?? null;
      await check('live-request-uses-selected-low-cost-model', issuedModel === report.testModel, { expected: report.testModel, actual: issuedModel });
      const answer = record.messages.filter(m => m.role === 'assistant' && m.requestId === last?.requestId).map(m => m.text).join('\n');
      report.live = { state: last?.state, latencyMs: win.performance.now() - started, answer: answer.slice(0, 1600), inputDocumentId: record.messages.find(m => m.requestId === last?.requestId && m.role === 'user')?.document?.id };
      await check('real-model-answer', last?.state === 'completed' && answer.trim().length > 0, { state: last?.state, characters: answer.length });
      await check('model-used-second-page-source', answer.includes(verificationToken) && !answer.includes('BAMBOO-19'));
      await check('full-document-in-live-request', Boolean(report.live.inputDocumentId));
      input().value = 'Explain this synthetic example in depth with ten worked examples and detailed reasoning for a beginner.';
      input().dispatchEvent(new (reader()._iframeWindow.Event)('input', { bubbles: true }));
      panel().querySelector('[data-zchatgpt-action="send"]').click();
      await until(() => panel()?.dataset.zchatgptGenerating === 'true', 'live-followup-started');
      await until(() => panel()?.querySelector('[data-status="streaming"] [data-zchatgpt-text]')?.textContent?.length > 0 || panel()?.dataset.zchatgptGenerating === 'false', 'live-followup-output', 120000);
      const stop = panel().querySelector('[data-zchatgpt-action="stop"]'); if (panel().dataset.zchatgptGenerating === 'true') stop.click();
      await until(() => panel()?.dataset.zchatgptGenerating === 'false', 'live-followup-stopped', 30000);
      const followupModel = await newestStoredRequestModel();
      await check('live-followup-uses-selected-low-cost-model', followupModel === report.testModel, { expected: report.testModel, actual: followupModel });
      const afterStop = JSON.parse(await IOUtils.readUTF8(PathUtils.join(records, `${conversationA}.json`)));
      const terminal = afterStop.requests.at(-1)?.state;
      report.live.stopState = terminal;
      await check('live-stop-confirmed-or-completion-race', terminal === 'cancelled' || terminal === 'completed', { state: terminal });
      if (terminal === 'completed') report.notRun.push('stop-during-stream-completed-too-fast');
      }
    }
    try {
      const doc = pdf().pdfDocument;
      const data = typeof doc.getData === 'function' ? await doc.getData() : null;
      report.loadedDocumentBytes = { supported: !!data?.byteLength, bytes: data?.byteLength ?? 0 };
    } catch { report.loadedDocumentBytes = { supported: false }; }

    // --- Native Preferences pane preflight (bounded addition; does not touch the checks above) ---
    // Observed on the installed subject XPI only. The visual pane, native theming and keyboard
    // focus are explicitly not verifiable here and stay in notRun.
    report.notRun.push('pref-pane-visual-theme-and-keyboard');
    report.notRun.push('pref-pane-registrar-isolated-from-host-auto-unregister');
    step = 'preferences-pane-preflight';
    const PANE_ID = 'zchatgpt-prefpane-settings';
    const panePanes = () => (Array.isArray(Zotero.PreferencePanes?.pluginPanes) ? Zotero.PreferencePanes.pluginPanes.filter(pane => pane && pane.id === PANE_ID) : null);
    const waive = value => { try { return Cu.waiveXrays(value); } catch { return value; } };
    const firstPane = () => { const entries = panePanes(); return entries && entries[0] ? waive(entries[0]) : null; };
    const paneDetails = () => {
      const pane = firstPane();
      return {
        paneCount: panePanes()?.length ?? null,
        id: pane ? String(pane.id) : null,
        pluginID: pane ? String(pane.pluginID) : null,
        pluginIDMatches: Boolean(pane && String(pane.pluginID) === config.subjectID),
        src: pane ? String(pane.src) : null,
        label: pane ? String(pane.rawLabel) : null,
        scripts: pane && Array.isArray(pane.scripts) ? pane.scripts.map(String) : [],
        defaultXUL: pane ? pane.defaultXUL === true : false,
      };
    };
    const identity = paneDetails();
    await check('pref-pane-registered-once-after-startup',
      identity.paneCount === 1 && identity.pluginIDMatches &&
      typeof identity.src === 'string' && identity.src.endsWith('content/preferences/preferences.xhtml') &&
      identity.label === 'Zotero ChatGPT' &&
      identity.scripts.length === 1 && identity.scripts[0].endsWith('content/preferences/pane.js') &&
      identity.defaultXUL === true,
      identity);
    // Open the real Preferences window and select our pane; Zotero loads the fragment and its script.
    const prefWin = Zotero.Utilities.Internal.openPreferences(PANE_ID);
    await until(() => prefWin && waive(prefWin).document && waive(prefWin).document.getElementById(PANE_ID), 'preferences-pane-window');
    const prefDoc = waive(prefWin).document;
    const paneRoot = prefDoc.getElementById(PANE_ID);
    await until(() => paneRoot.querySelector('[data-zchatgpt-pref="form"]') || paneRoot.querySelector('[data-zchatgpt-pref="error"]') || paneRoot.querySelector('[role="alert"]'), 'preferences-pane-mounted', 30000);
    const form = paneRoot.querySelector('[data-zchatgpt-pref="form"]');
    const paneText = String(paneRoot.textContent || '').slice(0, 200);
    const bridge = Boolean(waive(prefWin).Zotero && waive(prefWin).Zotero.ZoteroChatGPTPreferencesPane);
    const unavailable = !form || /unavailable|could not be displayed/i.test(paneText);
    report.preferencesPane = {
      windowOpened: true,
      sandboxPaneBridgeVisible: bridge,
      mountedForm: Boolean(form),
      controlCount: paneRoot.querySelectorAll('input, select, textarea, button').length,
      settingsFields: paneRoot.querySelectorAll('[data-zchatgpt-pref^="preference-"]').length,
      unavailable,
      textSample: paneText,
    };
    await check('pref-pane-window-mounts-real-form',
      Boolean(form) && report.preferencesPane.controlCount > 0 && !unavailable && bridge,
      report.preferencesPane);
    // The pane's copy must follow the stored UI language inside the real Preferences window. The
    // check switches the stored language through the pane's own control, then restores it, so the
    // profile is left as it was found. Only the UI-language setting is written; no record is touched.
    // The canary is the legend of the fieldset that owns the UI-language control, not the pane's
    // first legend: the pane was reorganized, so positional legends now belong to another section.
    const paneLegend = () => String(paneRoot.querySelector('[data-zchatgpt-pref="uiLanguage"]')?.closest('fieldset')?.querySelector('legend')?.textContent ?? '');
    const paneIdentifiers = () => [...paneRoot.querySelectorAll('[data-zchatgpt-skill]')].map(row => ({ id: String(row.getAttribute('data-zchatgpt-skill')), name: String(row.querySelector('label span')?.textContent ?? '') }));
    const storedLanguage = async () => JSON.parse(String(await Zotero.ZoteroChatGPTPreferencesHost.readSettings())).uiLanguage;
    // That section's copy differs by build: the 0.4.0a3 bundle the profile ships renders it as "Chat";
    // f6592a3 (17:28) renamed it "Appearance"; the one-row-header round reorganized the pane into
    // General / Chat / Agent / Local data (UI-06), so the UI-language control now lives under
    // "General". Identify the section from the copy this build renders, once, before any switch, so
    // the language assertions below check a direction instead of reading the expected value off the
    // pane they are checking. A section copy not in this table fails the check, so a rename has to be
    // acknowledged deliberately.
    const paneSectionCopy = [
      { en: 'General', zh: '通用' },
      { en: 'Chat', zh: '对话' },
      { en: 'Appearance', zh: '外观' },
    ];
    const sectionCopy = paneSectionCopy.find(copy => copy.en === paneLegend() || copy.zh === paneLegend()) ?? null;
    const expectedLegend = language => (language === 'zh' ? sectionCopy?.zh : sectionCopy?.en);
    const switchLanguage = async language => {
      const select = paneRoot.querySelector('[data-zchatgpt-pref="uiLanguage"]');
      select.value = language;
      select.dispatchEvent(new (waive(prefWin).Event)('change', { bubbles: true }));
      await until(() => paneLegend() === expectedLegend(language) && String(select.value) === language, `pref-pane-copy-${language}`, 30000);
    };
    const languageBefore = await storedLanguage();
    report.preferencesPane.storedLanguage = languageBefore;
    report.preferencesPane.legend = paneLegend();
    report.preferencesPane.sectionCopy = sectionCopy;
    report.preferencesPane.identifiersBefore = paneIdentifiers();
    await check('pref-pane-copy-matches-stored-ui-language',
      sectionCopy !== null && languageBefore === String(paneRoot.querySelector('[data-zchatgpt-pref="uiLanguage"]').value) && paneLegend() === expectedLegend(languageBefore),
      { storedLanguage: languageBefore, legend: paneLegend(), sectionCopy });
    await switchLanguage('zh');
    const chineseIdentifiers = paneIdentifiers();
    report.preferencesPane.legendAfterSwitch = paneLegend();
    report.preferencesPane.identifiersInChinese = chineseIdentifiers;
    await check('pref-pane-copy-follows-language-switch-with-verbatim-identifiers',
      (await storedLanguage()) === 'zh' && paneLegend() === expectedLegend('zh') &&
      chineseIdentifiers.length === report.preferencesPane.identifiersBefore.length &&
      chineseIdentifiers.every((row, index) => row.id === report.preferencesPane.identifiersBefore[index].id && row.name === report.preferencesPane.identifiersBefore[index].name),
      { storedLanguage: await storedLanguage(), legend: paneLegend(), identifiers: chineseIdentifiers });
    await switchLanguage('en');
    await check('pref-pane-copy-reverts-with-the-stored-language',
      (await storedLanguage()) === 'en' && paneLegend() === expectedLegend('en') && JSON.stringify(paneIdentifiers()) === JSON.stringify(report.preferencesPane.identifiersBefore),
      { storedLanguage: await storedLanguage(), legend: paneLegend() });
    let prefWinClosed = false;
    try { prefWin.close(); prefWinClosed = true; } catch { prefWinClosed = false; }
    report.preferencesPane.windowClosed = prefWinClosed;
    await save();
    // A disable/enable cycle must not stack panes: absent while disabled, exactly one after re-enable,
    // with no preference-pane error logged by the plugin. Zotero's own plugin-shutdown observer also
    // clears panes, so this proves the end state, not that only our registrar did the removal.
    const { AddonManager: PrefAddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
    const subjectAddon = await PrefAddonManager.getAddonByID(config.subjectID);
    const loggedErrors = [];
    const originalLogError = Zotero.logError;
    Zotero.logError = error => { loggedErrors.push(String((error && error.message) || error)); };
    try {
      await subjectAddon.disable();
      await until(() => (panePanes()?.length ?? -1) === 0, 'pref-pane-absent-while-disabled');
      await subjectAddon.enable();
      await until(() => panePanes()?.length === 1, 'pref-pane-single-after-reenable', 30000);
    } finally { Zotero.logError = originalLogError; }
    const paneErrors = loggedErrors.filter(text => /preferences pane|prefpane|zchatgpt-prefpane/i.test(text));
    await check('pref-pane-no-duplicates-across-disable-enable',
      panePanes()?.length === 1 && paneErrors.length === 0,
      { panesAfterReenable: panePanes()?.length ?? null, paneCountAfterStartup: identity.paneCount, preferencePaneErrors: paneErrors, loggedErrorCount: loggedErrors.length });

    report.status = 'passed'; report.finishedAt = new Date().toISOString(); await save();
  } catch (error) { report.status = 'failed'; report.failedStep = step; report.failure = { message: String((error && error.message) || error), stack: String((error && error.stack) || '').split('\n').slice(0, 6) }; report.finishedAt = new Date().toISOString(); await save(); Zotero.logError(error); }
  finally { restoreInstrumentation(); }
}
