# 当前进度与验收

本页只保留**当前状态、验证边界、剩余差距/下一任务与执行计划**。逐日迭代流水、原样失败记录与旧版证据已搬到 [docs/archive/progress-history-2026-09.md](archive/progress-history-2026-09.md)。代码、单元测试、真实宿主、真实模型与发行物是不同层次的证据，不得互相冒充；未运行项一律保留为 NOT RUN，不补写原因。


## 当前状态（2026-09-14 仓库清理后）

- **Git**：`main` 已把 `codex/product-agent-v0.4` 快进合并（98 个提交逐字保留、历史未改写），随后删除已完成的本地分支与空目录 `.worktrees/`；`origin/codex/product-agent-v0.4` 保留不动，未 push、未打 tag。清理前 HEAD `a7800ce5de13d65d3fe90c5c0313f37db5db26f0` 存于本地安全 ref `refs/backup/pre-cleanup-20260914`。
- **工作树**：干净。本轮只改被跟踪的 `packages/zotero/assets/sidebar.css`（死代码）与本页/其它文档；`dist/`、`build/`、`.zcr-dev/` 的清理不产生提交。
- **开发版本**：npm `0.4.0-alpha.1` / Zotero **`0.4.0a5`**（本轮提升，见 [`manifest.json`](../packages/zotero/manifest.json)）。
- **门禁（2026-09-14 同一树、按序）**：`npm run typecheck` PASS；`npm run lint` PASS；`npm run test:unit` PASS（**计数与条件见下『测试计数（唯一权威）』**）；`npm run package:dev` → `dist/zotero-codex-reader-0.4.0a5-dev.xpi`（**92,665,647 bytes**，SHA-256 `68529c36cfd422268a7f24fc05eaf350b057c1457923d1f8320a6bdc7129261b`）；`npm run verify:artifacts` **84 files PASS**，与 `dist/SHA256SUMS` 一致。均为代码 + 单元 + 产物证据。
- **真实宿主 `--context`（2026-09-14，0.4.0a5，专用 `.zcr-dev/context` 树）**：**PASSED，`32 executed / 32 PASS / 0 FAIL`**，`recordedRequests = 0`，`build` 0.4.0a5 且 SHA-256 `68529c36…` 与产物一致；`automatic-whole-pdf-background-preparation-without-panel` 通过（`productGate` 2/2、10 次自动读取、`preparationObserved: true`）；三个 `pref-pane-copy-*` 检查通过，命中 `Appearance`/`外观` 图例（zh 切换时 skill id/名字逐字不变）；8 项 `notRun`（`real-model-answer`、`official-login`、`in-flight-model-stop`、`long-term-memory`、`image-understanding`、`acknowledge-context-resumes-the-pending-explain`、`pref-pane-visual-theme-and-keyboard`、`pref-pane-registrar-isolated-from-host-auto-unregister`）不得当作通过。报告原样归档 [host-context-0.4.0a5-PASS-32of32.json](../.zcr-dev/verification/scope-2026-09-14-a5/host-context-0.4.0a5-PASS-32of32.json)，SHA-256 `03c7a614f9bd388f6e05c4d2f8e19bbf96734a49aac4178c99bff5b5da18d187`。
- **产物诚实边界**：见下 [产物边界（重要）](#产物边界重要)。
- **本轮（2026-09-14 收尾轮）删除（忽略目录，不产生提交）**：删掉 stale 的 `dist/zotero-codex-reader-0.4.0a4-dev.xpi`（92,661,386 B，SHA-256 `061f4680…`，**从未宿主验证、从未安装**）。删除前已确认宿主已验证的 `.zcr-dev/artifact-backup/zotero-codex-reader-0.4.0a4-dev.host-verified-5a6bb161.xpi` 仍在且 SHA-256 仍为 `5a6bb1616bfe0d54eb2bb6ef5230beb5825c8c1be6e7d5ba29c75b0cb94014cf`。现在 `dist/` 只保留 `zotero-codex-reader-0.4.0a5-dev.xpi` + `SHA256SUMS`。
- **更早清理轮删除（忽略目录，不产生提交）**：`dist/` 旧包 `0.3.0a1`（102,969,823 B）/ `0.4.0a1`（92,643,635 B）/ `0.4.0a2`（92,643,635 B）/ `0.4.0a3`（92,668,286 B）、`build/`（215 MB）、`.zcr-dev/` 旧日志 37 份（11 MB）与旧报告/ `build-info-*.json` 6 份。保留 `.zcr-dev/{profile,data,context,live,verification,pin-bump,probes,fixtures,s6-virgin,s6-upgrade,runtime-cache}` 与 `artifact-backup/`。删除前已用 `ps` 确认无 Zotero 进程使用任何 `.zcr-dev/` profile，且逐文件 `rg` 确认无仓库引用。
- **0.3.0a1 XPI 字节已删除**：`dist/zotero-codex-reader-0.3.0a1-dev.xpi`（102,969,823 B）的字节已不在磁盘上，只能从 tag `v0.3.0a1`（提交 `2b5b310`）重新打包复现。因此历史上**用该真实 a1 包跑过的 s6 升级/回退宿主流程无法逐字重跑**；`tests/build/prepare-s6-upgrade.test.ts` 已改为使用明确合成的本地缺失路径，不再依赖该已删除产物（URL 拒绝与参数配对校验先于任何文件访问；文件存在性校验仍由“两版本不同”用例用真实 fixture XPI 覆盖）。
- **安装状态（2026-09-14 09:03 只读核对）**：owner 正常 profile（`~/Library/Application Support/Zotero/Profiles/mi2zhr2s.default`）当前装的是 **`0.4.0a5`**：`extensions/{8a5f5bde-b4e1-41eb-b5d9-2774afa0cf72}.xpi` **92,665,647 bytes**、SHA-256 `68529c36cfd422268a7f24fc05eaf350b057c1457923d1f8320a6bdc7129261b`，与 `dist/zotero-codex-reader-0.4.0a5-dev.xpi` **逐字节一致**（`cmp` 相同）；`extensions.json` 报 addon version **`0.4.0a5`**（`active: true`，`sourceURI` 指向 `dist/` 的 a5）。mtime：XPI / `extensions.json` / `addonStartup.json.lz4` 均为 `2026-09-14 08:33`，`prefs.js` `08:35`；`prefs.js` **不含** `extensions.startupScanScopes`。替换 a4 时**没有**留下 a4 的当时备份（profile 侧最新只到 `…zcr-bak-20260913-215714-0.4.0a3`）；宿主已验证的 a4 字节仍保留在 `.zcr-dev/artifact-backup/zotero-codex-reader-0.4.0a4-dev.host-verified-5a6bb161.xpi`（`5a6bb161…`），profile 侧回退备份已于本轮补齐（见 [产物边界（重要）](#产物边界重要)）。**这是 profile 变更、不是仓库提交，其本身也不构成宿主验证证据**；没有任何 a5 在 owner 真实文献库被目视/使用的证据。

### 产物边界（重要）

- **canonical `dist` 产物 = `dist/zotero-codex-reader-0.4.0a5-dev.xpi`（92,665,647 bytes，SHA-256 `68529c36cfd422268a7f24fc05eaf350b057c1457923d1f8320a6bdc7129261b`）**，由 `package:dev` 从当前 HEAD 的源码打出现，`verify:artifacts` **84 files PASS**。
- **(a) 这份 a5 已完成真实宿主 `--context` 验证（2026-09-14，专用 `.zcr-dev/context` 树，32/32 PASS，`recordedRequests = 0`）。** 报告原样归档 [host-context-0.4.0a5-PASS-32of32.json](../.zcr-dev/verification/scope-2026-09-14-a5/host-context-0.4.0a5-PASS-32of32.json)（SHA-256 `03c7a614…`）。此前完成真实宿主 `--context` **32/32** 的是 a4 字节（92,661,563 bytes，SHA-256 `5a6bb1616bfe0d54eb2bb6ef5230beb5825c8c1be6e7d5ba29c75b0cb94014cf`，构建于 `96f8c2c`）。
- **(b) 宿主已验证的 a4 字节仍保留**在忽略路径 `.zcr-dev/artifact-backup/zotero-codex-reader-0.4.0a4-dev.host-verified-5a6bb161.xpi`（SHA-256 复核仍为 `5a6bb1616bfe0d54eb2bb6ef5230beb5825c8c1be6e7d5ba29c75b0cb94014cf`）。**owner profile 侧的回退备份也已补上**（2026-09-14 09:03，执行时 `ps` 确认无 Zotero 进程）：`extensions/{8a5f5bde-b4e1-41eb-b5d9-2774afa0cf72}.xpi.zcr-bak-20260914-090331-0.4.0a4`（92,661,563 B，SHA-256 复制后复核为 `5a6bb161…`，与上述忽略路径副本同字节）。这是 profile 文件，不是仓库提交。
- **(c) owner 正常 profile 当前装的是 `0.4.0a5`**（`68529c36…`，92,665,647 B，与 `dist/` 的 a5 逐字节一致），`extensions.json` 报 `0.4.0a5`。a5 的宿主验证仍**只在**专用 `.zcr-dev/context` 树内（2026-09-14，32/32 PASS）；**owner profile 里装的是同一份 a5 字节，但该安装动作本身不构成宿主验证证据**，也没有 a5 在 owner 真实文献库被目视或使用的证据。
- **(d) a5 使用了新的版本串**（`0.4.0a4` → `0.4.0a5`），因此下一次侧载对 owner 可见——不再有“同版本重装 no-op”的脚枪。同版本脚枪的机制说明仍适用于所有同版本重装场景。
- **验收门槛**：a5 已在专用 `.zcr-dev/context` 树完成一次真实宿主 `--context`（2026-09-14，32/32 PASS），据此可称 a5 为**宿主已验证**；但该验证**不含**真实模型、图像生成或公开发行，见下节“未验证 / NOT RUN”。a5 与 `5a6bb161` 的差异除版本字面量外，还有本轮补齐的 5 份第三方许可文件（不改运行行为，但会改变随包字节）。

### 测试计数（唯一权威，2026-09-14 实测）

本页**只有这一处**声明当前测试计数；其它出现过的数字（699/60、746/67、970/76、968+2、629+2 等）都是更早迭代的历史值，已随迭代流水搬到 [归档](archive/progress-history-2026-09.md)，不再作为当前计数。

- 本机（macOS，且 `dist/` 存在**当前 manifest 版本**即 a5 对应的 XPI）实测：**`npm run test:unit` → 990 passed / 77 files / 0 skipped**。
- 去掉该 XPI（例如干净 checkout，或打包前 `dist/` 里只有别的版本）实测：**988 passed / 77 files / 2 skipped**。
- 两个数字比上一版各多 2：本轮为补齐第三方许可新增了 1 条构建断言（`tests/build/build.test.ts`）与 1 条缺失许可拒绝断言（`tests/build/verify-artifacts.test.ts`）。
- 条件（这也是“0 skipped”只是本机属性的原因）：`tests/build/install-lifecycle.test.ts` 里有两条 `it.skipIf`：
  1. `copies the existing packaged XPI into a virgin isolated tree` —— 只有在 `dist/` 存在**当前 manifest 版本**的 XPI 时才复制该包并核对其 SHA-256；
  2. `verifies the Apple signature of the Codex binary inside the existing XPI` —— 除上述条件外还要求 `process.platform === 'darwin'`，用 `/usr/bin/codesign --verify --strict` 校验包内 Codex 二进制。
- CI 说明：CI 打出来的 XPI 是 **darwin/arm64 产物、但在 linux 上构建、且从不宿主执行**。第 1 条只有在“打包后同作业再跑一次 `test:unit`”时才会真正执行——`.github/workflows/ci.yml` 的 `package` 作业已在 `package:dev` **之后**加 `npm run test:unit`（`:47` 后接 `:55`），满足该顺序；第 2 条在 linux runner 上**始终 skip**（无 `codesign`，也非 darwin），故 CI 的 `package` 作业预期为 **989 passed / 1 skipped**。以上 990/988 均为**代码 + 单元**证据，不是宿主或真实模型结论。

## 实际交付路径

- 在当前 PDF 打开 Codex，先显示完整文章标题对应的会话和可输入界面；无需登录即可创建/恢复本地会话。打开本身不产生模型请求。
- 自动本地读取当前附件的全部可提取文本；正文来自 Zotero 原生 getPageData/getPageLabels2 字符接口，保留段落/换行/页标签。上下文可展开预览并返回原页，可指定物理 PDF 页范围，明确未覆盖/空白/失败/partial 页。
- 首次外发范围说明；真实设置可关闭自动全文。发送边界复核其他视图的全局关闭设置；问题、选区、图片、模型设置与请求附件冻结。解析失败/取消不发送书目替代回答，问题保留，准备期间新输入不被旧请求清掉。
- 同附件并发打开不再生成重复会话；同名正文与补充附件隔离。新建对话有独立草稿，切回恢复原草稿；两视图订阅不互相顶掉。删除活动/不确定聊天被拒绝，不把删除当取消、不丢请求日志。
- core 已把全文接入真实 turn/start 参数构造；同会话同来源追问复用，压缩通知/恢复/失败后重新带入原文。全文存为独立不可变 source 文件，逐轮消息只存摘要，避免重复写全文。**这一协议路径已过模拟集成，尚无本轮真实模型回答证据。**

## 验证：基线与现在

开始时 main / HEAD `1fdd3dc`，56 个已有修改/未跟踪文件。未提交、未推送。原内容与 diff 保存在忽略的 `.zcr-dev/verification/scope-2026-09-11/baseline/`；当前 diff 包含这些既有工作，不能全部归为本轮新增。**下表是 2026-09-13 那轮迭代的对照记录；其中的 `test:unit` 数字均已由 [测试计数（唯一权威）](#测试计数唯一权威2026-09-14-实测) 取代，仅作历史。**

| 检查 | 本轮开始 | 当前结果与边界 |
| --- | --- | --- |
| `npm run typecheck` / `npm run lint` | PASS | PASS |
| `npm run test:unit` | 305 PASS / 1 FAIL，39 files | **见 [测试计数（唯一权威）](#测试计数唯一权威2026-09-14-实测)**；早期 699 PASS / 60 files 等历史数字见归档 |
| `npm run package:dev` | 0.3.0a1，sha 196f0dc… | PASS，`dist/zotero-codex-reader-0.4.0a1-dev.xpi`（含固定 runtime 与项目 MIT LICENSE）；本轮重建 digest 仍为 `d33ab244…`（与提交前一致，字节可复现） |
| `npm run verify:artifacts` | 76 files PASS | **77 files PASS**，hash/白名单/许可/无私有记录与 Node 导入；digest 读 `dist/SHA256SUMS` |
| 临时 `git worktree` + `npm ci` 的 clean HEAD 重建 | 未执行 | **PASS**：typecheck PASS；`test:unit` 见 [测试计数（唯一权威）](#测试计数唯一权威2026-09-14-实测)（无 `dist/` 时 2 条 skip）；`package:dev` → 0.4.0a1 XPI；`verify:artifacts` 77 files，digest 与主树一致；复用本地固定 runtime 缓存，未重新下载 |
| `npm run verify:install -- build-info … --json` | 未作为基线执行 | PASS，实际本地 XPI 身份；不等于宿主升级/回退验收 |
| `npm run release:dry-run` | 旧版曾执行 | PASS，githubRelease=null，没有公开上传；脚本说明改指 development |
| `node scripts/prepare-host-test.mjs --context` + 专用 Zotero | 未执行 | 0.3.0a1 曾 **16/16 PASS**；本轮在 **0.4.0a1 复现 16/16 PASS**，signedOut，0 请求记录 |
| `node scripts/prepare-host-test.mjs --context --native` + 专用 Zotero | 未执行 | 旧 0.3.0a1 的 12 项原生驱动；本轮在 **0.4.0a1 复现 12/12 PASS**（4 类 NOT RUN），driverIssuedModelRequests=0 |
| `node scripts/prepare-host-test.mjs --s6 --upgrade-xpi 0.4 --rollback-xpi 0.3` + 专用 Zotero | 旧 a1→a2→a1，19/19 | **22/22 PASS**（2 NOT RUN）：0.3→0.4→0.3 版本切换、记录保留、新 schema 回退安全拒绝 |
| 文档链接 / `git diff --check` / 构建依赖图 | 旧入口相互重复/冲突 | 12 个维护/保护文档链接目标有效；diff 无空白错误；生产图覆盖 37 个运行 TS 模块，另有必要的 host-types 纯类型模块 |
| `.github/workflows/ci.yml` / `release.yml` | Node 只写 `24`（浮动 major），只跑 typecheck/lint/test:unit，从不打包 | Node 改为 `node-version-file: .nvmrc`（24.11.0，与 engines `>=24 <25` 一致）；`check` 跑 `npm ci`/`typecheck`/`lint`/`test:unit`，`package` 跑 `runtime-prepare`/`package:dev`/`verify:artifacts`；无 upload/publish/tag 步骤，宿主与 `--live` 明确排除 |

工具链 Node 24.11.0 / npm 11.6.1。当前开发包：`dist/zotero-codex-reader-0.4.0a1-dev.xpi`；`package:dev` + `verify:artifacts` 实测 **77 files**，SHA-256 以 `dist/SHA256SUMS` 为准。**2026-09-13 分支合并后的树**实测 **`24d82e17ca2f1bae5ee5b2806d69845c600bed63a848abd070fb2321e9baf534`**（含重绘 icon.svg）；上节宿主证据对应的合并前构建为 **`d33ab244f49e24da983daa2bfdbf542b8f6f28c5b40ad5b295ffd8c613311049`**。项目 MIT `LICENSE` 已随包。实际固定二进制 `codex-cli 0.154.0`（`runtime/manifest.ts` 的 `codexVersion`；此处旧文档曾误写 0.144.1，0.144.1 是上一轮升级前的历史值），其生成的实验 JSON schema 在 verification/protocol。model/list 没有初始上下文窗口，tokenUsage 通知的 modelContextWindow 可为 null；当前显示未知，未猜容量。

宿主实际覆盖：完整 XPI 加载；标题/输入先可用；两页文本与罗马/数字标签；本地/未发送说明；页范围遗漏；返回原页和关闭保留页；signedOut 本地会话；同父/同名附件隔离；草稿恢复；30 次开关/设置；单一 dock/按钮；无模型请求记录。报告：[本轮宿主报告](../.zcr-dev/verification/scope-2026-09-11/host-current-pdf.json)。未读取/复制认证文件，未向真实库写条目。CUA 在关闭测试实例后自动重选日常窗口，随即停止该窗口操作；之后仅按已核对的专用 PID 管理测试进程。

## 性能实测与失败修复

Apple M5 / 16 GB / macOS 26.6.2 (25G83)，Zotero 9.0.6，1000×600 CSS px，DPR 2，**两页合成 PDF，全文范围，未调用模型**。计时使用 performance.now，按恢复会话＋可用输入或设置导致的上下文状态变化判定，10ms 轮询。是 DOM 可交互/状态更新测量，不是硬件输入到屏幕呈现延迟。

| 项目 | 样本 | 当前数值 |
| --- | --- | --- |
| 缓存 sidebar 打开可交互 | n=30 | p95 **8.25ms**，max 8.27ms |
| 本地设置有效状态反馈 | n=30 | p95 **1.28ms**，max 1.44ms |
| 首次插件输入出现 / 本地文本准备 | 各 n=1，PDF 已加载 | 4.80ms / 177.93ms |

0.4.0a1 同一驱动重跑（2026-09-13，报告内环境 1512×949 DPR 2，同一台 M5，两页合成 PDF，未调用模型）：

| 项目 | 样本 | 0.4.0a1 实测 |
| --- | --- | --- |
| 缓存 sidebar 打开可交互 | n=30 | p95 **22.23ms**，max 26.25ms |
| 本地设置有效状态反馈 | n=30 | p95 **2.39ms** |
| 首次插件输入出现 / 本地文本准备 | 各 n=1 | 9.07ms / 83.99ms |

两次都满足 250ms/100ms 门槛；0.4 数值更高来自本机负载与更多的本地持久化/工作区初始化，样本仍是 DOM 可交互测量，不能外推为硬件呈现延迟或长时压力结论。

该样本满足对应 250ms/100ms 初始门槛；未测整个 Zotero 冷启动、真实论文/长书、模型等待/流式渲染、长时内存/多显示器/全部主题，不能外推。

首次宿主运行真实失败：标准 page.getTextContent 在 Zotero 9.0.6 不存在；原生 getPageData 跨窗口直接传对象又产生 DataCloneError。专用 Run JavaScript 实测 Cu.cloneInto 后返回第一页 1278 字符，已据此替换旧接口并重跑成功。之后驱动报告汇总 PathUtils.join 的复合路径参数失败，改为逐段路径后全通过。两份失败报告保存在 verification/host-before-*.json，不删除或包装成 PASS。曾尝试的 install CLI --help 不支持，已将文档换成实际 build-info 命令。

## 剩余差距与下一任务

| 要求 / 代码位置 | 现在与缺口 | 迭代 |
| --- | --- | --- |
| 标题/会话/全文：reader/document、chat、core/sessions | 上述本地/协议链路已验证；真实模型问答、选区全文推理/引文质量、host 文件替换和多窗口未测 | B |
| 预算/长文/缓存 | 本地文本缓存最多 **3 份、每份 16 MiB UTF-8**，超限要求缩小页范围；来源 ID 由文献身份/版本/解析器/页范围/文本摘要确定性生成，LRU 驱逐不改变身份；加载字节与磁盘 SHA-256 比较可发现 size/mtime 不变的替换。已接 runtime 窗口优先、否则固定 catalog 的预算与聚焦/多轮计划；自动章节/问题检索、语义坐标、OCR/页面图片仍未接。以上为代码+单元证据，真实模型预算行为未测 | B |
| 历史/恢复：presenter/store | 离线历史、草稿/滚动持久化、改名/分支/排队、schema 3 读写与旧 schema 1/2 安全拒绝已有代码与单元回归；**0.3↔0.4 宿主升级/回退与 schema-3 回退安全拒绝本轮已在 s6 隔离树验证（22/22）**，真实模型在途恢复仍未测 | B/C/F |
| 统一 @文章/@chat、/skill、personalization | WorkspaceStore、@article 元数据先行/选定后读取、@chat 有界快照、SKILL.md 解析与 revision 冲突、偏好/研究配置已有代码与单元；第三方 skill 仍不能授予权限。真实库接线与 UI 目视未验 | C |
| 模型/多模态/上下文 | 固定 catalog 模态/窗口、provider 能力与 rate-limit 解析、每轮预算、粘贴图片、生成图 16 MiB 校验与导出、diagram 线程能力已有代码与单元；真实档位/多图/真实图像生成、文件拖拽/截图排序、精确用量与完整已发送/已引用面板仍未测 | C |
| 标注 / 获取整理 agent | 候选 JSON 解析、按 PDF 版本原文定位、任务审批、账本写意图/撤销/冲突检测、DOI/链接查重与 OA 附件校验已有代码与单元；真实库原生写入/撤销、网络预览与合法全文核对未在宿主验证 | D/E |
| 设置/偏好设置窗口：preferences-*、workspace-store | 原生面板注册/清理、面板端口与快照写入、侧边栏去重已有代码与单元；**2026-09-13 已在真实宿主预检：注册身份正确、真实 Preferences 窗口能挂载面板（沙箱桥对片段可见）、禁用/启用不叠加、无错误日志**；**面板文案已随 store 的 `uiLanguage` 本地化，并在真实 Preferences 窗口实测双向切换（zh：图例 `对话`、store 读回 `zh`、六个内置 skill 的 id/名字逐字不变；切回 en：`Chat`、store 回 `en`）**。仍缺面板的中文**视觉**（字体回退、暗色/亮色、键盘 Tab）、打开窗口时的真实 store 并发，以及片段挂载前占位与“插件未运行”告警的英文（那时没有可读 store，无持久化语言可用） | F |
| 论断溯源：reader/locate、reader/source-highlight、reader-policy | 冻结 revision 校验、逐字引用定位与临时高亮导航、诚实 miss、无库写入已有代码与单元；**2026-09-13 已在真实宿主用生产 `nativeSourceNavigator`+`openSourcePage` 以合成 quote 实跑：回到引用页 `highlighted`、缺失 quote 诚实 `unlocated`、无库写入**；仍缺真实 Gecko 高亮**视觉**、长引用真实定位质量、以及真实模型是否输出逐字引用（点击真实回答链接的完整路径未验） | F |
| 安装/登录/发行/性能 | 项目已按 MIT 许可并在包内包含 `LICENSE`；第三方库/字体许可本轮已补齐（见上表许可行）。本轮实测 `package:dev`/`verify:artifacts` → a5（**84 files**），且 a5 已在专用 `.zcr-dev/context` 树完成真实宿主 `--context`（32/32 PASS，`recordedRequests = 0`）；owner profile 现也装的是这份 a5（`68529c36…`，与 `dist/` 一致；该 profile 安装本身不是宿主验证证据，也无真实文献库目视证据）。官方新登录、真实输出/停止/在途恢复、无 Node/下载隔离、长时压力、完整原生视觉矩阵、公开签名发行均未完成；干净 checkout 重建历史上复现过一次、本轮未重跑 | F |
| 草稿持久化：**已按代码判定（旧文档矛盾已更正）** | **未发送草稿会持久化到磁盘并在插件重启后恢复**，旧文档“仅寿命内保留、重启不会恢复”的表述为**错误**，已删除。代码链路（**代码 + 单元**证据，非宿主）：输入/设置/滚动变化在 `presenter.ts:260-268` 的 `stageDraft` 里经 150 ms debounce 进入 `flushDraft`（`:271-285`）→ `workspace.saveDraft`（`:280`）；插件关闭时 `index.ts:332` 的 `shutdown` 屏障对每个 presenter 强制 `flushDraft`。落盘由 `packages/core/src/workspace/store.ts:225-231` 的 `saveDraft` 写入 `workspace/drafts/<clientId>-<libraryId>-<attachmentKey>-<conversation>.json`（路径拼装在 `:191-193`），记录根目录由 `packages/zotero/src/runtime/local-services.ts:13-15` 的 `zotero-codex-reader/v1/records` 决定；`clientId` 来自 `index.ts:21` 的持久 pref `extensions.zcr.clientId`（`clientId()` 在 `:46-50`），跨重启/升级稳定。恢复在 `presenter.ts:243-251` 的 `loadLocal`（`:230`）里 `workspace.readDraft` 完成，`loadLocal` 由 `activate()`（`:613-614`）调用；只有持久化的 `pageRange` 被**故意**不恢复（`:246-249`，schema 保留但始终写 null）。**仍未做**：在专用 profile 重启后对“草稿实际恢复到输入框”做端到端宿主观察（本轮未运行宿主），故“重启后恢复”当前仅为代码/单元结论 | B |
| 许可/第三方声明缺口（**本轮已补齐**） | 已补齐。用 esbuild metafile 实测 `content/zcr.js` 真正打包的逐包文件：`linkify-it@5.0.2`、`mdurl@2.1.0`、`uc.micro@2.1.0`、`punycode.js@2.3.1` 均为 MIT，`entities@4.5.0`（**markdown-it 的嵌套副本**）为 BSD-2-Clause。注意版本判定：`punycode.js` 不是同名 hoisted `punycode@2.3.1`（后者只在 eslint→ajv→uri-js 的 dev 链上、不打包），`entities` 也不是根目录 hoisted 的 `entities@7.0.1`（happy-dom 的 dev 依赖）。已在 `scripts/build.mjs` 的 `copyThirdPartyAssets` 随包 `content/assets/licenses/{linkify-it,mdurl,uc.micro,punycode.js,entities}.LICENSE`（源文件名分别为 `LICENSE`/`LICENSE`/`LICENSE.txt`/`LICENSE-MIT.txt`/`LICENSE`），`scripts/verify-artifacts.mjs` 的 `requiredLicenses` 已把这 5 个列为必需，`tests/build/build.test.ts` 与 `tests/build/verify-artifacts.test.ts` 已加“缺一即拒绝”的断言（仅加强）。以上为代码 + 单元 + 产物证据。`runtime/README.md` 第 7 行关于 Rust 侧 Codex runtime 的“complete release dependency/license audit remains an S6 task”是对固定运行资产的独立声明，本轮未动 | 已完成 |

**下一条可执行任务（含本轮新增）**：`--context` 已能程序化打开真实偏好设置窗口、确认 `Zotero Codex Reader` 面板挂载与禁用/启用幂等，并在该窗口内实测面板文案随 store 语言双向切换；`close-preserves-current-page` 的间歇性丢失已定位为 pdf.js 提交页/位置之间的真实竞态并修复，驱动另有 `reopen-keeps-current-page` 守住“关闭再打开仍回到同页”。剩余的是**目视**核对面板（中文/英文、暗色/亮色、键盘 Tab、保存与导出失败提示）与真实 Gecko 临时高亮的**视觉**表现，需人工对照；随后在用户通过官方流程登录的隔离 profile 中，仅用合成材料验证“无需选区提问＋跨页定义＋More details＋停止＋模型设置切换”和真实图像生成（含真实模型回答里引用链接的点击路径）；随后用真实宿主复核最终 0.4 XPI 的原生任务/获取 UI，再按 F 的门槛处理升级/回退、无 Node 安装与公开签名发行。本轮未调用真实模型，不能把过去限额日期当作现在的阻塞证据。

人工试用：按 development 的 `--context --acceptance` 方式运行，移除自动驱动再使用；保留合成文献和已保存会话；未发送草稿**会**持久化并在插件重启后恢复（代码链路见上表“草稿持久化”行；此结论为代码/单元证据，重启后的端到端宿主观察仍未做）。无需 Node/CLI 的最终用户安装体验仍等待发行验收。

## 当前全量执行计划

- [x] 重新验证整合基线，建立功能分支与本地 checkpoint；收敛剩余旧文档。
- [x] B（代码+单元）：稳定文件/来源身份，预算与长文覆盖，草稿/滚动持久化、全局历史/改名/分支/排队、离线历史；代码在 contracts、core/sessions、reader/document、chat/presenter。
- [x] C（代码+单元）：可持久化 WorkspaceStore（偏好/研究配置/skills/引用）、统一 @文章/@chat 与 /skill；冻结本轮版本和权限。
- [x] UI（代码+单元）：单标题/四区、自然布局 composer、统一候选键盘交互、稳定消息 DOM、字号/焦点/图像预览；view.ts/sidebar.css 单一写入负责人。
- [x] D（代码+单元）：原生 quote 定位适配＋持久化任务 ledger；模型产生候选，审批后写入，冲突检测与撤销；真实库标注仍待宿主验证。
- [x] E（代码+单元）：DOI/链接/列表未保存元数据、查重、指定 collection、OA PDF 校验与恢复；原生适配与 ledger 共用；网络/真实库未验。
- [x] 多模态/能力（代码+单元）：模型目录/usage/上下文预算来源；粘贴/截图多图；固定 runtime 图像生成能力与 16 MiB 生成图校验；真实模型图像生成未验。
- [ ] F（BLOCKED）：真实隔离登录/问答/停止/恢复、各用户路径、主题/窄窗/大字/压力、无 Node/公开下载仍在对应条件成立时验收。**版本升级/回退与 schema-3 回退安全拒绝本轮已在 s6 隔离树验证（22/22）**；仍需要隔离官方登录、真实模型、真实宿主原生 UI、签名 XPI 与公开发布授权。
- [x] 合并 `feat/usage-batch-1` 与 `fix/audit-bugs-ui` 并补完耗时 UI（代码+单元）：两侧测试均保留，全量 `test:unit` 连续两次通过（计数见 [测试计数](#测试计数唯一权威2026-09-14-实测)），重打包 `verify:artifacts` **77 files**；真实宿主/模型仍未重跑。
- [x] 设置迁移（代码+单元+**2026-09-13 宿主预检**）：全局设置进入 Zotero 原生偏好设置面板（注册/反注册/失败与关闭竞态已测），侧边栏只保留每对话内容并指向原生设置；XPI 已含片段与脚本，`verify:artifacts` 把它们列为必需文件。**真实宿主已确认面板注册身份、Preferences 窗口挂载、禁用/启用幂等，以及面板文案随 store 的 `uiLanguage` 双向切换且 skill id/名字逐字不变**；面板的中文**视觉**（字体回退/主题/Tab）仍待宿主目视。
- [x] 阅读锚点竞态（代码+单元+**2026-09-13 宿主复核**）：`close-preserves-current-page` 的间歇失败定位为 pdf.js “跳页已提交、`_location` 尚未刷新”的真实竞态；`capturePosition` 改以已提交页为准、`setZoom` 先对齐恢复目标，失败优先单测先在未修复代码上失败；最终包连续 5 次 `--context` 23/23 PASS（另 `--context --native` 13/13），并新增 `reopen-keeps-current-page`。未复现失败的统计局限已在文中写明。
- [x] 论断溯源（代码+单元+**2026-09-13 宿主预检**）：点击引文先校验冻结 revision，再按链接 title 的逐字引用在冻结页面字符盒上定位，命中才做临时高亮，未命中诚实提示；点击路径无任何库写入。**真实宿主已用生产 `nativeSourceNavigator`+`openSourcePage` 与合成 quote 确认回到引用页的临时高亮导航、诚实 miss 与无库写入**；真实 Gecko 高亮**视觉**与真实模型是否遵守逐字引用指令仍未测。
- [x] CI 计时（代码+单元，2026-09-13）：`check` 作业在全量并行下超时的一类根因是**多兆字节 base64 往返叠加 vitest 对多 MiB `Uint8Array` 的通用深比较**（3 MiB 单次深比较实测 **~2.4s**，而 base64 编解码本身仅 ~110ms）。`reader-library.test.ts` 的导出上限用例改为精确的 **2 MiB+1** 边界（隔离 2.7s→**1.8s**，全量并行 **~3.5-4.3s**），`generated-image.test.ts` 的 16 MiB 边界用例补上与既有先例一致的 **15000ms** 显式预算（隔离 **~1.7s**，全量并行 **~3.0-4.5s**）；工作、边界与断言均未删改，也未全局抬高 `testTimeout` 或降低 worker 并发。本机连续 3 次全量通过（计数见 [测试计数](#测试计数唯一权威2026-09-14-实测)）；另用 12 与 30 个 CPU 占用进程施压仍全绿（两个重测分别 ~7.3s 与 ~12.8s，均在预算内），未施压时最坏 ~4.5s。以上为单元/打包证据，不是宿主或真实模型结论。
- [x] 0.4.0a3 版本提升、门禁、打包与产物校验（代码+单元+产物）：提交 `8828c15`；`typecheck`/`lint` PASS、`test:unit` PASS（计数见 [测试计数](#测试计数唯一权威2026-09-14-实测)；该轮历史数字见归档）、`package:dev` → `dist/zotero-codex-reader-0.4.0a3-dev.xpi`（92,668,286 bytes，SHA-256 `3abeb8c2…`）、`verify:artifacts` 79 files PASS；owner profile 已装入 a3 供验收（profile 变更，非仓库提交）。**但真实宿主不等同通过**：见下条。
- [ ] 真实宿主 `--context`（2026-09-13 0.4.0a3）：**FAILED**。新阶段（`b9165c1`）首次真机运行，在 `automatic-background-preparation` 处 60s 超时（5 项已通过；两次运行同一处未满足），报告原样归档于 `.zcr-dev/verification/scope-2026-09-13-a3/`；未修改驱动、未重试到通过。产品侧根因未定位，后续检查因此都未跑到。`--live-model`（需 owner 登录）仍 NOT RUN。
- [x] 0.4.0a4 版本提升、门禁、打包与产物校验（代码+单元+产物）：提交 `96f8c2c`；`typecheck`/`lint` PASS、`test:unit` PASS（计数见 [测试计数](#测试计数唯一权威2026-09-14-实测)；该轮历史数字见归档）、`package:dev` → `dist/zotero-codex-reader-0.4.0a4-dev.xpi`（92,661,563 bytes，SHA-256 `5a6bb161…`）、`verify:artifacts` 79 files PASS；owner profile 已装入 a4 供验收（profile 变更，非仓库提交）。
- [x] 真实宿主 `--context`（2026-09-13 0.4.0a4，**取代 a3 的 FAILED 结论**）：**32 executed / 32 PASS / 0 FAIL**，`recordedRequests = 0`，`build` 0.4.0a4 且 SHA-256 与产物一致；首次命中 `Appearance`/`外观` 图例 canary；a3 曾失败的 `automatic-whole-pdf-background-preparation-without-panel` 通过（`productGate` 2/2、10 次自动读取、`preparationObserved: true`）。报告归档 `.zcr-dev/verification/scope-2026-09-13-a4/`。8 项 `notRun`（含 `--live-model` 需 owner 登录）不得当作通过。
- [x] 死代码清理（代码+单元，2026-09-13）：移除 `sidebar.css` 中已无引用的 `.zcr-history-archived-label` 规则，并删掉 `sidebar-styles.test.ts` fixture 中同 class 的无断言 span；提交 `f1e8044`，清理后全量通过（计数见 [测试计数](#测试计数唯一权威2026-09-14-实测)）。
- [x] 死代码清理（代码+单元+产物，2026-09-14）：全仓引用核对（含 `rg`、`knip`、`.github`/scripts/bootstrap/manifest/locale/xhtml 动态入口）后删掉三处零引用导出：`chat/text-scale.ts` 的 `chatScaleFromReaderZoom()`（自基线 `38b047c` 起无调用的 no-op），`core/workspace/history.ts` 的 `parseHistoryListing`/`parseHistoryReport`（生产与测试都直接用 `isHistoryListing`/`isHistoryReport` 守卫，这两个包装从无调用），以及 `chat/pick-images.ts` 里被 `reader/library.ts` 原生 `filePicker` 取代的文件选择路径（`ImageFilePicker`/`pickImageAttachments`/`GeckoFilePicker`/`pathsFromPicker`/`geckoPickImageFiles` 与其 `ChromeUtils`/`IOUtils` 声明）。三次独立小提交。`typecheck`/`lint` PASS、`test:unit` 与基线一致（`dist/` 含当前版本 XPI 时 **989 passed / 1 skipped**，无 XPI 时 988 passed / 2 skipped，0 failed），`package:dev` + `verify:artifacts` 仍 **84 files PASS** 且 SHA-256 仍为 `68529c36…`——**与清理前逐字节一致**，因为这些导出本就被 esbuild tree-shake 出 `content/zcr.js`，删源码不改变随包产物。剪贴板/粘贴图像路径（`imagesFromClipboard`/`imagesFromGeckoClipboard`/`imageFromBytes` 等）与 `isHistoryListing`/`isHistoryReport`、`unavailable()`、`CHAT_TEXT_SCALE_DEFAULT` 均保留在用。
- [x] 开发 XPI 安装流自校验（代码+单元+只读真实 profile，2026-09-13）：新增 `npm run install:dev`（`plan`/`install`/`check`/`revert`/`rollback`）与 18 条单元/临时树回归（`test:unit` 计数见 [测试计数](#测试计数唯一权威2026-09-14-实测)），脚枪与命令见 development；真机 `check` 仍需一次目标 profile 重启才能证明，owner 当前实例按决定未重启。
- [x] 草稿持久化文档更正（代码+单元）：独立代码复核证实未发送草稿**会**持久化并在插件重启后恢复，删除旧的“仅寿命内保留”错误表述并补 `file:line`（`presenter.ts:230,243-251,260-268,271-285`、`index.ts:21,46-50,332`、`store.ts:191-193,225-231`、`local-services.ts:13-15`）。
- [x] s6 测试去依赖已删产物（代码+单元）：`tests/build/prepare-s6-upgrade.test.ts` 不再引用已删除的 `dist/zotero-codex-reader-0.3.0a1-dev.xpi`，改用明确合成的本地缺失路径；文件存在性校验仍由“两版本不同”用例覆盖。
- [x] 第三方许可补齐（代码+单元+产物）：5 个缺失声明（`linkify-it`/`mdurl`/`uc.micro`/`punycode.js`，均 MIT；`entities@4.5.0`，BSD-2-Clause）随包，`build.mjs` 拷入、`verify-artifacts.mjs` 必需、两条构建断言覆盖；`verify:artifacts` 由 79 files 升到 **84 files**。
- [x] 0.4.0a5 版本提升、门禁、打包与产物校验（代码+单元+产物）：`typecheck`/`lint` PASS、`test:unit` PASS（计数见 [测试计数](#测试计数唯一权威2026-09-14-实测)）、`package:dev` → `dist/zotero-codex-reader-0.4.0a5-dev.xpi`（**92,665,647 bytes**，SHA-256 `68529c36…`）、`verify:artifacts` **84 files PASS**。owner profile 已换上这份 a5 字节（`68529c36…`，`extensions.json` 报 `0.4.0a5`；profile 变更，非仓库提交，也不是宿主验证证据）；stale 的 `061f4680` a4 已删，宿主已验证的 `5a6bb161` 字节仍在 `.zcr-dev/artifact-backup/` 并已补 profile 侧回退备份。见 [产物边界（重要）](#产物边界重要)。
- [x] 真实宿主 `--context`（2026-09-14 0.4.0a5，**取代 a4 的 32/32 结论**）：**32 executed / 32 PASS / 0 FAIL**，`recordedRequests = 0`，`build` 0.4.0a5 且 SHA-256 `68529c36…` 与产物一致；a3 曾失败的 `automatic-whole-pdf-background-preparation-without-panel` 通过（`productGate` 2/2、10 次自动读取、`preparationObserved: true`）；三个 `pref-pane-copy-*` 通过（命中 `Appearance`/`外观` 图例，zh 时段内 skill id/名字逐字不变）。8 项 `notRun` 与报告逐字一致，不得当作通过。报告原样归档 `.zcr-dev/verification/scope-2026-09-14-a5/host-context-0.4.0a5-PASS-32of32.json`（SHA-256 `03c7a614…`）；未修改任何驱动/断言/超时，未读到任何认证文件，未向真实库写入。
- [ ] 收尾：干净 checkout 重建（历史上已在临时 worktree 复现过一次，本轮未重跑）；CI/release 工作流已按真实脚本与 `.nvmrc` 加固且保持无 upload/publish；产物/隐私/文档链接复查仍待执行，只留必要测试/运行资产。

UI 参考已只读核验本机官方扩展 26.908.31748 的样式资产；不是复制源码/品牌。使用 28px 桌面控件、宿主字体/主题、4/8/12/16px 间距、13px 正文和克制边框。原生宿主视觉还须在改动后实际检查。

## 下一阶段计划（2026-09-14）

以下五个 epic 各自独立可交付；每项写明**目标**、**能真正证明它的证据类别**与**阻塞**。总体拆分见本节末。

### Epic A — 真实模型行为（隔离合成数据）

- 目标：一次补齐整个 **real model** 证据类：回答/流式/停止/在途恢复、无选区提问、跨页定义、More details、会话中途切换模型设置、图表/公式读取、引用链接点击路径、图像生成、配额/用量诚实。
- 证据类别：**真实模型**（隔离合成数据 + 真实请求记录与报告）。
- 阻塞：owner 本人须在 `.zcr-dev/live/` 隔离树完成**一次**官方登录并授权配额；agent 不登录、不代替走 OAuth。
- 文件：`tests/host/live-model-driver.js`、`tests/host/context-driver.js`。

### Epic B — 长文档与多模态读取覆盖（autonomous）

- 目标：把扫描页从"记录 `status:'empty'/'error'` 后停止"（`packages/zotero/src/reader/document.ts:90-113`）升级为可选、需显式授权的 OCR 端口；把 `packages/core/src/context/planner.ts:113-122` 的纯词重叠页打分升级为章节/段落切分 + 问题检索；在图像预算内把图/公式页**自动**附加为页图（`packages/core/src/codex/model-capabilities.ts:103-128`）——今天只有 `packages/zotero/src/reader/library.ts` 的手动 `captureRegion`/`capturePage`。
- 证据类别：**代码 + 单元**（自主）；真实识别/读取质量仍需 Epic A 的真实模型与宿主材料。
- 阻塞：无（自主可做）；真实宿主/模型结论依赖 Epic A。

### Epic C — 工作区作者能力与统一范围对象（autonomous）

- 目标：(1) skill 创建/编辑/复制/导入/导出/试跑 UI —— presenter 的 CRUD 已存在（`packages/zotero/src/chat/presenter.ts:410-440`）但**没有任何 view 调用**，`packages/zotero/src/workspace/preferences-pane.ts` 只切 `enabled`（`:469`）；(2) research-topic profile 与 per-chat override —— 数据层在 `packages/contracts/src/workspace.ts`，UI 曾被移除，需重建；(3) 固定来源 + 从选中来源新建会话；(4) `@collection`/`@note`/`@annotation` —— kind 已在 `packages/contracts/src/workspace.ts:42` 声明，但 `packages/zotero/src/reader/library.ts:306` 的 `search()` 只返回 `article`；(5) 参考文件拖拽（今天只有图片）。
- 证据类别：**代码 + 单元**；UI 目视与真实库接线归 Epic D。
- 阻塞：无（自主可做）。

### Epic D — 视觉/交互/长时验收（mostly OWNER-gated）

- 目标：偏好设置面板中/英 + 暗色/亮色 + 键盘 Tab 视觉；真实 Gecko 高亮视觉；阅读锚点视觉；真实 IME；多窗口一致性；窄窗/多显示器/主题溢出；reduced-motion 契约。
- 证据类别：**真实宿主视觉**（截图/录屏 + 人工对照）。
- 阻塞：需 owner 在场的真实 GUI 与目视判定；部分项（overflow/reduced-motion 等契约级检查）可自主做，但"目视"结论不能由 agent 代签。

### Epic E — 发行与安装生命周期（OWNER-gated）

- 目标：无 Node 安装、下载隔离、干净 checkout 重建、升级/回退、**签名**公开发行，全部在**真实产物**上验证。
- 证据类别：**真实产物 + 签名发行**。
- 阻塞：签名与公开发行需 owner **明确授权**（当前会话授权不含 push/publish/付费服务）。

### 拆分：谁能证明什么

- **没有 owner 就不能证明**：Epic A 全部（需官方登录 + 配额授权）；Epic D 的目视/IME/多窗口结论；Epic E 的签名公开发行与"真实产物上的升级验收"。
- **自主 agent 可证明（代码 + 单元）**：Epic B 的 OCR 端口/章节检索/自动页图接线；Epic C 的全部技能作者 UI、研究 profile、固定来源、`@` 扩展与拖拽；Epic D 中契约级的 overflow/reduced-motion/主题类检查（仅代码层，非目视）；Epic E 的干净 checkout 重建、无 Node 安装脚本路径与下载隔离（**不含**签名发行）。
- 关键：Epic A 的阻塞是**账号授权，不是代码**；在 owner 完成一次官方登录前，任何"真实模型行为已通过"的说法都不成立。Epic E 的签名/公开发行在本会话授权之外，必须另行批准。

## 未验证 / NOT RUN（不得当成通过）

本轮（2026-09-14 收尾轮：草稿文档更正、s6 测试去依赖、补齐第三方许可、a5 版本提升）跑了 `typecheck`/`lint`/`test:unit`/`package:dev`/`verify:artifacts`，并对 a5 在专用 `.zcr-dev/context` 树跑了真实宿主 `--context`（**32/32 PASS，`recordedRequests = 0`**）；**未运行任何真实模型、图像生成或公开发行检查**。owner 正常 profile 现装的是同一份 a5 字节（`extensions.json` 报 `0.4.0a5`），但那是 profile 变更、**不是**本轮证据，也没有 a5 在 owner 真实文献库被目视/使用的证据。当前仍未验证：

- 真实模型输出/流式/停止/在途恢复（`--live` 与 `--live-model` 均 NOT RUN；`--live-model` 需 owner 本人在 `.zcr-dev/live/` 隔离树完成一次官方登录）；真实图像生成；真实文献库原生标注写入与撤销；`--context` 报告里的 8 项 `notRun`（`real-model-answer`、`official-login`、`in-flight-model-stop`、`long-term-memory`、`image-understanding`、`pref-pane-visual-theme-and-keyboard`、`pref-pane-registrar-isolated-from-host-auto-unregister`、`acknowledge-context-resumes-the-pending-explain`）。
- 面板中/英文与暗色/亮色的**目视**、键盘 Tab、真实 **IME** 输入、真实 Gecko 临时高亮**视觉**、真实阅读锚点目视；真实文献库 PDF 是否与合成 fixture 行为一致。
- 无 Node 环境安装、下载隔离、公开签名发行与升级验收；干净 checkout 重建（历史上已在临时 worktree 复现过一次，本轮未重跑）。
- **a5 的宿主证据**：a5 已在专用 `.zcr-dev/context` 树完成真实宿主 `--context`（2026-09-14，**32/32 PASS，`recordedRequests = 0`**），报告原样归档 `.zcr-dev/verification/scope-2026-09-14-a5/host-context-0.4.0a5-PASS-32of32.json`（SHA-256 `03c7a614…`）。该运行**只**证明当前合成 PDF 的本地路径、原生 UI/会话/附件切换、偏好面板注册与中英文图例切换、以及合成性能样本；它**不**证明真实模型输出/流式/停止/在途恢复、图像生成、原生库写入、无 Node 安装或公开发行。`--live-model`（需 owner 登录）仍 NOT RUN。
- a3 的 `--context` 失败（`automatic-background-preparation` 60s 超时）已被 a4 的 32/32 取代；a3 失败报告与过程原样保留在归档。


## 历史

- 逐日迭代流水、原样失败报告、旧版证据与历次清理记录：见 [docs/archive/progress-history-2026-09.md](archive/progress-history-2026-09.md)（2026-09-14 从本页搬出，内容未改写，仅调整相对链接）。
- 被删除的旧文档与旧代码的原文可从归档中记录的基线提交查看。

