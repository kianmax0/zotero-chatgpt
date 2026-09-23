# zotero-chatgpt：架构与数据契约

> 文档类型：架构契约。修订日期：2026-09-20。
> 2026-09-20 的发布前整备轮把本文对照当前源码、测试、manifest 与构建脚本重新核验了一遍：共同侧栏外壳、设置归属、两个复制动作的语义与历史删除同步已按实际实现更新，并在 §1.1 新增“源码 → 测试”入口导航表。动态版本、产物 hash 与验收结论只放在 progress.md。

产品行为见 [zotero-chatgpt-user-flow.md](zotero-chatgpt-user-flow.md)，操作见 [development.md](development.md)，证据见 [progress.md](progress.md)。

## 1. 执行边界

```text
Zotero Reader sidebar
└── 共同外壳：固定模式开关、单行工具栏导航、Paper & context details
    ├── Chat surface
    │   └── official chatgpt.com browser + constrained page actor
    └── Agent surface
        └── TypeScript core -> Gecko private stdio -> bundled Codex App Server
            └── reviewed ActionTasks -> Zotero native APIs -> verified results

共享只读来源：attachment identity、冻结 PDF revision/text、选区与经授权的条目快照
```

`Paper & context details` 是共同外壳的一部分：它显示下一次请求的来源与范围、本地读取覆盖和自动 PDF 上下文状态，以及两个手动复制动作的语义说明。手动复制书目信息使用独立的纯格式器，不读取 PDF 正文；自动发送路径继续使用自己的文档预算与冻结机制。

Chat 与 Agent 共用本地来源，不共用远端执行生命周期。ChatGPT 页面拥有自己的登录、模型、输入框、对话和 transcript；Agent 保存 Codex thread/turn 与本地任务。不能把两个服务伪装成一个远端会话。

Chat 的任何用户操作都不得触发 Codex 模型轮次，包含辅助标题、摘要、上下文压缩、意图识别、恢复和重试。即使 Codex 被设为只读或没有工具，其模型轮次仍是 Agent 服务用量，不能被当成免 Codex 额度的 Chat。

Node 仅用于构建与测试。发布运行路径为 Zotero / Gecko 与随包运行资产，不依赖系统 Node 或用户手动启动一个本地服务。具体工具链、Codex pin 与平台基线见开发和进度文档。

### 1.1 入口导航（源码 → 测试）

一个关键入口一行：职责写在源码里，行为由对应测试守护。测试名是位置而不是覆盖率声明。

| 入口 | 职责 | 主要测试 |
| --- | --- | --- |
| `packages/zotero/src/index.ts` | 插件装配：偏好、窗口/reader 注册、actor 与 resource 投影、view 生命周期、chat surface 池 | `tests/build/bootstrap.test.ts`、`tests/host/context-driver.js` |
| `packages/zotero/src/reader/dock.ts` | Zotero 原生 dock、样式注入、开合、焦点与几何 | `tests/zotero/reader/dock*.test.ts` |
| `packages/zotero/src/reader/context.ts` | `ReaderContext` 聚合：附件身份、冻结版本、选区、阅读状态 | `tests/zotero/reader/document*.test.ts`、`tests/zotero/presenter-context.ts` |
| `packages/zotero/src/reader/selection*.ts` | 选区捕获、`More details` / `Ask in sidechat` 路由 | `tests/zotero/reader/selection.test.ts`、`tests/zotero/chat/source-links.test.ts` |
| `packages/zotero/src/chat/view.ts` | 共同外壳、单行工具栏、两个复制按钮、Chat/Agent 内容区渲染 | `tests/zotero/chat/view.test.ts`、`sidebar-styles.test.ts` |
| `packages/zotero/src/chat/presenter.ts` | 状态编排：草稿、模式、任务投影、订阅与销毁 | `tests/zotero/chat/presenter*.test.ts`、`history-sync.test.ts` |
| `packages/zotero/src/chat/embed.ts` | 官方 `chatgpt.com` 宿主 surface、冻结上下文提交与受限 bridge | `tests/zotero/chat/embed-*.test.ts`、`tests/host/embed-driver.js` |
| `packages/zotero/actors/*.mjs` | 受限 JSWindowActor 与 DOM-only 页面助手 | `tests/zotero/chat/official-chat-{actor,child}.test.ts` |
| `packages/zotero/src/preferences/*` | 原生 Preferences 面板与本地数据管理 | `tests/zotero/preferences/*` |
| `packages/zotero/src/runtime/*` | GeckoStorage、随包资产、私有进程与惰性 Agent 连接 | `tests/runtime/*` |
| `packages/zotero/src/actions/native.ts`、`src/library/*` | 受控原生执行器与受限只读库访问 | `tests/zotero/actions/native.test.ts`、`tests/zotero/library/*` |
| `packages/core/src/index.ts` | `ReaderClient` 装配、惰性 Codex 通道、运行时状态 | `tests/core/lazy-runtime.test.ts`、`client.test.ts`、`transport.test.ts` |
| `packages/core/src/sessions/service.ts` | 会话/请求生命周期、停止、恢复与对账 | `tests/core/recovery.test.ts`、`history.test.ts`、`execution-boundary.test.ts` |
| `packages/core/src/tasks/controller.ts` | 审批、写前 intent、读回账本与冲突撤销 | `tests/core/tasks.test.ts`、`organization-tasks.test.ts` |
| `packages/core/src/workspace/store.ts` | 设置/skill/草稿与历史唯一写入者，提交后发布 `HistoryChange` | `tests/core/workspace.test.ts`、`history-sync.test.ts` |
| `packages/core/src/context/*` | 预算与规划、书目块、自动发送的文档 brief | `tests/core/context-planner.test.ts`、`bibliography.test.ts`、`document-brief.test.ts` |
| `packages/core/src/chat/paper-context.ts` | 手动书目复制格式器（与自动发送格式器分离） | `tests/core/paper-context.test.ts` |
| `packages/contracts/src/*` | 跨层数据契约、验证与受限输入 | `tests/contracts/*` |
| `scripts/*` | 构建、打包、产物校验、宿主准备、发行计划 | `tests/build/*` |

端到端无模型入口是 `node scripts/prepare-host-test.mjs --context --run-id <id>`（准备专用 profile 与合成 PDF，不调模型），由 `tests/host/context-driver.js` 断言；`--native` 覆盖合成候选的原生写入/读回/撤销，`--live*` 才需要真实账户与额度。命令与副作用见 [development.md](development.md)。

## 2. 分层和唯一所有者

依赖方向是 `packages/zotero -> packages/core -> packages/contracts`。contracts 不依赖 core/zotero；core 不依赖 DOM、Zotero 或 Node。具体静态边界继续由既有测试守护。

| 范围 | 责任 |
| --- | --- |
| `packages/contracts` | 纯数据契约、验证、请求和原生任务的受限输入 |
| `packages/core/src/codex` | App Server 协议、模型能力、策略、用量与历史对账 |
| core 的 sessions / context / workspace | 会话持久化、请求恢复、PDF 预算与规划、草稿和设置 |
| core 的 tasks | 审批、写前意图、读回账本、对账与撤销 |
| `packages/zotero/src/reader` | 当前附件、版本、选区、定位、阅读锚点与 dock |
| `packages/zotero/src/library` | 受限只读库查询、条目选择、集合列表与文件读取 |
| `packages/zotero/src/actions` | 原生标注、条目、标签、集合关系、文献获取及显式文件动作 |
| `packages/zotero/src/chat` | 现有 Chat/Agent 展示与接线、官方页面桥、共同外壳和任务投影 |
| `packages/zotero/src/runtime` | GeckoStorage、随包资产、私有进程与惰性 Agent 连接 |

以上是职责映射，不要求为文档中的每一行新增一个类、目录或抽象层。实施时以仓库实际目录和符号为准。

`packages/core/src/tasks/controller.ts` 继续是任务审批、意图与账本的唯一所有者，`packages/zotero/src/actions/native.ts` 是受控执行器。reader/library 不导入 actions 实现；Chat 页面桥不获得原生写入端口。Agent 展示通过现有注入端口访问任务，不能因为目录名含 `chat` 就把所有 UI 都认定为网页 Chat 执行路径。

conversation 文件应由一个持久化所有者串行写入；历史查询和 Preferences 删除入口不得自行平行改写同一文件。旧计划曾报告双写者风险，但当前是否仍存在必须查源码，不能据此直接宣称当前缺陷。

## 3. 共同外壳与各模式的所有权

共同外壳拥有模式开关、插件级导航、两个文献复制动作、`Paper & context details`、当前可见 surface 和必要的在途任务提示。模式开关只有一个稳定挂载位置，不由两种 composer 分别布局。正常态只有一行工具栏：上下文摘要不再占用常驻行，只在该详情面板内呈现。

Chat surface 负责官方 browser 生命周期与受限 actor。Agent surface 负责原生 transcript、composer、模型选择和任务卡片。两者显示互斥；切换不迁移、重放或重新分类在途请求。

文献库主窗口另有 Agent 工作区入口，不依赖 Reader 或 PDF。它用独立的本地 library session 身份显示获取/整理任务，复用同一个 `ActionTaskController` 审批与结果账本；不能为满足 Reader 会话的必填 `PaperScope` 伪造附件。主窗口的选中条目从该窗口的 `itemsView` 冻结，不能读取随后变动的焦点或其它窗口的选择。

官方 browser 暂时不可见时按既有设计保留页面，而不是销毁会话；隐藏状态不能获得焦点或捕获其它模式输入。长期生命周期和关闭恢复由宿主明确管理，不依赖每次 view render 重建页面。

保存 Agent 草稿与视图状态可使用现有 presenter/workspace。官方网页草稿由官方页面拥有，插件不能为“统一草稿”新增全文 transcript 抓取；受限发送过程所需的 composer 内容处理仅限该次可见用户动作。

界面状态是既有运行状态的投影，不是第二份业务真相。错误文案、任务完成和额度提示不能由 DOM 是否有某个按钮单独决定。UI-01 至 UI-07 的外观和交互验收以产品文档为准。

## 4. Chat 官方页面桥

### 4.1 来源、frame 与认证边界

沿用顶层 XUL browser 承载官方 `https://chatgpt.com` 页面。JSWindowActor 只匹配官方 HTTPS origin 的顶层 frame；父子消息同时验证 origin、页面身份、请求 marker、数据形状和当前绑定。

拒绝相似域名、HTTP、credentials URL、异常端口、子 frame 和过期消息。actor 模块仅通过窄 `resource://` substitution 暴露所需 content access；其它运行资产、记录和账户数据不可读。允许用户完成官方登录导航，不等于把桥的权限扩展到第三方登录页。

登录交互放行名单为 `auth.openai.com`、`appleid.apple.com` 和 `accounts.google.com`，只接受精确主机名、HTTPS、默认/443 端口且不含 URL 用户凭据的导航。该名单只恢复登录页面的鼠标操作；`stage`、`submitQuestion` 和文献准备消息仍限定在 `chatgpt.com`。返回 ChatGPT 后重新探测官方 composer。放行 Google 页面不代表真实 Google 登录已完成跨平台验收，也不绕过认证服务对内嵌浏览器的限制。

生产桥不读取回答正文、认证、cookie、token 或远端 transcript。不复制其它客户端认证，不调用未公开服务端接口，不关闭宿主安全机制来制造成功。

### 4.2 可见提交与冻结

既有链路是：官方 composer 的可见发送意图 → 父进程校验并冻结文献/选区/问题 → 生成覆盖说明与随机 marker → actor 写回同一个可见 composer → 触发该次官方提交 → 检查有限接受信号。

动作边界前后均复核自动上下文开关、attachment/revision、页面和会话绑定。Chat 默认只准备冻结条目的书目信息与摘要，不顺序截取 PDF 页面；显式选区作为独立原文输入。首次说明服务和字段，但不要求侧栏确认才能发送。`More details` 与 `Ask in sidechat` 走同一网页入口，不触达 Agent presenter 的模型发送路径；后者只准备内容，不代用户发送。

必须保留与原问题和选区对应的冻结来源，不能在异步回调中重新读取“当前 PDF”替换已经接受的请求。页面或草稿不再匹配时安全失败，不能套用旧 marker 到新对话。

### 4.3 接受确认与有限重试

本地准备、页面接受和模型回答是不同状态。actor 的成功响应不能被升级为“模型读完全文”。任何观察范围只为本次提交必要，不延伸为远端历史抓取。

原文档记录了编辑器空白重排兼容：比较草稿时允许已经验证过的空白重排，但仍要求 marker 存在且非空白内容未变。该约束的实际实现和测试在源码核查时保留，不能为 UI 简化删掉草稿保护。

既有有界保护只在草稿仍相同、没有本次标记消息、没有停止按钮，且信号一致指向页面尚未接受时，允许对同一份冻结提交最多再尝试一次。一旦已接受或结果不确定，不得盲目重发。真实运行是否触发该分支只由 progress 的对应证据声明。

### 4.4 远端绑定与手动文件辅助

Chat 只保存 canonical `https://chatgpt.com/c/<id>` 的本地绑定。查询串、fragment、share URL、其它路径和 origin 不作为会话身份。新 Chat 与新 Agent 分别建立各自的远端身份。

可选的 PDF 剪贴板操作只报告文件准备结果，不冒充附件上传完成，也不作为自动 actor 链路成功的替代。若未来改为其它可见附件流程，先验证宿主能力和用户授权，再更新契约；不能沿用旧计划的一律禁止 PDF 附件规则，也不能默默改用私有上传接口。

## 5. Agent 运行时、请求与恢复

### 5.1 惰性连接和隔离观察

打开侧栏、停留 Chat、读取本地会话或打开通用 Preferences 不启动 Codex。只有显式进入 Agent、Agent 登录/发送/重试或在 Agent 中恢复工作，才允许 `AgentRuntime.connection()` 准备私有目录、启动随包进程并握手。

普通 `get/select/current` 保持本地读取。Chat 打开一个含旧 Agent 消息的本地记录，也不能隐式恢复 Codex thread 或任务。未连接时显示模型缓存及其来源，不因设置面板加载自动探测模型服务。

运行时隔离分两种情况验证：冷启动 Chat 应维持零插件 Codex 进程、零模型请求；已有明确启动的 Agent 工作时，Chat 操作不得增加可归因于 Chat 的 Codex 连接、轮次或任务。不能把已有 Agent 后台进程的存在误判为 Chat 串线，也不能以“反正进程已启动”为理由允许 Chat 调用它。

### 5.2 请求持久化和权限

Agent 发送或排队时冻结模式、问题、PDF、选区/引用、skill、设置、组织选择和请求 ID。用户消息与 accepted 记录先原子持久化，随后才外发。排队期间的 UI 变化不改变冻结输入。

requestId 与冻结输入 hash 共同去重；相同 ID 对应不同内容必须拒绝。相同请求及候选恢复时复用原任务，不能因重开侧栏或重新收到通知再创建任务。

保留 `RequestMode = 'chat' | 'agent'`、`hashVersion: 3` 及旧 hash 的兼容重建。`RequestMode` 是已持久化协议的一部分，不意味着现在的新网页 Chat 必须走 core 的 Codex 队列；也不能用它代替服务来源判定。

状态沿用 accepted → dispatching → running → terminal。只对从未派发的 accepted 请求续派一次；dispatching/running 中断后转为 uncertain，通过 `thread/resume` / `thread/read` 与 request ID 对账，不自动重发。

模型不得获得 shell、任意文件、MCP、通用插件、浏览器或不受限 Zotero 工具。任务输出经过受限 schema 校验；上游未授权工具活动或不符合策略的审批请求必须拒绝并关闭受影响连接。

文献库整理使用单独的 Agent thread/turn，保存在插件私有运行时以支持 `thread/read` 结果核验；它不伪装成 Reader 会话。输入只含冻结条目的模型可见元数据、标签和已有集合序号，native key 留在受限的本地待对账记录中。该记录在 `thread/start` 前保存冻结输入、请求 ID，随后记录 thread/turn ID；超时或结果不明时，下一次操作先按原身份读回/恢复，不能发起第二个模型 turn。返回的索引候选交给原任务控制器生成预览；模型阶段失败或结果不确定时不产生写入任务。获取 DOI/公开 URL 的受控元数据预览无需模型 turn，但仍属于 Agent 工作区，保存条目和附件必须通过任务批准。

### 5.3 任务批准、停止和结果

Agent 模式本身不构成写入批准。一个任务可集中预览、选择和批准，不逐个弹窗打断用户。审批、写前 intent、native write、readback 和 ledger 均保留。

停止结束后续可停止的工作，不自动等价于撤销。uncertain 先 inspect/reconcile；有可靠写后结果的项和未完成项分别展示。查看、批准既有候选、原生读回和撤销不应隐含启动一个新的模型轮次。

## 6. 共享文献上下文与身份

`PaperScope(clientId, libraryId, attachmentKey)` 与 `DocumentRevision(fingerprint, size, modifiedAt, sha256)` 共同确定 PDF 身份。Reader 从已加载 `getData()` 计算 SHA 并与磁盘比较；即使 size/mtime 不变，内容替换也使旧坐标失效。

ReaderContext 沿用适配层聚合：组合既有身份、DocumentContext 和缓存，不复制第二份文档事实、不重复计算 revision/hash。实时页码、滚动、zoom 和 dock 宽度属于各视图的阅读状态，需要时捕获，不为“共享上下文”建立第二个持续同步的状态所有者。

文档本地提取与外发分开。Chat 的默认外发范围是本地书目信息与摘要，不将本地已提取的页数冒充发送范围；显式选区单独冻结。Agent 阅读和高亮仍可使用冻结的 PDF 原文与 core 的预算/规划逻辑。本次范围由实际发送快照决定，UI 只展示结果，不在 presenter 或 view 复制另一套估算与截断规则。平台 pin 等可变参数以代码及 progress 中记录的版本为准，不在 UI 中硬写“全文已读”。

同一父条目下多个 PDF 仍是不同 attachment；不同窗口、profile、library 与附件的异步结果不可串用。请求面显示冻结来源，共同摘要显示下一次来源，两者不能覆盖彼此。

## 7. 原生任务契约

### 7.1 annotate

模型输出仅允许 `{candidates:[{quote,pageIndex,reason}]}`。pageIndex 是页提示，不限制全 PDF 唯一匹配。保留原契约的可靠搜索上限：256 页 / 2,000,000 个规范化字符；超出可靠验证范围不得声称唯一。

使用冻结 PDF 的原生字符盒生成行矩形，跨页只允许相邻两页。候选重复、仍由历史任务拥有的输出或写入结果不明时，不能分配第二个写 key；只有确认原输出已撤销、对应所有权解除后才允许重新创建。

批准前只保存 review；批准后先保存 reserved key 与 `annotation-create` writing 意图，再调用 `Annotations.saveFromJSON`，最后按 key 读回完整原生快照。写前再次验证 quote 与 revision，不信任账本中的旧坐标。writing/unknown 恢复先 inspect，不重发。

原文跳转将第一页 rects 与相邻第二页 `nextPageRects` 一次交给 Reader.navigate，不修改缩放或旋转。撤销要求标注仍精确匹配写后快照并带本插件 provenance，否则 conflict。

### 7.2 organize

选择只从绑定主窗口的 `ZoteroPane.itemsView.getSelectedItems(false)` 取得。过滤附件、笔记、已删除和非 regular item；在第一次 await 前复制身份，去重后限定同库最多 50 项，并通过 `inspectOrganizationItem` 冻结元数据、标签、集合、附件、时间及完整签名。

模型仅接收 `itemIndex + metadata + tags + existing collectionIndexes` 与 `collectionIndex + name`。native key、完整签名和时间留在本地并参与 v3 请求 hash。返回只允许 `{itemIndex,tags,collectionIndexes}`，索引必须落在冻结数组内。

`planOrganization` 生成 before 快照与同库目标。批准后先保存 `organization-add` 意图；native transaction 复核当前状态等于 before 且目标可编辑，然后只新增标签与集合成员关系。读回验证期望结果及范围外 signature 未变。

账本保存 before/after、实际 addedTags 与 addedCollectionKeys。撤销先验证 delta 语义，再要求当前精确等于 after，仅移除实际新增项。人工后改、部分人工删除、缺失写后快照或所有权不明，分别保留数据并标为 conflict/uncertain。

整理仅使用已有可编辑集合，不扩大为创建/重命名/删除集合、删除标签、移动或删除条目、改元数据和处理附件。

### 7.3 acquire

输入只接受 DOI/公开 URL 与明确 collection。预览不保存 translator 结果，先做 DOI 查重；批准后创建字段白名单条目，或只为已存在条目新增集合成员关系。元数据白名单不接受 notes、tags、relations、本地路径或执行权限；模型提出的数据不能携带 native 写入权限。

OA 下载由受控宿主动作执行。逐跳校验公网 URL，拒绝私网/本地地址，并检查 MIME、大小、页数、首页标题/DOI、补充材料标志和哈希。不能确认身份或有效性时不创建附件。不得依靠模型的任意网络、shell 或文件访问完成下载。

元数据、collection membership 与 PDF 附件是可区分阶段；分别记录实际 native 结果，不把 translator 预览成功或元数据保存当成 PDF 下载成功。原获取任务的快照与账本兼容形状继续保留。

## 8. 设置、历史与兼容

共用设置只控制插件共有行为。Agent 模型、instructions、skills 和生成设置不影响官网模型或官网个人设置。新请求的模型选择只取运行时当前报告的 GPT-6 Sol、Astra、Luna，默认优先 Sol；已有记录的旧模型身份只读保留。原始 model ID 必须与实际运行时能力一致；缓存、随包目录和已确认能力分开显示。

历史索引只索引本地确实拥有的字段。官方远端 transcript 仍由官网拥有，不为 UI 的“统一历史”要求新增采集。删除通过唯一存储所有者执行，先检查活动 request/task/reading job；会话删除不调用原生撤销，也不顺便清理账户目录。

### 删除后的跨视图同步

`WorkspaceStore` 是本地会话的唯一写入者。一次删除在文件提交之后向订阅者发布一个 `HistoryChange`（`paper` + `removed` ids），订阅入口是可选契约 `ReaderWorkspace.subscribeHistory?`。任何已打开的历史列表都据此失效并重新读取，而不是等重启、切模式或重新打开；没有该能力的宿主退化为各自重新读取，不新增第二套持久化或全局事件框架。

视图侧必须同时覆盖三种竞态，三者都属于契约的一部分：

1. **旧查询晚返回**：删除会递增查询世代；删除前开始的 list/search 结果不得把已删除记录重新插回。
2. **旧保存晚执行**：`ConversationStore.save` 在写入前重新确认会话文件仍然存在，不信任内存副本；对已删除的会话返回 `NOT_FOUND`，只有显式 `create` 能重新建立记录。
3. **草稿与防抖保存**：删除通知到达后，该会话的草稿、位置与尚未执行的防抖保存一并丢弃，避免下一次 render、切模式或卸载时重建同一记录。

`subscribeHistory` 只做失效通知；删除的身份、范围、活动依赖检查与结果账本仍由存储所有者和原生任务控制器决定。

反方向（Sidebar 删除 → 已打开的 Preferences）目前没有推送通道：Preferences 面板只在 JSON 文本函数上跨沙箱运行，尚未暴露跨 compartment 回调。作为文档化的兜底，面板窗口重新获得焦点时重新读取自己的列表（只重新读取，不裁剪、不写入）。这不替代 Settings → Sidebar 的提交后推送。

### 8.1 旧 mode 不等于新服务来源

旧计划中的 Chat 本来走 Codex，缺失 mode 的旧记录也曾按 chat 解释。因此，不能把旧 `mode: chat` 或缺失 mode 直接映射为官方网页来源。

兼容要求是：按原 schema/hashVersion 验证原记录；用可证明的上游身份和记录来源进行只读分类。具有 Codex thread/turn 的旧记录不冒充官网对话；存在 canonical 官方 URL 绑定的记录按其网页来源处理；来源矛盾或无法确定时标明旧记录/来源未知，禁止自动外发或恢复。

继续旧 Codex 记录必须显式进入 Agent 并保留其用量含义。不能为了显示一个新模式名称，改写历史 mode、补字段后按旧格式重新 hash 或损坏任务引用。若需要新的本地来源元数据，先设计最小兼容变更与测试，不在本文凭空指定新的 schema 版本。

## 9. 持久化

根目录为 profile 下 `zotero-chatgpt/v1/`：

| 路径 | 内容 |
| --- | --- |
| `records/papers/*.json` | 附件会话索引 |
| `records/conversations/*.json/.jsonl` | schema 1/2/3 会话和请求日志 |
| `records/conversations/*.<document>.source.json` | 不可变 PDF 来源正文 |
| `records/workspace/settings.json`、`skills/*/SKILL.md`、`drafts/*` | 设置、skill 和草稿 |
| `records/tasks/*.json` | review、intent、结果与撤销账本 |
| `records/reading/*` | 多轮阅读任务 |
| `account/` | 插件专用 Codex home 和官方授权数据 |
| `home/`、`scratch/`、`tmp/` | 受限运行工作目录与临时文件 |

schema 1/2/3 继续可读；缺失字段不补写后冒充旧记录。新增字段需要兼容设计；旧 v3 请求在没有 organization 时保持原 hash。`NativeItemSnapshot` 保持旧 acquisition 形状，整理使用扩展 `NativeOrganizationItemSnapshot`。未知 task kind、损坏文件或 hash 不匹配时安全拒绝并保留原文件。

旧 `archivedAt`、`permissionMode` 等字段仅用于兼容读取，不新增这些旧格式写入。既有 pane ID、CSS 标识和偏好键不因 UI 重排被顺手改名；必要改名必须附兼容判断与宿主回归。

GeckoStorage 使用受限相对路径、符号链接检查、原子替换和 flush；不承诺断电目录级 fsync 或跨文件事务。账户目录不进入普通备份或诊断。

## 10. 宿主和安全约束

`getPageData({pageIndex})` / `getPageLabels2()` 提供字符与页标签；跨 realm 参数复制。Zotero 基础数据里的 `partial` 不能直接当作文本截断状态。

既有 capturePage 只在内存渲染已打开的 PDF，不产生 Zotero 写入，可以留在读端口；pickFile/exportImage 仍经显式文件动作边界，不为界面调整机械迁移无副作用的读取。

Reader.open 与后台引用保留用户已有 tab；只关闭仍由插件拥有且未被接管的临时 tab。PDF.js Xray 只对已经确认的宿主页对象 waive，渲染不改变用户缩放、焦点和当前页。

原生标注使用自身 saveTx，不能再套外层 DB transaction；标签/集合整理沿用 native transaction 与一次 item save。不得绕过 Zotero API 直接改数据库。

strict config 禁止 shell、网络搜索、外部工具、MCP、通用插件、记忆、多 agent 和任意环境继承。旧 diagram 扩展仅在明确选择且已验证能力时沿用其受限例外；发布前整备不扩大该能力，也不把它列为 UI 修复的必需项。

普通诊断只输出版本、阶段、错误码和必要白名单计数，不输出正文、图像、签名、认证、cookie、原始 stdio 或私人路径。用于随机合成 PDF 的测试断言不得反向扩大生产 actor 的读取能力。
