# zotero-chatgpt：进度、当前候选与证据索引

> 文档类型：证据和缺口，不是产品规格。更新日期：2026-09-23。
> 下方新增本轮本地候选的实测记录。既有 §0–§7 保留 2026-09-20 及更早版本的发行、失败与验收归属，不自动继承到本轮。状态只用 PASS / FAIL / BLOCKED / NOT RUN。

产品要求见 [zotero-chatgpt-user-flow.md](zotero-chatgpt-user-flow.md)，架构见 [module-design.md](module-design.md)，命令与状态定义见 [development.md](development.md)。

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

## 1. 当前候选（开发线）

| 字段 | 值 |
| --- | --- |
| 插件 ID | `{90909501-7b5b-4985-9f55-566e9890746c}` |
| Zotero manifest 版本 | `0.4.0a34`（名称 "Zotero ChatGPT (Development)"） |
| 候选 XPI | `dist/zotero-chatgpt-0.4.0a34-dev.xpi` |
| SHA-256 | `5c9ed57cb3e7269a9e64e604236cf5823afd3defbfe58f437b3fc96e653e55fa` |
| 大小 / 文件数 | 92,760,769 bytes / 87 files（`dist/SHA256SUMS` 同源） |
| 随包 Codex | 0.154.0 darwin/arm64；archive `344310a0…f9d7`，binary `4f859826…afcc` |
| 构建工具链 | Node 24.11.0 / npm 11.6.1（`.nvmrc`、`engines >=24 <25`） |
| 记录平台 | macOS Apple Silicon / Zotero 9.0.6 |
| 发行性质 | 本地开发 XPI；未签名，无公开下载地址，无更新频道 |

add-on 版本未变但产物被重建过多次，因此**旧 hash 不再标识当前文件**。历史值：`5447f338…`（a33）、`c5665975…`（09-19 UI 轮 a34）、`22afde95…`（09-20 精修轮 a34，文件曾为 92,760,986 bytes）。当前文件以 §2.2 与本节数值为准。

## 2. 2026-09-20 发布前整备轮

本轮范围：结构勘察、有证据的清理、缺陷修复、文档归位、构建与发行核查、离线回归、可用的宿主检查与自审。**没有**调用产品 Codex、没有试探额度、没有运行真实模型或原生动作验收。

### 2.1 代码与仓库改动

| 类型 | 内容 |
| --- | --- |
| 缺陷修复 | `chat/embed.ts` 的宿主页轮询定时器在 `hide()` 时没有停止：切换到 Agent 或关闭侧栏后，每个已创建 surface 仍每 500 ms 唤醒窗口（`tick → sync/probeBridge/trackConversation`），直到 surface 被驱逐或销毁；原注释“nothing painted 就停”与实现不符。现在 `hide()` 停止轮询、`show()` 重新启动，并有回归断言 `clearInterval` 收到该 handle。 |
| 缺陷修复 | `tests/host/context-driver.js` 有 5 处断言在“共同外壳 + 单行工具栏 + UI-05/06 文案”改造后仍按旧结构读取（3 处作用域 + 2 处文案），导致无模型宿主阶段在第 18 项即中止，之后的 29 项从未执行。详见 §2.4。 |
| 清理 | 删除无消费者的导出 `OFFICIAL_CHATGPT_ORIGIN`、`PAPER_CONTEXT_FIELDS`、`readerRevision`（含其唯一 import）、actor 内未使用的 `CHATGPT_ORIGIN`。 |
| 清理 | 删除死分支：`packages/zotero/src/index.ts` 的 `CHAT_TRANSPORT` 常量恒为 `undefined`，其两个条件表达式永不成立；改为直接返回既有 `CHAT_TRANSPORT_UNAVAILABLE_MESSAGE`，并保留“本构建不接原生 Chat transport”的说明。 |
| 清理 | 删除无引用的样式规则 `.zchatgpt-context-consent`（真正的首次外发同意控件使用 `zchatgpt-embed-notice` / `zchatgpt-embed-context-notice`）。 |
| 清理 | 从 `docs/` 删除三份一次性执行工单（`zotero-chatgpt-ui-redesign-instruction.md`、`zotero-chatgpt-ui-polish-instruction.md`、`zotero-chatgpt-release-readiness-instruction.md`）。其有效结论已在本文件 §5 与四份主文档中；原文在 git 历史（commit `7bbc9ca`）可完整恢复。 |

保留：`copyableAnswerText()` 虽当前是 identity，但它标注“剪贴板载荷 = 原始 Markdown”这一契约边界，非空 wrapper，故不删。`canonical/equal`、`bytes`、`waitRead` 等跨层重复是分层约束（`core` 不依赖 `packages/zotero`）或不足两行的局部工具，不为消重新增公共 utils 层。

### 2.2 本地门禁（工作树，2026-09-20）

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run test:unit` | PASS，103 files / 1379 tests / 0 skipped |
| `npm run package:dev` | PASS，构建 `dist/zotero-chatgpt-0.4.0a34-dev.xpi`（92,760,769 bytes） |
| `npm run verify:artifacts` | PASS，87 files；SHA-256 `5c9ed57cb3e7269a9e64e604236cf5823afd3defbfe58f437b3fc96e653e55fa` |

### 2.3 干净输入重建（可复现）

在不含 `node_modules` / `.git` / `dist` / `build` / 专用 profile 的临时副本中，只复制当前受检源码、lockfile 与固定运行资产（pinned Codex binary），执行 `npm ci --prefer-offline` → `typecheck` → `lint` → `package:dev` → `verify:artifacts` → `test:unit`：

- XPI：92,760,769 bytes，SHA-256 与工作树产物**逐字节相同**（`5c9ed57c…`）。
- 测试：103 files / 1379 tests / 0 skipped（打包后再跑，`tests/build` 中依赖 `dist/` 的两个 `skipIf` 用例确实执行）。
- 结论：打包是确定性的（固定 1980 时间戳、文件排序），不依赖旧 `dist/`、缓存或本机偶然文件。

### 2.4 无模型宿主阶段（当前候选，PASS 47/47）

专用隔离树 `.zotero-chatgpt-dev/context-runs/readiness-20260920d/`，`node scripts/prepare-host-test.mjs --context --run-id readiness-20260920d` 后用 `-no-remote -profile … -datadir …` 启动 Zotero 9.0.6（1000×600，DPR 2），只停止本任务自己启动且参数匹配的进程。

报告 `.zotero-chatgpt-dev/context-runs/readiness-20260920d/host-report.json`：`status: passed`，47/47，`build.sha256 = 5c9ed57c…`，`build.driverSourceHash = 4764c715…`。覆盖并 PASS 的关键项：单行共同头部与两个复制按钮、Chat 默认且 `chat-only-sidebar-use-starts-no-codex-process`、`chat-only-sidebar-use-does-not-prepare-codex`、Agent 惰性准备/启动、模式切换往返、`new-chat-tab-before-or-with-connection`、2 页本地提取与页标签、`context-source-hidden-without-a-citation`、上下文环诚实未知态、草稿跨附件保持、PDF 缩放与聊天字号独立、`single-dock-and-toggle-after-cycles`，以及性能门禁 `warm-open-p95 ≤ 250 ms`（实测 4.07 ms / n=30）与 `local-feedback-p95 ≤ 100 ms`（实测 0.28 ms / n=30）。Preferences 面板真实挂载、语言 canary 从 `General` 切到 `通用` 再切回、禁用/启用不叠加 pane。

明确 skip（报告 `skips`，因会触发登录或真实模型）：`acknowledge-context-resumes-the-pending-explain`、`not-ready-send-refuses-with-error-alert`。明确 NOT RUN（报告 `notRun`）：真实模型回答、真实登录、在途停止、长期记忆、图像理解、Preferences 视觉主题/键盘。

**驱动缺陷的复现与修复（FAIL → PASS，报告全部保留）**：

| 运行 | 结果 | 实际原因 |
| --- | --- | --- |
| `readiness-20260920` | FAIL（18 项后中止） | `new-chat-tab-before-or-with-connection` 用 `panel()`（`[data-zchatgpt-chat]`）查找标题 tab，但 tab 条已属于共同外壳；`panel()` 不再包含头部。 |
| `readiness-20260920b` | FAIL（同项） | 作用域修正后找到 tab，但断言只接受 `New chat`／`新建对话`；该处已切到 Agent，产品按 UI-05 显示 `New agent`。 |
| `readiness-20260920c` | FAIL（43/44） | `pref-pane-copy-matches-stored-ui-language` 的 section 文案表只列出 `Chat`／`Appearance`，而 UI-06 重组后界面语言控件位于 `General`（zh `通用`）。 |
| `readiness-20260920d` | **PASS 47/47** | 修正上述作用域与文案后，宿主阶段首次完整跑通当前候选。 |

同一处作用域问题还影响 `contextSource`（活动引文行位于 `More → Paper & context details`）与性能循环里的 history 按钮（属外壳 `actions`），一并按元素实际归属改为 `shell()`。

### 2.5 独立审查

在实现完成后、冻结产物前，用工作区既有的 CodeRabbit CLI（`coderabbit review --agent --uncommitted -c AGENTS.md`）对本轮未提交 diff 做了独立审查，未新增 Codex 用量。结果：1 条 minor（`CHANGELOG.md` 把驱动断言数写成 four，实际为 five），已修正；代码与测试文件无其他发现。该审查只覆盖源码/文档 diff，不替代真实宿主与真实服务验证。

### 2.6 本轮未运行

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
边界：§2.2–§2.4 的 PASS 只覆盖离线门禁、确定性打包与无模型宿主阶段；不等于真实服务或原生动作通过。
Codex 用量：本轮未调用产品 Codex，属“未发起”，不是“已实测为零”。
```

## 3. 当前阻塞与剩余必需验证

| 优先级 | 项 | 状态 |
| --- | --- | --- |
| P0 | Agent 真实链路（高亮、整理、获取的元数据 + PDF 两阶段）在**当前候选**上复验 | BLOCKED：`0.4.0a34` 未跑真实模型；沿用 a32 的额度阻塞记录，不能继承 a30 的 PASS |
| P0 | 真实网页 Chat 提问 / 恢复 / 停止在**当前候选**上复验 | NOT RUN：a33 的 web-live PASS 绑定旧产物，不自动继承 |
| P1 | UI-01 至 UI-07 的宿主**视觉**复核（浅深主题、IME、焦点环、多窗口） | 部分覆盖：本轮宿主阶段已验单行头部、两个复制按钮、模式往返、性能与 Preferences 语言切换；截图级视觉与多窗口仍 NOT RUN |
| P1 | 安装 / 升级 / 回退（专用 profile） | NOT RUN；本轮未安装到任何 profile |
| P1 | Sidebar 删除 → 已打开 Preferences 的推送 | 未闭合：面板沙箱未暴露跨 compartment 回调，现以“窗口重新聚焦时重读”兜底 |
| P2 | 公开分发材料（签名、许可复核、公开下载、更新频道、支持平台声明） | BLOCKED：本轮未获授权，且 `manifest.json` 的 `update_url` 仍指向 `.invalid` 占位 |
| P2 | 非 darwin-arm64 平台 | NOT RUN / 未支持声明：随包 Codex 是 darwin/arm64 |

## 4. 分场景证据矩阵（历史 + 当前轮）

同一报告含多项结果时拆行；不把服务未跑写成产品通过。当前轮的层级见 §2。

| 场景 | 自动 / 本地 | 真实服务与最终产物 | 未覆盖 |
| --- | --- | --- | --- |
| 干净安装、无系统 Node | 原记录 PASS | a33 install 46/46；0 请求 | 其它平台、公开发行安装 |
| Chat 冷启动不触发 Codex | 原记录 PASS | a33 web 记录 Codex 0→0；**当前轮宿主 PASS**（未准备/未启动运行时） | 已有 Agent 在途时的混合场景 |
| Agent 故障不阻断 Chat | 原表 PASS | 主要证明正常 Chat 的 Codex 0→0 | 未登录 / 缺资产 / 额度不足的故障注入 |
| PDF A/B、同名附件与切换草稿 | 原记录宿主 PASS | 真实服务多窗口 NOT RUN | 最终包的多窗口服务绑定 |
| 模式切换状态 | 原记录 clean host PASS | 主要为 Chat 不触发 Codex | 真实草稿 / focus / IME / 在途任务 |
| Agent 高亮与整理 | 原记录自动 / 原生宿主 PASS | a30 真模型 PASS；a33、当前候选 NOT RUN | 当前最终包真实模型 |
| 原生标注与整理撤销 | a33 native 子集 PASS | 合成候选，无模型调用 | 不能当完整真实模型流程 |
| 停止生成 | 原记录 PASS | a33 web resume-stop PASS | 其它恢复场景 |
| 有界第二次提交 | 单元回归 PASS | 真实 attempts 均为 1 | 第二次尝试分支未触发 |
| Settings ↔ History 删除同步 | 离线集成回归 PASS（真实 `ConversationStore` + `WorkspaceStore` + 独立 presenter） | — | 真实多窗口；Sidebar → Preferences 无推送 |
| 单行头部 / 两个复制动作 | 离线回归 PASS | **当前候选宿主 PASS**（`single-row-common-header-with-the-two-paper-actions`） | 截图级视觉、放大字号与多窗口 |
| 当前候选 XPI 干净重建 | PASS（逐字节相同 SHA） | — | 远端 CI 未运行 |

## 5. UI 轮次摘要（2026-09-19 / 09-20，已被源码与离线回归覆盖）

两轮均已完成源码改造、离线回归、浏览器（Blink）渲染复查与开发 XPI 打包；真实宿主验收当时未运行。

| 主题 | 落地结果 |
| --- | --- |
| UI-01 共同外壳 | 单一 `.zchatgpt-shell`；模式开关只在 `.zchatgpt-chrome` 内创建一次，切换不移动、无第二套开关 |
| UI-02 紧凑顶部 | 正常态只有一行 44 px 工具栏；上下文摘要、自动 PDF 状态、宿主重新加载收进 `More`；文献快捷动作只有 `Copy paper context` 与 `Copy PDF file` 两个图标按钮（32×32 命中区、18 px 图标、可键盘聚焦） |
| UI-03 四种事实分层 | 摘要回答“下一次发送什么”；本地提取、待发送范围、页面接受、回答分开表达；详情面板展示来源全名、下次发送、本地读取、自动 PDF 状态 |
| UI-04 文件与文本分开 | `Copy PDF file` 只报告“已复制到剪贴板，需粘贴”，不冒充附件上传；`Copy selection` 不再是工具栏动作 |
| UI-05 切换保持状态 | 模式各自保留草稿/焦点/滚动；Agent 空状态说明真实可用性；禁用给原因；Enter / Shift+Enter 与 IME 规则；空会话名为 `New agent` |
| UI-06 设置作用范围 | Preferences 重组为 General / Chat / Agent / 本地数据；`Agent text size`、`Agent instructions`（注明仅 Agent）；原始 model id/版本进 `Details` |
| UI-07 历史与删除 | 历史行 = 标题 + 文献/最近活动/可证明来源；Preferences 的 `Chat history` 改名 `Local data` 并说明删除范围 |
| 复制契约（P-04/05/08） | `core/src/chat/paper-context.ts` 只输出 Title / Authors / Publication / Year / DOI + Abstract，缺失省略，与自动发送的 `documentBrief()` 不共用格式器 |
| 两个动作独立（P-06） | 无可证明书目身份时禁用书目复制并说明原因，文件复制仍可用；反之亦然 |
| 冻结来源（P-07） | `exportPaperContext()` 在 await 前 clone `PaperScope`，按该冻结 scope 读取 |
| 历史删除同步（H-01/02/04/05/06） | `WorkspaceStore.removeConversation` 提交后发布 `HistoryChange`；`ReaderWorkspace.subscribeHistory?` 为可选契约；删除递增查询世代丢弃迟到 list/search；`ConversationStore.save` 写前重查文件，已删会话抛 `NOT_FOUND`，仅 `create` 能重建；删除同时丢弃草稿/位置/防抖保存与焦点归位 |
| 交付后修复（10.6 类） | reader 文档内联样式表改为与当前 bundle 比较后**原地重写**；工具栏说明元素自带内联隐藏声明，旧样式表下也不会打印成长串文字 |

历史上报的关键数值（已过期，仅作归属）：typecheck/lint PASS；unit 100 files / 1344 tests（UI 轮）→ 103 files / 1378 tests（精修轮）；a34 曾为 92,732,302 bytes / `c5665975…` 与 92,760,986 bytes / `22afde95…`。

## 6. 历史报告索引（证据路径，不复制正文）

| 证据 | 原始结果 | 覆盖范围 |
| --- | --- | --- |
| `.zotero-chatgpt-dev/context-runs/readiness-20260920{,b,c}/host-report.json` | FAIL（见 §2.4） | 驱动作用域/文案缺陷的复现记录，保留不覆盖 |
| `.zotero-chatgpt-dev/context-runs/readiness-20260920d/host-report.json` | **PASS 47/47** | 当前候选无模型宿主阶段 |
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

## 7. 原 a33 基线（原始记录，不代表当前候选）

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
