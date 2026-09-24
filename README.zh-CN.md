# Zotero ChatGPT

[English](README.md) · [下载 v0.1.1](https://github.com/kianmax0/zotero-chatgpt/releases/tag/v0.1.1)

**在 Zotero 里用 ChatGPT 读论文，用 Codex Agent 完成受控操作。**

Chat 在 PDF 旁打开 ChatGPT 官网，默认准备当前文献的书目信息与已保存摘要；选中的原文可单独加入问题。Agent 是独立模式，可解释论文、验证后写入 Zotero 原生高亮，并在文献库中发现、获取和整理文章。只有你明确切换时才进入 Agent；Chat 不发起 Codex 模型请求。

> 下方演示使用当前 `main` 开发包。可下载的 v0.1.1 发行包较旧，尚不包含演示中的全部功能。

## 功能与演示

阅读器中的 Agent 高亮须先验证原文及位置；本次明确要求的可靠高亮自动写入。其它写入会先预览并等待批准，随后读回 Zotero 结果。Figure 与文献库的模型链路在当前开发包仍属实验功能，实测范围见[进度记录](docs/progress.md)。Agent 模型请求使用 Codex 额度，需单独登录；Chat 不需要 API key，也不使用 Codex 额度。

以下演示使用 Silver 等人的 [AlphaGo 论文](https://doi.org/10.1038/nature16961)，在隔离 Zotero 文献库中完成。GIF 由同一次真实 Agent 任务的窗口截图剪辑而成，切换处不是连续录屏。

**选区提问：** 选中论文原文并点击 **More details**，在 ChatGPT 官网获得回答。

![Silver 论文选区经 More details 发往 ChatGPT 官网并获得回答。](docs/media/silver-chat-answer.gif)

**Agent 论文问答：** 独立的 Codex 会话回答问题并标出页码。

![Codex Agent 回答策略网络与价值网络的问题并给出页码。](docs/media/silver-agent-answer.gif)

**高亮关键段落：** Agent 验证策略网络、价值网络和蒙特卡洛树搜索的原文后，写入三条 Zotero 原生高亮。

![Agent 任务显示三条已写入的高亮、来源段落，以及 Silver 论文中的黄色标记。](docs/media/silver-agent-highlights.gif)

**圈画 Figure 1：** 框选图表、审核候选，并批准两组 Zotero 原生图像区域与 ink 标注。

![框选 Figure 1、审核两组圈画并查看保存后的 Zotero 原生标注。](docs/media/silver-figure-callout.gif)

**定位结果：** 从任务记录跳到 PDF 中保存的高亮，包括第 485 页的价值网络段落。

![Agent 任务与 Silver 论文第 484、485 页对应的原生高亮。](docs/media/silver-highlight-navigation.gif)

## 安装

从 [v0.1.1 Release](https://github.com/kianmax0/zotero-chatgpt/releases/tag/v0.1.1) 下载 `.xpi`，在 Zotero 的 **工具 → 插件** 窗口中拖入安装；若提示则重启。该预览版要求 Zotero 9.0.6；macOS Apple Silicon 的 Agent 使用随包运行时，Linux x86_64 的 Agent 需要已安装的 Codex CLI。

若要在 macOS Apple Silicon 上体验当前 `main` 的开发功能，使用 Node 24、npm 11 构建，再从同一窗口安装 `dist/zotero-chatgpt-0.1.1-dev.xpi`：

```sh
git clone https://github.com/kianmax0/zotero-chatgpt.git
cd zotero-chatgpt
npm ci
node scripts/runtime-prepare.mjs
npm run package:dev
```

开发包与已发布包版本号相同，但内容不同。

## 开始使用

1. 打开 PDF，点击 Zotero 阅读器中的对话气泡。默认进入 Chat，在官方页面登录 ChatGPT 后提问。
2. 选中段落后点 **Ask in sidechat** 可先准备问题；你发送前不会提交。完整 PDF 需要自行粘贴到官方页面。
3. 要高亮或处理文献库时，明确切换到 Agent 并单独登录 Codex。主题发现、获取与整理从文献库主窗口进入。

设置中可关闭自动文献信息。开放获取 PDF 取决于来源，保存条目不代表 PDF 已下载。

---

独立社区项目，与 Zotero、OpenAI 无隶属或背书关系。
