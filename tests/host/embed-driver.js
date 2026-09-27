/* global Zotero, ChromeUtils, PathUtils, IOUtils, Cu, Services, Cc, Ci */
// Phase 1 of the embedded-ChatGPT prototype: load a remote web application in every Zotero surface a
// sidebar could plausibly use, and record what the host actually does with it.
//
// This driver never types into the page, never clicks a login control, never reads or copies a
// credential, and never calls an OpenAI or ChatGPT JSON API. It creates a browser surface, points it
// at the site, and measures: was the element a real content browser at all, did the load complete or
// get refused (X-Frame-Options / CSP / Gecko security manager / Cloudflare challenge), how much DOM
// did the page build, and does any cookie exist for the host afterwards.
//
// `contentDocument` reads are chrome-privileged host reads of the page that is already loaded in our
// own surface. Only structural facts (title, element counts, booleans, cookie counts) are recorded —
// never page prose, never cookie values, never form field values.
async function runHostSmoke(config) {
  // Unique per run so "this load executed its own script" can be told apart from a cookie or title
  // left behind by an earlier run in the same profile.
  const nonce = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const baseUrl = config.url || 'https://chatgpt.com/';
  const url = (() => {
    if (!/^https?:/u.test(baseUrl)) return baseUrl;
    return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}zchatgpt_run=${nonce}`;
  })();
  const expectedTitle = `ZCHATGPT-RUN-${nonce}`;
  const safeWebURL = value => {
    try {
      const parsed = new URL(String(value || ''));
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return `${parsed.origin}${parsed.pathname}`.slice(0, 320);
      if (parsed.protocol === 'about:' && parsed.pathname === 'blank') return 'about:blank';
      return `scheme:${parsed.protocol.replace(/:$/u, '').slice(0, 24) || 'unknown'}`;
    } catch { return null; }
  };
  const safeReportedText = value => String(value || '').replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/giu, candidate => safeWebURL(candidate) ?? '[url-omitted]');
  const probeTimeoutMs = config.probeTimeoutMs || 25000;
  const targetHost = (() => { try { return new URL(url).hostname; } catch { return 'chatgpt.com'; } })();
  const report = {
    startedAt: new Date().toISOString(),
    stage: 'embed',
    status: 'running',
    target: safeWebURL(url),
    probeTimeoutMs,
    experiments: [],
    checks: [],
    notRun: [
      'interactive-login',
      'conversation-send',
      'streaming-render',
      'model-selection',
      'file-upload',
      'restart-persistence',
    ],
    build: { version: config.subjectVersion, sha256: config.artifactHash, driverSourceHash: config.driverSourceHash ?? null },
    note: 'Surface probe. Login, sending, upload and model selection need a human and are recorded as not-run, never as a pass.',
  };
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const save = () => Zotero.File.putContentsAsync(config.reportPath, JSON.stringify(report, null, 2));
  const message = error => safeReportedText((error && error.message) || error);
  const XUL_NS = 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul';
  const systemPrincipal = Services.scriptSecurityManager.getSystemPrincipal();
  let step = 'startup';
  const until = async (predicate, label, timeout = 20000) => {
    step = label; const start = Date.now();
    while (Date.now() - start < timeout) { const value = await predicate(); if (value) return value; await delay(25); }
    throw new Error(`Timed out: ${label}`);
  };
  const check = async (name, ok, details = {}) => { step = name; report.checks.push({ name, ok: Boolean(ok), details }); await save(); if (!ok) throw new Error(`Check failed: ${name}`); };

  // Remote console prose may contain page or account data. Keep only allowlisted error classes and
  // HTTP(S) origin/path with query and fragment discarded; never retain arbitrary message text.
  const consoleMessages = [];
  /**
   * A second, never-drained copy for the opt-in diagnostic window. It is what lets a human
   * reproduction — a sign-in attempt, for instance — leave evidence behind: the page's own errors and
   * warnings, in order, with the watchdog terminations counted separately because those are the
   * difference between a page that is slow and a page whose script Gecko has already destroyed.
   */
  const diagnosticConsole = [];
  let consoleListener = null;
  let productNetwork = null;
  const consoleZero = Date.now();
  const consoleClass = text => {
    if (/Script terminated by timeout|Script unresponsive|ScopeDisposedError|has been disposed/iu.test(text)) return 'script-timeout';
    if (/cloudflare|challenge|turnstile|captcha|verify you are human|just a moment/iu.test(text)) return 'challenge';
    if (/Content-Security-Policy|\bCSP\b|blocked.*(?:script|frame|resource)/iu.test(text)) return 'csp';
    if (/security manager|permission denied|denied to access|unsafe|principal/iu.test(text)) return 'security';
    if (/module|import|resource:\/\/|trusted scheme/iu.test(text)) return 'module-load';
    if (/failed to load|network|NS_ERROR|connection|request/iu.test(text)) return 'network-load';
    if (/Feature Policy: Skipping unsupported feature name|Missing resource in locale|InstallTrigger is deprecated|Layout was forced before the page was fully loaded/iu.test(text)) return 'noise';
    return 'other';
  };
  const consoleSource = value => {
    try {
      const url = new URL(String(value || ''));
      if (!['http:', 'https:'].includes(url.protocol)) return { scheme: url.protocol.slice(0, 24), origin: null, path: null };
      return { scheme: url.protocol, origin: url.origin.slice(0, 160), path: url.pathname.slice(0, 160) };
    } catch { return { scheme: null, origin: null, path: null }; }
  };
  const startConsole = () => {
    try {
      consoleListener = {
        observe(entry) {
          try {
            if (consoleMessages.length >= 500) return;
            const text = String((entry && (entry.message || entry.errorMessage)) || '');
            const source = String((entry && entry.sourceName) || '');
            const recordEntry = { ms: Date.now() - consoleZero, class: consoleClass(text), ...consoleSource(source) };
            consoleMessages.push(recordEntry);
            if (diagnosticConsole.length < 600) diagnosticConsole.push(recordEntry);
          } catch { /* console observers must never throw */ }
        },
      };
      Services.console.registerListener(consoleListener);
    } catch (error) { report.consoleCaptureError = consoleClass(message(error)); }
  };
  const takeConsole = () => consoleMessages.splice(0, consoleMessages.length);
  /**
   * The same console with the two floods removed — Gecko's own Feature Policy notes from a challenge
   * iframe and its locale warnings arrive in the hundreds and bury the handful of lines that are the
   * page's own voice. This is the list to read when the question is "what did the application say".
   */
  const diagnosticNotable = () => diagnosticConsole.filter(entry => !['noise', 'other'].includes(entry.class)).slice(-120);
  const safeConsole = entries => entries.map(entry => ({ ms: entry.ms, class: entry.class, scheme: entry.scheme, origin: entry.origin, path: entry.path }));
  const consoleClassCounts = () => diagnosticConsole.reduce((counts, entry) => ({ ...counts, [entry.class]: (counts[entry.class] ?? 0) + 1 }), {});
  /** Hostnames whose traffic explains a sign-in round trip; everything else is counted, not listed. */
  const WATCHED_HOSTS = /(^|\.)(chatgpt\.com|openai\.com|oaistatic\.com|oaiusercontent\.com|apple\.com|icloud\.com|cloudflare\.com|google\.com|gstatic\.com)$/i;

  /**
   * Network activity of the hosted surface, observed from chrome. Only the shape of each exchange is
   * recorded — host, a truncated path, the response status and whether the request was cancelled —
   * never a header, query string, body or cookie, so a password typed into the page cannot end up in
   * this report.
   */
  const startNetworkWatch = () => {
    const state = { responses: [], stops: [], hosts: {}, otherHosts: 0 };
    const note = (channel, kind) => {
      try {
        const uri = channel.URI;
        const host = String(uri.host || '');
        if (!WATCHED_HOSTS.test(host)) { state.otherHosts += 1; return; }
        state.hosts[host] = (state.hosts[host] || 0) + 1;
        const recordEntry = {
          ms: Date.now() - consoleZero,
          kind,
          host,
          path: String(uri.pathQueryRef || '').split('?')[0].slice(0, 120),
          status: (() => { try { return channel.responseStatus; } catch { return null; } })(),
          statusText: (() => { try { return String(channel.responseStatusText || '').slice(0, 40); } catch { return null; } })(),
          canceled: (() => { try { return Boolean(channel.isCanceled); } catch { return null; } })(),
          errorCode: (() => { try { const status = channel.status; return status === 0 || status === undefined ? null : `0x${(status >>> 0).toString(16)}`; } catch { return null; } })(),
          contentLength: (() => { try { return channel.contentLength; } catch { return null; } })(),
          fromCache: kind === 'cached',
        };
        const bucket = kind === 'stop' ? state.stops : state.responses;
        if (bucket.length < 400) bucket.push(recordEntry);
      } catch { /* observation must never disturb the request it observes */ }
    };
    const observer = {
      observe(subject, topic) {
        try {
          if (topic === 'http-on-stop-request') return note(subject.QueryInterface(Ci.nsIHttpChannel), 'stop');
          return note(subject.QueryInterface(Ci.nsIHttpChannel), topic === 'http-on-examine-response' ? 'response' : 'cached');
        } catch { /* a channel that is not an HTTP channel is not ours */ }
      },
    };
    try {
      for (const topic of ['http-on-examine-response', 'http-on-examine-cached-response', 'http-on-examine-merged-response', 'http-on-stop-request']) Services.obs.addObserver(observer, topic);
    } catch (error) { state.registerError = message(error); }
    return {
      state,
      stop() { try { for (const topic of ['http-on-examine-response', 'http-on-examine-cached-response', 'http-on-examine-merged-response', 'http-on-stop-request']) Services.obs.removeObserver(observer, topic); } catch { /* already gone */ } },
    };
  };
  /** The preferences that decide whether Gecko kills a long page script or lets a popup through. */
  const relevantPrefs = () => {
    const names = ['dom.max_script_run_time', 'dom.max_child_script_run_time', 'dom.max_chrome_script_run_time', 'dom.disable_open_during_load', 'privacy.cookieBehavior', 'network.cookie.cookieBehavior', 'dom.timeout.enable_budget_timer_throttling', 'dom.min_background_timeout_value'];
    const out = {};
    for (const name of names) { try { out[name] = Services.prefs.getPrefType(name) === 0 ? null : Services.prefs.getIntPref(name); } catch { out[name] = null; } }
    return out;
  };
  const scriptTerminations = () => diagnosticConsole.filter(entry => entry.class === 'script-timeout').length;

  const cookieCount = (host) => {
    try { return Services.cookies.countCookiesFromHost(host); } catch (error) { return `error:${message(error)}`; }
  };

  // Only ever asked of the local synthetic fixture: its cookie is created by the fixture's own inline
  // script and its value is this run's nonce, so it proves the page's JavaScript ran in this load.
  // No cookie belonging to a real site is ever read.
  const fixtureCookieMatches = () => {
    if (!/^(127\.0\.0\.1|localhost)$/u.test(targetHost)) return null;
    try {
      return Services.cookies.getCookiesFromHost(targetHost, {}).some(cookie => String(cookie.name) === 'zchatgpt_probe' && String(cookie.value) === nonce);
    } catch (error) { return `error:${message(error)}`; }
  };

  // Structural read of a loaded content document. Bounded lengths and counts only; every failure
  // mode is recorded rather than thrown.
  const readDocument = (element) => {
    const out = {};
    let doc = null;
    try { doc = element.contentDocument; } catch (error) { out.contentDocumentError = message(error); }
    if (!doc) {
      // A cross-origin iframe hides its document; a content browser created by chrome code does not.
      // Recording which one happened is the point of the comparison.
      try { out.contentWindowLocation = safeWebURL(element.contentWindow && element.contentWindow.location.href); }
      catch (error) { out.contentWindowError = message(error); }
      return out;
    }
    try { out.readyState = String(doc.readyState || ''); } catch (error) { out.readyStateError = message(error); }
    try { out.title = String(doc.title || '').slice(0, 120); } catch (error) { out.titleError = message(error); }
    try { out.location = safeWebURL((doc.location && doc.location.href) || ''); } catch (error) { out.locationError = message(error); }
    try { out.documentElementTag = String((doc.documentElement && doc.documentElement.tagName) || ''); } catch { /* best effort */ }
    try { out.elementCount = doc.getElementsByTagName('*').length; } catch { /* best effort */ }
    try { out.htmlLength = String((doc.documentElement && doc.documentElement.innerHTML) || '').length; } catch { /* best effort */ }
    try {
      const body = doc.body;
      if (body) {
        const text = String(body.textContent || '');
        out.textLength = text.length;
        // Marker names only; the page's own prose is never recorded.
        const markers = [];
        for (const marker of ['Log in', 'Sign up', 'Sign in', 'ChatGPT', 'Just a moment', 'Verify you are human', 'Enable JavaScript', 'script-ran', 'ZCHATGPT surface fixture']) {
          if (text.includes(marker)) markers.push(marker);
        }
        out.markers = markers;
      }
    } catch (error) { out.bodyError = message(error); }
    try {
      out.controls = {
        buttons: doc.querySelectorAll('button').length,
        inputs: doc.querySelectorAll('input').length,
        links: doc.querySelectorAll('a').length,
        forms: doc.querySelectorAll('form').length,
        scripts: doc.querySelectorAll('script').length,
      };
    } catch { /* best effort */ }
    try {
      const win = doc.defaultView;
      const resources = win && win.performance ? win.performance.getEntriesByType('resource') : [];
      out.resources = resources.length;
      out.scriptResources = resources.filter(entry => /script|javascript/i.test(String(entry.initiatorType || ''))).length;
    } catch { /* performance may be unavailable */ }
    return out;
  };

  const readSurface = (element, kind) => {
    const out = { element: {} };
    try { const rect = element.getBoundingClientRect(); out.rect = { width: Math.round(rect.width), height: Math.round(rect.height) }; }
    catch (error) { out.rectError = message(error); }
    out.element.localName = String(element.localName || '');
    out.element.namespaceURI = String(element.namespaceURI || '');
    try { out.element.constructor = element.constructor && element.constructor.name ? element.constructor.name : null; } catch { /* best effort */ }
    try {
      const win = element.ownerGlobal;
      out.element.isXULElement = win && typeof win.XULElement === 'function' ? element instanceof win.XULElement : null;
      out.element.isHTMLIFrame = win && typeof win.HTMLIFrameElement === 'function' ? element instanceof win.HTMLIFrameElement : null;
    } catch { /* best effort */ }
    out.element.hasLoadURI = typeof element.loadURI;
    out.element.hasWebProgress = typeof element.webProgress;
    if (kind.startsWith('xul')) {
      try { out.currentURI = element.currentURI ? safeWebURL(element.currentURI.spec) : null; } catch (error) { out.currentURIError = message(error); }
      try { out.contentTitle = element.contentTitle ? String(element.contentTitle).slice(0, 120) : null; } catch (error) { out.contentTitleError = message(error); }
      try { out.isLoadingDocument = element.webProgress ? Boolean(element.webProgress.isLoadingDocument) : null; } catch { /* best effort */ }
      // An inactive docshell never starts a queued navigation, so this is the difference between a
      // page that is slow and a page that was never allowed to load.
      try { out.docShellIsActive = element.docShell ? Boolean(element.docShell.isActive) : null; } catch { /* best effort */ }
      try { out.surfaceStateAttr = element.getAttribute ? element.getAttribute('data-zchatgpt-embed-state') : null; } catch { /* best effort */ }
      // A remote page runs out of process, so its document is not readable from chrome; these
      // browsing-context facts are what remains observable, and the document title is written by the
      // page's own script.
      try {
        const context = element.browsingContext;
        out.browsingContext = context ? {
          currentURI: context.currentURI ? safeWebURL(context.currentURI.spec) : null,
          osPid: context.currentWindowGlobal ? context.currentWindowGlobal.osPid : null,
          documentURI: context.currentWindowGlobal && context.currentWindowGlobal.documentURI ? safeWebURL(context.currentWindowGlobal.documentURI.spec) : null,
          isContent: Boolean(context.isContent),
        } : null;
      } catch (error) { out.browsingContextError = message(error); }
    }
    Object.assign(out, readDocument(element));
    return out;
  };

  // `/split-view` in reader.html is the real sidebar host. Anything created there has to work inside
  // an HTML document; anything created in the main window is inside a XUL document.
  const describeDocument = (doc) => {
    const out = {};
    try { out.location = safeWebURL((doc.location && doc.location.href) || ''); } catch (error) { out.locationError = message(error); }
    try { out.contentType = String(doc.contentType || ''); } catch { /* best effort */ }
    try { out.createXULElement = typeof doc.createXULElement; } catch { out.createXULElement = 'error'; }
    try { out.existingIframes = Array.from(doc.querySelectorAll('iframe')).map(frame => ({ src: String(frame.getAttribute('src') || '').slice(0, 120), inDocument: frame.isConnected })); } catch { /* best effort */ }
    try {
      const principal = doc.nodePrincipal;
      out.principal = principal ? { scheme: String(principal.scheme || ''), isSystem: Boolean(principal.isSystemPrincipal) } : null;
    } catch (error) { out.principalError = message(error); }
    return out;
  };

  const makeContainer = (doc, id, useXulBox = false) => {
    const container = useXulBox ? doc.createXULElement('vbox') : doc.createElement('div');
    container.setAttribute('data-zchatgpt-embed-probe', id);
    if (useXulBox) container.style.cssText = 'width:380px;height:620px;overflow:hidden;';
    else container.style.cssText = 'position:relative;display:block;width:380px;height:620px;min-width:380px;min-height:620px;overflow:hidden;border:1px solid rgba(128,128,128,0.5);background:#fff;';
    const slot = doc.getElementById('split-view') || doc.body || doc.documentElement;
    slot.appendChild(container);
    return container;
  };

  // An empty about:blank document is html/head/body, so "the element has a document with elements"
  // alone would report a page that never loaded as a success.
  const isRealPage = (snapshot) => {
    const location = snapshot.location ?? snapshot.currentURI ?? null;
    if (!location || location === 'about:blank' || String(location).startsWith('about:')) return false;
    const ready = snapshot.readyState === 'complete' || snapshot.readyState === 'interactive';
    return ready && (snapshot.elementCount > 1 || snapshot.currentURI !== undefined || snapshot.contentPid !== undefined);
  };

  // The page's own script writes the per-run title, so a title match is proof that JavaScript ran in
  // this load — the one fact a remote page cannot be asked for any other way from chrome code.
  const titleProvesScript = (entry) => {
    const title = String(entry.title || entry.contentTitle || '');
    return { expected: expectedTitle, observed: title.slice(0, 120), matched: title.includes(nonce) };
  };

  const finishEntry = async (entry, element, kind, born, settled, fallbackUsed) => {
    const final = element ? readSurface(element, kind) : {};
    entry.elapsedMs = Date.now() - born;
    Object.assign(entry, final);
    entry.settled = settled;
    if (fallbackUsed) entry.fallbackUsed = fallbackUsed;
    entry.console = takeConsole();
    entry.cookiesAfter = { [targetHost]: cookieCount(targetHost) };
    entry.challengeMarkers = entry.console.filter(item => item.class === 'challenge').slice(0, 10);
    entry.fixtureCookieFromThisRun = fixtureCookieMatches();
    entry.scriptRanThisLoad = titleProvesScript(entry);
    entry.verdict = (() => {
      if (entry.creationError) return entry.adoptionError ? 'adopted-then-failed' : 'creation-failed';
      const location = entry.location ?? entry.currentURI ?? null;
      if (isRealPage(entry)) return 'loaded';
      if (!location || location === 'about:blank') return 'never-navigated';
      if (entry.contentDocumentError !== undefined || entry.contentWindowError !== undefined) return 'loaded-but-document-not-readable';
      return 'partial-load';
    })();
    report.experiments.push(entry);
    await save();
    return entry;
  };

  const runProbe = async (spec) => {
    const { id, kind, host, doc, note, probeUrl = url, timeoutMs = probeTimeoutMs, adoptInto } = spec;
    step = `probe-${id}`;
    // Written before the probe runs, so a host that loses the process mid-probe still leaves the name
    // of the step it died in rather than a report that simply stops.
    report.step = step; await save();
    const entry = { id, kind, host, url: safeWebURL(probeUrl), note, startedAt: new Date().toISOString(), document: describeDocument(doc) };
    if (probeUrl === url || /^https?:/u.test(probeUrl)) entry.cookiesBefore = { [targetHost]: cookieCount(targetHost) };
    let element = null;
    let container = null;
    const born = Date.now();
    try {
      // The product does not append the browser to the window root; it wraps it in an HTML div it
      // positions itself. Which CSS box carries the browser decides whether the frame is rendered at
      // all, so both the fixed and the absolute variant are measured rather than assumed.
      if (kind === 'xul-fixed-div' || kind === 'xul-absolute-div') {
        container = doc.createElement('div');
        container.setAttribute('data-zchatgpt-embed-probe', id);
        container.style.cssText = `position:${kind === 'xul-fixed-div' ? 'fixed' : 'absolute'};display:block;left:40px;top:40px;width:380px;height:620px;overflow:hidden;border:0;margin:0;padding:0;z-index:2147483000;background:#fff;`;
        (doc.body || doc.documentElement).appendChild(container);
        entry.containerKind = kind;
        entry.containerParent = container.parentElement ? String(container.parentElement.localName || '') : null;
        try {
          const rect = container.getBoundingClientRect();
          entry.containerRect = { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) };
        } catch (error) { entry.containerRectError = message(error); }
      } else if (kind === 'xul-src-tabcontent' || kind === 'xul-viewer-attrs-loaduri-readertab' || spec.intoReaderTab) {
        const readerTabContent = spec.intoReaderTab || null;
        const deck = readerTabContent ? null : (Zotero.getMainWindow()?.Zotero_Tabs?.deck || doc.getElementById('tab-bar-container'));
        container = doc.createXULElement('tab-content');
        container.setAttribute('data-zchatgpt-embed-probe', id);
        container.style.cssText = 'width:380px;height:620px;overflow:hidden;';
        entry.containerKind = readerTabContent ? 'reader-tab-content-sibling' : 'xul-tab-content';
        const parent = readerTabContent || deck || doc.documentElement;
        entry.deckFound = Boolean(parent && parent.appendChild);
        parent.appendChild(container);
      } else {
        container = makeContainer(doc, id, kind === 'xul-src-xulbox');
        entry.containerKind = kind === 'xul-src-xulbox' ? 'xul-vbox' : 'html-div';
      }
      entry.attached = true;
      if (kind === 'xul-src' || kind === 'xul-src-xulbox' || kind === 'xul-src-tabcontent' || kind === 'xul-viewer-attrs') {
        // Exactly Zotero's own reader order: class, type, src, then append.
        element = doc.createXULElement('browser');
        element.setAttribute('class', 'zchatgpt-embed-probe-browser');
        element.setAttribute('flex', '1');
        element.setAttribute('type', 'content');
        // Zotero's viewer window (the surface that does load remote pages) carries these attributes.
        if (kind === 'xul-viewer-attrs') {
          element.setAttribute('remote', 'false');
          element.setAttribute('disableglobalhistory', 'true');
          element.setAttribute('maychangeremoteness', 'true');
          element.setAttribute('messagemanagergroup', 'zchatgpt-probe');
          entry.attributes = 'viewer';
        }
        element.setAttribute('src', probeUrl);
      } else if (kind === 'xul-loaduri' || kind === 'xul-adopt' || kind === 'xul-viewer-attrs-loaduri' || kind === 'xul-remote-true' || kind === 'xul-fixed-div' || kind === 'xul-absolute-div') {
        element = doc.createXULElement('browser');
        element.setAttribute('class', 'zchatgpt-embed-probe-browser');
        element.setAttribute('flex', '1');
        element.setAttribute('type', 'content');
        if (kind === 'xul-viewer-attrs-loaduri' || kind === 'xul-remote-true' || kind === 'xul-fixed-div' || kind === 'xul-absolute-div') {
          element.setAttribute('remote', 'false');
          element.setAttribute('disableglobalhistory', 'true');
          element.setAttribute('maychangeremoteness', 'true');
          element.setAttribute('messagemanagergroup', 'zchatgpt-probe');
          entry.attributes = 'viewer';
        }
        if (kind === 'xul-remote-true') { element.setAttribute('remote', 'true'); entry.attributes = 'remote-true'; }
      } else if (kind === 'iframe-src') {
        element = doc.createElement('iframe');
        element.setAttribute('src', probeUrl);
      }
      if (element) element.style.cssText = 'display:block;width:100%;height:100%;border:0;';
      if (element) container.appendChild(element);
      entry.created = true;
      // The navigation entry point Zotero's own viewer window uses.
      const navigate = () => element.loadURI(Services.io.newURI(probeUrl), { triggeringPrincipal: systemPrincipal });
      if (kind === 'xul-loaduri' || kind === 'xul-viewer-attrs-loaduri' || kind === 'xul-remote-true' || kind === 'xul-fixed-div' || kind === 'xul-absolute-div') {
        entry.loadURIUsed = true;
        try { navigate(); } catch (error) { entry.loadURIError = message(error); }
      }
      // Adoption experiment: navigate a browser in the XUL main window, then move the finished
      // element into the sidebar document, which cannot create XUL elements of its own.
      if (kind === 'xul-adopt') {
        entry.loadURIUsed = true;
        try { navigate(); } catch (error) { entry.loadURIError = message(error); }
        await delay(3000);
        entry.beforeAdoptionURI = safeWebURL(element.currentURI?.spec || '');
        entry.beforeAdoptionTitle = String(element.contentTitle || '');
        try {
          adopter: {
            const splitView = adoptInto.getElementById('split-view');
            if (!splitView) { entry.adoptionError = 'no #split-view in adoption target'; break adopter; }
            splitView.appendChild(element);
            entry.adoptedInto = 'reader #split-view';
          }
        } catch (error) { entry.adoptionError = message(error); }
        entry.afterAdoptionURI = safeWebURL(element.currentURI?.spec || '');
      }
    } catch (error) {
      entry.creationError = message(error);
      report.experiments.push(entry); await save(); return entry;
    }

    let settled = false;
    let fallbackUsed = null;
    const timeline = [];
    const deadline = born + timeoutMs;
    while (Date.now() < deadline) {
      await delay(500);
      const snapshot = readSurface(element, kind);
      const state = { ms: Date.now() - born, readyState: snapshot.readyState ?? null, location: snapshot.location ?? snapshot.currentURI ?? null, elementCount: snapshot.elementCount ?? null, isLoadingDocument: snapshot.isLoadingDocument ?? null };
      const previous = timeline[timeline.length - 1];
      if (!previous || previous.readyState !== state.readyState || previous.elementCount !== state.elementCount || previous.location !== state.location || previous.isLoadingDocument !== state.isLoadingDocument) timeline.push(state);
      if (isRealPage(snapshot) && snapshot.isLoadingDocument === false) { settled = true; break; }
    }
    entry.timeline = timeline.slice(0, 40);
    const finished = await finishEntry(entry, element, kind, born, settled, fallbackUsed);
    // Each probe takes its own container back out: two of them change the reader's or the deck's
    // layout while they exist, and a later measurement must not inherit that.
    try { (adoptInto && element ? element : container)?.remove?.(); } catch { /* already gone */ }
    return finished;
  };

  /**
   * What a page inside our surface can actually do, and whether hiding the surface changes it.
   *
   * The product loads the application while its box is parked off-screen so the session survives a
   * mode switch. Whether Gecko treats that box as a hidden document — frames stopped, timers cut to
   * one second — decides whether the application can finish starting at all, which is the difference
   * between "the page is slow" and "the page is standing still". The same page is therefore loaded
   * twice, once parked and once painted, and then the parked one is shown to see whether it recovers.
   */
  const runCapabilityProbe = async (probeUrl, win) => {
    const placements = ['parked', 'painted'];
    const results = [];
    for (const placement of placements) {
      const born = Date.now();
      const entry = { placement, url: safeWebURL(probeUrl), samples: [], errors: [] };
      let container = null;
      let browser = null;
      try {
        browser = win.document.createXULElement('browser');
        for (const [name, value] of [
          ['type', 'content'], ['remote', 'false'], ['disableglobalhistory', 'true'],
          ['maychangeremoteness', 'true'], ['messagemanagergroup', 'zchatgpt'], ['class', 'zchatgpt-embed-probe-browser'],
        ]) browser.setAttribute(name, value);
        browser.setAttribute('data-zchatgpt-embed-probe', `caps-${placement}`);
        browser.style.cssText = 'display:block;width:100%;height:100%;border:0;';
        container = win.document.createElement('div');
        container.setAttribute('data-zchatgpt-embed-probe', `caps-${placement}`);
        container.style.cssText = placement === 'parked'
          ? 'position:fixed;left:-20000px;top:0px;width:480px;height:720px;overflow:hidden;border:0;margin:0;padding:0;background:#fff;'
          : 'position:fixed;left:40px;top:80px;width:480px;height:720px;overflow:hidden;border:0;margin:0;padding:0;z-index:2147483000;background:#fff;';
        browser.setAttribute('src', probeUrl);
        container.appendChild(browser);
        (win.document.body || win.document.documentElement).appendChild(container);

        const readTitle = () => { try { return String(browser.contentTitle || ''); } catch (error) { entry.errors.push(message(error)); return ''; } };
        const decode = value => value.replace(/^ZCAPS\s*/u, '');
        let last = null;
        const deadline = Date.now() + 12000;
        while (Date.now() < deadline) {
          await delay(500);
          const title = decode(readTitle());
          if (title && title !== last) { last = title; entry.samples.push({ ms: Date.now() - born, report: title.slice(0, 500) }); }
          if (/slowImage/u.test(title)) break;
        }
        if (placement === 'parked') {
          // Showing the parked box is the whole question: does the page notice, resume frames and
          // finish the work it could not do while it was out of the viewport?
          container.style.left = '40px';
          container.style.top = '80px';
          container.style.zIndex = '2147483000';
          const shownAt = Date.now();
          await delay(3000);
          entry.afterShowing = { waitedMs: Date.now() - shownAt, report: decode(readTitle()).slice(0, 500) };
        }
        entry.final = decode(readTitle()).slice(0, 500);
      } catch (error) {
        entry.errors.push(message(error));
      } finally {
        try { container?.remove(); } catch { /* already gone */ }
      }
      results.push(entry);
      await save();
    }
    return results;
  };

  // Zotero's own supported remote-page surface: a XUL window whose <browser> loads any URI, used by
  // OAuth sign-in and by BrowserRequest challenges. Measured here as the baseline the sidebar would
  // have to match.
  const runViewerProbe = async (probeUrl) => {
    step = 'probe-viewer-window';
    report.step = step; await save();
    const entry = { id: `viewer-window`, kind: 'zotero-openInViewer', host: 'zotero-viewer', url: safeWebURL(probeUrl), note: 'Zotero.openInViewer()', startedAt: new Date().toISOString() };
    const born = Date.now();
    let viewer = null;
    try {
      viewer = Zotero.openInViewer(probeUrl);
      entry.opened = true;
      const browser = await until(() => {
        const found = viewer && !viewer.closed && viewer.document && viewer.document.querySelector('browser');
        return found || null;
      }, 'viewer-browser', 15000);
      entry.document = describeDocument(viewer.document);
      entry.browserWindowType = String(viewer.document.documentElement.getAttribute('windowtype') || '');
      let settled = false;
      const timeline = [];
      const deadline = born + probeTimeoutMs;
      while (Date.now() < deadline) {
        await delay(500);
        const snapshot = readSurface(browser, 'xul');
        const state = { ms: Date.now() - born, readyState: snapshot.readyState ?? null, location: snapshot.location ?? snapshot.currentURI ?? null, elementCount: snapshot.elementCount ?? null, isLoadingDocument: snapshot.isLoadingDocument ?? null };
        const previous = timeline[timeline.length - 1];
        if (!previous || previous.readyState !== state.readyState || previous.elementCount !== state.elementCount || previous.location !== state.location) timeline.push(state);
        const docReady = snapshot.readyState === 'complete' || snapshot.readyState === 'interactive';
        if (snapshot.elementCount > 1 && docReady && snapshot.isLoadingDocument === false) { settled = true; break; }
      }
      entry.timeline = timeline.slice(0, 40);
      const finished = await finishEntry(entry, browser, 'xul', born, settled, null);
      // The viewer is a real window; leaving it open would keep a second Zotero window in the run.
      try { if (viewer && !viewer.closed) viewer.close(); } catch { /* already closed */ }
      return finished;
    } catch (error) {
      try { if (viewer && !viewer.closed) viewer.close(); } catch { /* already closed */ }
      entry.creationError = message(error);
      const finished = await finishEntry(entry, null, 'xul', born, false, null);
      return finished;
    }
  };

  try {
    await Zotero.initializationPromise;
    startConsole();    await check('isolated-embed-profile', PathUtils.profileDir === config.profile && String(config.profile).endsWith('/.zotero-chatgpt-dev/embed/profile') && Zotero.DataDirectory.dir === config.dataDir, { profile: PathUtils.profileDir });
    // Cookies already on disk when this process starts prove the jar survives a Zotero restart; that
    // is the same mechanism an authenticated ChatGPT session would depend on. Counts only.
    report.persistence = { cookiesAtStartup: { [targetHost]: cookieCount(targetHost) } };
    const win = await until(() => Zotero.getMainWindow(), 'main-window');
    report.environment = {
      zotero: Zotero.version,
      gecko: Services.appinfo.platformVersion,
      platform: Services.appinfo.OS,
      windowSize: { width: win.innerWidth, height: win.innerHeight },
      mainWindowDocument: describeDocument(win.document),
    };
    // Chrome-privileged reachability of the target, so a refused frame load can be told apart from a
    // network problem in this isolated profile.
    try {
      const response = await fetch(url, { cache: 'no-store' });
      report.reachability = { fetched: true, status: response.status, type: response.headers.get('content-type') };
      try { await response.body?.cancel(); } catch { /* body already consumed */ }
    } catch (error) { report.reachability = { fetched: false, error: message(error) }; }
    await save();

    await until(() => win.ZoteroPane?.loaded && win.ZoteroPane?.itemsView, 'library-ready');
    await Zotero.Libraries.get(Zotero.Libraries.userLibraryID).waitForDataLoad('item');
    const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
    const addon = await AddonManager.getAddonByID(config.subjectID); if (addon?.userDisabled) await addon.enable();
    report.productAddon = { active: Boolean(addon?.isActive), version: addon?.version ?? null };

    // One synthetic attachment, opened in the real reader: the sidebar host is the reader document,
    // so the probe has to run there rather than in an arbitrary window.
    const parent = new Zotero.Item('journalArticle'); parent.setField('title', 'ZCHATGPT embedded web surface probe');
    parent.setCreators([{ firstName: 'Ada', lastName: 'Example', creatorType: 'author' }]);
    const queue = new Zotero.Notifier.Queue(); await parent.saveTx({ notifierQueue: queue });
    const attachment = await Zotero.Attachments.importFromFile({ file: config.pdfPath, parentItemID: parent.id, title: 'Embed probe PDF', saveOptions: { notifierQueue: queue } });
    await Promise.all([parent.loadAllData(), attachment.loadAllData()]); await Zotero.Notifier.commit(queue);
    win.Zotero_Tabs.closeAll(); await until(() => Zotero.Reader._readers.length === 0, 'close-only-this-profile-tabs');
    const opened = await Zotero.Reader.open(attachment.id);
    const reader = () => Zotero.Reader.getByTabID(opened.tabID);
    const readerDoc = () => reader()?._iframeWindow?.document;
    const doc = await until(() => readerDoc(), 'reader-document');
    report.reader = {
      documentURL: safeWebURL((doc.location && doc.location.href) || ''),
      hasSplitView: Boolean(doc.getElementById('split-view')),
      document: describeDocument(doc),
      readerBrowser: (() => {
        const browser = reader()?._iframe;
        if (!browser) return null;
        const out = { localName: String(browser.localName || ''), namespaceURI: String(browser.namespaceURI || '') };
        try { out.constructor = browser.constructor && browser.constructor.name; } catch { /* best effort */ }
        try { out.isConnected = browser.isConnected; } catch { /* best effort */ }
        return out;
      })(),
    };
    await check('reader-document-is-the-sidebar-host', Boolean(doc.getElementById('split-view')), report.reader);

    // Before anything else in this run touches the window: what a page inside the product's exact
    // surface shape can do, parked versus painted. This is the run's cheapest and most load-bearing
    // measurement, so it happens first and is saved as soon as it finishes.
    if (config.capabilityProbe) {
      step = 'capability-probe';
      report.step = step; await save();
      report.capability = await runCapabilityProbe(config.url, win);
      await save();
    }

    // The launched window can report a size while nothing under its tab bar has been laid out yet —
    // the whole chain from `#browser` down measures zero, including the reader pane the sidebar lives
    // in. That is a property of the harness window, not of the plugin, and it decides whether the rest
    // of the run can measure a painted surface at all, so it is recorded and a resize is tried.
    report.harnessLayout = await (async () => {
      const rect = node => { if (!node) return null; try { const r = node.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; } catch (error) { return message(error); } };
      const measure = () => ({ readerPane: rect(reader()?._iframe ?? null), deck: rect(win.Zotero_Tabs ? win.Zotero_Tabs.deck : null) });
      const mainWindow = win.document.getElementById('main-window');
      const children = mainWindow ? Array.from(mainWindow.children).map(node => ({ tag: String(node.localName || ''), id: String(node.id || ''), rect: rect(node), height: (() => { try { return win.getComputedStyle(node).height; } catch { return null; } })() })) : [];
      const before = measure();
      let error = null;
      try {
        win.resizeTo(win.outerWidth, win.outerHeight - 80);
        await delay(600);
        win.resizeTo(win.outerWidth, win.outerHeight + 80);
        await delay(900);
      } catch (caught) { error = message(caught); }
      return { before, after: measure(), mainWindowChildren: children, resizeError: error };
    })();
    await save();

    // ---- the shipped product path -----------------------------------------------------------------
    // Everything above measures what the host *can* do. This section drives the real dock: the plugin
    // under test creates its own surface, and these checks assert the surface the product actually
    // shows is the real application, in a chrome browser, kept across mode switches.
    const product = { notRun: ['interactive-login', 'conversation-send', 'streaming-render', 'model-selection', 'file-upload'] };
    report.product = product;
    productNetwork = startNetworkWatch();
    const embedBrowser = () => {
      const surfaces = [...win.document.querySelectorAll('[data-zchatgpt-embed-browser]')];
      const itemID = reader()?.itemID;
      const bound = itemID === undefined ? [] : surfaces.filter(node => String(node.getAttribute('data-zchatgpt-context-binding') || '').endsWith(`:${itemID}`));
      const paintedBound = bound.filter(node => Boolean(node.getAttribute('data-zchatgpt-embed-painted')));
      if (paintedBound.length === 1) return paintedBound[0];
      if (bound.length === 1) return bound[0];
      const paintedSurface = surfaces.filter(node => Boolean(node.getAttribute('data-zchatgpt-embed-painted')));
      return paintedSurface.length === 1 ? paintedSurface[0] : null;
    };
    const painted = () => { const node = embedBrowser(); return node ? String(node.getAttribute('data-zchatgpt-embed-painted') || '') : null; };

    const toggle = await until(() => doc.querySelector('[data-zchatgpt-toggle]'), 'product-toolbar-button');
    toggle.click();
    const embedSection = await until(() => doc.querySelector('[data-zchatgpt-embed]'), 'product-embed-section');
    await until(() => !embedSection.hasAttribute('hidden'), 'product-chat-surface-visible');
    const slot = doc.querySelector('[data-zchatgpt-embed-slot]');
    const nativeChat = doc.querySelector('[data-zchatgpt-chat]');
    const rectOfNode = node => {
      if (!node) return null;
      try { const rect = node.getBoundingClientRect(); return { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) }; }
      catch (error) { return message(error); }
    };
    // A surface that refuses to paint has a cause somewhere in the ancestor chain — a zero-height
    // reader pane, a hidden dock, a frame that is not the reader's — so the chain is recorded instead
    // of only its last symptom. Rects inside the reader document are in that document's viewport.
    const chain = node => {
      const out = [];
      let current = node;
      let depth = 0;
      while (current && depth < 10) {
        let style = null;
        try {
          const view = current.ownerGlobal || win;
          const computed = view.getComputedStyle ? view.getComputedStyle(current) : null;
          style = computed ? { display: computed.display, position: computed.position, height: computed.height, flex: computed.flex, overflow: computed.overflow } : null;
        } catch { /* best effort */ }
        out.push({ depth, tag: String(current.localName || ''), id: String(current.id || ''), cls: String(current.className || '').slice(0, 48), rect: rectOfNode(current), style, hidden: Boolean(current.hidden) });
        current = current.parentElement; depth += 1;
      }
      return out;
    };
    // UI-01: the switch is fixed in the common shell bar in both modes, never inside the notice
    // strip that belongs to the hosted surface.
    const shellSwitch = doc.querySelector('[data-zchatgpt-shell-bar] [data-zchatgpt-mode-switch]');
    const embedNoticeSwitch = doc.querySelector('[data-zchatgpt-embed-notice] [data-zchatgpt-mode-switch]');
    await check('product-chat-mode-shows-the-hosted-surface',
      Boolean(slot) && Boolean(nativeChat && nativeChat.hidden === true) && Boolean(shellSwitch) && !embedNoticeSwitch,
      { nativeChatHidden: nativeChat ? nativeChat.hidden : null, modeSwitchInShellBar: Boolean(shellSwitch), modeSwitchInEmbedNotice: Boolean(embedNoticeSwitch) });
    // The normal header is one row: no permanent context summary row, no legacy action strip, and no
    // second bar beside the shell bar.
    await check('product-chat-header-is-a-single-row',
      !doc.querySelector('[data-zchatgpt-shell-context]') && !doc.querySelector('[data-zchatgpt-embed-bar]')
        && !doc.querySelector('[data-zchatgpt-embed-actions]') && !doc.querySelector('[data-zchatgpt-document-status]')
        && doc.querySelectorAll('[data-zchatgpt-shell-bar]').length === 1,
      {
        contextRow: Boolean(doc.querySelector('[data-zchatgpt-shell-context]')),
        legacyBar: Boolean(doc.querySelector('[data-zchatgpt-embed-bar]')),
        legacyActions: Boolean(doc.querySelector('[data-zchatgpt-embed-actions]')),
        documentStatus: Boolean(doc.querySelector('[data-zchatgpt-document-status]')),
        shellBars: doc.querySelectorAll('[data-zchatgpt-shell-bar]').length,
      });
    const paperActions = doc.querySelector('[data-zchatgpt-paper-actions]');
    const paperButtons = paperActions ? [...paperActions.querySelectorAll('button')] : [];
    await check('product-chat-offers-the-two-paper-icon-actions-in-the-toolbar',
      Boolean(paperActions)
        && paperButtons.length === 2
        && paperButtons.every(node => String(node.textContent || '').trim() === '' && Boolean(node.querySelector('svg')))
        && paperButtons.some(node => node.dataset.zchatgptAction === 'copy-paper-context')
        && paperButtons.some(node => node.dataset.zchatgptAction === 'copy-pdf-file'),
      { actions: paperButtons.map(node => ({ action: node.dataset.zchatgptAction || null, label: node.getAttribute('aria-label'), hasGlyph: Boolean(node.querySelector('svg')), hit: rectOfNode(node) })) });
    // The dock lives in the reader's HTML document, which cannot create XUL elements at all, so the
    // surface must be the host's chrome browser in the main window rather than an element beside it.
    await check('product-chat-surface-is-not-an-element-in-the-reader-document', !doc.querySelector('[data-zchatgpt-embed-browser]'));

    product.layout = {
      window: {
        innerWidth: win.innerWidth, innerHeight: win.innerHeight,
        outerWidth: win.outerWidth, outerHeight: win.outerHeight,
        windowState: (() => { try { return win.windowState; } catch { return null; } })(),
      },
      documentElement: rectOfNode(win.document.documentElement),
      tabBar: rectOfNode(win.document.getElementById('tab-bar-container')),
      deck: rectOfNode(win.Zotero_Tabs ? win.Zotero_Tabs.deck : null),
      tabs: {
        selected: String((win.Zotero_Tabs && win.Zotero_Tabs.selectedID) || ''),
        opened: String(opened.tabID || ''),
        readers: Zotero.Reader._readers.length,
      },
      frameChain: chain(reader()?._iframe ?? null),
      slotChain: chain(slot),
      embedChain: chain(doc.querySelector('[data-zchatgpt-embed]')),
    };
    await save();

    const surfaceBrowser = await until(() => embedBrowser(), 'product-embed-browser', 30000);
    // A new-window request from the hosted page is how an OAuth sign-in usually leaves the document.
    // Whether a browsing context came with it is the difference between a visible sign-in page and a
    // request that goes nowhere the owner can see, so both are recorded.
    const popupAttempts = [];
    try {
      surfaceBrowser.addEventListener('DOMWindowOpen', event => {
        try {
          const detail = event.detail || {};
          popupAttempts.push({
            ms: Date.now() - consoleZero,
            url: safeWebURL(detail.url || ''),
            hasBrowsingContext: Boolean(detail.browsingContext),
            hasWindow: Boolean(event.target && event.target !== surfaceBrowser),
          });
        } catch { /* observation only */ }
      });
    } catch (error) { product.popupListenerError = message(error); }
    // A silent surface has several possible causes — no layout yet, a hidden dock, an inactive
    // docshell, a refused navigation — and they are told apart by what changes over time, so the
    // samples are recorded rather than reduced to one final reading.
    const describeSurface = () => {
      const browser = embedBrowser();
      if (!browser) return { missing: true, surfaces: win.document.querySelectorAll('[data-zchatgpt-embed-browser]').length };
      const probe = value => { try { return typeof value === 'function' ? value() : value; } catch (error) { return message(error); } };
      const pointer = value => ['', 'auto', 'none'].includes(String(value ?? '')) ? String(value ?? '') : 'other';
      const centerHitOwnedBrowser = probe(() => { const rect = browser.getBoundingClientRect(); if (rect.width < 1 || rect.height < 1) return false; const hit = win.document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2); return hit === browser || browser.contains?.(hit) === true; });
      return {
        state: String(browser.getAttribute('data-zchatgpt-embed-state') || ''),
        painted: painted(),
        currentURI: probe(() => safeWebURL(browser.currentURI?.spec || '')),
        isLoadingDocument: probe(() => Boolean(browser.webProgress?.isLoadingDocument)),
        docShellIsActive: probe(() => (browser.docShell ? Boolean(browser.docShell.isActive) : null)),
        contentPid: probe(() => browser.browsingContext?.currentWindowGlobal?.osPid ?? null),
        title: probe(() => String(browser.contentTitle ?? '').slice(0, 80)),
        parent: String(browser.parentElement?.localName || ''),
        pointerEvents: { inline: pointer(browser.style.pointerEvents), computed: pointer(win.getComputedStyle(browser).pointerEvents) },
        centerHitOwnedBrowser,
        rect: rectOfNode(browser),
        containerStyle: String(browser.parentElement?.getAttribute('style') || '').slice(0, 200),
        slotRect: rectOfNode(slot),
        frameRect: rectOfNode(reader()?._iframe ?? null),
        window: { width: win.innerWidth, height: win.innerHeight },
      };
    };
    const waitStart = Date.now();
    const untilDeadline = waitStart + 30000;
    const samples = [];
    while (Date.now() < untilDeadline) {
      const sample = describeSurface();
      const previous = samples[samples.length - 1];
      if (!previous || JSON.stringify({ ...previous, t: 0 }) !== JSON.stringify({ ...sample, t: 0 })) samples.push({ t: Date.now() - waitStart, ...sample });
      if (sample.painted && /^\d+x\d+$/u.test(sample.painted)) break;
      await delay(500);
    }
    product.paintWait = samples.slice(0, 20);
    await save();
    const coverage = painted();
    const slotRect = describeSurface().slotRect;
    product.paint = {
      painted: coverage,
      slot: slotRect,
      browserRect: rectOfNode(embedBrowser()),
      containerRect: rectOfNode(win.document.querySelector('[data-zchatgpt-embed-container]')),
      containerStyle: String(win.document.querySelector('[data-zchatgpt-embed-container]')?.getAttribute('style') || '').slice(0, 200),
    };
    // A slot with no height on screen is not something the surface may paint into, and in this
    // window it is a property of the harness rather than of the plugin: the launched window lays the
    // reader pane out after the dock has already been measured. That case is recorded as skipped so
    // the run can still answer the question it exists for — whether the application loads and stays.
    if (!slotRect || slotRect.height < 1 || slotRect.width < 1) {
      product.paint.skipped = 'the reader pane has no height in this window, so there is no slot to cover';
    } else {
      await check('product-chat-surface-covers-the-sidebar-slot',
        Boolean(coverage) && /^\d+x\d+$/u.test(coverage) && coverage === `${slotRect.width}x${slotRect.height}`,
        product.paint);
    }
    surfaceBrowser.setAttribute('data-zchatgpt-product-tag', nonce);
    const surfaceURI = await until(() => {
      const uri = String(embedBrowser()?.currentURI?.spec || '');
      return uri && uri !== 'about:blank' && !uri.startsWith('about:') ? uri : null;
    }, 'product-chat-browser-load', 30000).catch(() => null);
    product.surfaceAfterLoad = describeSurface();
    // The product always loads the application this plugin hosts; `--url` only redirects the
    // experiments above, so this check names the application origin rather than the probe URL.
    await check('product-chat-browser-loads-the-application', String(surfaceURI).startsWith('https://chatgpt.com/'),
      { currentURI: safeWebURL(surfaceURI), expected: 'https://chatgpt.com/', paintWait: product.paintWait });
    // Product actor proof: ask the actor bound to this exact WindowGlobal whether it can see the one
    // named official composer. The reply is an enum only — no document text, form value, account data
    // or credential crosses into this report — and the query never clicks or sends a model request.
    report.step = 'product-official-chat-actor-probe';
    await save();
    product.actorProbe = await (async () => {
      const out = {
        actor: 'ZoteroChatGPTOfficialChat',
        currentURI: safeWebURL(surfaceBrowser.currentURI?.spec || ''),
        contentPid: surfaceBrowser.browsingContext?.currentWindowGlobal?.osPid ?? null,
        status: null,
        elapsedMs: null,
        error: null,
        timeline: [],
      };
      product.actorProbe = out;
      const started = Date.now();
      // The anonymous landing page can sit on a challenge interstitial for tens of seconds before
      // the application hydrates its composer; 30 s was enough to see "missing" forever without
      // ever observing the editor the drift report needs. 120 s distinguishes "no editor at all"
      // from "an editor the product does not recognise".
      const deadline = started + Math.min(120000, Math.max(1000, Number(config.probeTimeoutMs) || 120000));
      while (Date.now() < deadline) {
        try {
          const browser = embedBrowser();
          const global = browser?.browsingContext?.currentWindowGlobal;
          if (!global) throw new Error('The hosted page has no current WindowGlobal.');
          let timer = null;
          const result = await Promise.race([
            global.getActor('ZoteroChatGPTOfficialChat').sendQuery('probe'),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Official Chat actor probe query timed out.')), 5000); }),
          ]).finally(() => { if (timer !== null) clearTimeout(timer); });
          const status = result && typeof result.status === 'string' ? result.status : 'invalid-response';
          out.status = status; out.error = null;
          // The probe's `structure` payload is the child actor's own allowlisted shape — editor
          // tag/id/role/contenteditable and a send-button count, never page prose or field values.
          // A selector repair is built from exactly this, so keep every non-empty observation.
          const structure = result && typeof result.structure === 'object' && result.structure ? result.structure : null;
          if (structure && Array.isArray(structure.editors) && structure.editors.length > 0 && !out.structure) out.structure = structure;
          out.currentURI = safeWebURL(browser.currentURI?.spec || '');
          out.contentPid = global.osPid ?? null;
          out.timeline.push({ ms: Date.now() - started, status, currentURI: out.currentURI, contentPid: out.contentPid, editors: structure && Array.isArray(structure.editors) ? structure.editors.length : 0, knownSendButtons: structure ? Number(structure.knownSendButtons ?? 0) : 0 });
          if (status === 'ready' || status === 'composer-ready' || status === 'draft') break;
        } catch (error) {
          out.error = message(error);
          out.timeline.push({ ms: Date.now() - started, status: 'error', error: out.error });
        }
        out.timeline = out.timeline.slice(-60); await save();
        await delay(500);
      }
      out.timeline = out.timeline.slice(-60);
      out.elapsedMs = Date.now() - started;
      out.surfaceAfterProbe = describeSurface();
      return out;
    })();
    if (['composer-missing', 'unsupported-composer'].includes(product.actorProbe.status)) {
      const pointerEvents = product.actorProbe.surfaceAfterProbe.pointerEvents;
      await check('product-without-supported-composer-keeps-web-page-clickable',
        pointerEvents.inline === 'auto' && pointerEvents.computed === 'auto'
          && product.actorProbe.surfaceAfterProbe.centerHitOwnedBrowser === true,
        { actorStatus: product.actorProbe.status, pointerEvents, centerHitOwnedBrowser: product.actorProbe.surfaceAfterProbe.centerHitOwnedBrowser });
    }
    const productActorReady = ['ready', 'composer-ready', 'draft'].includes(product.actorProbe.status) && product.actorProbe.error === null;
    const manualWatch = Number(config.watchSeconds || 0) > 0;
    if (config.webLive) { product.actorProbe.webLiveReadinessGate = productActorReady; await save(); }
    else if (manualWatch) { product.actorProbe.manualLoginReadiness = productActorReady ? 'available' : 'unavailable'; await save(); }
    else await check('product-official-chat-actor-reaches-the-composer', productActorReady, product.actorProbe);
    if (config.webLive) {
      report.step = 'product-official-chat-web-live';
      product.webLive = { status: 'checking-readiness', maxModelTurns: 1, modelTurnsStarted: 0, transcriptReturned: false, authDataRead: false, cookieDataRead: false, timeline: [] };
      const boundedQuery = async (actorName, name, data, timeout = 5000) => {
        const browser = embedBrowser(); const global = browser?.browsingContext?.currentWindowGlobal;
        if (!global) throw new Error('The hosted page has no current WindowGlobal.');
        let timer = null;
        try {
          const value = await Promise.race([
            global.getActor(actorName).sendQuery(name, data),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${actorName} ${name} timed out.`)), timeout); }),
          ]);
          return { value, global, browser };
        } finally { if (timer !== null) clearTimeout(timer); }
      };
      const ownCodexProcesses = async () => {
        const { Subprocess } = ChromeUtils.importESModule('resource://gre/modules/Subprocess.sys.mjs');
        const child = await Subprocess.call({ command: '/bin/ps', arguments: ['-axo', 'pid=,args='], stderr: 'pipe' });
        const decoder = new TextDecoder(); let output = '';
        for (let bytes = await child.stdout.read(); bytes.byteLength !== 0; bytes = await child.stdout.read()) output += decoder.decode(bytes, { stream: true });
        output += decoder.decode(); await child.wait();
        return output.split('\n').filter(line => line.includes(`${config.profile}/zotero-chatgpt/`) && line.includes(' app-server')).map(line => line.trim().slice(0, 220));
      };
      let before = await boundedQuery('ZoteroChatGPTWebAcceptance', 'probe', { verificationToken: config.verificationToken });
      let baseline = before.value;
      product.webLive.baseline = baseline;
      let effectiveProductStatus = product.actorProbe.status;
      if (effectiveProductStatus === 'draft' && baseline?.draftMatchesKnownSyntheticHarness === true) {
        const cleared = await boundedQuery('ZoteroChatGPTWebAcceptance', 'clearKnownHarnessDraft', {}, 10000);
        product.webLive.discardedKnownSyntheticDraft = cleared.value?.status === 'cleared' && cleared.value?.discardedKnownSyntheticDraft === true && cleared.value?.empty === true;
        if (product.webLive.discardedKnownSyntheticDraft) {
          before = await boundedQuery('ZoteroChatGPTWebAcceptance', 'probe', { verificationToken: config.verificationToken }); baseline = before.value; product.webLive.baselineAfterDiscard = baseline;
          const productAfterDiscard = await boundedQuery('ZoteroChatGPTOfficialChat', 'probe', {}, 10000); effectiveProductStatus = productAfterDiscard.value?.status ?? 'invalid-response';
          product.webLive.productAfterDiscard = { status: effectiveProductStatus };
        }
      } else product.webLive.discardedKnownSyntheticDraft = false;
      const draftSafe = effectiveProductStatus !== 'draft' || baseline?.draftMatchesExactTestQuestion === true;
      const contextReady = ['ready', 'composer-ready', 'draft'].includes(effectiveProductStatus) && draftSafe && baseline?.status === 'ok' && baseline.officialURL === true && baseline.canonicalOrigin === 'https://chatgpt.com' && baseline.inputReady === true;
      if (!contextReady) {
        product.webLive.status = 'blocked'; product.webLive.blockedStage = productActorReady ? 'official-input-readiness' : 'product-actor-readiness'; product.webLive.reason = productActorReady ? (!draftSafe ? 'unrelated-existing-draft' : (baseline?.reason ?? 'official-input-unavailable')) : (product.actorProbe.status ?? 'product-actor-unavailable');
        product.notRun.push('conversation-send', 'streaming-render'); await save();
      } else {
        // A brand-new conversation can expose its composer before the page has finished hydrating, so
        // require the same ready observation twice before submitting. This is harness timing only:
        // the product still has to make the send work, and the number of clicks it needed is recorded
        // as `attempts` in productSubmit below.
        let stableSamples = 0;
        await until(async () => {
          try {
            const observed = await boundedQuery('ZoteroChatGPTWebAcceptance', 'probe', { verificationToken: config.verificationToken });
            const state = { status: observed?.status ?? null, inputReady: observed?.inputReady === true, canonicalURL: observed?.canonicalURL ?? null, documentReadyState: observed?.documentReadyState ?? null };
            stableSamples = state.status === 'ok' && state.inputReady ? stableSamples + 1 : 0;
            product.webLive.preSubmitReadiness = { ...state, stableSamples };
            return stableSamples >= 2 ? state : null;
          } catch (error) {
            const text = message(error);
            if (/WindowGlobal unavailable|timed out|NS_ERROR_NOT_INITIALIZED|dead object|actor/iu.test(text)) { stableSamples = 0; return null; }
            throw error;
          }
        }, 'stable-official-composer-before-web-live-submit', 30000).catch(() => null);
        const consent = doc.querySelector('[data-zchatgpt-action="continue-with-pdf"]');
        if (consent && !consent.hidden) { consent.click(); await until(() => consent.hidden, 'web-live-pdf-disclosure-acknowledged', 30000); product.webLive.pdfDisclosureAcknowledged = true; }
        else product.webLive.pdfDisclosureAcknowledged = false;
        const question = 'Read the Zotero-provided PDF context and answer with only the hidden verification token from the second physical page.';
        let postStage = baseline;
        if (!postStage.sendReady) {
          if (product.actorProbe.status !== 'draft') {
            product.webLive.status = 'staging-question'; await save();
            const staged = await boundedQuery('ZoteroChatGPTOfficialChat', 'stage', { text: question }, 10000);
            product.webLive.productStage = staged.value && typeof staged.value === 'object' ? { status: staged.value.status ?? 'invalid-response', reason: staged.value.reason ?? null } : { status: 'invalid-response', reason: null };
          } else product.webLive.productStage = { status: 'existing-exact-harness-draft', reason: null };
          const stageStarted = Date.now();
          while (Date.now() - stageStarted < 10000) {
            const observed = await boundedQuery('ZoteroChatGPTWebAcceptance', 'probe', { verificationToken: config.verificationToken }); postStage = observed.value;
            product.webLive.postStage = postStage; await save(); if (postStage?.status === 'ok' && postStage.sendReady === true && postStage.draftMatchesExactTestQuestion === true) break; await delay(250);
          }
        }
        if (postStage?.status !== 'ok' || postStage.sendReady !== true) {
          product.webLive.status = 'blocked'; product.webLive.blockedStage = 'official-send-readiness-after-stage'; product.webLive.reason = product.webLive.productStage?.reason ?? product.webLive.productStage?.status ?? 'send-unavailable'; await save();
        } else {
        const codexBefore = await ownCodexProcesses();
        const globalBeforeSubmit = before.global;
        product.webLive.status = 'submitting'; product.webLive.submissionAttempts = 1; product.webLive.confirmedServiceReply = false; await save();
        const submitted = await boundedQuery('ZoteroChatGPTOfficialChat', 'submitQuestion', { question }, 90000);
        product.webLive.productSubmit = submitted.value && typeof submitted.value === 'object'
          ? { status: submitted.value.status ?? 'invalid-response', reason: submitted.value.reason ?? null, attempts: Number.isInteger(submitted.value.attempts) ? submitted.value.attempts : null }
          : { status: 'invalid-response', reason: null };
        product.webLive.sameWindowGlobalAtSubmit = submitted.global === globalBeforeSubmit;
        product.webLive.status = 'observing-submit-outcome'; await save();
        const started = Date.now(); const deadline = started + 180000; let latest = baseline; let streamingObserved = false;
        while (Date.now() < deadline) {
          try {
            const sample = await boundedQuery('ZoteroChatGPTWebAcceptance', 'probe', { verificationToken: config.verificationToken });
            latest = sample.value;
            if (latest?.streaming === true) streamingObserved = true;
            product.webLive.timeline.push({
              ms: Date.now() - started, status: latest?.status ?? 'invalid-response', officialURL: latest?.officialURL === true, currentCanonicalURL: latest?.canonicalURL ?? null,
              inputReady: latest?.inputReady === true, sendReady: latest?.sendReady === true, draftLength: Number(latest?.draftLength ?? 0), draftHasOwnMarker: latest?.draftHasZoteroRequestMarker === true,
              streaming: latest?.streaming === true, userMarkerMessages: Number(latest?.userMarkerMessages ?? 0), assistantMessages: Number(latest?.assistantMessages ?? 0),
              latestAssistantContainsToken: latest?.latestAssistantContainsToken === true, roleStructure: latest?.roleStructure ?? null,
            });
            if (latest?.status === 'ok' && latest.officialURL === true && latest.userMarkerMessages > baseline.userMarkerMessages && latest.assistantMessages > baseline.assistantMessages && latest.latestAssistantContainsToken === true && latest.streaming === false) break;
          } catch (error) { product.webLive.timeline.push({ ms: Date.now() - started, status: 'query-error', error: message(error).slice(0, 200) }); }
          product.webLive.timeline = product.webLive.timeline.slice(-120); await save(); await delay(500);
        }
        const codexAfter = await ownCodexProcesses(); product.webLive.timeline = product.webLive.timeline.slice(-120);
        const userMarkerDelta = Number(latest?.userMarkerMessages ?? 0) - Number(baseline.userMarkerMessages ?? 0); const assistantDelta = Number(latest?.assistantMessages ?? 0) - Number(baseline.assistantMessages ?? 0);
        const confirmedServiceReply = assistantDelta >= 1 && latest?.latestAssistantContainsToken === true && latest?.streaming === false;
        const confirmedFailure = !confirmedServiceReply && userMarkerDelta === 0 && latest?.draftHasZoteroRequestMarker === true && latest?.streaming === false;
        if (streamingObserved || assistantDelta >= 1) product.webLive.modelTurnsStarted = 1;
        if (userMarkerDelta === 1) product.notRun = product.notRun.filter(name => name !== 'conversation-send');
        if (streamingObserved) product.notRun = product.notRun.filter(name => name !== 'streaming-render');
        product.webLive.confirmedServiceReply = confirmedServiceReply;
        product.webLive.result = {
          officialURL: latest?.officialURL === true, canonicalOrigin: latest?.canonicalOrigin ?? null, currentCanonicalURL: latest?.canonicalURL ?? null,
          userMarkerDelta, assistantDelta, latestAssistantContainsToken: latest?.latestAssistantContainsToken === true, streaming: latest?.streaming === true,
          draftLength: Number(latest?.draftLength ?? 0), draftHasOwnMarker: latest?.draftHasZoteroRequestMarker === true, roleStructure: latest?.roleStructure ?? null, streamingObserved,
          codexProcessesBefore: codexBefore.length, codexProcessesAfter: codexAfter.length,
        };
        const passed = confirmedServiceReply && userMarkerDelta === 1 && product.webLive.result.officialURL && product.webLive.result.canonicalOrigin === 'https://chatgpt.com' && product.webLive.result.codexProcessesBefore === 0 && product.webLive.result.codexProcessesAfter === 0;
        product.webLive.status = passed ? 'passed' : confirmedFailure ? 'confirmed-failure' : 'unknown';
        report.checks.push({ name: 'product-web-live-official-answer-uses-random-pdf-token', ok: passed, details: { ...product.webLive.result, productSubmitStatus: product.webLive.productSubmit.status, outcome: product.webLive.status } });
        await save();
        }
      }
    }
    // Recorded, not asserted: hit testing a chrome document over an out-of-process frame is not a
    // stable contract, so the composited result is what the human step looks at.
    try {
      const point = win.document.elementFromPoint(product.paint.browserRect.left + Math.floor(product.paint.browserRect.width / 2), product.paint.browserRect.top + Math.floor(product.paint.browserRect.height / 2));
      product.paint.hitTest = point ? { localName: String(point.localName || ''), isSurface: point.hasAttribute?.('data-zchatgpt-embed-browser') === true } : null;
    } catch (error) { product.paint.hitTestError = message(error); }

    // Chat -> Agent -> Chat: the mode control moves with the mode, the native surface appears, and
    // the application document is neither reloaded nor rebuilt.
    const click = selector => { const node = doc.querySelector(selector); if (!node) throw new Error(`Missing ${selector}`); node.click(); };
    click('[data-zchatgpt-action="mode-agent"]');
    await until(() => { const node = doc.querySelector('[data-zchatgpt-embed]'); return node && node.hasAttribute('hidden'); }, 'product-agent-mode-surface-hidden');
    await check('product-agent-mode-restores-the-native-chat',
      doc.querySelector('[data-zchatgpt-chat]').hidden === false && doc.querySelector('[data-zchatgpt-shell-bar] [data-zchatgpt-mode-switch]') !== null && doc.querySelector('[data-zchatgpt-composer-leading] [data-zchatgpt-mode-switch]') === null && painted() === '',
      { nativeChatHidden: doc.querySelector('[data-zchatgpt-chat]').hidden, painted: painted() });
    click('[data-zchatgpt-action="mode-chat"]');
    await until(() => painted(), 'product-chat-repainted');
    const back = embedBrowser();
    // The invariant is "the same element, the same document", not "the same URL": the application is
    // free to navigate itself (a challenge interstitial becoming the app, a sign-in redirect), and
    // that is not a reload of our surface. So the element identity, the tag written into it, and the
    // application origin are asserted, and any same-origin navigation is reported rather than failed.
    const backURI = String(back.currentURI?.spec || '');
    await check('product-mode-switch-keeps-the-application-document',
      back === surfaceBrowser && back.getAttribute('data-zchatgpt-product-tag') === nonce && backURI.startsWith('https://chatgpt.com/'),
      { sameElement: back === surfaceBrowser, currentURI: safeWebURL(backURI), uriWhenTagged: safeWebURL(surfaceURI), navigatedItself: backURI !== surfaceURI });
    product.cookiesAfterChatSurface = { [targetHost]: cookieCount(targetHost) };
    await save();

    // ---- the Zotero context routes, driven through the product's own controls ---------------------
    if (config.clipboardProbe === true) {
    // Chat mode hosts the real application, and the application owns its own conversation: this host
    // cannot put the paper into that page. What it can do is put the paper — as text, and as the
    // actual PDF file — on the clipboard, and these checks drive the product's own controls and read
    // the pasteboard back, so "the paper reached the clipboard" is measured rather than asserted.
    // A pasteboard read that records *why* it found nothing: which flavors the clipboard actually
    // advertises, and what shape the value came back in. A flavor that is simply absent and a read
    // that threw are different failures, and only one of them is the product's.
    const readClipboard = (flavor) => {
      const clipboard = Services.clipboard;
      const which = clipboard.kGlobalClipboard;
      const out = { flavor, present: null, read: null, kind: null, error: null };
      try { out.present = Boolean(clipboard.hasDataMatchingFlavors([flavor], which)); }
      catch (error) { out.present = `error:${message(error)}`; }
      if (out.present !== true) return out;
      try {
        // The same read Zotero's own `Utilities.Internal.getClipboard` performs: no `init`, an
        // out-object for the transfer data, then the value's own `data` for text.
        const transferable = Cc['@mozilla.org/widget/transferable;1'].createInstance(Ci.nsITransferable);
        transferable.addDataFlavor(flavor);
        clipboard.getData(transferable, which);
        const data = {};
        transferable.getTransferData(flavor, data, {});
        const value = data.value ?? null;
        out.kind = value === null ? 'null' : typeof value;
        if (typeof value === 'string') out.read = value;
        else if (value) {
          // Text arrives as `nsISupportsString`; a file arrives as `nsIFile`. Asking either one for
          // `data` throws NS_NOINTERFACE, which is a shape answer rather than a read failure.
          try { out.read = typeof value.QueryInterface === 'function' ? value.QueryInterface(Ci.nsISupportsString).data : value.data; }
          catch { out.read = typeof value.path === 'string' ? value.path : null; }
        }
      } catch (error) { out.error = message(error); }
      return out;
    };
    /** The first flavors the clipboard advertises, so a miss can be told from a wrong flavor name. */
    const clipboardFlavors = () => {
      const out = {};
      for (const flavor of ['text/unicode', 'text/plain;charset=utf-16', 'text/plain', 'text/html', 'application/x-moz-file']) {
        try { out[flavor] = Boolean(Services.clipboard.hasDataMatchingFlavors([flavor], Services.clipboard.kGlobalClipboard)); }
        catch (error) { out[flavor] = `error:${message(error)}`; }
      }
      return out;
    };
    /** Up to 60 characters, for the *synthetic* block this driver itself asked the product to build. */
    const clipboardHead = (value) => (typeof value === 'string' ? value.slice(0, 60) : null);
    // Gecko has advertised copied text under more than one flavor name across versions, and which one
    // a given Zotero build uses is exactly the kind of detail this probe must measure rather than
    // assume: every candidate is tried, and each attempt is recorded.
    const readFirstText = () => {
      const attempts = [];
      for (const flavor of ['text/unicode', 'text/plain;charset=utf-16', 'text/plain']) {
        const reading = readClipboard(flavor);
        attempts.push(reading);
        if (typeof reading.read === 'string' && reading.read.length > 0) return { reading, attempts };
      }
      return { reading: null, attempts };
    };
    // The toolbar's short-lived answer line; it is absolutely positioned so it never changes the
    // header height.
    const embedStatus = () => { const node = doc.querySelector('[data-zchatgpt-shell-feedback]'); return node ? String(node.textContent || '') : null; };
    /**
     * Click one bar control and wait for the bar's *own* answer to that click: the line the previous
     * action left standing must not be read as this action's result, so the wait is for a change.
     */
    const useControl = async (id) => {
      const control = doc.querySelector(`[data-zchatgpt-action="${id}"]`);
      await check(`product-context-control-${id}`, Boolean(control), { status: embedStatus() });
      const before = embedStatus();
      control.click();
      return until(() => { const now = embedStatus(); return now && now !== before ? now : null; }, `product-status-${id}`, 30000);
    };

    // A sentinel the driver puts on the pasteboard itself, so "the product wrote nothing" and "this
    // probe cannot read the pasteboard" are told apart before the product's own write is measured.
    const sentinel = `ZCHATGPT-SENTINEL-${nonce}`;
    const sentinelWrite = (() => {
      try {
        const helper = Services.clipboardHelper || Cc['@mozilla.org/widget/clipboardhelper;1'].getService(Ci.nsIClipboardHelper);
        helper.copyString(sentinel);
        return true;
      } catch (error) { return message(error); }
    })();
    const sentinelRead = readFirstText();
    product.clipboardReadPath = {
      sentinelWritten: sentinelWrite === true ? true : sentinelWrite,
      sentinelSeen: sentinelRead.reading ? sentinelRead.reading.read === sentinel : false,
      chosenFlavor: sentinelRead.reading ? sentinelRead.reading.flavor : null,
      attempts: sentinelRead.attempts,
    };
    await check('product-clipboard-read-path', product.clipboardReadPath.sentinelSeen === true, product.clipboardReadPath);

    const contextStatus = await useControl('copy-paper-context');
    await save();
    const { reading: paperReading, attempts: paperAttempts } = readFirstText();
    const paperText = paperReading ? paperReading.read : null;
    product.contextClipboard = {
      status: String(contextStatus || ''),
      chosenFlavor: paperReading ? paperReading.flavor : null,
      attempts: paperAttempts,
      flavorsAdvertised: clipboardFlavors(),
      // The manual copy is bibliography only, so the assertion is the other way round now: the block
      // must carry the fields and must NOT carry the locally read PDF text or its brief header. The
      // synthetic paper's own body matches `carriesPaperText`; its stored title matches `carriesTitle`.
      head: clipboardHead(paperText),
      textLength: paperText === null ? null : paperText.length,
      carriesTitle: paperText === null ? null : /^Title: /mu.test(paperText),
      carriesAuthors: paperText === null ? null : /^Authors: /mu.test(paperText),
      carriesPdfBody: paperText === null ? null : /prior describes beliefs|likelihood describes|ORCHID-72/u.test(paperText),
      carriesBriefHeader: paperText === null ? null : /Context from the PDF open in Zotero/u.test(paperText),
      carriesPageMarker: paperText === null ? null : /\[page /u.test(paperText),
    };
    await check('product-chat-copies-the-paper-bibliography-only',
      product.contextClipboard.carriesTitle === true && product.contextClipboard.carriesAuthors === true
        && product.contextClipboard.carriesPdfBody === false && product.contextClipboard.carriesBriefHeader === false
        && product.contextClipboard.carriesPageMarker === false,
      product.contextClipboard);

    const fileStatus = await useControl('copy-pdf-file');
    await save();
    const fileReading = readClipboard('application/x-moz-file');
    const clipboardFile = fileReading.read;
    let attachmentPath = null;
    try { attachmentPath = await (await Zotero.Items.get(attachment.id)).getFilePathAsync(); } catch { /* recorded below */ }
    product.fileClipboard = {
      status: String(fileStatus || ''),
      flavorPresent: fileReading.present,
      valueKind: fileReading.kind,
      readError: fileReading.error,
      flavorsAdvertised: clipboardFlavors(),
      clipboardPath: clipboardFile ? String(clipboardFile) : null,
      attachmentPath: attachmentPath ? String(attachmentPath) : null,
      matchesAttachment: Boolean(clipboardFile && attachmentPath && String(clipboardFile) === String(attachmentPath)),
    };
    await check('product-chat-copies-the-pdf-file',
      product.fileClipboard.matchesAttachment === true &&
      /\bcopied\b/iu.test(String(fileStatus || '')) && /\bpaste\b/iu.test(String(fileStatus || '')),
      product.fileClipboard);
    } else {
      // The system clipboard is shared with the user's other work, even when this Zotero instance
      // is hidden or backgrounded. Keep ordinary embed/Web-live checks read-only with respect to it.
      product.notRun.push('product-clipboard-read-path', 'clipboard-copy-paper-context', 'clipboard-copy-pdf-file');
      await save();
    }

    // Recorded, not asserted: what the application itself reached. `contentTitle` is written by the
    // page's own script, so a non-empty title is the page's own statement that its JavaScript ran;
    // an empty title with a live URI is a page that is still starting. The remote document is
    // deliberately NOT walked: it belongs to another origin, and this prototype's whole point is that
    // the host does not reach into the application it hosts. Two archived runs of these same bytes
    // recorded the application's own title and a Cloudflare interstitial respectively, which is the
    // ordinary behavior of the site for a profile with no signed-in session.
    report.step = 'product-application';
    await save();
    const applicationSnapshot = await (async () => {
      const start = Date.now();
      let snapshot = describeSurface();
      while (Date.now() - start < 25000 && !snapshot.title) { await delay(750); snapshot = describeSurface(); }
      return snapshot;
    })();
    const applicationTitle = String(applicationSnapshot.title || '');
    product.application = {
      currentURI: applicationSnapshot.currentURI ?? null,
      title: applicationTitle.slice(0, 120),
      isLoadingDocument: applicationSnapshot.isLoadingDocument ?? null,
      docShellIsActive: applicationSnapshot.docShellIsActive ?? null,
      osPid: applicationSnapshot.contentPid ?? null,
      state: applicationSnapshot.state ?? null,
      // The title is the page's own, so it separates an interstitial from the application without
      // reading the page. Whether the app reached a sign-in screen or a signed-in conversation is
      // what the human step answers, and stays NOT RUN here.
      reached: /just a moment|verify you are human/i.test(applicationTitle) ? 'challenge'
        : /chatgpt/i.test(applicationTitle) ? 'application'
        : applicationTitle ? 'unknown' : 'no-title',
      note: 'Browser-element properties only; the remote document is not walked.',
    };
    product.initialNetwork = {
      responses: productNetwork.state.responses.slice(-120), stops: productNetwork.state.stops.slice(-60),
      hosts: productNetwork.state.hosts, otherHostCount: productNetwork.state.otherHosts,
    };
    productNetwork.stop(); productNetwork = null;
    await save();

    // ---- the human reproduction window (opt-in) ----------------------------------------------------
    // Everything above is measured without a person. This section exists for the one thing a driver
    // cannot do: use the hosted application as a signed-in human would. When `--watch-seconds` is
    // passed, the run stays alive for that long with the network and console watchers attached, and
    // the report then holds what the page itself did — which requests were answered, which were
    // cancelled, whether a new window was requested and where it went, and how often Gecko terminated
    // the page's script. Nothing is typed or clicked by this driver.
    product.popupAttempts = popupAttempts;
    const watchSeconds = Number(config.watchSeconds || 0);
    if (watchSeconds > 0) {
      const hiddenChildBrowsers = () => {
        const origin = embedBrowser()?.browsingContext ?? null; if (!origin) return [];
        return [...win.document.querySelectorAll('browser')].flatMap(browser => {
          const context = browser.browsingContext ?? null; if (!context || context.opener !== origin) return [];
          const safe = safeWebURL(browser.currentURI?.spec || context.currentURI?.spec || ''); let host = null; let path = null;
          try { const parsed = safe?.startsWith('http') ? new URL(safe) : null; host = parsed?.host ?? null; path = parsed?.pathname ?? null; } catch { /* already classified */ }
          const rect = rectOfNode(browser); let display = null; try { display = win.getComputedStyle(browser).display; } catch { /* observation only */ }
          return [{ hidden: Boolean(browser.hidden || display === 'none' || !rect), hasOpener: true, contextId: String(context.id ?? '').slice(0, 80) || null, host, path }];
        }).slice(0, 12);
      };
      step = 'ready-for-manual-login-watch';
      report.step = step; await save();
      const network = startNetworkWatch();
      product.diagnose = {
        startedAt: new Date().toISOString(),
        watchSeconds,
        phase: 'ready-for-manual-login-watch',
        actorReadiness: product.actorProbe.manualLoginReadiness ?? (productActorReady ? 'available' : 'unavailable'),
        prefs: relevantPrefs(),
        instruction: 'Use the hosted application in this window; the driver only observes.',
        hiddenChildBrowsers: hiddenChildBrowsers(),
      };
      await save();
      const deadlineMs = Date.now() + watchSeconds * 1000;
      let lastSave = 0;
      // One sample per cycle of what the application document is doing. A page that stays on the same
      // URI and title for minutes while the owner waits on it is the shape of a stalled request, and
      // the transition into or out of an interstitial is what separates "slow" from "never".
      const surfaceTimeline = [];
      while (Date.now() < deadlineMs) {
        await delay(1000);
        const sample = describeSurface();
        const previous = surfaceTimeline[surfaceTimeline.length - 1];
        if (!previous || previous.title !== sample.title || previous.currentURI !== sample.currentURI || previous.isLoadingDocument !== sample.isLoadingDocument) {
          surfaceTimeline.push({ t: Math.round((Date.now() - consoleZero) / 1000), uri: sample.currentURI, title: sample.title, loading: sample.isLoadingDocument });
        }
        if (Date.now() - lastSave < 5000) continue;
        lastSave = Date.now();
        product.diagnose = {
          ...product.diagnose,
          secondsLeft: Math.max(0, Math.round((deadlineMs - Date.now()) / 1000)),
          scriptTerminations: scriptTerminations(),
          consoleClassCounts: consoleClassCounts(),
          notableConsole: safeConsole(diagnosticNotable()),
          consoleTail: safeConsole(diagnosticConsole.slice(-40)),
          surfaceTimeline: surfaceTimeline.slice(-40),
          requests: network.state.responses.slice(-80),
          stopped: network.state.stops.slice(-40),
          hosts: network.state.hosts,
          otherHostCount: network.state.otherHosts,
          popups: popupAttempts.slice(-10),
          hiddenChildBrowsers: hiddenChildBrowsers(),
          surface: sample,
        };
        await save();
      }
      network.stop();
      product.diagnose = {
        ...product.diagnose,
        secondsLeft: 0,
        endedAt: new Date().toISOString(),
        scriptTerminations: scriptTerminations(),
        consoleClassCounts: consoleClassCounts(),
        notableConsole: safeConsole(diagnosticNotable()),
        consoleTail: safeConsole(diagnosticConsole.slice(-120)),
        surfaceTimeline: surfaceTimeline.slice(-60),
        requests: network.state.responses.slice(-120),
        stopped: network.state.stops.slice(-60),
        hosts: network.state.hosts,
        otherHostCount: network.state.otherHosts,
        popups: popupAttempts,
        hiddenChildBrowsers: hiddenChildBrowsers(),
        surface: describeSurface(),
      };
      await save();
    }

    // ---- what the host can do beyond the product path ---------------------------------------------
    // Run after the product so the destructive experiments cannot disturb what the shipped surface
    // measures: each probe is torn down as it finishes, but a XUL `tab-content` placed inside the
    // reader's own tab content damages the host layout while it exists, and the product would then be
    // measured in a reader pane that has no height.
    // The comparison probes read remote documents from privileged code, and in this Zotero build one
    // of them — a remote page in a privileged reader-document iframe — ends the host process. They are
    // therefore opt-in rather than part of the default run: `--surface-probes` runs them, and the
    // default run ends on the product evidence and says where the comparison lives.
    if (config.surfaceProbes) {
      await runProbe({ id: 'reader-iframe', kind: 'iframe-src', host: 'reader-document', doc, note: 'HTML iframe in the reader sidebar host document, for the record: this is the surface the current dock lives in.' });
      await runProbe({ id: 'mainwindow-xul-viewer-attrs-src', kind: 'xul-viewer-attrs', host: 'main-window', doc: win.document, note: 'XUL browser in the XUL main window carrying the attribute set of Zotero\'s own remote-page viewer, navigated by src.' });
      await runProbe({ id: 'mainwindow-xul-viewer-attrs-loadURI', kind: 'xul-viewer-attrs-loaduri', host: 'main-window', doc: win.document, note: 'Same attribute set, navigated by loadURI with the system principal.' });
      await runProbe({ id: 'mainwindow-fixed-div', kind: 'xul-fixed-div', host: 'main-window', doc: win.document, note: 'The product shape: viewer attributes inside an HTML div the surface positions itself, fixed over the window.' });
      await runProbe({ id: 'mainwindow-absolute-div', kind: 'xul-absolute-div', host: 'main-window', doc: win.document, note: 'The same HTML div positioned absolutely, in case a chrome viewport does not support fixed positioning.' });
      await runViewerProbe(url);
    } else {
      report.surfaceProbes = {
        run: false,
        why: 'Opt-in (`--surface-probes`): these probes read remote documents from privileged code and one of them ends this host build\'s process. The iframe/XUL/viewer comparison for this same target is in `.zotero-chatgpt-dev/embed/host-report-0.4.0a17-surface-8of8-PASS.json`.',
      };
      await save();
    }

    const webStatus = report.product?.webLive?.status;
    report.status = webStatus === 'blocked' ? 'blocked' : webStatus === 'confirmed-failure' ? 'failed' : webStatus === 'unknown' ? 'uncertain' : 'completed';
    report.finishedAt = new Date().toISOString();
    await save();
  } catch (error) {
    if (productNetwork) {
      productNetwork.stop();
      report.productNetworkAtFailure = {
        responses: productNetwork.state.responses.slice(-120), stops: productNetwork.state.stops.slice(-60),
        hosts: productNetwork.state.hosts, otherHostCount: productNetwork.state.otherHosts,
      };
      productNetwork = null;
    }
    report.status = 'failed';
    report.failure = {
      step, class: consoleClass(message(error)), consoleClassCounts: consoleClassCounts(),
      notableConsole: safeConsole(diagnosticNotable()),
      consoleTail: safeConsole(diagnosticConsole.slice(-80)),
    };
    report.finishedAt = new Date().toISOString();
    try { await save(); } catch { /* nothing left to report */ }
  } finally {
    if (consoleListener) { try { Services.console.unregisterListener(consoleListener); } catch { /* already gone */ } }
    try { await save(); } catch { /* nothing left to report */ }
  }
}
