# zotero-chatgpt：进度与证据索引

> 文档类型：证据和缺口，不是产品规格。更新日期：2026-09-24。
> 前四节记录 2026-09-23 的本地开发候选，后续保留有引用价值的发行、失败与验收历史；历史结果不自动继承到当前候选。已移除过期的“当前候选”快照和重复状态矩阵。状态只用 PASS / FAIL / BLOCKED / NOT RUN。

产品要求见 [zotero-chatgpt-user-flow.md](zotero-chatgpt-user-flow.md)，架构见 [module-design.md](module-design.md)，命令与状态定义见 [development.md](development.md)。

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
