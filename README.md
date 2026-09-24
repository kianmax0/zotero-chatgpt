# Zotero ChatGPT

[简体中文](README.zh-CN.md) · [Download v0.1.1](https://github.com/kianmax0/zotero-chatgpt/releases/tag/v0.1.1)

**Read papers with ChatGPT. Put a Codex Agent to work in Zotero.**

| Mode | Use it for |
| --- | --- |
| **Chat** | Ask about the current paper in the official ChatGPT page. Its bibliography and saved abstract are prepared for you; add a passage if you like. No API key, no Codex allowance, no separate sign-in. |
| **Agent** | Codex explains the paper, writes verified native highlights, or proposes a Figure callout. In the library window: discover by topic, acquire an open-access PDF, organize selected items. Separate sign-in; uses your Codex allowance. |

Chat opens by default and never starts a Codex request. Agent writes stay inside the requested paper or collection: verified highlights from an explicit request apply automatically, everything else is previewed for approval. Figure and model-backed library flows on `main` are experimental ([progress](docs/progress.md)).

## Demo

Silver et al. (2016), *[Mastering the game of Go with deep neural networks and tree search](https://doi.org/10.1038/nature16961)*, in an isolated library. Edited sequences of real window screenshots from `main`, not continuous recordings.

**Chat — ask about a passage.** Select text, choose **More details**, read the answer in the official ChatGPT page.

![A Silver passage sent through More details and answered in the official ChatGPT page.](docs/media/silver-chat-answer.gif)

**Agent — ask about the paper.** A separate Codex conversation answers with a page reference.

![A Codex Agent question about policy and value networks, with its cited answer.](docs/media/silver-agent-answer.gif)

**Agent — highlight key passages.** Agent verifies the sources, then writes three native Zotero highlights.

![A completed Agent task with three applied highlights and yellow marks in the Silver paper.](docs/media/silver-agent-highlights.gif)

**Agent — mark Figure 1.** Review the callouts, then approve native area and ink annotations.

![Selecting Figure 1, reviewing two callouts, and the saved native annotations.](docs/media/silver-figure-callout.gif)

**Agent — jump to the result.** Task output controls open the saved highlights in the PDF.

![The Agent task and the matching highlights on pages 484 and 485.](docs/media/silver-highlight-navigation.gif)

## Install

Download the `.xpi` from the [v0.1.1 release](https://github.com/kianmax0/zotero-chatgpt/releases/tag/v0.1.1) and drag it into **Tools → Plugins**. Requires Zotero 9.0.6. Agent uses the bundled runtime on macOS Apple Silicon; on Linux x86_64 it needs an installed Codex CLI.

To build the current `main` version instead (Node 24, npm 11):

```sh
git clone https://github.com/kianmax0/zotero-chatgpt.git
cd zotero-chatgpt
npm ci
node scripts/runtime-prepare.mjs
npm run package:dev
```

Install `dist/zotero-chatgpt-0.1.1-dev.xpi` the same way; it shares the v0.1.1 version label but is a newer build.

## Start using it

1. Open a PDF and click the chat bubble. Chat opens by default; sign in to ChatGPT in its page.
2. Ask about the paper, or select a passage and choose **Ask in sidechat** to stage it. Nothing is sent until you submit.
3. Switch to **Agent** only for Codex tasks. Discovery, acquisition and organizing live in the main-library panel.

Automatic paper context can be turned off in settings. Copying a PDF only prepares it for you to paste — it is not uploaded.

---

Independent community project. Not affiliated with or endorsed by Zotero or OpenAI.
