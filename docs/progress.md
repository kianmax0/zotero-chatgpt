# zotero-chatgpt：进度与证据索引

> 文档类型：证据和缺口，不是产品规格。更新日期：2026-09-28。
> 首节记录 Linux Agent 用户复测结果，其后保留运行时修复、仓库收尾与最终开发包、 Chat 网页修复、用户 UI 反馈、重构验收及有引用价值的修复、测试、发行与失败历史；历史结果不自动继承到当前候选。已移除过期的“当前候选”快照和重复状态矩阵。状态只用 PASS / FAIL / BLOCKED / NOT RUN。

产品要求见 [zotero-chatgpt-user-flow.md](zotero-chatgpt-user-flow.md)，架构见 [module-design.md](module-design.md)，命令与状态定义见 [development.md](development.md)。

## 2026-09-28 用户实测：Linux Agent 登录与使用

用户在 Debian x86_64 / Zotero 10.0.3 上复测代理继承开发包，XPI SHA-256 为 `66b737337eac208ae05ecd1587eb95c9977d43e6eea33cf55daeb4d96104634a`。首次仍返回相同 403；只读排查确认已安装该包，但 Zotero 与 Agent 进程均没有代理环境变量。桌面手动代理设置没有自动转为进程环境，因此插件没有可继承的值。按现有桌面代理配置，通过带代理环境变量的启动脚本启动 Zotero 后，用户反馈“现在可以登陆了，并且我测试能正常工作了”。个人启动脚本只保留在本地交付目录，不纳入仓库。

| 场景 | 状态 | 证据与范围 |
| --- | --- | --- |
| Agent 官方登录 | PASS | 用户本人手动登录并反馈成功；不是开发助手执行的自动认证测试。 |
| Agent 基本使用 | PASS | 用户手动测试并反馈正常工作；未提供逐项操作清单，不外推为所有原生动作已验收。 |
| 高亮、获取、整理等完整原生写入与撤销流程 | NOT RUN | 本次反馈未逐项确认这些场景。 |

本次仅补充证据文档，产品代码与上述 XPI 不变；对应离线门禁及 59/59 无模型宿主结果见下一节。保留此前 403 失败记录。本轮完成自审，未进行独立审查；用户已授权本地 Git 提交，未执行 push、PR 或发布。

## 2026-09-27 Agent 继承代理环境变量

用户在上一轮开发包完成浏览器认证后报告 `token_exchange_failed`，服务端返回 `403 Country, region, or territory not supported`。这是实际登录 FAIL，不能以先前未登录宿主 PASS 宣称端到端已完成。源码确认 Agent 的环境白名单未传递代理变量；用户明确要求继承它们，本轮只增加这项网络配置传递，不对地区限制或实际登录结果作保证。

Agent 准备时经 Gecko `Services.env.get` 读取 Zotero 进程的 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY` 及各自小写形式；非空值原样传递，大小写优先级和绕过规则留给运行程序处理，重试时重新读取。保持 `environmentAppend:false` 和私有 HOME/CODEX_HOME，不继承其它变量，不记录代理地址/凭据、不写入 profile 配置。普通 Chat/路径计算不读取代理或准备 Agent。

| 层级 | 状态 | 证据与范围 |
| --- | --- | --- |
| 修复前回归 | FAIL | 新代理继承用例 1 FAIL，旧 5 PASS，保留 `proxy-red.log`。 |
| 类型、lint、完整单测 | PASS | `npm run typecheck`、`npm run lint`、`npm run test:unit -- --maxWorkers=1`：114 files / 1533 PASS / 1 原平台条件跳过。覆盖八个变量、大小写冲突原样保留、NO_PROXY、空值、重试读取和其他变量不继承。 |
| 构建、产物 | PASS | `npm run package:dev`、`npm run verify:artifacts`，88 files；SHA-256 `66b737337eac208ae05ecd1587eb95c9977d43e6eea33cf55daeb4d96104634a`，208756431 bytes。 |
| 真实 Gecko → Codex 环境传递 | PASS | `context-runs/proxy-env-20260927/proxy-inheritance-report.json`。仅向自启的全新专用 Zotero 注入八个合成代理值，按专用 profile 的可执行路径匹配 Codex，确认八项值一致、OPENAI_API_KEY/PATH/NODE_OPTIONS 不存在。只输出布尔和计数，不读取用户真实代理或认证。 |
| 最终 XPI / Zotero 10.0.3 无模型宿主 | PASS | 同目录 `host-report.json`，59/59、模型请求 0，含 Chat 零进程/零准备与 Agent 惰性启动、Reader/文库/设置启停。 |
| 实际代理连通、官方登录和模型问答 | NOT RUN | 本轮宿主仅使用合成代理，未验证用户实际出口，不登录、不读取认证、不请求模型。用户需在获得代理环境的 Zotero 中重新完成官方登录。地区限制错误是否解除仍待验证。 |

证据保存在 `.zotero-chatgpt-dev/verification/proxy-env-20260927/`。完成 diff 自审与 `git diff --check`，未进行独立审查。未安装到日常 profile、未 commit/push/PR。此包取代上一个 Linux 测试包用于后续登录测试；保留旧包及其证据。


## 2026-09-27 Debian Agent 随包运行时与 Zotero 10 兼容

基线 `4d1c637`，分支 `fix/linux-agent-runtime`，未提交工作树。原 Chat Google 登录 PR #4 已合并，本轮独立处理 Agent。用户旧包在 Linux 报 `Unable to prepare the bundled Codex runtime`；当前上游虽有 Linux 分支，却依赖系统 CLI 并导入其他客户端认证。现在随包提供固定 0.156.1 的 Darwin arm64 与 Linux x86_64-musl 官方资产，按 Gecko OS/ABI 选择并校验，保留 Mac 缓存路径；两平台统一私有 HOME/CODEX_HOME，去除系统程序查找及凭据复制，严格核对协议版本。不会删除已有 profile 中的认证文件。

本机 Zotero 已为 **10.0.3**；第一次隔离加载发现产品与 driver 的 `strict_max_version: 9.0.*` 导致 `appDisabled`。经用户明确选择，产品兼容范围改为 **9.0.6–10.0.x**，driver 跟随产品声明。平台声明不是所有组合已实测；本轮只在 Debian x86_64 / Zotero 10.0.3 验证宿主，Mac 与 Zotero 9 宿主 NOT RUN。

运行资产来源与两个 SHA 见 `runtime/manifest.ts` 和 `runtime/README.md`。GitHub 官方 Linux 归档 digest 与下载内容一致；可执行文件为静态 ELF，发布 XPI 不依赖 Node。统一 XPI 包含两个目标，体积增加，但每个 profile 只提取本平台程序。Chat/Agent 登录分离与惰性连接不变。

| 层级 / 场景 | 状态 | 证据与限制 |
| --- | --- | --- |
| 修复前回归 | FAIL | `prepare.test.ts` 新增两条用例在旧实现分别因系统 CLI 路径与错误平台校验失败；原 3 条 PASS。保留 `linux-red.log`。 |
| 完整离线门禁 | PASS | `npm run typecheck`、`npm run lint`、`npm run test:unit -- --maxWorkers=1`：114 files / 1532 PASS / 1 平台条件跳过（Apple codesign）。未调整 timeout 或跳过失败用例。 |
| 构建和最终 XPI | PASS | `npm run package:dev`、`npm run verify:artifacts`。`dist/zotero-chatgpt-0.1.1-dev.xpi`，208756304 bytes，88 files，SHA-256 `e538914306540eee461327834a36255baa3f4b017f816b11ba1e5e68b46f1eb2`。另逐项解压核对两个运行程序的大小和 SHA。 |
| 真实 Linux Codex 协议 | PASS | `.zotero-chatgpt-dev/linux-protocol-20260927/report.json`：生产 prepare/client/protocol，Node child-process 适配，版本/配置校验通过，`ready`、`signedOut`、模型目录 7 项，0 模型请求。这不是 Gecko transport 的替代证据。 |
| 候选包 Zotero 10 安装/启停 | PASS | `.zotero-chatgpt-dev/s6-virgin/host-report.json`，候选 SHA `44eee70eb38dbe90bb202e5a0259026c0a24b1b5a0e09ec31044f06dbc66fa79`：15 项 PASS、3 项 NOT RUN。专用合成库，1 个私有 Codex 进程，未登录，登录控件存在，禁用停止进程、同版本重载和本地记录保留。版本升级/回退与模型发送未执行。该候选与最终包差别是移除 core 剩余的 `system` 版本例外。 |
| 最终包 Zotero 10 用户路径 | PASS | `.zotero-chatgpt-dev/context-runs/linux10-final-20260927/host-report.json`：最终 XPI / Zotero 10.0.3，59/59 检查通过，0 模型请求。Chat 冷启动无 Codex 进程和私有运行目录，显式 Agent 启动；覆盖文库/Reader 入口、草稿与附件隔离、侧栏尺寸、原生 PDF 上下文与设置启停。此结果不等于官网问答或真实模型验证。 |
| 真实 Agent 登录、模型问答/原生动作 | BLOCKED | 需要用户本人通过 Agent 的独立官方登录后测试；本轮没有读取/迁移凭据、登录或调用模型，也没有安装到日常 profile。 |
| Mac 宿主、Zotero 9 宿主、完整视觉/IME、多窗口、版本升级/回退 | NOT RUN | Mac 资产及回归仍受构建和单测校验；不能继承旧宿主 PASS。 |

早期离线失败均保留：双平台 fixture 增加 Linux 资产后，包清单断言漏列新文件（已补）；一次安装测试超过原 5 秒限制（构建并行期间），后续串行门禁按原限制重跑；宿主脚本测试夹具只提供 version，补齐兼容字段后 34/34 PASS。本轮是自审，核对 diff 与产物，未进行独立审查。未 commit、push、建 PR 或发布。

证据目录：`.zotero-chatgpt-dev/verification/linux-agent-20260927/`，保留 red/中间失败与 final 日志；专用宿主报告按各自 XPI 身份区分。日常文献库与认证未作为测试对象。


## 2026-09-27 仓库收尾与当前开发包

本轮在 `9c9f3f0` 工作树上审查并纳入已有 UI、页面桥、偏好注册与宿主测试改动，修正文档和营销源文件归档；文库 Agent 输入时只更新草稿相关控件，不再逐字重建消息、模型选项和历史列表。回归先观察到旧实现会替换已有消息 DOM，再验证修复后消息节点保持原身份。独立审查又发现未知官网编辑器的未标注发送控件可能绕过上下文门禁；回归先 FAIL，再收紧为有草稿时拦截所有外部点击、提交与非 IME Enter。旧 schema、任务账本和 Chat/Agent 执行边界没有为清理而删除。营销成片、截图、图片、Word 导出和视频制作浏览器 profile 只保留在本地；仓库只收制作源文件。已过时的 65 秒提示、清单和 manifest 移至本地忽略目录，未进入 Git。

| 层级或场景 | 状态 | 本轮证据与限制 |
| --- | --- | --- |
| 静态与单测 | PASS | 最终 `npm run typecheck`、`npm run lint`；打包后 `npm run test:unit -- --maxWorkers=1` 为 114 files / 1521 tests。文库输入回归先 FAIL，修复后定向 19 tests PASS；未知官网发送控件回归也先 FAIL、修复后 PASS。`git diff --check` PASS。 |
| 开发包与发行计划 | PASS | `npm run package:dev`、`npm run verify:artifacts`：`dist/zotero-chatgpt-0.1.1-dev.xpi`，87 files，SHA-256 `971867097927ee29f399b5f45b1633b3c8f7f512cfd628643ce22c3880c95205`。`npm run release:dry-run` 仅生成同一 hash 的本地计划，未发布。 |
| 当前开发包无模型宿主 | PASS | Zotero 专用 `.zotero-chatgpt-dev/context-runs/wrapup-final-20260927/`，`host-report.json` 59/59，绑定同一 XPI hash 与 driverSourceHash `8809f0ed323ef1146fb2cc36685a475e40f616f73e9d2440d5f3718bcb81a27f`；recordedRequests=0。先前 `wrapup-20260927/` 的 59/59 对应旧 hash `48001ae8…`，只作为历史报告保留。设备、样本和性能口径见报告，不能据此推断真实服务。 |
| 当前开发包官网嵌入探测 | FAIL | `.zotero-chatgpt-dev/embed/host-report.json` 对同一最终 XPI 执行 10 项检查，其中 `product-official-chat-actor-reaches-the-composer` 未通过：官网提供 `textarea#pending-home-input`，actor 报 `unsupported-composer`，没有已知发送按钮。旧报告另存为 `host-report-before-wrapup-20260927.json`。该探测没有输入账号、没有发送问题，也没有读取回答正文。 |
| 营销源文件 | PASS | 嵌套 Remotion `npm run assets` 从本地素材准备 12 个资源，`npm run check:copy` 检查 31 条文案通过。Git 源文件本身不含演示视频和截图，单凭 checkout 无法独立出片。 |
| 当前 XPI 的真实 ChatGPT 文献问答 | BLOCKED | 这次官网嵌入探测未识别受支持的输入框，所以没有继续提交带随机合成文献上下文的问题；`conversation-send` 在报告中为 NOT RUN。不能以页面可见或 9 项其它检查通过替代真实回答。 |
| 真实 Codex、升级/回退与正式发行 | NOT RUN | 本轮未登录、未发模型请求，也未做最终 XPI 升级/回退与无 Node 安装。用户选择整理已有 GitHub Release，不发布新版本；v0.1.1 的已发布资产不等于本轮开发包。 |

性能优化验证的是逐字输入不再重建 transcript 的结构性成本；未做输入延迟基准，因此不报告速度提升百分比。源码与本轮离线/无模型宿主检查不能代替真实 ChatGPT 文献上下文或真实 Agent 写入验收。

## 2026-09-27 Chat 网页鼠标命中修复

隔离宿主先前在官网 `textarea#pending-home-input` 状态测得 actor `unsupported-composer`；`chat/embed.ts` 因此把整个网页 browser 设为 `pointer-events: none`，导致页面可见但鼠标无法命中。该轮在受限 actor 响应 `unsupported-composer` 后恢复网页点击，但当时只拦截可识别的发送意图；本页上方的仓库收尾轮进一步修复了未知发送控件的缺口。当前规则是未知编辑器为空时网页可点击，有草稿时外部点击、提交与非 IME Enter 都由 actor 拦截，并显示失败提示。受控文献上下文提交仍要求受支持的编辑器。未修改 Chat/Agent 路由、认证或 Zotero 写入权限。

| 层级或场景 | 状态 | 本轮证据与限制 |
| --- | --- | --- |
| 回归与离线门禁 | PASS | `embed-surface.test.ts` 在修改前复现 `none`（1 FAIL / 27 PASS）；未知编辑器的表单外 Send 控件回归也先 FAIL、修复后 PASS。最终 `npm run typecheck`、`npm run lint`、`npm run test:unit`（114 files / 1519 tests）、`npm run package:dev`、`npm run verify:artifacts`、`git diff --check` 均 PASS。最终开发 XPI `dist/zotero-chatgpt-0.1.1-dev.xpi` 为 87 files，SHA-256 `119e673fa02e6f4bd296cea69871192f0290aa3ff1eb70dd74e4098901b185d1`。 |
| 真实 Zotero 网页命中状态 | PASS | 最终包 `.zotero-chatgpt-dev/embed/host-report.json`（专用 profile、合成 PDF、driverSourceHash `637f1766…`）在 `unsupported-composer` 下测得 browser 的内联与计算后 `pointer-events: auto`，窗口中心命中 browser；新增宿主断言同时检查两者并 PASS。未执行官网控件的人工鼠标点击。此前候选包报告按原名保留，不继承为最终包证据。 |
| 官方 ChatGPT 输入与真实回答 | BLOCKED | 同一最终宿主报告在 60 秒内观察到官网 `div[role=textbox][contenteditable=true]`，其 form 有 3 个按钮，但没有受支持的发送按钮；actor 为 `unsupported-composer`，完整 embed 阶段因 `product-official-chat-actor-reaches-the-composer` FAIL。未发送模型请求、未读取账户或 transcript，网页可命中不等于文献上下文已交付或真实回答成功。 |
| 日常 Zotero 安装与用户实际点击 | NOT RUN | 本轮只打包并加载到 `.zotero-chatgpt-dev/embed/` 专用 profile；未更新日常 profile，也未操作其中的网页。 |

独立只读审查指出的两处缺口（宿主断言未检查实际命中、表单外明确 Send 控件未拦截）均已补回并复审，无新的阻断发现。审查本身不替代上述宿主报告。

## 2026-09-27 用户反馈：UI 问题盘点

以下四项是用户在真实使用后直接提出的体验问题，记录为反馈，不借此前无模型宿主 PASS 宣称视觉体验已通过。本节先保留原意，后续源码与界面盘点的发现另列，并区分可证实的机制和待实机复核的判断。

1. `Paper & context details` 功能及其入口多余。
2. 主界面与 Reader 界面的按钮功能和 UI 设计不一致。
3. 界面文字太多。
4. Agent 模式的设计观感差。

### 当前工作树的源码盘点

与上述反馈直接相关的机制：Reader 的 `More` 菜单在 Agent 模式只剩 `Paper & context details` 一个入口，却再打开第二层面板；该面板还承载“重新读取 PDF”和当前引用的“返回原文”，所以删除入口前须安置这些实际动作（`packages/zotero/src/chat/view.ts:704-708, 1623-1647`）。Reader 的 PDF 图标复制文件供用户粘贴到 ChatGPT，文库的 PDF 图标直接打开附件；Reader 的两项 ChatGPT 复制动作在 Agent 中仍常驻（`chat/view.ts:673-679, 1694-1708`；`views/library-agent-workbench.ts:171-173`）。文字密度来自 Reader 首次外发长说明、文库 Chat 常驻说明、Agent 空状态标题/说明和 Preferences 补充说明，并非单一字号问题（`chat/view.ts:240-242`；`views/library-agent-workbench.ts:181-182, 317-321`；`preferences/pane.ts:221-224`）。Reader 与文库 Agent 还分别使用模型弹出按钮和原生下拉框，文库图标在窗口宽度小于 1100px 时缩到 24×26px（`chat/view.ts:907-916`；`views/library-agent-workbench.ts:134, 215`）。这些结构差异可从源码确认；“丑”的具体视觉表现仍以用户观察为准，本轮未取得当前 XPI 的截图级复核。

| 优先级 | 另发现的用户问题 | 源码依据与证据界限 |
| --- | --- | --- |
| 高 | 官方 ChatGPT 页面现在可点击，但当前隔离宿主仍未识别可支持的输入框；插件带文献上下文的正常提问链路尚未走通。 | 本文 §“Chat 网页鼠标命中修复”的最新报告记录 `unsupported-composer`、无已知发送按钮，真实回答为 BLOCKED；可点击只证明鼠标命中，不证明提交成功。 |
| 高 | 切到 Chat 后，正在运行或等待审核的 Agent 工作缺少稳定的公共提示，用户可能误以为任务已停止或消失。 | Reader 普通任务在 Chat 被过滤，阅读任务另走一条显示条件；模式开关没有运行状态（`chat/view.ts:1675-1677, 2219-2223, 2255-2256, 2361-2362`）。源码确认显示路径不同；实际视觉仍待复核。 |
| 高 | 在文库点击“整理选中条目”时，即使没有选中条目也能准备并发送；缺少范围的校验发生在 Codex 模型返回后，可能消耗一次无用轮次。 | 起步按钮无选中项检查（`views/library-agent-workbench.ts:184-196`）；`sendLibraryAgentMessage` 先于 `intent.kind === 'organize'` 的空范围拒绝（`library/agent-orchestrator.ts:193-210, 234-235`）。这是源码顺序结论，实际模型请求未运行。 |
| 高 | 在常见窄主窗口中，文库 Chat 的当前文献标题被隐藏；切换 Zotero 选中项后，用户难以从插件确认下次提问绑定哪篇文章。 | Chat 把文献名写入标题，但 `@media (max-width:1100px)` 隐藏整个标题（`views/library-agent-workbench.ts:134, 316-321`）；选中变化会刷新绑定（同文件 `323-340`）。身份冻结逻辑不因此失效，问题在发送前可见性。 |
| 中 | 文库 PDF 按钮在没有合格选中项时仍看起来可点，点后才报“选一篇有 PDF 的文章”。 | 禁用条件只看是否提供回调（`views/library-agent-workbench.ts:534-535`），回调在零项、多项或无唯一 PDF 时才拒绝（`index.ts:698-706`）。源码确认，具体外观未复核。 |
| 中 | 文库 Agent 回答直接显示原始文本，Reader Agent 则解析 Markdown、数学公式和来源链接；相同服务的回答呈现质量不同。 | 文库用 `textContent` 填入 `line.text`（`views/library-agent-workbench.ts:374-378`），Reader 调用 `renderAnswer`、来源链接和代码块处理（`chat/view.ts:1518-1525`）。源码确认渲染路径不同，尚无当前版本的回答截图。 |
| 中 | 文库 Agent 未登录或没有模型时，模型下拉框显示“Sign in for models”但被禁用；发送按钮只依据问题是否为空启用，恢复动作与主要动作分离。 | `views/library-agent-workbench.ts:381-386, 447-450`；最终登录/模型错误由 `library/agent-orchestrator.ts:193-201` 抛出。源码确认控件状态，实际视觉未复核。 |
| 中 | Preferences 的语言、字号、模型及上下文开关即时保存，但 Agent instructions 需额外按 Save；离开页面前没有发现未保存内容的拦截。 | `preferences/pane.ts:571-592, 600-606`，`preferences/entry.ts:91-93`。源码确认两种保存规则；关闭窗口丢稿尚未实机复现。 |
| 中 | 文库 Agent 的“跳转到消息”只覆盖当前会话最近 30 条，仍缺少查找、重开和继续不同文库 Agent 会话的真正历史入口。 | `views/library-agent-workbench.ts:348-359`；稳定的单一 library session ID 见 `index.ts:121-126`。这是功能范围缺口，当前入口已改名避免误称历史。 |

以上问题盘点只做文档记录和源码检查；没有修改产品 UI、重跑宿主或请求真实模型。下节 UI 重构的 59/59 无模型检查只证明当时列出的 DOM/几何与流程断言，不构成这些使用体验的 PASS。现有产品规格 UI-01/UI-02 仍将 `Paper & context details` 和两项复制按钮写作目标；它们与这次用户反馈冲突，后续设计需连同必要的上下文状态、重读和返回原文入口一并修订，不能把旧规格视作本次反馈的否决理由。

## 2026-09-27 用户路径 UI 重构

本轮按产品文档的设计原则调整 Reader 与文库工作区的展示和操作，不改变 Chat/Agent 路由、写入权限、schema 或运行时。文库 Chat/Agent 头部只显示各自相关的工具；当前对话消息跳转不再冒称会话历史；文库 Agent 空状态聚焦输入并保留两项常见任务建议，Enter 发送、Shift+Enter 换行且 IME 组合不发送。新空状态文案随界面语言切换，Chat 区域的辅助技术名称也改为 ChatGPT。文库布局按条目区实际宽度堆叠，Reader 极窄侧栏的头部可分两行并保留复制按钮命中区。Preferences 说明同一开关对 Reader Chat 书目摘要、Reader Agent PDF 文本的不同作用，以及文库 Chat 的独立开关。无 Chat 通道时的文案不把 Agent 描述为等价替代。

| 层级或场景 | 状态 | 本轮证据与限制 |
| --- | --- | --- |
| 静态、单元与产物 | PASS | `npm run typecheck`、`npm run lint`、`npm run test:unit -- --maxWorkers=1`（114 files / 1519 tests）、`npm run package:dev`、`npm run verify:artifacts` 均通过。最终开发 XPI `dist/zotero-chatgpt-0.1.1-dev.xpi`：87 files，SHA-256 `2b15cafa1e9b089f13951c242066683d6e7a30bbd2d12d39f39807cecc819139`。 |
| 独立 Zotero 无模型用户路径与布局几何 | PASS | 最终 `.zotero-chatgpt-dev/context-runs/ui-refactor-20260927-e/host-report.json`：Zotero 9.0.6、1000×600 主窗、59/59、记录的模型请求 0，driverSourceHash `8809f0ed…`，绑定上述最终 XPI。实测文库 Chat 工具可见性、443px 条目区时上下堆叠，以及 Reader 约 291px 可用宽度下两行工具栏、32px 按钮和菜单落点；合成资料只写入专用 profile。此前 XPI `943b5081…` 的 `ui-refactor-20260927-d/` 与 `87ae2cac…` 的 `ui-refactor-20260927-c/` 均为 59/59，不继承为最终产物证据。 |
| 前次窄宽度检查驱动 | FAIL | 较早包 `87ae2cac…` 的 `.zotero-chatgpt-dev/context-runs/ui-refactor-20260927-b/host-report.json` 在 16 项通过后超时：驱动只改 CSS 自定义变量，而产品实际把 dock 宽度以内联 `width` 和 `flex-basis` 固定。保留失败报告；改为临时调整同一布局属性并在检查后恢复，才得到后续 PASS。更早包 `5b8b2cda…` 的 `ui-refactor-20260927-a/` 为 56/56，未覆盖窄宽度检查。 |
| 截图级视觉、主题、放大字号、真实 IME 与多窗口 | NOT RUN | 宿主报告提供 DOM 和几何证据，没有取得同尺寸截图或人工焦点/滚动检查；键盘与 IME 只有 DOM 回归，不能外推为真实输入体验。 |
| 官方 ChatGPT 回答、Codex 候选与真实文献库 | NOT RUN | 本轮没有登录、发送模型请求或操作日常 Zotero 文献库。此前记录的真实 Chat 阻塞不因 UI 修改自动解除。 |

测试用独立实例在报告完成后按完整 profile 路径核对并停止。此轮未提交、发布或安装到日常 profile。

## 2026-09-27 新开发包后台宿主验收

验收产物仍为下节 SHA-256 `e30682ebcb726b86db71ed6bb2ef63cab65e46c3d860c4a59e886000ab7c691e`。使用 `open -n -g` 启动独立 Zotero 9.0.6 实例及 `.zotero-chatgpt-dev/` 专用 profile/data；只停止完整参数匹配的自启进程，日常 Zotero 未作为测试对象。所有宿主报告以实际 XPI hash 和 driverSourceHash 区分；没有把失败重跑覆盖。

| 用户场景 | 状态 | 本轮证据与限制 |
| --- | --- | --- |
| 文库/Reader 默认 Chat、显式 Agent、草稿与附件身份、PDF 引用跳页、设置启停 | PASS | 最终无模型 `context-runs/accept-e306-userpath-20260927/host-report.json` **56/56**。驱动先打开 `More → Paper & context details`，确认引用按钮可见再点击，原生 Reader 返回所引页；Preferences 启停后面板数 1→0→1。较早 `accept-e306-hidden-20260927/` 和 `accept-e306-background-20260927/` 均在直接点击折叠面板内隐藏引用按钮时 FAIL（36 项），随后同包旧驱动的 `accept-e306-background-r2-20260927/` 55/55 PASS；旧 XPI `e3216ba5…` 对照 55/55 PASS。失败为不符合用户路径的驱动点击及间歇性证据，原报告保留，不宣称产品导航始终无问题。 |
| 原生动作、公开主题发现与 DOI 获取 | PASS | `context-runs/accept-e306-acquire-20260927/host-report.json` **24/24**。合成条目高亮/整理等原生阶段通过；OpenAlex 固定主题返回 3 个 OA 候选，未写库。独立固定公开 DOI `10.1371/journal.pone.0345574` 经 Zotero translator 预览、审批前零条目写入、批准后原生条目和目标集合读回，以及 OA PDF 附件父条目/MIME/SHA-256 读回均通过。主题结果**未包含**该 DOI，因此这两段不能合称为“从搜索结果保存”。此驱动打包工作树适配器，不能证明已安装 XPI 的模型/UI 路由。 |
| 官方网页 Chat：复制信息、复制 PDF 文件（旧驱动实测） | PASS | 固定报告 `.zotero-chatgpt-dev/verification/accept-e306-20260927/embed-e306-clipboard-probe-report.json` 绑定 XPI `e30682eb…` 与旧 driverSourceHash `b7f16a32…`，15 项白名单检查通过：书目信息只含合成标题/作者、不含 PDF 正文；PDF 文件进入文件型剪贴板，界面提示“PDF copied — paste to attach”。测试夹具原先缺作者、驱动原先硬查旧英文 `clipboard` 文案，两个失败报告也已归档。复制成功不代表官网已接收附件。当前驱动默认跳过共享剪贴板检查，修订后这两项宿主验收 NOT RUN，不能把旧 PASS 当作安全默认分支的重测。 |
| 官方网页真实提问与回答 | BLOCKED | 同一固定 embed 报告：`https://chatgpt.com/` 内仅观察到 `pending-home-input` textarea，发送按钮数 0，产品 actor 为 `unsupported-composer`；等待后仍未达到发送准备态，**0 模型轮次**。未发送问题、未读取账号或远端 transcript；不能区分官网加载/认证状态与页面结构变更，不把页面 URL 已打开报为 Chat 成功。 |
| Agent 真实 Sol/Luna 高亮与文库整理 | BLOCKED | `.zotero-chatgpt-dev/live/host-report.json` 的新 XPI 运行时 ready，但专用 profile 为 `signedOut`，驱动进入官方登录等待；没有点击登录或发送模型请求，随后仅停止自启实例。新 XPI 的真实模型候选、审批及写入读回仍未验收。 |
| 截图级布局、深浅主题、字号、IME、焦点与多窗口 | NOT RUN | 后台自动驱动检查了若干 DOM/几何和 PDF 锚点，但没有取得同尺寸多主题截图或在可操作窗口完成这批人工步骤；不能把 56 项无模型检查外推为完整视觉体验 PASS。 |
| 测试对共享剪贴板的隔离 | FAIL | embed 驱动的复制控件测试曾写入 macOS 共享剪贴板，与用户“不打扰其他任务”的要求冲突。发现后停止该阶段；没有读取或尝试恢复用户随后使用的剪贴板内容。驱动现默认跳过复制检查，仅显式 `--clipboard-probe` 才运行，且开发文档标明不得用于后台验收。此修订不能抹去已经发生的共享剪贴板写入。 |

本轮没有提交、安装到日常 profile 或发布。真实 Chat 与 Agent 的两处阻塞及截图级项目仍未完成验收。
验收驱动修订后的最终后台门禁：`npm run typecheck`、`npm run lint`、`npm run test:unit -- --maxWorkers=1`（114 files / **1515 tests**）与 `git diff --check` 均 PASS；产物复核 `npm run verify:artifacts` PASS（87 files），XPI SHA 仍为 `e30682eb…`。

## 2026-09-27 后台修复候选

基于下节用户路径盘点，本轮只处理文库整理的候选边界、文库 Chat 初始化报错与 Preferences 跨启用周期的注册清理。仍在 `main` 工作树，manifest `0.1.1`；原有 `.gitignore`、`tests/host/embed-driver.js` 及营销文件改动保留，未提交或公开发布。本轮重新打包的开发 XPI `dist/zotero-chatgpt-0.1.1-dev.xpi` 为 99,599,410 bytes，SHA-256 `e30682ebcb726b86db71ed6bb2ef63cab65e46c3d860c4a59e886000ab7c691e`，与下节原候选 `e3216ba5…` 不同。

| 层级或用户场景 | 状态 | 本轮证据与边界 |
| --- | --- | --- |
| 文库 Agent 整理预览 | PASS | 新增真实 `ActionTaskController` 回归：带显示 `name` 的集合原先被严格 native target 校验拒绝（RED），现在仅把 `clientId/libraryId/collectionKey` 传给任务控制器，预览进入 review（GREEN）。保留模型输入中的显示名称与冻结索引。旧 Silver 失败的原始模型输出没有安全结构化记录，故不能证明它当时只有这一处原因；当前真实模型轮次 NOT RUN。 |
| 文库 Chat 初始化失败与重开 | PASS | 两条 DOM 回归原先分别表现为同步抛错后 `role=alert` 隐藏、成功重开后旧错误仍显示（RED）；现均通过（GREEN）。真实 Zotero/官网故障频率 NOT RUN。红测日志保存在 `.zotero-chatgpt-dev/verification/ux-background-20260927/chat-error-red.log`。 |
| Preferences 旧注册与新启用交错 | PASS | 按本机 Zotero 9.0.6 `omni.ja` 的 `preferencePanes.js` 顺序构造两条异步 resolve/reject 回归：原 `remove()` 立即返回，旧代可按固定 ID 清掉新面板（RED）；现 `remove()` 等待在途注册，插件 `shutdown()` 等待清理，回归 GREEN。旧宿主超时报告缺终态 pane 数，不能证明其根因正是此竞态；新 XPI 的真实启停宿主验收 NOT RUN。测试 driver 已补白名单面板数量及时间序列，未采集原始错误文本。 |
| 本地门禁和产物 | PASS | `npm run typecheck`、`npm run lint`、`npm run test:unit -- --maxWorkers=1`（114 files / 1514 tests）、`npm run package:dev`、`npm run verify:artifacts`（87 files）均通过。 |
| 新 XPI 的真实 Zotero、ChatGPT/Codex 与截图级体验 | NOT RUN | 按用户要求本轮仅后台工作，未启动/控制 Zotero 窗口，未登录、发送模型请求或写入日常文献库。下节旧产物的宿主 PASS/FAIL 不继承为新 XPI 结果。 |

本节是代码与离线验证证据；正式判断 Preferences 间歇故障及真实整理是否解决，仍需在不打扰日常 Zotero 的独立可交互宿主条件下复测新 XPI。
独立只读 diff 审查未发现可操作的正确性或回归问题；审查没有运行宿主或服务。`git diff --check` PASS，已有用户未提交改动未被覆盖。

## 2026-09-27 用户路径测试盘点

本轮测试 `main` 的 `9c9f3f0`，manifest `0.1.1`，macOS arm64 / Zotero 9.0.6 / Node 24.11.0 / npm 11.6.1。测试前已有 `.gitignore`、`tests/host/embed-driver.js` 和未跟踪营销文件等改动，本轮没有修改产品源码或这些文件。重新打包的 `dist/zotero-chatgpt-0.1.1-dev.xpi` 为 99,599,253 bytes，SHA-256 `e3216ba5d519ab93986b0d935fbb0158a70b1c213e842c504a2127d9a5f2a7d8`，与测试前的开发 XPI 逐字节一致。宿主只使用新建的 `.zotero-chatgpt-dev/context-runs/audit-20260927-*/` 专用 profile 和合成资料；没有操作日常文献库。

| 用户场景或层级 | 状态 | 本轮证据与限制 |
| --- | --- | --- |
| 本地门禁和开发包 | PASS | `npm run typecheck`、`npm run lint`、`npm run test:unit`（114 files / 1509 tests）、`npm run package:dev`、`npm run verify:artifacts`（87 files）均通过。 |
| 打开文库/Reader、默认 Chat、显式切 Agent、切回、附件与草稿、PDF 阅读位置、设置语言 | PASS | 新专用 profile 的第二轮无模型宿主报告 `context-runs/audit-20260927-context-r2/host-report.json`：55/55，产物 SHA 如上，driverSourceHash `c8a575fd…`，记录的模型请求 0。包括主窗口无 PDF 入口、原生详情栏保留、同名附件区分和设置面板挂载；不代表官网真实回答或截图级视觉验收。 |
| 禁用再启用插件后打开 Preferences | FAIL | 第一轮 `context-runs/audit-20260927-context/host-report.json` 在前 54 项通过后，`pref-pane-single-after-reenable` 等待 30 秒超时。相同产物与 driver 的第二轮该项 PASS；故障目前呈间歇性，尚未确定是插件注册还是 Zotero 宿主时序。保留两个报告，不以重跑覆盖首次 FAIL。 |
| 整理预览/批准/撤销、原生高亮与 Figure 圈画读回 | PASS | `context-runs/audit-20260927-native/host-report.json`：20/20；只对隔离资料运行。原生驱动打包的是工作树生产适配器，候选为合成输入，不能证明已安装 XPI 的模型输出校验，也不能推翻下节真实 Silver 整理 FAIL。 |
| 独立人工窗口的截图级操作 | BLOCKED | 已准备并启动 `context-runs/audit-20260927-user/` 无 driver profile，但当前 UI 控制工具只绑定到同时运行的日常 Zotero 进程。未在日常文献库点击测试动作；关闭了自己的测试进程。窄/宽侧栏、深色主题、字号、IME 和多窗口视觉行为没有本轮人工验收。 |
| 真实官网 ChatGPT 回答、真实 Codex 候选、主题发现到 OA PDF 保存 | NOT RUN | 本轮没有登录、发送真实模型请求或执行外部 PDF 下载。Reader 的历史真实 Chat/Agent 演示见下节，不能冒充本轮复测；主窗口 Chat 完整官网链路与主题发现完整链路仍缺当前验证。 |

用户角度的待处理问题：先调查 Preferences 重启后的间歇性超时，再复现下节已记录的真实文库整理输入校验失败。主窗口 Chat 的真实回答、主题发现到 OA PDF 附件、窄窗/IME/多窗口属于验收缺口，不能从上述 PASS 推定成功。

### 同日后台用户场景复核

用户要求测试在后台进行，不打断其它桌面任务；本阶段只运行本地 Vitest 和源码/证据审查，没有启动、聚焦或操作 Zotero 窗口，也没有调用真实服务。

| 场景 | 状态 | 证据与结论 |
| --- | --- | --- |
| 文库工作区、官方 Chat 桥、Reader 焦点/尺寸、整理与请求恢复的定向回归 | PASS | `npm run test:unit -- <12 个相关测试文件> --maxWorkers=1`：12 files / 138 tests。它们是 DOM/适配器替身，不证明真实页面、模型与 Zotero GUI 体验。 |
| 主窗口 Chat 初始化同步失败时显示可恢复错误 | FAIL | 临时 DOM 复现使 `showChat` 同步抛错：面板已经打开，但 `role=alert` 仍隐藏。失败日志及临时用例副本保存在 `.zotero-chatgpt-dev/verification/ux-background-20260927/sync-chat-open-error.{log,test.ts}`；仓库测试文件已移除。生产包装器在 `libraryChat.show()` 报 `error` 时也会同步抛错，而工作区的 `.then().catch()` 只处理 Promise 拒绝。真实 Zotero 触发频率 NOT RUN。 |
| 延迟打开 Chat 后用户立即点回 Agent | NOT RUN | 延迟 `showChat` 的临时 DOM 替身会复现模式选择被后来完成的 Chat 覆盖；但当前生产包装器同步返回已兑现的 Promise，未发现真实用户点击可插入该延迟的证据，因此不列为当前已确认缺陷。探索日志保存在同一后台验证目录。 |
| 文库 Agent 的键盘、历史与窄面板体验 | NOT RUN | 源码显示文库 Agent 仅用 Cmd/Ctrl+Enter 提交且输入框没有该提示，Reader 原生输入提示 Enter 提交；文库“历史”仅导航当前记录的最近 30 条；堆叠布局以整个窗口 1150px 断点决定。实际 IME、窄文献区、主题和字号效果尚无本轮 GUI 实测，这些是待验证的体验风险，不报为视觉缺陷。 |

以上 FAIL 只覆盖隔离 DOM 的同步错误路径；没有修改产品代码。后台复核也未重新运行真实 Silver 整理、主窗口官网 Chat 回答或发现到 PDF 保存。

## 2026-09-24 README 与 Silver 论文演示

本轮只改 README、媒体与证据文档。使用用户提供的 Silver 等人 2016 年论文和隔离 `.zotero-chatgpt-dev/context-runs/readme-media/`；未操作日常文献库。五段 GIF 的来源、剪辑和产物 SHA 见 [media/sources.md](media/sources.md)。当前开发 XPI SHA-256 为 `e3216ba5d519ab93986b0d935fbb0158a70b1c213e842c504a2127d9a5f2a7d8`。

| 场景 | 状态 | 实测与边界 |
| --- | --- | --- |
| Chat 选区问答 | PASS | 登录后的官方 ChatGPT 页面接受 **More details** 送出的 Silver 论文选区与书目信息，并显示真实回答；[GIF](media/silver-chat-answer.gif) 为状态剪辑。 |
| Agent 论文问答 | PASS | 一次 GPT-6 Sol 请求完成，Reader 显示带页码链接的回答；[GIF](media/silver-agent-answer.gif) 略去 128 秒等待。 |
| Agent 原生高亮与定位 | PASS | 另一次 Sol 请求完成，任务 3/3 applied；Zotero 读回三条原生高亮，任务输出定位到第 484、485 页；[高亮](media/silver-agent-highlights.gif)、[定位](media/silver-highlight-navigation.gif)均为同任务的状态剪辑。 |
| Figure 1 圈画 | PASS | 一次 Sol 轮次生成五个候选；宿主退出后先在记录副本、再在停机的专用 profile 内以原请求身份对账并生成 review 任务，未重发模型轮次。产品界面批准两项后任务 2/5 saved；原生读回 2 个 image 区域与 2 个 ink 标注。[GIF](media/silver-figure-callout.gif)展示选区、审核和保存结果。 |
| 文库整理 | FAIL | 首次 Sol 轮次被历史标为 interrupted；确认结束后重试，第二轮模型输出已完成，但任务输入校验失败。Silver 条目没有新增标签，也没有可交付成功 GIF。 |
| 按主题发现并下载论文 | NOT RUN | 尚未执行真实发现、审核与 OA PDF 下载，README 未放此功能的演示 GIF。 |
| 完整宿主门禁与新 XPI 打包 | NOT RUN | 本轮是文档和实机演示，未重跑完整门禁或重新打包；上述 PASS 只绑定已安装的指定开发 XPI 与单项真实流程。 |

## 2026-09-23 仓库清理候选

本轮从 `2125cea` 建立 `codex/repo-cleanup-20260923`。删除未接入生产装配的旧文库整理轮次实现 `packages/core/src/library/organization.ts` 及其专属测试；当前文库 Agent 的整理、请求恢复和对账由 `packages/core/src/library/session.ts` 与任务控制器承担。旧 `pending-library-organizations/` 记录只由被删除模块读取，此路径不再支持恢复。另去掉四个经 TypeScript 未使用诊断确认的参数或属性及其调用实参，未改变 Chat / Agent 产品边界、持久化格式或运行时 pin。

删除与可靠高亮自动执行流程不一致、且已无产品文档引用的旧示意图两份；删去过期候选快照和重复状态汇总，保留历史 PASS/FAIL 结果及报告索引。修正运行时 pin 注释和 Linux 支持的历史措辞。

| 层级 | 状态 | 本轮证据与边界 |
| --- | --- | --- |
| 静态与单元 | PASS | `npm run typecheck`、`npm run lint`、`npm run test:unit -- --maxWorkers=1`：114 files / 1509 tests / 0 skipped。删除前基线为 115 files / 1517 tests；减少的 8 项仅属于已删除的孤立模块测试。额外 `tsc --noEmit --noUnusedLocals --noUnusedParameters` PASS。 |
| 打包与产物 | PASS | `npm run package:dev`、`npm run verify:artifacts`：87 files；`dist/zotero-chatgpt-0.1.1-dev.xpi` 为 99,599,253 bytes，SHA-256 `e3216ba5d519ab93986b0d935fbb0158a70b1c213e842c504a2127d9a5f2a7d8`。 |
| 真实 Zotero、网页与 Codex 服务 | NOT RUN | 本轮仅删孤立路径与未用参数，未启动宿主或发起模型请求；此前宿主与服务结果仍绑定各自旧产物。 |
| 本地忽略产物 | PASS | 核对没有使用本仓库专用树的活动进程后，精确移除 `.zotero-chatgpt-dev/` 内 161 个大于 20 MB 的重复 Codex 可执行文件及 XPI 副本，合计 23,321,301,264 bytes，并删除 `dist/` 中旧 0.1.0 XPI 副本；保留当前 `runtime-cache/`、profile 认证与配置文件以及 JSON 报告。这项本地磁盘清理不属于 Git/XPI。 |

## 2026-09-23 主窗口统一与真实论文演示候选

本节绑定当前开发 XPI `188caffcd4138ae5ea6db4b4ebcb8ddfc076cbb4ac9ad28c6e917c3a9c5d623b`（99,599,288 bytes / 87 files）。主窗口入口紧邻搜索，默认 Chat；未选文献只显示简短提示，切到 Agent 后使用与 Reader 同一套对话外壳。窄窗堆叠和分隔条保留 Zotero 原生详情栏；Agent 起步区压缩为四个简短操作。当前 PDF、文库 Chat 上下文和设置文字已精简，主窗口 Chat 明示外发范围及 PDF 正文不随附。Agent 仍支持自然语言、`/skill`、`@` 文献/集合、主题发现、受控获取、整理、元数据补全、笔记、集合与 Figure 圈画；所有写入保留各自预览/批准和原生读回，可靠高亮按用户本次请求自动执行。

| 层级 | 状态 | 当前证据与边界 |
| --- | --- | --- |
| 静态与单元 | PASS | `npm run typecheck`、`npm run lint`、`npm run test:unit -- --maxWorkers=1`：115 files / **1517 tests** / 0 skipped；`npm run package:dev`、`npm run verify:artifacts`：87 files。包含主窗口 Chat 首次打开不加载 Agent、发送时冻结选中项、闲置网页重绑、未授权或否定的自然语言写入拒绝、Figure 单飞及输出矩形导航回归。 |
| 真实 Zotero 无模型宿主 | NOT RUN | 最近的 `.zotero-chatgpt-dev/context-runs/library-agent-compact-final-20260923-2010/host-report.json` 是较早 XPI `ba3b3105…` 的 **55/55 PASS**，包含主窗口默认 Chat、原生详情栏保留、分隔条、Reader 进入自动收起和 Chat/Agent 隔离；当前 XPI 只补写入意图拒绝，尚未重跑宿主。 |
| 视觉检查 | NOT RUN | 较早 XPI `b3c088a3…` 的 Zotero 1000×600 窄窗截图 `.zotero-chatgpt-dev/context-runs/library-visual-review-20260923-1934/main-chat-default.png` 与 `.zotero-chatgpt-dev/context-runs/library-agent-visual-20260923-1940/main-agent.png` 显示主窗口无文字重叠、原生详情栏可见；后续四按钮精简产物的有效截图未取得，不能继承该视觉 PASS。深色主题和较大字号也未测。 |
| 当前 XPI 的 Sol 原生高亮与整理 | BLOCKED | 较早 XPI `ba3b3105…` 的 `.zotero-chatgpt-dev/context-runs/library-agent-visual-20260923-1625/host-live-final-ba3-sol-core-20260923.json` 在 `official-agent-login` 处停止，**0 次新模型轮次**；需用户在专用 profile 本人重新登录，当前 XPI 尚无新模型请求。更早 XPI `af5d6bd7…` 的真实 Sol 报告 `host-live-sol-live-after-picker-20260923.json` 已完成可靠高亮自动写入/读回/撤销与选中项整理批准/读回/冲突撤销，旧结果不继承为当前产物 PASS。 |
| 经典论文历史演示 | PASS | 较早 XPI `af5d6bd7…` 在专用 profile 对 *Attention Is All You Need* 完成一次 Sol 任务及 3/3 原生高亮；旧 GIF 已按 README 素材清理要求从当前仓库移除，历史验证不继承到当前 XPI。 |
| Figure 与主窗口 Chat 完整真实链路 | NOT RUN | Figure 合成候选的 Zotero 原生写入/读回/精确撤销在较早候选 `.zotero-chatgpt-dev/context-runs/library-agent-native-final-20260923-1720/host-report.json` **20/20**；当前 XPI 上从真实 Sol 裁图到用户批准和原生结果尚未跑完。主窗口 Chat 的官方网页真实提交与自动上下文接收也尚未验证，不能把 mock 或 UI 状态当作远端回答。 |

失败及旧产物报告保留在各自 run-id 目录；上表不覆盖以下历史记录。当前分支仅开发候选，尚未公开 Release 或安装到日常 profile。

## 2026-09-23 反馈修订候选（草稿 PR 后续）

本轮针对用户在真实 Zotero 截图中反馈的模型设置、主窗口入口/面板和高亮流程继续修订；基线是下节的 `e0baff9f…` 候选。本节只记录新构建和本轮实测，不继承下节真实获取示例的产物身份。正式 Agent 默认 Sol，Astra/Luna 仍可手动选；Sol/Luna 强制门禁只用于节省真实模型测试用量。

| 层级 | 状态 | 本轮证据与范围 |
| --- | --- | --- |
| 行为与源码 | PASS | Preferences 保存后立即刷新已打开侧栏的模型菜单及未发送草稿；正在运行的请求保持冻结模型。主窗口 Agent 按钮移到 Zotero 原生新建/标识符/附件/笔记按钮组右端；面板把“Get paper / Organize selection”分开，原任务记录仍可见。新 Agent annotate 请求的自动执行意图随请求和任务持久化，只对唯一定位且几何可靠的候选走原写入/读回/撤销；旧请求及旧任务保持人工 review。新注释清除内部来源链接，只留标识和简短解释。 |
| 本地门禁 | PASS | 最终 diff 的 `npm run typecheck`、`npm run lint`、`npm run test:unit -- --maxWorkers=1`：106 files / **1423 tests** / 0 skipped；复审发现的面板重开焦点问题也有定向回归。`npm run package:dev`、`npm run verify:artifacts` 通过。最终 XPI `dist/zotero-chatgpt-0.1.1-dev.xpi`：99,556,600 bytes / 87 files；SHA-256 `b1de523489543a2b9cd1e7b1130c9b178d58742c57a77949c26c3317dd53c8f7`。 |
| 真实 Zotero 无模型宿主 | PASS | Zotero 9.0.6、专用 `.zotero-chatgpt-dev/context-runs/feedback-final-b1de-20260923/`，报告 `host-report.json` 49/49，绑定上述最终 XPI SHA；无模型轮次。此前 `feedback-final-2dca-20260923/` 在 4 项通过后因 host driver 仍查找旧的 Close 按钮 aria-label 而 FAIL，原报告保留；只修驱动选择器后 `feedback-final-2dca-rerun-20260923/` 49/49，此后各产品修订均另用新 profile 对确切产物复核。 |
| 真实 Sol/Luna 高亮、整理与 GIF | BLOCKED | 本轮没有发送模型请求。上一节专用 profile 的 live `model/list` 只有 Astra；用户表示稍后亲自完成官方登录。真实模型自动高亮、无二次批准的原生读回、选中项整理及经典论文 GIF 均需该步骤后验证，不能把确定性单测算作 demo。 |
| 主窗口截图级视觉复核 | NOT RUN | 自动化界面本轮绑定到已存在的日常 Zotero 窗口，未在该窗口点击或截图；独立测试实例已按完整 profile 路径核对后停止。按钮位置由 Zotero 9.0.6 自带 `zoteroPane.xhtml` 结构、DOM 回归和无模型宿主入口检查支持；窄窗、主题、字号的最终外观仍待独立窗口复核。 |

图表圈画、选中条目元数据补全、简介笔记及主窗口围绕所选文献的官方网页 Chat 仍是产品设计方向，见产品文档 §7.5；本轮没有把这些新写入能力标为完成。

## 2026-09-23 本地开发候选（尚未发行）

基线是 GitHub `main` 的 `e951849`（`v0.1.1`）；本地先核对远端 SHA，再在 `codex/agent-library-and-context` 分支开发。manifest 仍为 `0.1.1`，所以本轮**只按内容 SHA 识别开发包**，不把旧发行版或较早的同版本 XPI 当作这次产物。没有公开 Release 或日常 profile 安装。

| 层级 | 状态 | 本轮证据与范围 |
| --- | --- | --- |
| 源码/产品 | PASS | Chat 默认只组装冻结书目信息与摘要；首次说明无需侧栏确认，设置可关闭，显式选区独立。文献库工具栏与 Tools 菜单提供无 PDF 的 Agent 入口，受控 DOI 获取和选中条目整理共用原任务批准/账本。模型选择限 GPT-6 Sol、Astra、Luna；旧模型记录只读保留。 |
| 运行资产 | PASS | 官方 Codex `rust-v0.156.1` arm64 archive `2bd64af1…11a5ca`、binary `0196e89f…255a`，哈希、Apple OpenAI 签名和 `runtime-prepare.mjs` 验证通过；旧 0.154.0 资产单独保存在忽略目录。官方 0.156.1 模型目录包含 Sol/Luna，实际账户可用性仍由运行时 live `model/list` 判定。 |
| 本地门禁 | PASS | `npm run typecheck`、`npm run lint`、`npm run test:unit -- --maxWorkers=1`（106 files / **1408 tests** / 0 skipped）、`npm run package:dev`、`npm run verify:artifacts`。XPI `dist/zotero-chatgpt-0.1.1-dev.xpi`：99,554,194 bytes / 87 files，SHA-256 `e0baff9f551ba7a195edb2b9a37c7ab6acdc2b85d169aa5664c4986496867726`。完整单测在允许调用 `ps` 的环境执行；沙箱内同一类 build 测试曾因 `spawnSync ps EPERM` 失败，不是产品断言通过。 |
| 真实 Zotero 无模型宿主 | PASS | Zotero 9.0.6、专用 `.zotero-chatgpt-dev/context-runs/final-e0ba-20260923/`、最终 XPI SHA `e0baff9f…`：`host-report.json` **49/49**。含主窗口无 Reader 可见/打开 Agent 入口、Reader/Chat 隔离、Agent 惰性启动、模式往返、PDF 原生读取、偏好挂载和性能检查；该阶段没有模型轮次。 |
| 真实文献获取 | PASS | 最终 XPI 在专用 `.zotero-chatgpt-dev/context-runs/demo-final-20260923/` 的合成集合中，公开 DOI `10.1371/journal.pone.0345574`：Zotero translator 预览 → 明确批准 → 原生条目和 OA PDF 附件读回均观察到，输出按钮能定位 Zotero 条目。另一次隔离测试中，`10.1038/nature14539` 的元数据已保存但 OA PDF 候选不可用，`10.1371/journal.pone.0009619` 保存元数据但 PDF 身份无法确认，均未误报为附件成功。最终 XPI 的三张真实宿主 still 及来源见 [media/sources.md](media/sources.md)。获取任务无需 Codex 模型轮次。 |
| Agent 真实 Sol/Luna 高亮与整理 | BLOCKED | 旧 0.154.0 运行时只列 Astra；升级至 0.156.1 后，当前专用 profile 的 live 模型目录仍只列 Astra。加了 Sol/Luna 强制门禁的 `--context --live --live-core-flows` 在 `sol-or-luna-model-unavailable` 以 **0 新模型轮次**停止。用户表示稍后会在专用 profile 亲自完成官方登录刷新；此前不把单测或旧 a30 的通过当成本轮真实高亮验收。文献库整理的新独立 turn 路径目前仅有确定性回归，真实模型仍 NOT RUN。 |
| 意外的高成本模型轮次 | FAIL | 在强制门禁加入另一份 `context-driver.js` 前，一次专用 profile 运行沿用旧会话 Astra 设置，实际开始了 **1 次**高亮请求。发现后只停止自己启动、参数完全匹配的 Zotero/Codex 进程；第二轮未开始、原生写入未批准。报告在 `.zotero-chatgpt-dev/verification/agent-20260923/astra-run-interrupted.json` 保留为运行中断证据，不能写成通过或 0 请求。两份 live 驱动现都要求 Sol/Luna 并核对请求模型。 |
| 真实 ChatGPT 网页回答与高亮录屏 | NOT RUN | 本轮验证了桥接契约及真实 Zotero UI；没有在最终 XPI 的官方网页对话里发送随机合成 PDF 问题，也没有用模型生成高亮录屏。README 的 Agent 获取 still 是真实受控获取流程，原有高亮图仍明确标为 illustration。 |

宿主数据只来自专用 profile 和公开 DOI；没有写入日常 Zotero 文献库。原报告、版本和未完成项继续按下文历史段落保存。

## 0. 首个发行版 0.1.0（2026-09-20）

本轮把 add-on 版本从开发标识 `0.4.0a34` 提升为**首个发行版 `0.1.0`**，并按用户当轮的明确授权首次公开发行（push → tag `v0.1.0` → GitHub Release）。

| 字段 | 值 |
| --- | --- |
| Zotero manifest 版本 | `0.1.0`（名称 "Zotero ChatGPT"，描述改为 "Read and discuss papers with ChatGPT inside Zotero. Early preview."） |
| npm 版本 | `0.1.0`（`package.json`、`package-lock.json`、`packages/{zotero,core,contracts}/package.json`、`packages/core/src/index.ts` 默认 `pluginVersion`） |
| 发行 XPI | `dist/zotero-chatgpt-0.1.0-dev.xpi`，92,760,736 bytes / 87 files |
| SHA-256 | `31b0f4c5d0bae1e4922b1da52e1de74c00c98918a7b69b86808cae3732e4ac49` |
| Tag | `v0.1.0` |
| 发行性质 | **未签名**；无更新频道；支持平台仅 macOS Apple Silicon |

发行 XPI 与 README 素材所用的 `0.4.0a34` 候选**逐文件比较只有两处差异**：`manifest.json` 的 name/version/description，以及 `content/zchatgpt.js` 里一个默认 `pluginVersion` 字面量（2,007,809 → 2,007,801 字节）。没有 UI 代码变化，因此 `docs/media/` 的截图与录屏对 `0.1.0` 仍然成立。

### 0.1 本轮实际执行

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run test:unit` | PASS，103 files / 1379 passed / 0 skipped（打包后再跑：`tests/build` 里两个以"`dist/` 存在当前版本 XPI"为条件的用例此时已执行。随重命名改了 4 处断言：`build.test.ts` 的显示名、`client.test.ts` 与两个 reader stub 的 `pluginVersion`） |
| `npm run package:dev` | PASS，产出 `dist/zotero-chatgpt-0.1.0-dev.xpi` |
| `npm run verify:artifacts` | PASS，87 files |
| 干净树重建 | PASS，`git ls-files` 导出到 `/tmp` 的干净树 + `npm ci` + `runtime-prepare` + `package:dev`，产物 SHA-256 与工作树**逐字节相同** |
| 无模型宿主阶段 `--context --run-id release-010` | PASS **47/47**（build `0.1.0`，sha `31b0f4c5…`） |
| S6 virgin 安装 | PASS，15 ok / 3 跳过（`live-model-send`、`version-bump-upgrade`、`rollback-restores-previous-version` 为单版本树的设计内跳过） |
| S6 两版本升级/回滚 | PASS，20 ok / 2 跳过 |

S6 两版本阶段用 `--upgrade-xpi dist/zotero-chatgpt-0.4.0a34-dev.xpi --rollback-xpi dist/zotero-chatgpt-0.1.0-dev.xpi`：验证 `0.1.0 → 0.4.0a34` 升级、`0.4.0a34 → 0.1.0` 回滚、两次替换后握手与「未登录」状态不变、会话记录保留，以及旧版本读取 schema 3 记录时**拒绝且不改写字节**。

### 0.2 本轮修掉的两个真实问题

1. **`tests/host/s6-driver.js` 的选择器过时（测试缺陷，非产品缺陷）。** 单行头部改版把模式开关移进公共 shell，而 shell bar 是 `[data-zchatgpt-chat]` 的**兄弟节点**而非后代，驱动仍在 `panel()` 里查它，因此停在 `Timed out: mode switch`。已改为从 `[data-zchatgpt-shell]` 取该控件；`panel()` 保留原义（runtime/auth/generating 数据集确实仍在 chat section 上）。
2. **复用测试树的陈旧 add-on（测试装配问题，非产品缺陷）。** `.zotero-chatgpt-dev/s6-upgrade` 是 9 月 13 日那轮留下的树，里面仍启用着旧命名的 `zcr-host-test@local` v0.0.1 与旧 add-on id 的 `{8a5f5bde-…}` v0.3.0a1。旧驱动同样在启动时执行 `runHostSmoke` 并调用 `Zotero.Utilities.Internal.quit()`，于是在当前驱动跑到第 3 项时静默退出 Zotero，报告永远停在 `status: running`。`--s6` 只替换 `zchatgpt-host-test@local`，不会清理它们。已把这两个文件归档到 `.zotero-chatgpt-dev/verification/release-0.1.0/` 后从该专用树移除，随后阶段一次通过。

两处都只影响测试工具与专用测试树，未改动产品行为、权限、运行时 pin 或数据 schema。

### 0.3 本轮仍未执行

```text
真实 Codex 模型轮次、真实高亮/获取/整理原生任务、真实 ChatGPT 提交与文件粘贴：
      NOT RUN。本轮未调用产品 Codex、未试探额度、未恢复远端线程。
      S6 阶段只启动 bundled Codex 进程做本地协议握手（无 thread、无 turn、无模型请求），
      驱动本身声明 live-model-send 为 notRun。
签名与签名验证：NOT RUN（用户选择以未签名形式发行）。
非 darwin-arm64 平台：NOT RUN / 未支持声明。
```

### 0.4 Google 登录交互修复（2026-09-20，未发行）

基线 `bcf8d382a271b5cb05cf0403cb3768c880403602`，分支 `fix/google-login-interaction`；验证环境 Linux、Node 24.19.0、npm 11.6.1。以下仅是本次修复的证据，不继承此前 macOS 宿主或真实服务的 PASS。

**原因与范围**：Chat 侧栏导航到 `accounts.google.com` 时，原认证交互名单只包含 OpenAI 和 Apple；`tick()` 将 `pointerEvents` 设为 `none`，而只匹配 `chatgpt.com` 的 actor 不能重新放行 Google 页面。本轮增加精确的 Google 主机名，只放行普通登录交互；PDF 准备、`stage`、`submitQuestion` 仍拒绝认证页面。未修改 actor origin、Agent 运行资产、插件 ID 或版本。

**先复现再修复**：扩展现有 Apple 测试，覆盖 OpenAI / Apple / Google 认证跳转及返回 ChatGPT。旧代码下 Google 用例 FAIL（预期 `auto`，实际 `none`；27 项通过、1 项失败），修改后同文件 PASS 28/28。增加认证页文献准备事件和发送/选区命令隔离检查，以及相似域名、子域名、HTTP、非默认端口、URL 用户凭据等 6 个拒绝用例。合计新增 8 个用例。

| 本轮检查 | 结果 |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `node scripts/runtime-prepare.mjs` | PASS；只下载并校验固定资产，未执行 Codex |
| `npm run package:dev` | PASS |
| `npm run verify:artifacts` | PASS；87 files |
| `npm run test:unit -- --maxWorkers=1` | PASS；103 files / 1386 passed / 1 skipped；Linux 按原有条件跳过 Apple 签名检查 |
| 真实 Chat / Google 登录 | PASS（用户手动报告）：Debian / Zotero 9.0.6 中 Chat 登录成功；助手未复现，未独立核验该次 profile 与已安装包哈希。未读取账号、Cookie 或认证文件 |
| Agent Linux 运行 | FAIL（用户手动报告）：显示 `Unable to prepare the bundled Codex runtime`；随包仍为 darwin-arm64，本次修复不增加 Agent Linux 支持 |
| Chat 发送 / PDF 上下文 / 重启后的登录保持 | NOT RUN；用户尚未报告这些验证结果 |

首次完整测试使用 `--maxWorkers=4`，结果 FAIL（1385 passed / 1 failed / 1 skipped）：既有 `install-dev-xpi.test.ts` 的临时配置安装测试超过 5 秒。单独以 `--maxWorkers=1` 复核该文件 PASS 18/18，随后完整串行测试 PASS；未修改断言、超时限制或跳过条件。保留首次失败记录，不把失败归因当成已证明的根因。

本轮 XPI：`dist/zotero-chatgpt-0.1.0-dev.xpi`，92,760,745 bytes；SHA-256 `842d9447c8b38f18172dcafeeacb507976446412fa299974abb60295ef052ca0`。此为本地测试产物，与 §0 的已发布原版哈希不同。复现、定向通过、首次完整失败、安装复核及最终完整通过日志保存在忽略目录 `.zotero-chatgpt-dev/verification/google-login-20260920/`。

审查：自审 PASS（实际 diff、域名和文献桥边界、无无关修改、`git diff --check`）；独立审查 NOT RUN。用户手动报告的 Chat 登录成功与自动测试分开记载，不外推为其它账户、认证流程或平台均可用。测试期间曾出现网页连接失败和菜单缺失，原因未完成诊断；不将这些问题声称为本次改动修复，也不绕过认证服务限制。

## 1. 2026-09-20 发布前整备轮

本轮范围：结构勘察、有证据的清理、缺陷修复、文档归位、构建与发行核查、离线回归、可用的宿主检查与自审。**没有**调用产品 Codex、没有试探额度、没有运行真实模型或原生动作验收。

### 1.1 代码与仓库改动

| 类型 | 内容 |
| --- | --- |
| 缺陷修复 | `chat/embed.ts` 的宿主页轮询定时器在 `hide()` 时没有停止：切换到 Agent 或关闭侧栏后，每个已创建 surface 仍每 500 ms 唤醒窗口（`tick → sync/probeBridge/trackConversation`），直到 surface 被驱逐或销毁；原注释“nothing painted 就停”与实现不符。现在 `hide()` 停止轮询、`show()` 重新启动，并有回归断言 `clearInterval` 收到该 handle。 |
| 缺陷修复 | `tests/host/context-driver.js` 有 5 处断言在“共同外壳 + 单行工具栏 + UI-05/06 文案”改造后仍按旧结构读取（3 处作用域 + 2 处文案），导致无模型宿主阶段在第 18 项即中止，之后的 29 项从未执行。详见 §1.4。 |
| 清理 | 删除无消费者的导出 `OFFICIAL_CHATGPT_ORIGIN`、`PAPER_CONTEXT_FIELDS`、`readerRevision`（含其唯一 import）、actor 内未使用的 `CHATGPT_ORIGIN`。 |
| 清理 | 删除死分支：`packages/zotero/src/index.ts` 的 `CHAT_TRANSPORT` 常量恒为 `undefined`，其两个条件表达式永不成立；改为直接返回既有 `CHAT_TRANSPORT_UNAVAILABLE_MESSAGE`，并保留“本构建不接原生 Chat transport”的说明。 |
| 清理 | 删除无引用的样式规则 `.zchatgpt-context-consent`（真正的首次外发同意控件使用 `zchatgpt-embed-notice` / `zchatgpt-embed-context-notice`）。 |
| 清理 | 从 `docs/` 删除三份一次性执行工单（`zotero-chatgpt-ui-redesign-instruction.md`、`zotero-chatgpt-ui-polish-instruction.md`、`zotero-chatgpt-release-readiness-instruction.md`）。其有效结论已迁入四份主文档；原文在 git 历史（commit `7bbc9ca`）可完整恢复。 |

保留：`copyableAnswerText()` 虽当前是 identity，但它标注“剪贴板载荷 = 原始 Markdown”这一契约边界，非空 wrapper，故不删。`canonical/equal`、`bytes`、`waitRead` 等跨层重复是分层约束（`core` 不依赖 `packages/zotero`）或不足两行的局部工具，不为消重新增公共 utils 层。

### 1.2 本地门禁（工作树，2026-09-20）

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run test:unit` | PASS，103 files / 1379 tests / 0 skipped |
| `npm run package:dev` | PASS，构建 `dist/zotero-chatgpt-0.4.0a34-dev.xpi`（92,760,769 bytes） |
| `npm run verify:artifacts` | PASS，87 files；SHA-256 `5c9ed57cb3e7269a9e64e604236cf5823afd3defbfe58f437b3fc96e653e55fa` |

### 1.3 干净输入重建（可复现）

在不含 `node_modules` / `.git` / `dist` / `build` / 专用 profile 的临时副本中，只复制当前受检源码、lockfile 与固定运行资产（pinned Codex binary），执行 `npm ci --prefer-offline` → `typecheck` → `lint` → `package:dev` → `verify:artifacts` → `test:unit`：

- XPI：92,760,769 bytes，SHA-256 与工作树产物**逐字节相同**（`5c9ed57c…`）。
- 测试：103 files / 1379 tests / 0 skipped（打包后再跑，`tests/build` 中依赖 `dist/` 的两个 `skipIf` 用例确实执行）。
- 结论：打包是确定性的（固定 1980 时间戳、文件排序），不依赖旧 `dist/`、缓存或本机偶然文件。

### 1.4 无模型宿主阶段（0.4.0a34 历史产物，PASS 47/47）

专用隔离树 `.zotero-chatgpt-dev/context-runs/readiness-20260920d/`，`node scripts/prepare-host-test.mjs --context --run-id readiness-20260920d` 后用 `-no-remote -profile … -datadir …` 启动 Zotero 9.0.6（1000×600，DPR 2），只停止本任务自己启动且参数匹配的进程。

报告 `.zotero-chatgpt-dev/context-runs/readiness-20260920d/host-report.json`：`status: passed`，47/47，`build.sha256 = 5c9ed57c…`，`build.driverSourceHash = 4764c715…`。覆盖并 PASS 的关键项：单行共同头部与两个复制按钮、Chat 默认且 `chat-only-sidebar-use-starts-no-codex-process`、`chat-only-sidebar-use-does-not-prepare-codex`、Agent 惰性准备/启动、模式切换往返、`new-chat-tab-before-or-with-connection`、2 页本地提取与页标签、`context-source-hidden-without-a-citation`、上下文环诚实未知态、草稿跨附件保持、PDF 缩放与聊天字号独立、`single-dock-and-toggle-after-cycles`，以及性能门禁 `warm-open-p95 ≤ 250 ms`（实测 4.07 ms / n=30）与 `local-feedback-p95 ≤ 100 ms`（实测 0.28 ms / n=30）。Preferences 面板真实挂载、语言 canary 从 `General` 切到 `通用` 再切回、禁用/启用不叠加 pane。

明确 skip（报告 `skips`，因会触发登录或真实模型）：`acknowledge-context-resumes-the-pending-explain`、`not-ready-send-refuses-with-error-alert`。明确 NOT RUN（报告 `notRun`）：真实模型回答、真实登录、在途停止、长期记忆、图像理解、Preferences 视觉主题/键盘。

**驱动缺陷的复现与修复（FAIL → PASS，报告全部保留）**：

| 运行 | 结果 | 实际原因 |
| --- | --- | --- |
| `readiness-20260920` | FAIL（18 项后中止） | `new-chat-tab-before-or-with-connection` 用 `panel()`（`[data-zchatgpt-chat]`）查找标题 tab，但 tab 条已属于共同外壳；`panel()` 不再包含头部。 |
| `readiness-20260920b` | FAIL（同项） | 作用域修正后找到 tab，但断言只接受 `New chat`／`新建对话`；该处已切到 Agent，产品按 UI-05 显示 `New agent`。 |
| `readiness-20260920c` | FAIL（43/44） | `pref-pane-copy-matches-stored-ui-language` 的 section 文案表只列出 `Chat`／`Appearance`，而 UI-06 重组后界面语言控件位于 `General`（zh `通用`）。 |
| `readiness-20260920d` | **PASS 47/47** | 修正上述作用域与文案后，宿主阶段首次完整跑通当时的 0.4.0a34 产物。 |

同一处作用域问题还影响 `contextSource`（活动引文行位于 `More → Paper & context details`）与性能循环里的 history 按钮（属外壳 `actions`），一并按元素实际归属改为 `shell()`。

### 1.5 独立审查

在实现完成后、冻结产物前，用工作区既有的 CodeRabbit CLI（`coderabbit review --agent --uncommitted -c AGENTS.md`）对本轮未提交 diff 做了独立审查，未新增 Codex 用量。结果：1 条 minor（`CHANGELOG.md` 把驱动断言数写成 four，实际为 five），已修正；代码与测试文件无其他发现。该审查只覆盖源码/文档 diff，不替代真实宿主与真实服务验证。

### 1.6 本轮未运行

```text
真实 ChatGPT 提交 / 文件粘贴、真实 Codex 模型轮次、高亮 / 获取 / 整理原生任务、
跨窗口真实服务绑定、日常 profile 安装、签名与公开发行：NOT RUN
原因：本轮按用户明确限制不调用产品 Codex、不试探额度、不恢复远端线程、不运行真实原生动作验收，
      也未获得公开发布 / 安装授权。
截图级视觉复查（浅深主题、长标题、放大字号、IME、焦点环、History 删除前后、Preferences 视觉）：
      NOT RUN。本轮用真实 Gecko 宿主阶段核对了单行头部、两个复制按钮、模式往返、性能与语言切换的
      属性/几何，但没有产出新截图；可用浏览器工具拒绝 file:// 且无法访问本机回环预览服务，
      因此没有把旧截图当作当前候选的证据。
远端 CI、跨平台与非 darwin-arm64 运行：NOT RUN。本轮未 push（未获授权），只验证了本地等价命令。
边界：§1.2–§1.4 的 PASS 只覆盖离线门禁、确定性打包与无模型宿主阶段；不等于真实服务或原生动作通过。
Codex 用量：本轮未调用产品 Codex，属“未发起”，不是“已实测为零”。
```

## 历史报告索引（证据路径，不复制正文）

| 证据 | 原始结果 | 覆盖范围 |
| --- | --- | --- |
| `.zotero-chatgpt-dev/context-runs/readiness-20260920{,b,c}/host-report.json` | FAIL（见 §1.4） | 驱动作用域/文案缺陷的复现记录，保留不覆盖 |
| `.zotero-chatgpt-dev/context-runs/readiness-20260920d/host-report.json` | **PASS 47/47** | 0.4.0a34 历史产物无模型宿主阶段 |
| `a33-{typecheck,lint,unit,package,artifacts}.log` | PASS（原记录） | 100 files / 1336 tests / 0 skipped；87-file XPI |
| `9374ac8…/final-status.txt` | PASS（原记录） | detached worktree 在版本 commit 上重建相同 SHA |
| `final-a33-install-PASS.json` | PASS（原记录） | a33 XPI 46/46，PATH 无 Node，0 请求 |
| `a33-native-16-PASS-DOI-UNAVAILABLE.json`：native 子集 | PASS（原记录 16/16） | 标注、整理、读回、撤销等本地原生行为 |
| 同一报告：DOI 预览 | UNAVAILABLE（原业务结果）；本轮未复核 | 预览已尝试，未取得可用元数据；未核实原断言与外部根因 |
| `a33-web-live-PASS.json` | PASS（原记录） | 真实网页 14/14，随机 token 命中，Codex 0→0 |
| `a33-web-resume-stop-PASS.json` | PASS（原记录） | 恢复与停止 5/5，Codex 0→0 |
| `a32-native-PASS-17.json` | PASS（原记录） | a32 17/17，含该轮 DOI 预览；不替代 a33 |
| `a30-web-live-fresh-conversation-not-accepted.json` | FAIL（原记录） | 首次提交未确认，0 消息、0 接受 |
| `a32-web-resume-stale-manifest-FAIL.json` | FAIL（原记录） | harness 用旧 resume manifest；原文称更正后重跑通过 |
| `a32-live-core-annotate-turn-failed-FAIL.json` / `…-r2-…` | FAIL（原记录） | 高亮准备阶段未完成；用户确认当时周额度用尽；失败不被阻塞说明覆盖 |
| `a30-live-core-PASS.json` | PASS（原记录） | 真模型 2 轮，annotate + organize 12/12 |
| `.zotero-chatgpt-dev/verification/delivery-20260919/acceptance-current.json` | 原文档记录的机器可读摘要；本轮未读取 | — |
| `.zotero-chatgpt-dev/ui-preview/screenshots/ui-polish-*.png` | 浏览器（Blink）渲染复查，非 Zotero/Gecko | 单行头部、窄窗、深浅主题、复制反馈、History 菜单、说明文字隐藏复现 |

## 原 a33 基线（原始记录，不代表当前候选）

| 字段 | 原记录 |
| --- | --- |
| 版本 / XPI | `0.4.0a33` / `dist/zotero-chatgpt-0.4.0a33-dev.xpi` |
| SHA-256 / 文件数 | `5447f33870bc56677796437764b9600c0892ef492db0c339fc083c86dcd69631` / 87 |
| 版本 commit | `9374ac8` |
| 该轮 Chat 修复 | `f942eeb`（无 composer 页保持可点击）、`482e35a`（允许已验证的空白重排）、`08d53ba`（有界第二次提交）、`9374ac8`（reload 图标） |
| 平台 | macOS Apple Silicon / Zotero 9.0.6 |
| 发行性质 | 本地开发 XPI，未签名 |

Chat 默认 brief 来自本地纯文本、最多 12,000 字符且不自动发送页面图像，是该版记录，不是本轮已核验的新配置，也不代表全文全部传给模型。Agent 的 strict config、quote 唯一验证、同库最多 50 项加法整理、已有可编辑集合、intent/readback/delta 与冲突撤销约束继续保留。

原记录未覆盖：签名、公开发布、更新频道、其它 CPU/系统、Gatekeeper 下载来源、升级/回退和公开安装验证。Apple passkey 仍是该基线的 BLOCKED 记录，不推定之后的宿主版本仍有同一结果。
