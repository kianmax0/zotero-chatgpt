import { Window as HappyWindow } from 'happy-dom';
import { expect, it, vi } from 'vitest';
import { mountUILocale } from '../../../packages/zotero/src/chat/ui-locale.ts';

function setup() {
  const document = new HappyWindow().document as unknown as Document;
  const root = document.createElement('section'); root.className = 'zchatgpt-chat'; document.body.append(root);
  const add = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '', parent: HTMLElement = root) => {
    const node = document.createElement(tag); node.className = className; node.textContent = text; parent.append(node); return node;
  };
  return { document, root, add };
}

it('switches visible controls, accessible names and placeholders without replacing focused input or values', () => {
  const { document, root, add } = setup();
  const send = add('button', 'zchatgpt-button', 'Send'); send.dataset.zchatgptAction = 'send'; send.setAttribute('aria-label', 'Send'); send.title = 'Send';
  const input = add('textarea', 'zchatgpt-input'); input.placeholder = 'Ask a question…'; input.setAttribute('aria-label', 'Question'); input.value = 'Send 新想法'; input.focus(); input.setSelectionRange(3, 6);
  const locale = mountUILocale(root); locale.update('zh');
  expect(send.textContent).toBe('发送'); expect(send.title).toBe('发送'); expect(send.getAttribute('aria-label')).toBe('发送');
  expect(input.placeholder).toBe('提出问题…'); expect(input.getAttribute('aria-label')).toBe('问题');
  expect(document.activeElement).toBe(input); expect(input.value).toBe('Send 新想法'); expect(input.selectionStart).toBe(3); expect(input.selectionEnd).toBe(6);
  locale.update('en'); expect(send.textContent).toBe('Send'); expect(input.placeholder).toBe('Ask a question…'); expect(send.title).toBe('Send'); locale.dispose();
});

it('translates the open-chat strip name while a chat named like a control stays verbatim', () => {
  const { root, add } = setup();
  const strip = add('div', 'zchatgpt-panes'); strip.setAttribute('role', 'tablist'); strip.setAttribute('aria-label', 'Open chats');
  const tab = add('div', 'zchatgpt-pane-tab', '', strip);
  tab.dataset.zchatgptPaneTab = ''; tab.dataset.zchatgptAction = 'select-pane'; tab.setAttribute('aria-selected', 'true'); tab.title = 'Send';
  const label = add('span', 'zchatgpt-pane-tab-label', 'Send', tab);
  const fresh = add('div', 'zchatgpt-pane-tab', '', strip);
  fresh.dataset.zchatgptPaneTab = ''; fresh.dataset.zchatgptConversationId = 'new-chat'; fresh.setAttribute('aria-label', 'New chat');
  const freshLabel = add('span', 'zchatgpt-pane-tab-new', 'New chat', fresh);
  const locale = mountUILocale(root); locale.update('zh');
  expect(strip.getAttribute('aria-label')).toBe('已打开的对话');
  // A chip carries the chat's own name: a chat called "Send" keeps that name on screen and for AT.
  expect(label.textContent).toBe('Send');
  expect(tab.title).toBe('Send');
  // The unbound New chat tab is copy, unlike named titles.
  expect(freshLabel.textContent).toBe('新建对话');
  expect(fresh.getAttribute('aria-label')).toBe('新建对话');
  locale.update('en');
  expect(strip.getAttribute('aria-label')).toBe('Open chats');
  expect(freshLabel.textContent).toBe('New chat');
  locale.dispose();
});

it('never translates source, chat, history, candidate, profile or workflow content even when it matches a control', () => {
  const { root, add } = setup(); const protectedNodes: HTMLElement[] = [];
  for (const className of ['zchatgpt-current-title', 'zchatgpt-initial-title', 'zchatgpt-history-title', 'zchatgpt-pane-tab-label', 'zchatgpt-command-option', 'zchatgpt-message-text', 'zchatgpt-message-reference', 'zchatgpt-citation-text', 'zchatgpt-task-question', 'zchatgpt-task-quote', 'zchatgpt-task-scope']) {
    const node = add('div', className, 'Send'); node.setAttribute('aria-label', 'Send'); protectedNodes.push(node);
    const embedded = add('button', 'zchatgpt-button', 'Stop', node); embedded.dataset.zchatgptAction = 'send'; protectedNodes.push(embedded);
  }
  const preview = add('div', 'zchatgpt-workspace-preview'); protectedNodes.push(add('pre', '', 'Global preferences', preview));
  const settings = add('div', 'zchatgpt-workspace-settings'); const workflows = add('details', '', '', settings); add('summary', '', 'Installed workflows', workflows);
  const skill = add('details', '', '', workflows); protectedNodes.push(add('summary', '', 'Global preferences', skill));
  const profile = add('select', '', '', settings); profile.dataset.zchatgptProfile = ''; const option = add('option', '', 'Send', profile); option.value = 'profile-one'; protectedNodes.push(option);
  const chip = add('span', 'zchatgpt-workspace-chip'); const chipName = add('button', 'zchatgpt-workspace-control', 'Send', chip); chipName.title = 'Preview Send'; protectedNodes.push(chipName);
  const row = add('div', 'zchatgpt-task-row'); protectedNodes.push(add('p', 'zchatgpt-task-muted', 'Completed', row));
  const model = add('button', 'zchatgpt-picker-option'); model.dataset.zchatgptSetting = 'model'; protectedNodes.push(add('span', 'zchatgpt-picker-option-label', 'High', model));
  const before = protectedNodes.map(node => node.textContent); const locale = mountUILocale(root); locale.update('zh');
  expect(protectedNodes.map(node => node.textContent)).toEqual(before); expect(root.querySelector('.zchatgpt-history-title')!.getAttribute('aria-label')).toBe('Send');
  expect(chipName.title).toBe('预览 Send'); locale.update('en'); expect(chipName.title).toBe('Preview Send'); locale.dispose();
});

it('preserves form elements, selection values, names and whitespace in translated labels', () => {
  const { document, root, add } = setup(); const settings = add('div', 'zchatgpt-preferences');
  const label = add('label', '', '  Instructions\n', settings); const select = add('select', '', '', label); select.name = 'paper'; select.dataset.zchatgptHistory = 'paper';
  const all = add('option', '', 'All papers', select); all.value = ''; const busy = add('option', '', 'work in progress', select); busy.value = 'busy'; select.value = 'busy'; select.focus();
  const textNode = label.firstChild; const locale = mountUILocale(root); locale.update('zh');
  expect(label.firstChild).toBe(textNode); expect(textNode!.textContent).toBe('  指令\n'); expect(all.textContent).toBe('全部文献');
  expect(select.value).toBe('busy'); expect(select.name).toBe('paper'); expect(document.activeElement).toBe(select);
  locale.update('en'); expect(textNode!.textContent).toBe('  Instructions\n'); expect(busy.textContent).toBe('work in progress'); locale.dispose();
});

it('localizes controls added by later renders and restores the latest externally authored status', async () => {
  const { root, add } = setup(); const status = add('p', 'zchatgpt-status-line', 'Responding…');
  const locale = mountUILocale(root); locale.update('zh'); expect(status.textContent).toBe('正在回答…');
  status.firstChild!.textContent = 'Stopped'; const button = add('button', 'zchatgpt-task-button', 'Reconcile task'); button.setAttribute('aria-label', 'Reconcile task');
  await vi.waitFor(() => { expect(status.textContent).toBe('已停止'); expect(button.textContent).toBe('核对任务状态'); expect(button.getAttribute('aria-label')).toBe('核对任务状态'); });
  locale.update('en'); expect(status.textContent).toBe('Stopped'); expect(button.textContent).toBe('Reconcile task'); locale.dispose();
});

it('translates only fixed task progress templates while preserving identifiers', () => {
  const { root, add } = setup(); const task = add('details', 'zchatgpt-task-card'); task.dataset.zchatgptTaskId = 'one'; const summary = add('summary', '', 'Annotations · Review · 2/3 selected', task);
  const counts = add('p', 'zchatgpt-task-counts', '2 ready · 1 unresolved', task);
  const reading = add('details', 'zchatgpt-task-card'); reading.dataset.zchatgptReadingJob = 'job'; const progress = add('summary', '', 'Reading · running · 1/3 passes', reading);
  const locale = mountUILocale(root); locale.update('zh');
  expect(summary.textContent).toBe('标注 · 待审核 · 已选择 2/3'); expect(counts.textContent).toBe('2 待处理 · 1 未定位');
  expect(progress.textContent).toBe('阅读 · 运行中 · 1/3 轮');
  locale.update('en'); expect(summary.textContent).toBe('Annotations · Review · 2/3 selected'); expect(progress.textContent).toBe('Reading · running · 1/3 passes'); locale.dispose();
});

it('translates skill chip action labels without translating the skill name', () => {
  const { root, add } = setup();
  const preview = add('button', 'zchatgpt-workspace-control', '/Send'); preview.setAttribute('aria-label', 'Preview skill Send'); preview.title = 'Preview skill Send';
  const remove = add('button', 'zchatgpt-workspace-control', '×'); remove.setAttribute('aria-label', 'Remove skill Stop');
  const locale = mountUILocale(root); locale.update('zh');
  expect(preview.textContent).toBe('/Send'); expect(preview.title).toBe('预览 skill Send'); expect(remove.getAttribute('aria-label')).toBe('移除 skill Stop');
  locale.update('en'); expect(preview.title).toBe('Preview skill Send'); expect(remove.getAttribute('aria-label')).toBe('Remove skill Stop'); locale.dispose();
});

it('localizes task-scope templates while keeping identifiers verbatim', () => {
  const { root, add } = setup();
  const card = add('details', 'zchatgpt-task-card'); const body = add('div', 'zchatgpt-task-body', '', card);
  const pdfScope = add('p', 'zchatgpt-task-muted', 'PDF PDFONE01 · candidate pages 1, 3', body);
  const emptyScope = add('p', 'zchatgpt-task-muted', 'PDF PDFONE01 · candidate pages none', body);
  const collectionScope = add('p', 'zchatgpt-task-muted', 'Target collection: My Papers', body);
  const locale = mountUILocale(root); locale.update('zh');
  expect(pdfScope.textContent).toBe('PDF PDFONE01 · 候选页 1, 3');
  expect(emptyScope.textContent).toBe('PDF PDFONE01 · 候选页 无');
  expect(collectionScope.textContent).toBe('目标分类：My Papers');
  locale.update('en');
  expect(pdfScope.textContent).toBe('PDF PDFONE01 · candidate pages 1, 3');
  expect(collectionScope.textContent).toBe('Target collection: My Papers'); locale.dispose();
});

it('localizes the context ring accessible report in both directions', () => {
  const { root, add } = setup();
  const ring = add('span', 'zchatgpt-context-ring', ''); ring.dataset.zchatgptContextState = 'runtime-reported';
  ring.setAttribute('aria-label', 'Last runtime usage report: 12,345 input tokens; model window 128,000 (runtime reported). This is the last report, not remaining context.');
  ring.title = 'Last runtime usage report: 12,345 input tokens; model window 128,000 (runtime reported). This is the last report, not remaining context.';
  const unknown = add('span', 'zchatgpt-context-ring', ''); unknown.setAttribute('aria-label', 'Current context is unknown: the runtime has not reported usage for this model.');
  const noWindow = add('span', 'zchatgpt-context-ring', ''); noWindow.setAttribute('aria-label', 'Last runtime usage report: 12,300 input tokens; the model window is unknown. This is the last report, not remaining context.');
  const locale = mountUILocale(root); locale.update('zh');
  // The ring never carries text: only its accessible report is localized.
  expect(ring.textContent).toBe('');
  expect(ring.getAttribute('aria-label')).toBe('上次运行时用量报告：12,345 个输入词元；模型窗口 128,000（运行时报告）。这是上次报告，并非剩余空间。');
  expect(ring.title).toBe('上次运行时用量报告：12,345 个输入词元；模型窗口 128,000（运行时报告）。这是上次报告，并非剩余空间。');
  expect(unknown.getAttribute('aria-label')).toBe('当前上下文未知：运行时尚未报告此模型的用量。');
  expect(noWindow.getAttribute('aria-label')).toBe('上次运行时用量报告：12,300 个输入词元；模型窗口未知。这是上次报告，并非剩余空间。');
  locale.update('en');
  expect(ring.getAttribute('aria-label')).toBe('Last runtime usage report: 12,345 input tokens; model window 128,000 (runtime reported). This is the last report, not remaining context.');
  expect(unknown.getAttribute('aria-label')).toBe('Current context is unknown: the runtime has not reported usage for this model.'); locale.dispose();
});

it('localizes the context coverage disclosure while keeping counts and the planner reason verbatim', () => {
  const { document, root, add } = setup();
  const details = add('div', 'zchatgpt-context-details');
  const title = add('p', 'zchatgpt-context-details-title', 'Context supplied to the last request', details); title.setAttribute('data-zchatgpt-ui', 'true');
  // Mirrors the real `line()` shape: label span, a literal space, then the value span.
  const row = (label: string, value: string) => {
    const line = add('p', 'zchatgpt-context-detail', '', details);
    const name = add('span', 'zchatgpt-context-detail-label', label, line); name.setAttribute('data-zchatgpt-ui', 'true');
    const text = add('span', 'zchatgpt-context-detail-value', value, line); text.setAttribute('data-zchatgpt-ui', 'true');
    text.before(document.createTextNode(' '));
    return text;
  };
  const pagesValue = row('Pages supplied', '14 of 312 pages');
  const windowValue = row('Model window', '128,000 tokens (runtime reported)');
  const allowanceValue = row('Text allowance', 'not asserted');
  const setValue = row('Page numbers', '1–4, 7, and 3 more');
  const noFit = add('p', 'zchatgpt-context-detail zchatgpt-context-detail-nofit', 'Fit was not asserted: model capacity or retained history is unknown.', details); noFit.setAttribute('data-zchatgpt-ui', 'true');
  // The planner's recorded reason has no `data-zchatgpt-ui` marker, so it is data, not copy.
  const reason = add('p', 'zchatgpt-context-detail-reason', 'Recorded source gaps: 3 pages with no text, and 2 more.', details);
  const locale = mountUILocale(root); locale.update('zh');
  expect(title.textContent).toBe('上次请求提供的上下文');
  expect(details.querySelector('.zchatgpt-context-detail-label')!.textContent).toBe('已提供页数');
  // Counts, page sets and token figures are re-emitted verbatim; only the phrase changes.
  expect(pagesValue.textContent).toBe('14 / 312 页');
  expect(windowValue.textContent).toBe('128,000 词元（运行时报告）');
  expect(allowanceValue.textContent).toBe('未断言');
  expect(setValue.textContent).toBe('1–4, 7，另有 3 个');
  expect(noFit.textContent).toBe('未断言是否适配：模型容量或保留的历史记录未知。');
  expect(reason.textContent).toBe('Recorded source gaps: 3 pages with no text, and 2 more.');
  locale.update('en');
  expect(pagesValue.textContent).toBe('14 of 312 pages');
  expect(windowValue.textContent).toBe('128,000 tokens (runtime reported)');
  expect(setValue.textContent).toBe('1–4, 7, and 3 more');
  expect(reason.textContent).toBe('Recorded source gaps: 3 pages with no text, and 2 more.'); locale.dispose();
});

it('localizes the honest elapsed-time states while keeping the measured seconds verbatim', () => {
  const { root, add } = setup();
  const waiting = add('p', 'zchatgpt-request-timing'); add('span', 'zchatgpt-request-timing-text', 'Waiting 7s', waiting);
  const answered = add('p', 'zchatgpt-request-timing'); add('span', 'zchatgpt-request-timing-text', 'Answered in 42s', answered);
  const unknown = add('p', 'zchatgpt-request-timing'); add('span', 'zchatgpt-request-timing-text', 'Elapsed time unavailable', unknown);
  const locale = mountUILocale(root); locale.update('zh');
  expect(waiting.textContent).toBe('等待 7 秒');
  expect(answered.textContent).toBe('回答用时 42 秒');
  expect(unknown.textContent).toBe('耗时无法确定');
  locale.update('en');
  expect(waiting.textContent).toBe('Waiting 7s'); expect(answered.textContent).toBe('Answered in 42s'); locale.dispose();
});

it('localizes the local PDF read failures the composer alert can now show', () => {
  const { root, add } = setup();
  const timedOut = add('p', 'zchatgpt-error', 'The current PDF did not finish loading in time to read it locally. Wait for it to load or reopen it; your question is kept.');
  const unreadable = add('p', 'zchatgpt-error', 'The current PDF could not be read locally. Wait for it to load or reopen it; your question is kept.');
  const changed = add('p', 'zchatgpt-error', 'The PDF file changed while this reader was open. Reopen it to load the current version.');
  const empty = add('p', 'zchatgpt-error', 'No extractable text was found in the pages supplied from this PDF. Attach the relevant page image if you want to ask about them.');
  const locale = mountUILocale(root); locale.update('zh');
  // The three local causes stay distinct in Chinese: timeout, unreadable, and a changed revision.
  expect(timedOut.textContent).toBe('当前 PDF 未能及时加载完成，无法在本地读取。请等待其加载完成或重新打开；你的问题已保留。');
  expect(unreadable.textContent).toBe('当前 PDF 无法在本地读取。请等待其加载完成或重新打开；你的问题已保留。');
  expect(changed.textContent).toBe('此阅读器打开期间 PDF 文件已更改。请重新打开以载入当前版本。');
  expect(empty.textContent).toBe('从此 PDF 提供的页面中未找到可提取的文本。如需就此提问，请附加相关页面图像。');
  locale.update('en');
  expect(timedOut.textContent).toBe('The current PDF did not finish loading in time to read it locally. Wait for it to load or reopen it; your question is kept.');
  expect(unreadable.textContent).toBe('The current PDF could not be read locally. Wait for it to load or reopen it; your question is kept.');
  locale.dispose();
});

it('localizes the close-chat control without touching the destructive delete label', () => {
  const { root, add } = setup();
  const close = add('button', 'zchatgpt-current-close'); close.dataset.zchatgptAction = 'close-conversation'; close.setAttribute('aria-label', 'Close chat'); close.title = 'Close chat';
  const del = add('button', 'zchatgpt-icon-button'); del.dataset.zchatgptAction = 'delete-conversation'; del.setAttribute('aria-label', 'Delete chat');
  const locale = mountUILocale(root); locale.update('zh');
  expect(close.getAttribute('aria-label')).toBe('关闭对话');
  expect(close.title).toBe('关闭对话');
  expect(del.getAttribute('aria-label')).toBe('删除对话');
  locale.update('en');
  expect(close.getAttribute('aria-label')).toBe('Close chat');
  expect(close.title).toBe('Close chat'); locale.dispose();
});

it('translates the details summary and re-emits every page count verbatim', () => {
  const { root, add } = setup();
  const line = (text: string) => { const node = add('span', 'zchatgpt-context-row-value', text); node.setAttribute('data-zchatgpt-ui', 'true'); return node; };
  const all = line('Current PDF · all 12 pages read locally');
  const some = line('Current PDF · excerpts from 8 of 12 pages');
  const waiting = line('Preparing current PDF text… 3 of 12 pages');
  const alone = line('Preparing current PDF text…');
  const off = line('Automatic PDF context is off');
  const selected = line('Selected text · page 5');
  const none = line('PDF text unavailable');
  const locale = mountUILocale(root); locale.update('zh');
  expect(all.textContent).toBe('当前 PDF · 已在本地读取全部 12 页');
  expect(some.textContent).toBe('当前 PDF · 12 页中的 8 页摘录');
  expect(waiting.textContent).toBe('正在准备当前 PDF 文本……第 3/12 页');
  expect(alone.textContent).toBe('正在准备当前 PDF 文本……');
  expect(off.textContent).toBe('自动 PDF 上下文已关闭');
  expect(selected.textContent).toBe('选中文本 · 第 5 页');
  expect(none.textContent).toBe('PDF 文本不可用');
  locale.update('en');
  expect(some.textContent).toBe('Current PDF · excerpts from 8 of 12 pages'); locale.dispose();
});

it('stays inside its pane and stops observing after disposal', async () => {
  const { document, root, add } = setup(); const outside = add('button', 'zchatgpt-button', 'Send', document.body); const inside = add('button', 'zchatgpt-button', 'Send');
  const locale = mountUILocale(root); locale.update('zh'); expect(inside.textContent).toBe('发送'); expect(outside.textContent).toBe('Send');
  locale.dispose(); expect(inside.textContent).toBe('Send'); inside.textContent = 'Stop'; locale.update('zh');
  await new Promise(resolve => setTimeout(resolve, 20)); expect(inside.textContent).toBe('Stop');
});

it('localizes completed metadata outcomes, annotation review counts and switches while keeping model captions intact', () => {
  const { root, add } = setup(); const task = add('details', 'zchatgpt-task-card');
  const summary = add('summary', '', 'Acquire literature · Completed · 2 items saved · 0 PDFs attached', task);
  const header = add('div', 'zchatgpt-task-row-header', '', task); const outcome = add('span', 'zchatgpt-task-muted', 'Metadata saved; PDF unavailable (download failed)', header);
  const review = add('button', 'zchatgpt-button', 'Review 3 annotation suggestions'); review.dataset.zchatgptAction = 'review-annotations';
  const speed = add('button', 'zchatgpt-switch'); speed.dataset.zchatgptSetting = 'speed'; speed.setAttribute('aria-label', 'Fast');
  const meta = add('div', 'zchatgpt-message-meta', 'High');
  const locale = mountUILocale(root); locale.update('zh');
  expect(summary.textContent).toBe('获取文献 · 已完成 · 已保存 2 个条目 · 已附加 0 个 PDF');
  expect(outcome.textContent).toBe('元数据已保存；PDF 不可用（下载失败）'); expect(review.textContent).toBe('审核 3 条标注建议');
  expect(speed.getAttribute('aria-label')).toBe('快速'); expect(meta.textContent).toBe('High');
  locale.update('en'); expect(summary.textContent).toBe('Acquire literature · Completed · 2 items saved · 0 PDFs attached'); locale.dispose();
});

it('localizes the Chat / Agent mode selector while keeping the product term and pressed state', () => {
  const { root, add } = setup();
  const group = add('div', 'zchatgpt-mode-switch'); group.setAttribute('role', 'group'); group.setAttribute('aria-label', 'Mode'); group.setAttribute('data-zchatgpt-ui', 'true');
  const chat = add('button', 'zchatgpt-mode-option', 'Chat', group); chat.dataset.zchatgptAction = 'mode-chat'; chat.setAttribute('aria-label', 'Chat'); chat.setAttribute('aria-pressed', 'true');
  const agent = add('button', 'zchatgpt-mode-option', 'Agent', group); agent.dataset.zchatgptAction = 'mode-agent'; agent.setAttribute('aria-label', 'Agent'); agent.setAttribute('aria-pressed', 'false');
  const locale = mountUILocale(root); locale.update('zh');
  expect(group.getAttribute('aria-label')).toBe('模式');
  expect(chat.textContent).toBe('对话'); expect(chat.getAttribute('aria-label')).toBe('对话');
  // `Agent` is the product's own term for the acting mode, so it stays itself rather than becoming a
  // translated control phrase; the pressed state is not copy and is never rewritten.
  expect(agent.textContent).toBe('Agent');
  expect(chat.getAttribute('aria-pressed')).toBe('true');
  locale.update('en');
  expect(chat.textContent).toBe('Chat'); expect(group.getAttribute('aria-label')).toBe('Mode'); locale.dispose();
});

it('translates the plus section headings and each row title and description', () => {
  const { add } = setup();
  const group = add('div', 'zchatgpt-plus-group');
  add('div', 'zchatgpt-plus-heading', 'Attach', group);
  add('div', 'zchatgpt-plus-heading', 'Reference', group);
  const row = add('button', 'zchatgpt-plus-row', '', group);
  row.dataset.zchatgptAction = 'pick-file'; row.setAttribute('aria-label', 'Attach file…'); row.title = 'Attach file…';
  const title = add('span', 'zchatgpt-plus-row-title', 'Attach file…', row);
  const description = add('span', 'zchatgpt-plus-row-description', 'Text or image from your computer', row);
  const locale = mountUILocale(group); locale.update('zh');
  const headings = [...group.querySelectorAll<HTMLElement>('.zchatgpt-plus-heading')].map(node => node.textContent);
  expect(headings).toEqual(['添加附件', '引用']);
  expect(title.textContent).toBe('附加文件…');
  expect(description.textContent).toBe('来自你电脑的文本或图片');
  expect(row.getAttribute('aria-label')).toBe('附加文件…'); expect(row.title).toBe('附加文件…');
  locale.update('en'); expect(title.textContent).toBe('Attach file…'); expect(description.textContent).toBe('Text or image from your computer'); locale.dispose();
});

it('translates the attach-file row and the file refusals while leaving the file name verbatim', () => {
  const { root, add } = setup();
  const row = add('button', 'zchatgpt-plus-row', ''); row.dataset.zchatgptAction = 'pick-file';
  row.setAttribute('aria-label', 'Attach file…'); row.title = 'Attach file…';
  const title = add('span', 'zchatgpt-plus-row-title', 'Attach file…', row);
  const description = add('span', 'zchatgpt-plus-row-description', 'Text or image from your computer', row);
  const error = add('div', 'zchatgpt-error', 'This file has no text to attach.');
  const empty = add('div', 'zchatgpt-error', 'This file is not UTF-8 text, so it cannot become text context. Attach a text file or an image.');
  // An attached file is data, so its own name is never translated, even when it matches a UI word.
  const chip = add('div', 'zchatgpt-workspace-chip', 'Send');
  const locale = mountUILocale(root); locale.update('zh');
  expect(title.textContent).toBe('附加文件…');
  expect(description.textContent).toBe('来自你电脑的文本或图片');
  expect(row.getAttribute('aria-label')).toBe('附加文件…'); expect(row.title).toBe('附加文件…');
  expect(error.textContent).toBe('此文件没有可附加的文本。');
  expect(empty.textContent).toBe('此文件不是 UTF-8 文本，无法作为文本上下文。请附加文本文件或图片。');
  expect(chip.textContent).toBe('Send');
  locale.update('en'); expect(title.textContent).toBe('Attach file…'); expect(error.textContent).toBe('This file has no text to attach.'); locale.dispose();
});

it('translates the paper toolbar and its answers while keeping the copied identifiers verbatim', async () => {
  const { root, add } = setup();
  const group = add('div', 'zchatgpt-paper-actions', '', root);
  const copy = add('button', 'zchatgpt-icon-button', '', group); copy.dataset.zchatgptAction = 'copy-paper-context';
  copy.setAttribute('aria-label', 'Copy paper context');
  copy.title = 'Copy paper context\nCopy title, authors, publication, year, DOI and abstract as text. Does not include PDF full text.';
  const hint = add('span', 'zchatgpt-visually-hidden', 'Copy title, authors, publication, year, DOI and abstract as text. Does not include PDF full text.', group);
  hint.setAttribute('data-zchatgpt-ui', 'true');
  const file = add('button', 'zchatgpt-icon-button', '', group); file.dataset.zchatgptAction = 'copy-pdf-file';
  file.setAttribute('aria-label', 'Copy PDF file');
  file.title = 'Copy PDF file\nCopy the current PDF file to the clipboard. Paste it into ChatGPT to attach it.';
  const menu = add('div', 'zchatgpt-more-menu', '', root);
  const details = add('button', 'zchatgpt-more-row', 'Paper & context details', menu); details.dataset.zchatgptAction = 'open-paper-details'; details.setAttribute('data-zchatgpt-ui', 'true');
  const reload = add('button', 'zchatgpt-more-row', 'Reload ChatGPT', menu); reload.dataset.zchatgptAction = 'reload-chat'; reload.setAttribute('data-zchatgpt-ui', 'true');
  const status = add('span', 'zchatgpt-shell-feedback', 'PDF copied — paste to attach', root);
  const locale = mountUILocale(root); locale.update('zh');
  expect(copy.getAttribute('aria-label')).toBe('复制文献信息');
  expect(copy.title).toBe('复制文献信息\n以文本复制标题、作者、发表载体、年份、DOI 和摘要。不包含 PDF 正文。');
  expect(hint.textContent).toBe('以文本复制标题、作者、发表载体、年份、DOI 和摘要。不包含 PDF 正文。');
  expect(file.getAttribute('aria-label')).toBe('复制 PDF 文件');
  expect(details.textContent).toBe('文献与上下文详情');
  expect(reload.textContent).toBe('重新加载 ChatGPT');
  expect(status.textContent).toBe('PDF 已复制 — 粘贴即可附加');
  // A line that arrives after the language switch is picked up by the observer, not just at update().
  status.textContent = 'Paper details copied';
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(status.textContent).toBe('已复制文献信息');
  locale.update('en');
  expect(status.textContent).toBe('Paper details copied');
  expect(copy.title).toBe('Copy paper context\nCopy title, authors, publication, year, DOI and abstract as text. Does not include PDF full text.');
  locale.dispose();
});
