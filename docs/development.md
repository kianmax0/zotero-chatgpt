# zotero-chatgpt：开发、测试与发行

> 文档类型：操作与验证规则。修订日期：2026-09-20。
> 命令、脚本参数、CI 与产物校验已对照当前 `package.json`、`scripts/`、`runtime/` 和 `.github/workflows/` 核验。2026-09-20 的发布前整备轮实际运行了离线门禁、打包、产物校验与**无模型**宿主阶段；没有运行真实 ChatGPT/Codex、真实模型轮次或原生动作验收。§6 的截图级 UI 宿主检查仍是后续开发要求。

产品行为见 [zotero-chatgpt-user-flow.md](zotero-chatgpt-user-flow.md)，模块契约见 [module-design.md](module-design.md)，实际结果见 [progress.md](progress.md)。本文件不保存逐版本测试流水，也不提供长期、无条件的真实文献库操作授权。

## 1. 开始工作前

先阅读仓库实际的 `AGENTS.md`、README、这四份文档、相关源码与近期变更。检查工作树并保留其它人的未提交改动；一文件一个写入负责人，不 reset、checkout、git clean 或改写历史。

实现范围必须来自当前任务。普通工程决策可在范围内自行完成；新增付费服务、不可逆数据处理、扩大文献范围、真实账户登录、公开发布等不能由历史工单自动授权。

涉及过期文档时，先迁移仍有效的权限、兼容、测试和未完成事项，再删除旧文件并修复引用。不要保留多份互相冲突的“当前架构”；也不要因旧计划要求“不动 UI”“禁止 agent 目录”等历史阶段限制，拒绝当前任务明确的 UI 修复。

不存在完整源码或原始报告时，把相关判断记为待核查。文档说某路径曾存在，不等于它现在仍有缺陷；旧文档记录 PASS，不等于本次重新验证。

## 2. 环境与本地门禁

上传文档记录的目标环境是 Node 24.x、npm 11.x、macOS Apple Silicon、Zotero 9.0.6；具体 Node pin 以 `.nvmrc` 为准。Node 只用于构建和测试，发布 XPI 不依赖系统 Node。

工作区版本、Zotero manifest 版本和最终 XPI 身份不是同一概念。manifest 可先升候选版本；只有实际打包、验证并记录 hash 的文件才是该轮产物，不能从旧文档版本号猜当前文件名。

```sh
npm ci
node scripts/runtime-prepare.mjs
npm run typecheck
npm run lint
npm run test:unit
npm run package:dev
npm run verify:artifacts
```

`runtime-prepare.mjs` 按 manifest 锁定官方 Codex darwin-arm64 归档和 SHA-256，准备到忽略目录；当前目标 pin 为 0.156.1。实施时先核对实际 manifest，不能因文档旧 pin 擅自升级或降级运行时。该脚本不替换系统 CLI，不读取/迁移其它客户端认证。缺少真实运行资产时打包失败，不能用 fixture 冒充。

| 命令 | 能证明什么 | 不能证明什么 |
| --- | --- | --- |
| `npm run typecheck` | TypeScript 边界一致 | 真实宿主可用 |
| `npm run lint` | 静态规则通过 | 用户流程正确 |
| `npm run test:unit` | contracts/core/DOM/host doubles 的断言通过 | 真实 Zotero、真实 ChatGPT/Codex 或实际额度隔离 |
| `npm run package:dev` | 候选 XPI、运行资产和 SHA 文件生成 | 最终包已经加载、可登录或可用 |
| `npm run verify:artifacts` | 文件白名单、hash、许可、无 Node 运行导入和私有记录 | 真实服务端到端成功 |
| `npm run release:dry-run` | 本地发行计划 | 已上传、已建 tag 或已发布 |

每个行为修复先建立能复现故障的回归，再实现并扩大必要验证。不能通过删除断言、跳过失败测试、削弱安全检查或把未跑场景改成 PASS 来完成交付。

## 3. Chat / Agent 隔离必须单独验证

### 3.1 静态边界

检查 Chat 网页提交、选区菜单、文献准备、标题、历史、重试、设置加载和恢复等所有入口。它们不能调用 Codex 模型发送，也不能依赖 Agent 连接才完成本地功能。

检查原生写入是否只能经受控 Agent 任务。不要只用“有无工具列表”“按钮写的是 Chat”或目录名来推断执行来源；也不要为了让新布局编译，删除既有 tasks/actions 权限门禁。

### 3.2 运行时证据

| 场景 | 应记录的可核查结果 |
| --- | --- |
| 冷启动仅使用 Chat | 插件 Codex 进程、连接和模型轮次保持为零；不准备 Agent 认证目录 |
| Agent 未登录、不可用或额度不足时使用 Chat | Chat 不因 Agent 状态被禁用；自身网页错误单独报告 |
| Chat 提问、选区、标题、恢复、重试 | 均无可归因于这些动作的 Codex 模型请求 |
| 先使用 Agent 再切回 Chat | 已有 Agent 工作归属清楚；Chat 不新增 Agent 请求或恢复任务 |
| 打开通用设置和本地历史 | 只读本地数据，不隐式连接 Agent |
| 明确进入 Agent 后发送 | 请求绑定 Agent、使用真实 Codex，并有对应 request / turn 证据 |

只记录插件拥有的进程与白名单计数，不检查或终止其它 Codex 会话，不读取私人提示词或认证。额度数字短时间没变化不能替代调用路径验证。已存在的 Agent 进程也不能单独证明 Chat 串线。

## 4. 隔离宿主树

所有产品、原生和服务验收只使用仓库内明确命名的 `.zotero-chatgpt-dev/` 子树与合成资料。日常 Zotero、其它开发 profile、其它 Codex 会话和用途不明目录不在测试范围。

启动前核对完整 `-profile` / `-datadir`。自动停止只针对自己启动且参数完全匹配的进程，禁止 `killall`。停止前仅检查该隔离 profile 的非认证记录，确认没有 active request；不读取、复制、截图或删除 account、cookie、token、密码和验证码。

```sh
/Applications/Zotero.app/Contents/MacOS/zotero \
  -no-remote \
  -profile "$PWD/.zotero-chatgpt-dev/context/profile" \
  -datadir "$PWD/.zotero-chatgpt-dev/context/data"
```

非 live context 使用明确 `--run-id <短名称>`；其它阶段重跑前把报告归档为带时间和用途的名称。失败报告不被后续运行覆盖。

fixture 在运行时生成随机唯一内容。真实文献问答必须在同一请求/对话中验证这一内容确实被使用；不要把 fixture token 直接写进问题来制造命中。可使用本地提取之外的对照检查，防止仅验证正文已经准备而没有验证真实传递。

prepare 脚本生成的 `driverSourceHash` 必须与本次工作树匹配，避免旧 profile、旧 XPI 或旧 driver 的缓存产生假 PASS。最终产物与工作树驱动结果分开记录。

## 5. 既有宿主阶段

下列命令保留自上传文档。执行前核对当前脚本支持的参数，不新增一个实际不存在的 npm 验收命令。

| 准备命令 | 范围与副作用 |
| --- | --- |
| `node scripts/prepare-host-test.mjs --context --run-id <id>` | 主窗口无 PDF 的 Agent 入口、本地 PDF、dock、模式、会话、上下文、偏好和安全边界；默认不发模型请求 |
| `node scripts/prepare-host-test.mjs --context --native --run-id <id>` | 工作树原生适配器和合成条目/PDF；写入并撤销合成标注、标签、集合；不调用模型 |
| `node scripts/prepare-host-test.mjs --context --live` | context 合成 PDF 上调用已登录 Codex，会使用实际额度；不接受 `--run-id` |
| `node scripts/prepare-host-test.mjs --context --live --live-core-flows --login-wait-seconds <0..3600>` | 操作者完成官方 Agent 登录后，验证真实模型高亮候选经定位后自动原生写入、整理候选经 review/批准后写入，以及读回和冲突撤销 |
| `node scripts/prepare-host-test.mjs --live-core --reuse-run-id <既有专用run-id> --report-id <新报告id> --login-wait-seconds <0..3600>` | 在已登录的专用 `context-runs/<run-id>` profile 上跑两轮 Sol/Luna 模型验收；要求实例已关闭、安装的 XPI 与传入文件 SHA 完全相同，保留该 profile 的设置和认证文件，报告名不得覆盖已有报告 |
| `node scripts/prepare-host-test.mjs --embed` | 官方 browser/actor 比较探测；不自动登录，不采集认证和回答正文 |
| `node scripts/prepare-host-test.mjs --embed --web-live` | 官方页面 actor 的真实可见提交链路；不能与 URL/watch/comparison probe 参数合用 |
| `node scripts/prepare-host-test.mjs --embed --watch-seconds <n>` | 比较探测后保留人工观察窗口；只记录白名单网络/console/surface 状态 |
| `node scripts/prepare-host-test.mjs --live-model` | 读取 Agent 实际模型目录，不发送问题 |
| `node scripts/prepare-host-test.mjs --context --acceptance --run-id <id>` | 无自动 driver 的人工试用 |
| `node scripts/prepare-host-test.mjs --s5` | 进程中断与本地恢复隔离阶段 |
| `node scripts/prepare-host-test.mjs --s6` | virgin、升级、回退隔离阶段 |

参数组合由 `scripts/host-test-stage.mjs` 校验：`--native` 不与 `--live` / `--acceptance` 合用；`--live-core-flows` 必须与 `--context --live` 同用；`--reuse-run-id` 只用于明确的 live core 验收并要求独立 `--report-id`；登录等待只用于声明的阶段；主阶段互斥。

`--native` 的候选是合成输入，只能证明 native API、账本和撤销。`--live-core-flows` 才能提供真实模型候选证据；只有完整报告满足断言才可声明该轮端到端通过，不能用局部 PASS 掩盖 fixture/driver FAIL。

Agent 真实模型验收优先选当前运行时报告的 GPT-6 Sol，Sol 不可用时可选 Luna；两者都不可用则记 BLOCKED，不自动用 Astra 消耗更高成本。报告需记录实际请求模型 ID。文献库整理的独立 Agent turn 也需核对冻结选择、模型候选、任务预览和原生读回；只看到 main-window 面板或任务卡片不足以算通过。

`--embed` 页面可见、actor 注册或单测通过不能证明真实 Chat 提交。必须在同一隔离 profile 完成官方登录，并在真实回答中验证随机合成 PDF 内容。trusted scheme、about:blank、CSP、Cloudflare 或站点 DOM 阻断时保留实际失败/阻塞，不关闭安全机制。

上述命令不能自动被解释为已经覆盖 acquire 的“元数据 + PDF 附件”完整链路。文献获取需检查当前仓库是否已有对应测试；缺失时在任务范围内补充。仅 DOI translator 预览不算 PDF 下载通过。

自动 driver 结束后先退出该实例，再准备人工 acceptance。禁止 driver、CUA 和人工同时竞争操作同一窗口。

## 6. UI 宿主验收

采用相同窗口尺寸、相同附件和明确产物版本记录切换前后状态。截图用合成资料，记录实际侧栏宽度、缩放和字号；不能从用户上传截图反推当时安装的 XPI。

窄、常规、宽侧栏均应检查。可将 360 / 480 / 720 CSS px 作为测试采样点，但这些是建议采样值，不是已经验证的最小支持宽度；宿主无法达到的尺寸记录实际值。

| 对应产品要求 | 检查内容 | 所需证据 |
| --- | --- | --- |
| UI-01 | 切换前后模式开关保持同一位置与命中区；不出现两套开关 | 相同尺寸下的真实宿主截图与点击验证 |
| UI-02 | 常规默认正常态紧凑；成功提示不堆叠；详情可展开 | 正常、成功、异常、展开状态截图 |
| UI-03 | 本地提取、待发送范围、页面接受分别显示；不虚称全文已读 | 冻结输入范围与对应 UI 的一致性检查 |
| UI-04 | 剪贴板准备不被写成附件上传完成；完整文件与文本片段分开 | 真实页面手动附件流程及明确阶段结果 |
| UI-05 | 草稿、焦点、滚动、PDF 锚点保持；在途任务不串线；IME 不误发 | 实际键盘/切换/多窗口操作与请求计数 |
| UI-06 | Agent instructions、模型、skills 和字号作用范围明确 | 设置变化结果、真实可用性和无隐藏连接证据 |
| UI-07 | 主界面历史与数据管理分工；删除范围清楚 | 本地绑定/会话删除行为及活动任务保护检查 |

同时检查深浅主题、长标题、放大字号、键盘导航、禁用原因、菜单关闭后焦点返回、输入框遮挡与横向溢出。无内容时不显示悬空假按钮；发生失败后不能永远锁住发送。

这些 UI 检查多数不需要真实模型。只有页面接受、真实回复或模型生成任务等特定边界才请求服务，不能为测试布局反复消耗 Codex 额度。

## 7. 登录与认证

Agent 登录只由操作者本人在专用 profile 完成官方浏览器流程。driver 可以等待，不能点击身份认证控件、输入密码/验证码或读取 auth 文件。ChatGPT 页面登录同样由操作者完成；插件不要复制其它客户端认证。

不为“干净环境”删除已命名测试 profile 的认证目录。需要未登录状态时新建明确 profile；需要持久化状态时复用原 profile。准备脚本只清理它拥有、可重建的 driver/fixture 文件。

没有 GUI、账号、网络或可用额度时，完成不依赖阻塞的验证，并准确记录阻塞边界。不能伪造回复、截图、日志或请求成功，也不能用“需要人工”代替本可完成的自动检查。

## 8. 结果和证据口径

| 状态 | 定义 |
| --- | --- |
| PASS | 指定版本/产物、指定层级的该场景本次实际执行并满足断言 |
| FAIL | 该场景已执行但未满足断言；保留失败报告与原始结果 |
| BLOCKED | 已知的外部条件或必要人工步骤阻止本轮验收推进，记录原因和恢复条件 |
| NOT RUN | 本轮未执行，不根据相似场景推定 |

执行结果与验收推进状态必要时分开：例如 a32 尝试实际失败保留 FAIL；a33 因额度未重跑，其执行状态为 NOT RUN，验收可记录 BLOCKED。不能把已有失败报告改写成没有发生过。

不使用 PARTIAL 或 FAIL/BLOCKED 作为混合枚举。一个报告里有多项结果时拆行：native 子集、DOI 预览和 PDF 下载分别记录。停止、超时、重试、进程中断也应分别列场景，不能用停止按钮通过覆盖整个恢复体系。

每条证据记录场景、commit/工作树身份、XPI hash、环境、命令、driver hash、实际结果与报告路径。自动测试、工作树宿主、真实服务和最终 XPI 分开。未提供原始报告时注明“来自既有文档，未重新核验”。

成功截图不能替代 native readback；native 合成候选不能替代真实模型；一次真实请求 attempts=1 不能证明第二次重试分支已跑过。没有明确服务错误码时，用户确认额度用尽可以支持阻塞判断，但超时本身不证明所有产品回归已经排除。

## 9. 产物、安装与发行

以实际 `packages/zotero/manifest.json`、`dist/SHA256SUMS` 与本轮 progress 选择 XPI，不复制旧文件名：

```sh
npm run package:dev
npm run verify:artifacts
npm run verify:install -- build-info --xpi <dist/current-dev.xpi> \
  --out .zotero-chatgpt-dev/build-info.json --json
```

既有安装工具如下；运行这些命令需要目标 profile 的明确安装授权，不因本文件存在而自动获得：

```sh
npm run install:dev -- plan    --profile "<profile>" --xpi "<xpi>"
npm run install:dev -- install --profile "<profile>" --xpi "<xpi>"
npm run install:dev -- check   --profile "<profile>"
npm run install:dev -- revert  --profile "<profile>"
npm run install:dev -- rollback --profile "<profile>"
```

`plan` 只读。`install` 在目标 profile 运行时拒绝，先备份旧 XPI，再核对落盘 SHA；只在需要 profile scope 扫描时管理带标记的单一 user.js 偏好，不手改 extensions.json / addonStartup.json.lz4。`check` 核对运行进程打开的 inode/size 与退出后的登记版本；无法测量时报告 not-measured，不假 PASS。

最终交付要求当前 XPI、准确支持范围、构建身份、实际通过层级和未完成事项。改变产物 hash 后不得默默继承旧产物真实服务证据；确实未重跑的场景保留原版本标签。

公开 push、GitHub Release、签名、更新频道、付费服务、真实文献库写入和日常 profile 安装均需要对应授权。公开发行还需干净 checkout 重建、最终 XPI 专用宿主复验、无 Node 环境、升级/回退和支持平台证据。

完成实现后审查实际 diff，修复发现的问题并重跑相关检查。可用独立审查时记录其证据；只能自审时明确为自审。文档审查、代码审查和真实宿主验证不可互相替代。
