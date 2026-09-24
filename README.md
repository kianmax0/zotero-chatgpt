# Zotero ChatGPT

[简体中文](README.zh-CN.md) · [Download v0.1.1](https://github.com/kianmax0/zotero-chatgpt/releases/tag/v0.1.1)

**Read papers with ChatGPT. Put a Codex Agent to work in Zotero.**

Chat opens the official ChatGPT website beside your PDF. Agent is a separate mode for verified Zotero highlights and scoped library tasks. You choose when to switch; Chat never starts a Codex model request.

> The demos below use the current `main` development build. The downloadable v0.1.1 release is older and does not include every feature shown here.

## What it does

| Mode | Use it for |
| --- | --- |
| **Chat** | Ask about the current paper in the official ChatGPT page. The plugin prepares its bibliography and saved abstract; you can add a selected passage or paste the PDF yourself. |
| **Agent** | Ask Codex to explain the paper, create verified native highlights, or propose a Figure callout. In the library window, discover papers by topic, acquire an available open-access PDF, and organize selected items. |

Agent changes stay within the requested paper or collection. Verified highlights from an explicit request apply automatically; other changes show a preview for approval and report the Zotero result. Figure and model-backed library flows on `main` remain experimental; [current verification](docs/progress.md) is tracked separately. Agent model turns use your Codex allowance and require a separate sign-in. Chat needs no API key and does not use Codex allowance.

## Demo: reading Silver et al. (2016)

These demos use *[Mastering the game of Go with deep neural networks and tree search](https://doi.org/10.1038/nature16961)* in an isolated Zotero library. Each GIF is an edited sequence of real window screenshots; the cuts are not continuous screen recording.

**Ask about a passage.** Select text in the PDF, choose **More details**, and get an answer in the official ChatGPT page.

![A Silver paper passage sent through More details and answered in the official ChatGPT page.](docs/media/silver-chat-answer.gif)

**Ask Agent about the paper.** A separate Codex conversation answers with a page reference.

![A Codex Agent question about policy and value networks, followed by its cited answer.](docs/media/silver-agent-answer.gif)

**Highlight key passages.** Agent verified the policy network, value network, and Monte Carlo tree search passages, then saved three native Zotero highlights.

![A completed Agent task reports three applied highlights, shows their source passages, and reveals yellow highlights in the Silver paper.](docs/media/silver-agent-highlights.gif)

**Mark Figure 1.** Select the diagram, review proposed callouts, and approve two native Zotero area and ink annotations.

![Selecting Figure 1, reviewing two callouts, and viewing the saved native Zotero annotations.](docs/media/silver-figure-callout.gif)

**Jump to the result.** The task's output controls open the saved highlights in the PDF, including the value-network passage on page 485.

![The Agent task and the corresponding native highlights on pages 484 and 485 of the Silver paper.](docs/media/silver-highlight-navigation.gif)

## Install

**Released build:** Download the `.xpi` from [v0.1.1](https://github.com/kianmax0/zotero-chatgpt/releases/tag/v0.1.1). In Zotero, open **Tools → Plugins** and drag it into that window. This preview requires Zotero 9.0.6. Agent uses the bundled runtime on macOS Apple Silicon; on Linux x86_64 it requires an installed Codex CLI. Restart Zotero if prompted.

**Current development build (macOS Apple Silicon):** With Node 24 and npm 11, run:

```sh
git clone https://github.com/kianmax0/zotero-chatgpt.git
cd zotero-chatgpt
npm ci
node scripts/runtime-prepare.mjs
npm run package:dev
```

Install `dist/zotero-chatgpt-0.1.1-dev.xpi` using the same Zotero menu. The development build has the same version label as the older release; use the build you intended.

## Start using it

1. Open a PDF and click the chat bubble in Zotero's reader. Chat opens by default; sign in to ChatGPT in its page.
2. Ask about the paper, or select a passage and choose **Ask in sidechat** to prepare a question. The selected text is not sent until you submit it.
3. Switch to **Agent** only when you want a Codex task. Sign in to Codex separately. Use the main-library panel for discovery, acquisition, and organizing selected items.

Automatic paper context can be turned off in the plugin settings. Copying a PDF file prepares it for you to paste into ChatGPT; it does not silently upload the file. Open-access PDF availability depends on the source.

---

Independent community project. Not affiliated with or endorsed by Zotero or OpenAI.
