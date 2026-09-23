# README media: what each file is

Short provenance for the images in the repository README. This is a record of what was actually
produced, not a product specification.

## Where the earlier Chat media was made

- **Host**: Zotero 9.0.6 (`/Applications/Zotero.app`, version from its `Info.plist`), macOS, Apple
  Silicon, light theme.
- **Instance**: an isolated, dedicated profile and data directory,
  `.zotero-chatgpt-dev/context-runs/readme-media/{profile,data}`, launched with
  `-no-remote -profile ... -datadir ...`. The everyday Zotero profile was never opened, used, or
  captured.
- **Build under capture**: `dist/zotero-chatgpt-0.4.0a34-dev.xpi`, sha256
  `5c9ed57cb3e7269a9e64e604236cf5823afd3defbfe58f437b3fc96e653e55fa`, matching
  `packages/zotero/manifest.json` version `0.4.0a34`. This is the artifact that was installed in the
  isolated profile for these captures.
- **Model requests**: none. No Chat question was sent and no Agent request was made. The captures use
  only local UI state and a passage staged into the official composer before sending.

## Demo content

The paper in the images is synthetic and generated for this repository by
`.zotero-chatgpt-dev/readme-media/make-demo-paper.mjs` ("Learning from prediction errors", "Demo
Author / Demo Institute"). It carries no DOI, no real author, no real publication and no real data,
and it says so on its own first page. Its bibliography fields were imported from a synthetic BibTeX
entry, and the PDF was attached by hand in the isolated library.

## The files

### `overview.png`

- **Type**: real screenshot of the running product, not an illustration.
- **Content**: the isolated Zotero window at 1440x880 CSS px (captured at 2x), with the synthetic
  demo paper in the reader on the left and the plugin sidebar on the right at 480 CSS px. The sidebar
  is in Chat mode and hosts the real `chatgpt.com` page in its signed-out state; the sidebar's own
  chrome (the Chat/Agent switch, the paper tab, the two copy controls, and the first-run context
  disclosure) is the product's.
- **Processing**: captured with `screencapture -l <window id>`, cropped to the window, scaled once to
  1920 px wide. No content was retouched, added, or removed.
- **What it does not show**: any conversation, answer, or signed-in state. No question was asked.

### `chat-demo.gif`

- **Type**: real screen recording of the running product.
- **Content**: one continuous interaction in the isolated window. A sentence is selected in the PDF
  with a real drag, the plugin's own `Ask in sidechat` control is clicked, and the passage arrives in
  the official ChatGPT composer as a draft. The recording ends before anything is sent.
- **Why this is not a sent request**: in Chat mode the selection action routes `ask` to
  `official.stage()` in `packages/zotero/src/chat/official-chat.ts`, which writes the composer and
  never submits. The submitting control (`More details`) was deliberately never clicked.
- **Processing**: recorded with `ffmpeg` from `avfoundation` at 15 fps / 3024x1964, trimmed to 8.1 s
  (leading and trailing idle time only; the middle is continuous and is not sped up), scaled to
  1200 px wide, 12 fps, 224-colour palette, no dither, delta-optimised.
- **Note on the caption**: the still and the GIF both say the passage is shown before sending,
  because that is the state the recording ends in.

### `chat-demo-poster.png`

- **Type**: still frame from the same recording (not a separate capture).
- **Content**: the final state of `chat-demo.gif`, exported at 1600 px wide from the source video so
  the text stays sharp. Provided so the section is readable without playing the animation.

### `agent-workflow.svg` and `agent-workflow.png`

- **Type**: illustration. It is **not** a screenshot, and it is visibly labelled `ILLUSTRATED
  WORKFLOW` inside the image.
- **Content**: the four intended steps (ask, review, approve, apply) with the example request
  "Highlight the key passages." It shows how the flow is meant to work; it is not evidence that any
  of these steps ran. No Agent task was executed for this media, and no native write was performed.
- **Processing**: drawn by hand as a self-contained SVG (no script, no external font, no remote
  resource). `agent-workflow.png` is a 1600 px wide render of the same file made with
  `rsvg-convert`, kept in case a raster export is wanted. The older review/approve highlighting
  diagram is no longer featured in the README after explicit Agent highlights became automatic.

## Library Agent acquisition stills from the earlier candidate (2026-09-23)

- **Host and scope:** Zotero 9.0.6 on macOS Apple Silicon, in the dedicated
  `.zotero-chatgpt-dev/context-runs/demo-final-20260923/{profile,data}` tree. The collection
  named `Synthetic Agent demo` exists only there. No daily Zotero profile was opened or captured.
- **Build:** `dist/zotero-chatgpt-0.1.1-dev.xpi`, SHA-256
  `e0baff9f551ba7a195edb2b9a37c7ab6acdc2b85d169aa5664c4986496867726`, installed in
  that profile for these final captures. Codex 0.156.1 is bundled, but no model turn was used for
  the acquisition workflow shown here.
- **`agent-library-entry.png`:** real Zotero main-library window with the Agent toolbar button
  visible before a PDF or article was opened in the isolated collection.
- **`agent-acquisition-review.png`:** a real unsaved task preview for public DOI
  `10.1371/journal.pone.0345574`. The Zotero translator supplied the metadata; the task had not
  received approval when captured.
- **`agent-acquisition-result.png`:** the same task after explicit approval. The original Zotero
  item and verified PDF attachment appeared in the isolated collection, and the task readback shows
  one item saved and one PDF attached. The output button also selected the native Zotero item,
  whose detail pane showed the DOI, target collection, and one attachment. Separately, DOI
  `10.1038/nature14539` saved metadata in an earlier isolated test profile but reported no OA PDF
  candidate; it is not shown as a successful PDF download.
- **Capture:** unretouched window screenshots through the computer-use API at 1000×600 CSS px.
  These are separate stills from the same product run, not a continuous screen recording. They do
  not demonstrate a model-generated highlight or a general claim that every DOI has an OA PDF.

## `agent-classic-paper-demo.gif` (2026-09-23)

- **Type:** trimmed screen recording of a real Codex Agent turn and Zotero's resulting native highlight. No frames or annotations were drawn in editing.
- **Paper:** Vaswani et al., *Attention Is All You Need*, [arXiv:1706.03762](https://arxiv.org/abs/1706.03762), imported with its public PDF into the dedicated `Transformer demo` test collection. Source PDF SHA-256: `bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697`.
- **Host:** Zotero 9.0.6, macOS Apple Silicon, dedicated `.zotero-chatgpt-dev/context-runs/library-agent-visual-20260923-1625/{profile,data}`. The user completed official Codex sign-in in this dedicated profile. No everyday library was used or captured.
- **Build:** `dist/zotero-chatgpt-0.1.1-dev.xpi`, SHA-256 `af5d6bd72ed1aedff6beaa7c705dfc3f29ed5723575f37e76440e801755347f3` at capture time. Later source changes are identified by a different SHA; this clip is not evidence for those changes.
- **Actual work:** one `gpt-6-sol` turn (request `c77878ac-1fee-4d6e-b968-4d0146771c17`) completed and its durable task recorded `autoApply: true`, `completed`, and 3/3 items `applied`. The visible yellow passage and task card show the real Reader result. The model took about 126 seconds; the clip shows the end of that wait and automatic native application, with no second approval click.
- **Processing:** `ffmpeg` captured the public-paper Reader window at 10 fps. The GIF uses a contiguous 12-second tail, sampled to 6 fps and resized to 1000 px. The source recording is retained in ignored `.zotero-chatgpt-dev/demo-attention/raw-highlight.mp4`; GIF SHA-256 `c01eabca01ba60f8d7972dfc38627740a49c0df4d4e2a4d3b06292973e08a9de`.
- **Limit:** the GIF shows one highlighted passage and a 3/3 task count. The durable task and native readback establish the three applied annotations; the GIF alone does not show every annotation or prove their scientific importance.

## Rebuilding

The working scripts and the raw captures are intentionally outside version control, under
`.zotero-chatgpt-dev/readme-media/`:

```sh
node .zotero-chatgpt-dev/readme-media/make-demo-paper.mjs      # regenerate the demo paper
.zotero-chatgpt-dev/readme-media/host.sh start                 # launch the isolated instance
.zotero-chatgpt-dev/readme-media/reset-and-record.sh rec/chat-demo.mp4
```

`host.sh` only ever starts or stops the process whose arguments name this exact tree. The
`runjs.sh`, `zjs.sh`, `domclick.sh`, `field.mjs`, `winlist`, `ocr`, and `mouse` helpers were written
for these captures; they drive the isolated instance only and are not part of the product.

## Rights

All screenshots were captured here, and the drawn illustration and synthetic demo paper were made
for this repository. The newer Agent stills show the Zotero interface and public DOI bibliographic
metadata inside an isolated test library; this repository does not claim ownership of those third
party elements. No user library content or third-party supplied screenshot is included. Nothing was
uploaded to an external image host or compression service.
