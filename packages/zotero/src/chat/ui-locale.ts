export type UILanguage = 'en' | 'zh';

const COPY: Readonly<Record<string, string>> = {
  'Sign in with ChatGPT': '使用 ChatGPT 登录', 'Cancel sign-in': '取消登录', Reconnect: '重新连接',
  'New chat': '新建对话', 'Chat history': '对话历史', 'Search chats…': '搜索对话…', 'Open chats': '已打开的对话',
  'Close chat': '关闭对话', 'Delete chat': '删除对话', 'Rename chat': '重命名对话', 'Save name': '保存名称', 'Chat name': '对话名称',
  'New content': '新内容', 'Ask a question…': '提出问题…', Question: '问题', Send: '发送', Stop: '停止',
  'Account usage': '账户用量', 'Return to source': '返回原文', Remove: '移除', You: '你', Copy: '复制',
  'Model and generation settings': '模型与生成设置', Effort: '推理强度', Options: '选项', Fast: '快速', Model: '模型',
  'Enter a question to send.': '请输入问题后再发送。',
  'Sign in with ChatGPT to send.': '使用 ChatGPT 登录后即可发送。',
  'Codex is not connected yet.': 'Codex 尚未连接。',
  'Model and generation settings (sign in to Codex to change them)': '模型与生成设置（登录 Codex 后可更改）',
  'Enter to send · Shift+Enter for a new line': 'Enter 发送 · Shift+Enter 换行',
  Low: '低', Medium: '中', High: '高', 'Extra High': '极高', Today: '今天', Yesterday: '昨天', 'Previous 7 days': '过去 7 天', Older: '更早',
  'Open the Codex sidebar to connect.': '打开 Codex 侧栏以连接。', 'Starting Codex…': '正在启动 Codex…',
  'Codex is unavailable': 'Codex 暂不可用', 'Finish signing in to ChatGPT in your browser.': '请在浏览器中完成 ChatGPT 登录。',
  'Sign in with ChatGPT to ask a question.': '使用 ChatGPT 登录后即可提问。', 'Responding…': '正在回答…',
  'Chat is unavailable in this build. Use Agent mode.': '此版本未集成 Chat 通道，请使用 Agent 模式。',
  // Chat mode's hosted application bar. The application's own UI is not translated here; these are
  // only the controls this host adds, and what they did with the user's clipboard.
  'Reload ChatGPT': '重新加载 ChatGPT',
  // The two paper actions in the common toolbar. The tooltip is the title plus its explanation, so
  // the combined two-line strings are dictionary keys of their own.
  'Copy paper context': '复制文献信息',
  'Copy title, authors, publication, year, DOI and abstract as text. Does not include PDF full text.': '以文本复制标题、作者、发表载体、年份、DOI 和摘要。不包含 PDF 正文。',
  'Copy paper context\nCopy title, authors, publication, year, DOI and abstract as text. Does not include PDF full text.': '复制文献信息\n以文本复制标题、作者、发表载体、年份、DOI 和摘要。不包含 PDF 正文。',
  'Copy PDF file': '复制 PDF 文件',
  'Copy the current PDF file to the clipboard. Paste it into ChatGPT to attach it.': '将当前 PDF 文件复制到剪贴板。粘贴到 ChatGPT 即可附加。',
  'Copy PDF file\nCopy the current PDF file to the clipboard. Paste it into ChatGPT to attach it.': '复制 PDF 文件\n将当前 PDF 文件复制到剪贴板。粘贴到 ChatGPT 即可附加。',
  'Paper details copied': '已复制文献信息',
  'This item has no bibliographic information to copy.': '此条目没有可复制的文献信息。',
  'The paper details could not be read.': '无法读取文献信息。',
  'PDF copied — paste to attach': 'PDF 已复制 — 粘贴即可附加',
  'More actions': '更多操作',
  'Paper & context details': '文献与上下文详情',
  'Allow PDF context': '允许 PDF 上下文',
  'Conversation actions': '对话操作',
  'Delete local conversation…': '删除本地对话…',
  'Delete this local conversation? Its messages and unsent draft are removed from this computer. The official ChatGPT conversation, the paper and native annotations are not touched.': '删除此本地对话？其消息与未发送的草稿将从此电脑移除。官方 ChatGPT 对话、文献和原生标注不受影响。',
  'Delete locally': '删除本地记录',
  'Keep it': '保留',
  // The file route puts the real PDF on the clipboard; the paste into ChatGPT is the owner's step.
  'The PDF file is on your clipboard — paste it into ChatGPT to attach it.': 'PDF 文件已复制到剪贴板 — 粘贴到 ChatGPT 即可附加。',
  'Copying the PDF file is unavailable here.': '此处无法复制 PDF 文件。',
  'This attachment has no local PDF file to copy.': '此附件没有可复制的本地 PDF 文件。',
  'The PDF file could not be copied.': '无法复制该 PDF 文件。',
  'When you send in official ChatGPT, the paper title, authors, publication, year, DOI and stored abstract are added when available. PDF body text is not added. A passage you explicitly select is included separately. Opening the sidebar sends nothing. You can turn automatic paper context off in Zotero Preferences.': '在官方 ChatGPT 中发送时，插件会在可用时加入文献标题、作者、发表信息、年份、DOI 和已保存的摘要。不会加入 PDF 正文。你明确选择的段落会单独加入。打开侧栏不会发送任何内容。你可以在 Zotero 偏好设置中关闭自动文献信息上下文。',
  'Preparing frozen paper metadata and any explicit selection. Nothing has been sent yet.': '正在准备冻结的文献信息和明确选择的段落，尚未发送任何内容。',
  'ChatGPT accepted this message with bibliographic paper context and any explicit selection.': 'ChatGPT 已接收这条消息，其中包含文献信息上下文和明确选择的段落（如有）。',
  'ChatGPT did not confirm that this message was accepted. It was not sent again.': 'ChatGPT 未确认已接收这条消息，插件没有再次发送。',
  'ChatGPT accepted this message without automatic paper context; an explicit selection may still be included.': '自动文献信息上下文已关闭；ChatGPT 已接收这条消息。消息仍可能包含你明确选择的段落。',
  'The paper metadata could not be read. Your ChatGPT draft was kept and was not sent.': '无法读取文献信息。ChatGPT 草稿已保留，未发送。',
  'The official ChatGPT composer is unavailable. Your draft was kept and was not sent.': '官方 ChatGPT 输入框不可用。草稿已保留，未发送。',
  'The selection was inserted in the ChatGPT draft. It has not been sent.': '选中内容已插入 ChatGPT 草稿，尚未发送。',
  'Sign in to official ChatGPT. Automatic paper context will be included only after its supported composer is available.': '请登录官方 ChatGPT。只有检测到受支持的输入框后，才会加入自动文献信息上下文。',
  'Automatic paper context is blocked because this ChatGPT page does not expose the supported composer. No question can be sent from this surface.': '此 ChatGPT 页面未提供受支持的输入框，自动文献信息上下文已阻止发送；此界面不会发送任何问题。',
  'Automatic paper context is blocked because the official ChatGPT send control is unsupported. Your draft was kept and was not sent.': '官方 ChatGPT 发送控件不受支持，自动文献信息上下文已阻止发送。草稿已保留，未发送。',
  'Four paper ChatGPT sessions already contain drafts or work. Finish or clear one before opening another.': '已有四个论文 ChatGPT 会话包含草稿或进行中的工作。请先完成或清空其中一个，再打开新会话。',
  'Complete sign-in on the official account page. PDF context is disabled until ChatGPT returns.': '请在官方账户页面完成登录。返回 ChatGPT 前，PDF 上下文功能保持关闭。',
  Recorded: '已记录', Stopped: '已停止', Failed: '失败', Queued: '已排队', 'Cancelled before sending': '发送前已取消',
  'Unconfirmed: the connection was interrupted. The request was not sent again.': '状态未确认：连接已中断，未重新发送此请求。',
  'No saved chats match this search.': '没有匹配的已保存对话。',
  // A history row's provable source label. `Agent` is a product name and stays verbatim; a legacy
  // `mode: chat` record is the old Codex read-only path, never an official web conversation.
  Legacy: '旧版',
  Mixed: '混合',
  Appearance: '外观', 'Interface language': '界面语言',
  'Queue question': '将问题加入队列', 'Cancel queued question': '取消排队的问题',
  'Regenerate in new chat': '在新对话中重新生成', 'Edit in new chat': '在新对话中编辑',
  'Review annotation suggestions': '审核标注建议',
  Attach: '添加附件', 'Add images or context': '添加图片或上下文',
  // One local file, routed by the host: text-like files become text context, images become image
  // input. The label is deliberately about content, not about "uploading" a file anywhere.
  'Attach file…': '附加文件…', 'Text or image from your computer': '来自你电脑的文本或图片',
  'Attaching a file is unavailable.': '无法附加文件。',
  'The chat changed while choosing a file. Choose it again.': '选择文件时对话已切换。请重新选择。',
  'No file was selected.': '未选择文件。',
  'Choose a regular file, not a folder.': '请选择文件，而非文件夹。',
  'This file is not UTF-8 text, so it cannot become text context. Attach a text file or an image.': '此文件不是 UTF-8 文本，无法作为文本上下文。请附加文本文件或图片。',
  'This file has no text to attach.': '此文件没有可附加的文本。',
  'This file looks like binary data, so it cannot become text context.': '此文件看起来是二进制数据，无法作为文本上下文。',
  'The selected file could not be read.': '无法读取所选文件。',
  'The selected file is empty or exceeds the supported size limit.': '所选文件为空或超出支持的大小上限。',
  'This attached file has no readable text. Attach it again.': '此附加文件没有可读取的文本。请重新附加。',
  'Save literature to': '文献保存位置',
  Reference: '引用',
  Skill: 'Skill', 'Add a skill': '添加 skill', 'Installed skills for this chat': '此对话可用的 skill', 'Add references': '添加引用', 'Saved chats and articles': '已保存的对话与文章',
  'Target collection': '目标分类', 'Choose a collection…': '选择分类…', 'Preview image': '预览图片',
  'Image preview': '图片预览', 'Close image preview': '关闭图片预览', 'Save image…': '保存图片…',
  'Move image earlier': '将图片前移',
  'Use current paper context automatically': '自动使用当前文献信息上下文',
  'New agent': '新建 Agent 会话',
  // Context details (UI-02/UI-03). Dynamic sentences with counts are handled by `progress()`; these
  // are the fixed phrases. The one-line summary lives in the details now, not in a permanent row.
  'Automatic PDF context is off': '自动 PDF 上下文已关闭',
  'Automatic paper context is off': '自动文献信息上下文已关闭',
  'Paper details and stored abstract will be included when available · no PDF body text': '可用时会加入文献信息和已保存的摘要 · 不包含 PDF 正文',
  'Automatic paper details and abstract': '自动文献信息和摘要',
  'Automatic PDF text': '自动 PDF 文本',
  'Chat sends available bibliography and stored abstract. PDF body text is excluded; explicitly selected text is included separately.': 'Chat 会发送可用的文献信息和已保存的摘要，不会发送 PDF 正文；明确选择的文本会单独加入。',
  'Chat does not send PDF body text. Paper details and the stored abstract are included when available.': 'Chat 不会发送 PDF 正文；可用时会加入文献信息和已保存的摘要。',
  'PDF text unavailable': 'PDF 文本不可用',
  'Current PDF · text not prepared yet': '当前 PDF · 文本尚未准备',
  'No PDF context': '没有 PDF 上下文',
  'Context for the next message': '下一条消息的上下文',
  Source: '来源',
  'Next send': '下次发送',
  'Read locally': '本地已读取',
  'Automatic PDF context': '自动 PDF 上下文',
  On: '开启',
  Off: '关闭',
  'The last request did not record a coverage report.': '上次请求未记录覆盖报告。',
  'Re-read current PDF': '重新读取当前 PDF',
  'Close context details': '关闭上下文详情',
  // Agent empty state (UI-05). Purpose copy for the native surface; the entries only prepare drafts.
  'Ask Codex about this paper': '向 Codex 提问这篇论文',
  'Answers stay in this sidebar. Highlighting, article retrieval and library organization only run after you review and approve a proposed task.': '回答显示在此侧栏中。高亮、获取文章和整理文献库只会在你审核并批准候选任务后执行。',
  'Highlight key points': '高亮重点',
  'Draft a request for the current PDF': '为当前 PDF 起草请求',
  'Get an article': '获取文章',
  'Draft a request for a DOI or public URL': '为 DOI 或公开 URL 起草请求',
  'Organize selected items': '整理选中条目',
  'Uses the selection in the Zotero main window': '使用 Zotero 主窗口中的选中条目',
  'Draft prepared below. Nothing has been sent.': '草稿已准备在下方，尚未发送任何内容。',
  'When you send in Agent, the full PDF text, your selected text and attached images go to Codex through your ChatGPT account. Opening this sidebar only prepares local text. You can turn automatic source context off in Zotero Preferences.': '在 Agent 中发送时，此 PDF 的全文、选中文本和附加图片将通过你的 ChatGPT 账户发送至 Codex。打开侧栏仅会在本地准备文本。你可以在 Zotero 偏好设置中关闭自动来源上下文。',
  'Allow PDF context and send': '允许 PDF 上下文并发送',
  'This action could not be completed.': '此操作未能完成。',
  'The source could not be opened.': '无法打开原文。',
  'The image could not be saved.': '无法保存图片。',
  'The clipboard image could not be attached.': '无法附加剪贴板图片。',
  'That image is larger than the 2 MB limit, so it was not attached.': '该图片超过 2 MB 上限，未附加。',
  'That image format cannot be attached. Use PNG, JPEG, GIF or WebP.': '无法附加该图片格式。请使用 PNG、JPEG、GIF 或 WebP。',
  'The dropped image could not be attached.': '无法附加拖放的图片。',
  'Collections could not be loaded.': '无法加载分类列表。',
  Copied: '已复制',
  'The answer could not be copied.': '无法复制回答。',
  // Local PDF preparation failures. Kept distinct so the owner can tell "this PDF could not be read
  // here" from "the file changed underneath the reader" from "there was no text to send".
  'The current PDF could not be read locally. Wait for it to load or reopen it; your question is kept.': '当前 PDF 无法在本地读取。请等待其加载完成或重新打开；你的问题已保留。',
  'The current PDF did not finish loading in time to read it locally. Wait for it to load or reopen it; your question is kept.': '当前 PDF 未能及时加载完成，无法在本地读取。请等待其加载完成或重新打开；你的问题已保留。',
  'The PDF file changed while this reader was open. Reopen it to load the current version.': '此阅读器打开期间 PDF 文件已更改。请重新打开以载入当前版本。',
  'The PDF changed during preparation. Reopen it and send again.': '准备过程中 PDF 已更改。请重新打开后再次发送。',
  'The host cannot verify this loaded PDF version. Reopen the PDF before asking.': '无法校验已加载的 PDF 版本。请重新打开此 PDF 后再提问。',
  'No extractable text was found in the pages supplied from this PDF. Attach the relevant page image if you want to ask about them.': '从此 PDF 提供的页面中未找到可提取的文本。如需就此提问，请附加相关页面图像。',
  'The PDF page text could not be extracted.': '无法提取 PDF 页面文本。',
  'Elapsed time unavailable': '耗时无法确定',
  'The saved research profile is no longer available; global preferences apply.': '已保存的研究配置不可用；将应用全局偏好设置。',
  'Context unknown': '上下文用量未知',
  'Close preview': '关闭预览', 'Reference preview': '引用预览',
  'Use reference pages': '使用这些引用页面', 'Use entire reference': '使用完整引用',
  'Reference first PDF page': '引用 PDF 起始页', 'Reference last PDF page': '引用 PDF 结束页',
  'Instructions': '指令', 'Codex instructions': 'Codex 指令',
  'Save': '保存',
  'Installed skills': '已安装的 skill',
  Name: '名称', Description: '说明', Version: '版本',
  'Acquire literature': '获取文献',
  Enabled: '已启用', Duplicate: '创建副本', Export: '导出',
  Edit: '编辑', Delete: '删除', Cancel: '取消',
  'Preferences saved.': '偏好已保存。',
  'No skills installed.': '尚未安装 skill。',
  References: '引用', All: '全部', Articles: '文献', Chats: '对话', Skills: 'skill', 'Searching…': '正在搜索…', 'Adding…': '正在添加…', 'No matches': '无匹配项',
  'Search references…': '搜索文献…', 'Search references': '搜索文献', 'Type a title, author or year to search.': '输入标题、作者或年份进行搜索。',
  Tasks: '任务', Include: '选中', 'Include this candidate': '选中此候选项', 'Verified metadata': '已核验的元数据',
  'Existing item': '已有条目', 'Choose metadata': '选择元数据', 'Choose existing item': '选择已有条目', 'Obtain a verified PDF': '获取已核验的 PDF',
  'Approve selected': '批准所选项', 'Approving…': '正在批准…', 'Cancel task': '取消任务', 'Cancellation requested': '已请求取消',
  'Reconcile task': '核对任务状态', 'Undo task': '撤销任务', 'Open source': '打开原文', 'Open saved output': '打开已保存的结果',
  'Open reading result': '打开阅读结果', 'Cancel reading': '取消阅读', 'Reconcile reading': '核对阅读状态',
  Preparing: '准备中', Review: '待审核', Running: '运行中', Completed: '已完成', 'Partly completed': '部分完成',
  Cancelled: '已取消', Unconfirmed: '未确认', Undone: '已撤销', Conflict: '存在冲突',
  Ready: '待处理', Unresolved: '未定位', Skipped: '已跳过', 'Writing…': '正在写入…', Applied: '已应用',
  'Metadata saved': '元数据已保存', 'Undoing…': '正在撤销…', 'Changed output preserved': '已保留修改后的结果',
  'Metadata saved; PDF removed': '元数据已保存；PDF 已移除', 'PDF attached': 'PDF 已附加',
  'Metadata saved; PDF result unconfirmed': '元数据已保存；PDF 结果未确认', 'Metadata saved; PDF not requested': '元数据已保存；未请求 PDF',
  'Metadata saved; PDF not attempted': '元数据已保存；未尝试获取 PDF',
  'Reconcile unconfirmed writes before undoing. They will not be resent automatically.': '撤销前请先核对未确认的写入，它们不会被自动重发。',
  'Changed outputs and human changes are preserved. Undo checks the recorded version again.': '已修改的结果和人工更改会被保留。撤销时会再次核对记录的版本。',
  'PDF download is unavailable for this target; approval saves metadata only.': '此目标无法下载 PDF；批准后仅保存元数据。',
  // Native Zotero Preferences pane (preferences/pane.ts). Messages the store raises
  // through the same text reach the sidebar too, so the key is deliberately shared.
  Chat: '对话',
  // The pane's groups. `Chat` stays the product name; `Agent` stays `Agent`.
  General: '通用',
  Agent: 'Agent',
  'Local data': '本地数据',
  Details: '详情',
  'Agent instructions': 'Agent 指令',
  Models: '模型',
  'Checked models are offered in Agent requests; the exact id is what is sent. Source: the bundled catalog, not your account\'s live entitlements.': '勾选的模型会在 Agent 请求中提供；右侧确切 id 就是实际发送的 id。来源：随包目录，并非你账户的实时权限。',
  'Checked models are offered in Agent requests; the exact id is what is sent. Source: the running runtime\'s report plus the bundled catalog.': '勾选的模型会在 Agent 请求中提供；右侧确切 id 就是实际发送的 id。来源：正在运行的运行时的报告与随包目录。',
  'Applies only to Agent requests.': '仅用于 Agent 请求。',
  'Chat opens the official ChatGPT website in the sidebar. Its account, models, conversations and limits are managed by ChatGPT, not by this plugin.': 'Chat 会在侧栏中打开官方 ChatGPT 网站。其账户、模型、对话与限额由 ChatGPT 管理，不由本插件管理。',
  'The plugin adds only the paper context it may attach to a message you send there. It never sends a Codex request for Chat.': '插件只会在你于该网站发送消息时附加它可附加的论文上下文。Chat 不会发起任何 Codex 请求。',
  'Codex starts only when you use Agent. Opening this window reads local settings and any cached model report; it never connects.': '只有在使用 Agent 时才会启动 Codex。打开此窗口只读取本地设置和缓存的模型报告，不会连接。',
  'Manage the conversations this plugin saved on this computer. Deleting a local chat never deletes the official ChatGPT conversation, and never undoes a native annotation.': '管理本插件保存在这台电脑上的对话。删除本地对话不会删除官方 ChatGPT 对话，也不会撤销原生标注。',
  'Unsaved changes': '未保存的更改',
  'Interface language saved.': '界面语言已保存。', 'Agent text size saved.': 'Agent 文字大小已保存。',
  'Automatic PDF text preparation is on.': '已开启自动准备 PDF 文本。', 'Automatic PDF text preparation is off.': '已关闭自动准备 PDF 文本。',
  'Skill updated.': 'skill 已更新。',
  'The stored preferences could not be read.': '无法读取已保存的偏好。',
  // History management section (preferences/history-section.ts). Counts, paper titles, timestamps and
  // chat titles are data and stay verbatim; only the phrases below are translated.
  Paper: '文献', 'All papers': '全部文献', 'Select all': '全选',
  'Delete selected': '删除所选项',
  'Delete permanently': '永久删除', 'work in progress': '有未完成的工作',
  'No saved chats yet.': '尚未保存任何对话。',
  'The saved chat list could not be read. Nothing was changed.': '无法读取已保存的对话列表，未做任何更改。',
  'The change could not be confirmed. Reopen this section to see what is actually stored.': '无法确认更改结果。请重新打开此部分以查看实际保存的内容。',
  'The chats were submitted for removal, but the saved chat list could not be re-read. Reopen this section to see what is stored.': '对话已提交删除，但无法重新读取已保存的对话列表。请重新打开此部分以查看已保存的内容。',
  'A chat with an unfinished answer or native task was skipped: finish or cancel it before deleting.': '已跳过包含未完成回答或原生任务的对话：请先完成或取消，再删除。',
  // Context-ring coverage disclosure (rendered by `contextDetailNodes` in chat/view.ts). These are
  // labels and phrases only: page numbers, token figures, model ids and the planner's `reason` line
  // are data and pass through verbatim. `unknown`/`not asserted` are emitted only by the disclosure.
  'Context supplied to the last request': '上次请求提供的上下文',
  Mode: '模式', 'Whole source': '整份来源', 'Question-focused selection': '按问题选取', 'Multi-pass reading': '多轮阅读',
  'Pages supplied': '已提供页数', 'Page numbers': '页码', 'Model window': '模型窗口',
  unknown: '未知', 'Text allowance': '文本配额', 'not asserted': '未断言',
  'Fit was not asserted: model capacity or retained history is unknown.': '未断言是否适配：模型容量或保留的历史记录未知。',
  'What was supplied and what was not': '已提供与未提供的内容',
};

// Content areas are never localized, including controls embedded in rendered Markdown.
const CONTENT = [
  '.zchatgpt-message-text', '.zchatgpt-rendered', '.zchatgpt-citation-text', '.zchatgpt-current-title', '.zchatgpt-initial-title',
  // An open-chat chip shows the chat's own title: a chat named "Send" must not be renamed on screen.
  // The shell's binding title is the paper's own title, so it is data too.
  '.zchatgpt-pane-tab-label', '.zchatgpt-shell-title',
  '.zchatgpt-history-title', '.zchatgpt-message-reference', '.zchatgpt-command-option', '.zchatgpt-command-label', '.zchatgpt-command-description',
  '.zchatgpt-task-question', '.zchatgpt-task-quote', '.zchatgpt-task-scope', '.zchatgpt-workspace-preview pre', '.zchatgpt-workspace-preview-title strong',
  'script', 'style', 'svg', 'math', '[data-zchatgpt-ui="false"]',
].join(',');
const BUTTONS = 'button[data-zchatgpt-action],.zchatgpt-button,.zchatgpt-icon-button,.zchatgpt-task-button,.zchatgpt-workspace-control,.zchatgpt-preferences button';
const TEXT = [
  BUTTONS, '.zchatgpt-picker-heading', '[data-zchatgpt-setting="effort"] .zchatgpt-picker-option-label', '.zchatgpt-picker-toggle-row > span',
  '.zchatgpt-history-heading', '.zchatgpt-history-empty',   '.zchatgpt-status-line', '.zchatgpt-message-meta',
  '.zchatgpt-context-disclosure > p', '.zchatgpt-error', '.zchatgpt-shell-feedback',
  '.zchatgpt-workspace-status',
  '[data-zchatgpt-collection-target] option[value=""]', '.zchatgpt-plus-menu', '.zchatgpt-plus-heading', '.zchatgpt-plus-row-title', '.zchatgpt-plus-row-description', '.zchatgpt-acquisition-target', '.zchatgpt-command-heading', '.zchatgpt-command-status',
  '.zchatgpt-task-card > summary', '.zchatgpt-task-row-header > .zchatgpt-task-muted', '.zchatgpt-task-check', '.zchatgpt-task-field',
  '.zchatgpt-task-field option[value=""]', '.zchatgpt-task-counts', '.zchatgpt-task-body > .zchatgpt-task-muted',
  '[data-zchatgpt-reading-job] .zchatgpt-task-row > p:first-child', '[data-zchatgpt-ui="true"]',   '.zchatgpt-context-ring', '.zchatgpt-request-timing-text',
  // The context details are reached from the More menu; the fixed phrases are dictionary keys.
  '.zchatgpt-context-panel-title',
  // Agent empty state (UI-05). Drafts prepared into the composer are data and stay verbatim.
  '.zchatgpt-agent-empty-title', '.zchatgpt-agent-empty-body',
  '.zchatgpt-agent-empty-action-title', '.zchatgpt-agent-empty-action-hint', '.zchatgpt-agent-empty-note',
  // The hosted page's notice strip, when the first outbound disclosure is owed or the host could not
  // show the page at all.
  '.zchatgpt-embed-bridge-status', '.zchatgpt-embed-context-notice',
  // The unbound New chat tab is copy, unlike named chat titles.
  '.zchatgpt-pane-tab-new',
  // Native Preferences pane: pane copy only. Skill names and ids are never matched.
  '.zchatgpt-preferences legend', '.zchatgpt-preferences label', '.zchatgpt-preferences summary', '.zchatgpt-preferences [data-zchatgpt-pref="uiLanguage"] option',
  '.zchatgpt-preferences [data-zchatgpt-pref="status"]', '.zchatgpt-preferences [data-zchatgpt-pref="error"]', '.zchatgpt-preferences .zchatgpt-preferences-muted',
  // History management section: its own status, select-all count, confirmation lines, paper options.
  '.zchatgpt-preferences [data-zchatgpt-history="intro"]',
  '.zchatgpt-preferences [data-zchatgpt-history="error"]', '.zchatgpt-preferences [data-zchatgpt-history="status"]',
  '.zchatgpt-preferences [data-zchatgpt-history="confirm-text"]', '.zchatgpt-preferences [data-zchatgpt-history="selected-count"]',
  '.zchatgpt-preferences [data-zchatgpt-history="paper"] option',
].join(',');
const ATTRIBUTES = [
  BUTTONS, '.zchatgpt-input', '.zchatgpt-history-panel', '.zchatgpt-history-search', '.zchatgpt-picker-menu', '[data-zchatgpt-picker]', '[data-zchatgpt-setting="speed"]',
  // The open-chat strip's own name is copy; the chat titles inside it are data and stay verbatim.
  '.zchatgpt-panes',
  '[data-zchatgpt-pane-tab][data-zchatgpt-conversation-id="new-chat"]',
  '.zchatgpt-pane-tab-new',
  '.zchatgpt-plus-menu input', '.zchatgpt-rename-form input', '[data-zchatgpt-collection-target]', '.zchatgpt-workspace-preview',
  '.zchatgpt-context-panel', '[data-zchatgpt-more-menu]', '.zchatgpt-history-menu',
  '.zchatgpt-workspace-preview input', '.zchatgpt-workspace-search', '.zchatgpt-image-preview', '.zchatgpt-command-list', '.zchatgpt-task-view', '.zchatgpt-task-check input', '[data-zchatgpt-ui="true"]', '.zchatgpt-context-ring',
  // The History search box carries copy in its placeholder and aria-label only when it is empty.
  '.zchatgpt-preferences [data-zchatgpt-history="search"]',
].join(',');
const STATUS: Readonly<Record<string, string>> = {
  queued: '已排队', reserved: '待开始', running: '运行中', completed: '已完成', paused: '已暂停', uncertain: '未确认', cancelled: '已取消', failed: '失败',
  preparing: '准备中', review: '待审核', 'partly completed': '部分完成', unconfirmed: '未确认', undone: '已撤销', conflict: '存在冲突',
  ready: '待处理', unresolved: '未定位', skipped: '已跳过', 'writing…': '正在写入…', applied: '已应用',
  'metadata saved': '元数据已保存', 'undoing…': '正在撤销…', 'changed output preserved': '已保留修改后的结果',
};

function progress(text: string): string {
  let match = /^Waiting (\d+)s$/u.exec(text);
  if (match) return `等待 ${match[1]} 秒`;
  match = /^Answered in (\d+)s$/u.exec(text);
  if (match) return `回答用时 ${match[1]} 秒`;
  match = /^(Annotations|Acquire literature) · (Preparing|Review|Running|Completed|Partly completed|Cancelled|Unconfirmed|Undone|Conflict|Failed) · (.+)$/u.exec(text);
  if (match) {
    const outcome = match[3]!.replace(/^(\d+\/\d+) selected$/u, '已选择 $1').replace(/^(\d+\/\d+) annotations applied$/u, '已应用 $1 个标注').replace(/^(\d+) items? saved · (\d+) PDFs? attached$/u, '已保存 $1 个条目 · 已附加 $2 个 PDF');
    if (outcome !== match[3]) return `${match[1] === 'Annotations' ? '标注' : '获取文献'} · ${COPY[match[2]!]!} · ${outcome}`;
  }
  match = /^Reading · (\w+) · (\d+\/\d+) passes$/u.exec(text);
  if (match && STATUS[match[1]!]) return `阅读 · ${STATUS[match[1]!]!} · ${match[2]} 轮`;
  match = /^(Synthesis|Reading pass (\d+)|Read selected sources) · (\w+)$/u.exec(text);
  if (match && STATUS[match[3]!]) return `${match[1] === 'Synthesis' ? '综合' : match[2] ? `阅读第 ${match[2]} 轮` : '阅读所选来源'} · ${STATUS[match[3]!]!}`;
  const counts = text.split(' · ').map(part => /^(\d+) (.+)$/u.exec(part));
  if (counts.length && counts.every(part => part && STATUS[part[2]!])) return counts.map(part => `${part![1]} ${STATUS[part![2]!]!}`).join(' · ');
  match = /^Review (\d+) annotation suggestions$/u.exec(text);
  if (match) return `审核 ${match[1]} 条标注建议`;
  match = /^PDF (\S+) · candidate pages (.+)$/u.exec(text);
  if (match) return `PDF ${match[1]} · 候选页 ${match[2] === 'none' ? '无' : match[2]}`;
  // Local reading status. Every count is data and is re-emitted verbatim.
  match = /^Reading this PDF…$/u.exec(text);
  if (match) return '正在读取此 PDF……';
  match = /^Reading this PDF… (\d+) of (\d+) pages$/u.exec(text);
  if (match) return `正在读取此 PDF……第 ${match[1]}/${match[2]} 页`;
  match = /^Read all (\d+) pages locally$/u.exec(text);
  if (match) return `已在本地读取全部 ${match[1]} 页`;
  match = /^Read (\d+) of (\d+) pages locally$/u.exec(text);
  if (match) return `已在本地读取 ${match[2]} 页中的 ${match[1]} 页`;
  match = /^No text could be read from this PDF locally$/u.exec(text);
  if (match) return '无法在本地从此 PDF 提取到文本';
  // Context summary (shell). Every count and page label is captured and re-emitted verbatim.
  match = /^Selected text · page (.+)$/u.exec(text);
  if (match) return `选中文本 · 第 ${match[1]} 页`;
  match = /^Selected text · page (.+) · paper details and abstract when available$/u.exec(text);
  if (match) return `选中文本 · 第 ${match[1]} 页 · 可用时加入文献信息和摘要`;
  match = /^Selected text · page (.+) · automatic paper context off$/u.exec(text);
  if (match) return `选中文本 · 第 ${match[1]} 页 · 自动文献信息上下文已关闭`;
  match = /^Preparing current PDF text…$/u.exec(text);
  if (match) return '正在准备当前 PDF 文本……';
  match = /^Preparing current PDF text… (\d+) of (\d+) pages$/u.exec(text);
  if (match) return `正在准备当前 PDF 文本……第 ${match[1]}/${match[2]} 页`;
  match = /^Current PDF · all (\d+) pages read locally$/u.exec(text);
  if (match) return `当前 PDF · 已在本地读取全部 ${match[1]} 页`;
  match = /^Current PDF · excerpts from (\d+) of (\d+) pages$/u.exec(text);
  if (match) return `当前 PDF · ${match[2]} 页中的 ${match[1]} 页摘录`;
  match = /^(\d+) of (\d+) pages have text$/u.exec(text);
  if (match) return `${match[2]} 页中有 ${match[1]} 页含文本`;
  match = /^p\. (.+)$/u.exec(text);
  if (match) return `第 ${match[1]} 页`;
  match = /^Target collection: (.*)$/u.exec(text);
  if (match) return `目标分类：${match[1]}`;
  match = /^Source: (\S+)\nPermissions: (.*)\nUnsupported dependencies: (.*)$/u.exec(text);
  if (match) return `来源：${match[1]}\n权限：${match[2] === 'none' ? '无' : match[2]}\n不支持的依赖：${match[3] === 'none' ? '无' : match[3]}`;
  // History management section. Every number and title in these lines is data and is carried
  // through verbatim; only the surrounding sentence is translated. They precede the generic
  // `Delete …?` rule below, which would otherwise only translate the verb.
  match = /^(\d+) stored chats?$/u.exec(text);
  if (match) return `已保存 ${match[1]} 个对话`;
  match = /^(\d+) matching chats?$/u.exec(text);
  if (match) return `匹配 ${match[1]} 个对话`;
  match = /^(\d+) selected$/u.exec(text);
  if (match) return `已选择 ${match[1]} 个`;
  match = /^(\d+) messages?$/u.exec(text);
  if (match) return `${match[1]} 条消息`;
  match = /^(\d+) tasks?$/u.exec(text);
  if (match) return `${match[1]} 个任务`;
  match = /^Showing the (\d+) most recent of (\d+) matching chats\. Narrow the search or the paper filter to see the rest\.$/u.exec(text);
  if (match) return `仅显示最近匹配的 ${match[2]} 个对话中的 ${match[1]} 个。请缩小搜索范围或更改文献筛选以查看其余内容。`;
  match = /^…and (\d+) more papers — search to narrow$/u.exec(text);
  if (match) return `……还有 ${match[1]} 篇文献，请用搜索缩小范围`;
  match = /^Deleted (\d+) of (\d+) chats?\.(?: (\d+) could not be changed\.)?$/u.exec(text);
  if (match) {
    const head = `已删除 ${match[2]} 个对话中的 ${match[1]} 个。`;
    return match[3] ? `${head}有 ${match[3]} 个未能更改。` : head;
  }
  match = /^Delete “(.+)”\? This permanently removes the chat, its messages and its unsent draft from this computer\. Native task outputs and exported files are not undone\. This cannot be undone\.$/u.exec(text);
  if (match) return `删除“${match[1]}”？将从此电脑永久移除该对话、其中的消息及其未发送的草稿。原生任务的输出和已导出的文件不会被撤销。此操作无法撤销。`;
  match = /^Delete (\d+) chats\? This permanently removes those chats, their messages and their unsent drafts from this computer\. Native task outputs and exported files are not undone\. This cannot be undone\.$/u.exec(text);
  if (match) return `删除 ${match[1]} 个对话？将从此电脑永久移除这些对话、其中的消息及其未发送的草稿。原生任务的输出和已导出的文件不会被撤销。此操作无法撤销。`;
  match = /^Delete (.+)\?$/u.exec(text);
  if (match) return `删除 ${match[1]}？`;
  match = /^Context ([\d.]+k?) \/ ([\d.]+k?) tokens$/u.exec(text);
  if (match) return `上下文 ${match[1]} / ${match[2]} 词元`;
  match = /^Context ([\d.]+k?) tokens · window unknown$/u.exec(text);
  if (match) return `上下文 ${match[1]} 词元 · 窗口未知`;
  // Context-ring coverage disclosure. The template phrases translate; every count, page number and
  // token figure is captured and re-emitted verbatim. `…, and N more` is the page set's own tail.
  match = /^(\d+) of (\d+) pages$/u.exec(text);
  if (match) return `${match[1]} / ${match[2]} 页`;
  match = /^([\d,]+) tokens \((runtime reported|bundled catalog estimate)\)$/u.exec(text);
  if (match) return `${match[1]} 词元（${match[2] === 'runtime reported' ? '运行时报告' : '内置目录估算'}）`;
  match = /^([\d,]+) tokens$/u.exec(text);
  if (match) return `${match[1]} 词元`;
  match = /^(.+), and (\d+) more$/u.exec(text);
  if (match) return `${match[1]}，另有 ${match[2]} 个`;
  match = /^Metadata saved; PDF unavailable \((no doi|no oa candidate|existing pdf|download failed|file type mismatch|identity unconfirmed|supplementary|file too large)\)$/u.exec(text);
  if (match) {
    const reason: Readonly<Record<string, string>> = { 'no doi': '无 DOI', 'no oa candidate': '无开放获取来源', 'existing pdf': '已有 PDF', 'download failed': '下载失败', 'file type mismatch': '文件类型不符', 'identity unconfirmed': '文献身份未确认', supplementary: '补充材料', 'file too large': '文件过大' };
    return `元数据已保存；PDF 不可用（${reason[match[1]!]!}）`;
  }
  // Native Preferences pane. Values, ids and workflow names stay verbatim.
  match = /^Agent text size \(([\d.]+)–([\d.]+)\)$/u.exec(text);
  if (match) return `Agent 文字大小（${match[1]}–${match[2]}）`;
  match = /^Choose an Agent text size from ([\d.]+) to ([\d.]+)\.$/u.exec(text);
  if (match) return `请选择 ${match[1]} 到 ${match[2]} 之间的 Agent 文字大小。`;
  match = /^(.*) · Unavailable: (.+)$/u.exec(text);
  if (match) return `${match[1]} · 不可用：${match[2]}`;
  return text;
}

function actionLabel(text: string): string {
  const fixed = COPY[text]; if (fixed) return fixed;
  const contextUnknown = 'Current context is unknown: the runtime has not reported usage for this model.';
  if (text === contextUnknown) return '当前上下文未知：运行时尚未报告此模型的用量。';
  const contextNoWindow = /^Last runtime usage report: ([\d,]+) input tokens; the model window is unknown\. This is the last report, not remaining context\.$/u.exec(text);
  if (contextNoWindow) return `上次运行时用量报告：${contextNoWindow[1]} 个输入词元；模型窗口未知。这是上次报告，并非剩余空间。`;
  const contextReported = /^Last runtime usage report: ([\d,]+) input tokens; model window ([\d,]+) \((runtime reported|bundled catalog estimate)\)\. This is the last report, not remaining context\.$/u.exec(text);
  if (contextReported) return `上次运行时用量报告：${contextReported[1]} 个输入词元；模型窗口 ${contextReported[2]}（${contextReported[3] === 'runtime reported' ? '运行时报告' : '内置目录估算'}）。这是上次报告，并非剩余空间。`;
  for (const [source, target] of [
    ['Rename chat: ', '重命名对话：'],
    ['Preview skill ', '预览 skill '], ['Remove skill ', '移除 skill '],
    ['Preview ', '预览 '], ['Remove ', '移除 '], ['Confirm delete ', '确认删除 '], ['Cancel delete ', '取消删除 '],
    ['Duplicate ', '创建副本：'], ['Export ', '导出 '], ['Edit ', '编辑 '], ['Delete ', '删除 '],
  ] as const) if (text.startsWith(source)) return target + text.slice(source.length);
  // Dynamic accessible names (for example the context summary) reuse the same patterns as the
  // visible text; a value no pattern matches is returned unchanged.
  return progress(text);
}

interface Original { source: string; rendered: string }
/** Translate only known UI surfaces. Source text and user-defined names stay in their original language. */
export function mountUILocale(root: Element): { update(language: UILanguage): void; dispose(): void } {
  let language: UILanguage = 'en'; let disposed = false;
  const texts = new WeakMap<Text, Original>(); const attributes = new WeakMap<Element, Map<string, Original>>();
  const protectedContent = (node: Element) => !!node.closest(CONTENT);
  const original = (current: string, previous: Original | undefined): string => previous?.rendered === current ? previous.source : current;
  const localize = (source: string, node: Element, attribute: boolean): string => {
    if (language === 'en') return source;
    const text = source.trim(); let translated: string;
    if (attribute) translated = actionLabel(text);
    else if (node.matches('.zchatgpt-message-meta')) {
      const status = /^(Recorded|Responding…|Stopped|Failed|Queued|Cancelled before sending|Unconfirmed: the connection was interrupted\. The request was not sent again\.)( · .+)?$/u.exec(text);
      translated = status ? COPY[status[1]!]! + (status[2] ?? '') : text;
    } else translated = COPY[text] ?? progress(text);
    return translated === text ? source : source.slice(0, source.indexOf(text)) + translated + source.slice(source.indexOf(text) + text.length);
  };
  const candidates = (scope: Element, selector: string) => [...(scope.matches(selector) ? [scope] : []), ...scope.querySelectorAll(selector)];
  const apply = (scope: Element) => {
    if (protectedContent(scope)) return;
    for (const node of candidates(scope, TEXT)) {
      if (protectedContent(node) || node.closest('.zchatgpt-workspace-chip') || node.matches('[data-zchatgpt-picker],[data-zchatgpt-setting="model"]')) continue;
      for (const child of node.childNodes) {
        if (child.nodeType !== 3) continue;
        const text = child as Text; const source = original(text.data, texts.get(text)); const rendered = localize(source, node, false);
        texts.set(text, { source, rendered }); if (text.data !== rendered) text.data = rendered;
      }
    }
    for (const node of candidates(scope, ATTRIBUTES)) {
      if (protectedContent(node) || node.matches('[data-zchatgpt-setting="model"]')) continue;
      const saved = attributes.get(node) ?? new Map<string, Original>(); attributes.set(node, saved);
      for (const name of ['aria-label', 'title', 'placeholder']) {
        const current = node.getAttribute(name); if (current === null) { saved.delete(name); continue; }
        const source = original(current, saved.get(name)); const rendered = localize(source, node, true);
        saved.set(name, { source, rendered }); if (current !== rendered) node.setAttribute(name, rendered);
      }
    }
  };
  const Observer = root.ownerDocument.defaultView?.MutationObserver;
  const observer = Observer ? new Observer(records => {
    if (disposed || language === 'en') return;
    const scopes = new Set<Element>();
    for (const record of records) {
      const node = record.target.nodeType === 1 ? record.target as Element : record.target.parentElement;
      if (node && root.contains(node) && !protectedContent(node)) scopes.add(node);
    }
    for (const scope of scopes) apply(scope);
  }) : null;
  observer?.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'title', 'placeholder'] });
  return {
    update(next) { if (!disposed) { language = next; apply(root); } },
    dispose() { if (disposed) return; observer?.disconnect(); language = 'en'; apply(root); disposed = true; },
  };
}
