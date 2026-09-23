/* global Zotero, ChromeUtils, PathUtils, IOUtils */
// Minimal installed-XPI live acceptance: exactly two explicit Agent turns on fresh synthetic data.
// It never clicks Login, reads auth files, copies credentials, or replays a failed/uncertain request.
async function runHostSmoke(config) {
  const token = config.verificationToken;
  const report = {
    startedAt: new Date().toISOString(), stage: 'live-core', status: 'running', checks: [],
    build: { version: config.subjectVersion, sha256: config.artifactHash, driverSourceHash: config.driverSourceHash ?? null },
    fixture: { verificationToken: token }, modelTurnsAuthorized: 2, modelTurnsStarted: 0,
    driverClickedLogin: false, driverReadAuthFiles: false,
  };
  const save = () => Zotero.File.putContentsAsync(config.reportPath, JSON.stringify(report, null, 2));
  const delay = ms => Zotero.Promise.delay(ms); let step = 'startup';
  const until = async (read, label, timeout = 30000) => { step = label; const started = Date.now(); while (Date.now() - started < timeout) { const value = await read(); if (value) return value; await delay(25); } throw new Error(`Timed out: ${label}`); };
  const check = async (name, ok, details = {}) => { step = name; report.checks.push({ name, ok: Boolean(ok), details }); await save(); if (!ok) throw new Error(`Check failed: ${name}`); };
  const click = node => { if (!node || node.hidden || node.closest?.('[hidden]')) throw new Error('Expected visible UI control is missing.'); node.focus(); node.click(); };
  const requestSnapshot = async () => {
    const directory = PathUtils.join(config.profile, 'zotero-chatgpt', 'v1', 'records', 'conversations'); const rows = [];
    if (!await IOUtils.exists(directory)) return rows;
    for (const file of await IOUtils.getChildren(directory)) {
      if (!file.endsWith('.json') || file.endsWith('.source.json')) continue;
      const record = JSON.parse(await IOUtils.readUTF8(file));
      for (const request of record.requests ?? []) {
        const user = (record.messages ?? []).find(message => message.role === 'user' && message.requestId === request.requestId);
        rows.push({ requestId: request.requestId, state: request.state, workflow: user?.workflow?.skill?.workflow ?? null, model: user?.settings?.model ?? null });
      }
    }
    return rows;
  };
  try {
    await Zotero.initializationPromise;
    const profile = String(config.profile); const match = profile.match(/^(.*\/\.zotero-chatgpt-dev\/context)\/profile$/u);
    await check('dedicated-preserved-context-profile', PathUtils.profileDir === profile && Boolean(match) && config.dataDir === `${match?.[1]}/data` && Zotero.DataDirectory.dir === config.dataDir);
    const win = await until(() => Zotero.getMainWindow(), 'main-window'); await until(() => win.ZoteroPane?.loaded && win.ZoteroPane?.itemsView, 'library-ready');
    const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs'); const addon = await AddonManager.getAddonByID(config.subjectID);
    await check('full-installed-xpi-active', addon?.isActive && addon.version === config.subjectVersion, { actualVersion: addon?.version ?? null });
    const libraryID = Zotero.Libraries.userLibraryID; await Zotero.Libraries.get(libraryID).waitForDataLoad('item');
    const control = new Zotero.Collection(); control.libraryID = libraryID; control.name = `Live preserved ${token}`; await control.saveTx();
    const target = new Zotero.Collection(); target.libraryID = libraryID; target.name = `Live target ${token}`; await target.saveTx();
    const parent = new Zotero.Item('journalArticle'); parent.libraryID = libraryID; parent.setField('title', `Live core paper ${token}`); parent.addTag(`preserve-parent-${token}`); parent.addToCollection(control.key); await parent.saveTx({ skipSelect: true });
    const peer = new Zotero.Item('journalArticle'); peer.libraryID = libraryID; peer.setField('title', `Live selected peer ${token}`); peer.addTag(`preserve-peer-${token}`); peer.addToCollection(control.key); await peer.saveTx({ skipSelect: true });
    const attachment = await Zotero.Attachments.importFromFile({ file: config.pdfPath, parentItemID: parent.id, title: `Live PDF ${token}`, saveOptions: { skipSelect: true } });
    await Promise.all([parent.loadAllData(), peer.loadAllData(), attachment.loadAllData()]);
    const opened = await Zotero.Reader.open(attachment.id); let tabId = opened.tabID;
    const reader = () => Zotero.Reader.getByTabID(tabId); const doc = () => reader()?._iframeWindow?.document;
    const shell = () => doc()?.querySelector('[data-zchatgpt-sidebar]'); const panel = () => doc()?.querySelector('[data-zchatgpt-chat]');
    const toggle = () => doc()?.querySelector('[data-zchatgpt-toggle]'); const input = () => panel()?.querySelector('[data-zchatgpt-input]');
    await until(() => reader()?._internalReader?._primaryView?._iframeWindow?.PDFViewerApplication?.pdfDocument, 'pdf-ready', 60000);
    await until(() => toggle(), 'toolbar-toggle'); toggle().click(); await until(() => input(), 'agent-input', 60000);
    const modeSwitch = () => shell()?.querySelector('[data-zchatgpt-mode-switch]'); const modeButton = mode => modeSwitch()?.querySelector(`[data-zchatgpt-action="mode-${mode}"]`);
    if (modeSwitch()?.dataset.zchatgptMode !== 'agent') click(modeButton('agent'));
    await until(() => modeSwitch()?.dataset.zchatgptMode === 'agent' && panel()?.dataset.zchatgptRuntime === 'ready', 'agent-runtime-ready', 120000);
    const beforeLogin = await requestSnapshot(); report.requestsBeforeLogin = beforeLogin.length; await save();
    const loginStarted = Date.now(); while (panel().dataset.zchatgptAuth !== 'signedIn' && Date.now() - loginStarted < (config.loginWaitSeconds ?? 0) * 1000) await delay(500);
    if (panel().dataset.zchatgptAuth !== 'signedIn') { report.status = 'blocked'; report.blockedStage = 'official-agent-login'; report.finishedAt = new Date().toISOString(); await save(); return; }
    await delay(2500); const afterLogin = await requestSnapshot();
    await check('login-starts-no-incidental-request', afterLogin.length === beforeLogin.length, { before: beforeLogin.length, after: afterLogin.length });
    // Live acceptance must use the workhorse/efficient models, never the most costly Astra fallback.
    const picker = panel().querySelector('[data-zchatgpt-picker]');
    click(picker);
    const lowCostModel = await until(() => panel()?.querySelector('[data-zchatgpt-setting="model"][data-zchatgpt-value="gpt-6-sol"]')
      || panel()?.querySelector('[data-zchatgpt-setting="model"][data-zchatgpt-value="gpt-6-luna"]'), 'sol-or-luna-model-option', 10000).catch(() => null);
    if (!lowCostModel || lowCostModel.disabled) {
      report.status = 'blocked'; report.blockedStage = 'sol-or-luna-model-unavailable'; report.finishedAt = new Date().toISOString(); await save(); return;
    }
    click(lowCostModel);
    report.testModel = lowCostModel.dataset.zchatgptValue;
    await check('low-cost-test-model-selected', report.testModel === 'gpt-6-sol' || report.testModel === 'gpt-6-luna', { model: report.testModel });
    if (picker.getAttribute('aria-expanded') === 'true') click(picker);
    const baselineIDs = new Set(afterLogin.map(request => request.requestId));
    const taskCard = label => [...panel().querySelectorAll('[data-zchatgpt-task-id]')].find(card => String(card.querySelector('summary')?.textContent ?? '').includes(label));
    const send = async (question, label, afterClick) => {
      input().value = question; input().dispatchEvent(new (reader()._iframeWindow.Event)('input', { bubbles: true }));
      const button = panel().querySelector('[data-zchatgpt-action="send"]'); await until(() => !button.disabled, `${label}-send-enabled`);
      await check(`${label}-visible-send`, win.Zotero_Tabs.selectedID === tabId && !button.hidden && !button.closest('[hidden]'), { selectedTab: win.Zotero_Tabs.selectedID, readerTab: tabId });
      click(button); report.modelTurnsStarted += 1; await save(); if (afterClick) await afterClick();
      await until(() => panel()?.dataset.zchatgptGenerating === 'true', `${label}-accepted`, 30000); await until(() => panel()?.dataset.zchatgptGenerating === 'false', `${label}-terminal`, 180000);
    };
    const annotationsBefore = attachment.getAnnotations().length;
    await send('Highlight the five most important scientifically meaningful sentences in the current PDF. Use native Zotero highlights and propose only exact quotations that appear verbatim in this PDF.', 'annotation');
    const annotationCard = await until(() => { const card = taskCard('Annotations'); return card && ['completed', 'partial', 'failed'].includes(card.dataset.state) ? card : null; }, 'annotation-auto-applied', 60000); await attachment.loadAllData();
    const createdAnnotations = attachment.getAnnotations().length - annotationsBefore;
    await check('annotation-auto-apply-native-readback', ['completed', 'partial'].includes(annotationCard.dataset.state) && createdAnnotations > 0 && createdAnnotations <= 5 && annotationCard.querySelector('[data-zchatgpt-task-action="approve"]')?.hidden === true, { state: annotationCard.dataset.state, created: createdAnnotations, candidates: annotationCard.querySelectorAll('[data-zchatgpt-task-item-id]').length });
    annotationCard.open = true; click(annotationCard.querySelector('[data-zchatgpt-task-action="undo"]')); await until(() => annotationCard.dataset.state === 'undone', 'annotation-undone', 60000); await attachment.loadAllData();
    await check('annotation-undo-readback', attachment.getAnnotations().length === annotationsBefore);
    const proposedTag = `live-organized-${token}`; const laterTag = `later-edit-${token}`;
    await win.ZoteroPane.selectItems([parent.id, peer.id], { inLibraryRoot: true }); await until(() => win.ZoteroPane.itemsView.getSelectedItems(false).length === 2, 'two-library-rows-selected'); win.Zotero_Tabs.select(tabId);
    await until(() => shell()?.dataset.attachmentKey === attachment.key && input(), 'reader-restored');
    await send(`Organize the selected Zotero items by adding the tag ${proposedTag} and placing both items in the collection named "${target.name}". Preserve every existing tag and collection.`, 'organization', () => win.ZoteroPane.selectItems([parent.id], { inLibraryRoot: true, noTabSwitch: true }));
    const organizationCard = await until(() => { const card = taskCard('Organize library'); return card?.dataset.state === 'review' ? card : null; }, 'organization-review-terminal-preparation', 60000); await Promise.all([parent.loadAllData(), peer.loadAllData()]);
    const organizationReview = { state: organizationCard.dataset.state, candidates: organizationCard.querySelectorAll('[data-zchatgpt-task-item-id]').length, parentShown: organizationCard.textContent.includes(parent.getField('title')), peerShown: organizationCard.textContent.includes(peer.getField('title')) };
    await check('organization-frozen-review-before-write', organizationReview.state === 'review' && organizationReview.candidates === 2 && organizationReview.parentShown && organizationReview.peerShown, organizationReview);
    organizationCard.open = true; click(organizationCard.querySelector('[data-zchatgpt-task-action="approve"]')); await until(() => organizationCard.dataset.state === 'completed', 'organization-applied', 60000); await Promise.all([parent.loadAllData(), peer.loadAllData()]);
    const tags = item => item.getTags().map(value => value.tag); const collections = item => item.getCollections().map(id => Zotero.Collections.get(id)?.key).filter(Boolean);
    await check('organization-additive-readback', [parent, peer].every(item => tags(item).includes(proposedTag) && collections(item).includes(target.key) && collections(item).includes(control.key)));
    peer.addTag(laterTag); await peer.saveTx({ skipSelect: true }); organizationCard.open = true; click(organizationCard.querySelector('[data-zchatgpt-task-action="undo"]')); await until(() => organizationCard.dataset.state === 'conflict', 'organization-undo-conflict', 60000); await Promise.all([parent.loadAllData(), peer.loadAllData()]);
    await check('organization-undo-preserves-later-edit', !tags(parent).includes(proposedTag) && !collections(parent).includes(target.key) && tags(peer).includes(proposedTag) && tags(peer).includes(laterTag) && collections(peer).includes(target.key));
    const finalRequests = await requestSnapshot(); const issued = finalRequests.filter(request => !baselineIDs.has(request.requestId)); const workflows = issued.map(request => request.workflow).sort();
    await check('exactly-two-authorized-model-requests', report.modelTurnsStarted === 2 && issued.length === 2 && issued.every(request => request.state === 'completed' && request.model === report.testModel) && JSON.stringify(workflows) === JSON.stringify(['annotate', 'organize']), { modelTurnsStarted: report.modelTurnsStarted, requests: issued });
    report.status = 'passed'; report.finishedAt = new Date().toISOString(); await save();
  } catch (error) {
    report.status = 'failed'; report.failedStep = step; report.failureClass = String(error?.name ?? 'Error').slice(0, 80); report.finishedAt = new Date().toISOString();
    try { await save(); } catch { /* no further evidence channel */ }
  }
}
