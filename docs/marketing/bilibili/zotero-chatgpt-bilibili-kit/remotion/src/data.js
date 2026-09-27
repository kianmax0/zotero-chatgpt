// The `.js` extension is required: `tools/audio.mjs` imports this file directly
// in Node, while the JSX components are resolved by the bundler.
import {theme} from './theme.js';

// ---------------------------------------------------------------------------
// The single source of truth for scene timings, copy and the tempo grid.
// Picture and sound both read this file, so cuts and hits cannot drift apart.
// ---------------------------------------------------------------------------
export const FPS = theme.fps;
export const WIDTH = theme.width;
export const HEIGHT = theme.height;

// ---------------------------------------------------------------------------
// Tempo grid.
//
// 150 BPM @ 30fps -> 12 frames per beat, 48 frames (1.6s) per bar.
// Every scene boundary is a whole number of bars, so every cut lands on a
// downbeat and the soundtrack can be written against the same grid.
//
// Frame-first arithmetic (`(FPS * 60) / BPM`) keeps these values exact
// integers; deriving them from seconds would introduce float drift.
// ---------------------------------------------------------------------------
export const BPM = 150;
export const BEATS_PER_BAR = 4;
export const BEAT_FRAMES = (FPS * 60) / BPM; // 12
export const BAR_FRAMES = BEAT_FRAMES * BEATS_PER_BAR; // 48
export const BEAT_SECONDS = BEAT_FRAMES / FPS; // 0.4
export const BAR_SECONDS = BAR_FRAMES / FPS; // 1.6

/** Frames for `beats` beats. Negative values are allowed (pre-rolled entrances). */
export const b = (beats) => Math.round(beats * BEAT_FRAMES);

export const DURATION_BARS = 30;
export const DURATION_IN_FRAMES = DURATION_BARS * BAR_FRAMES; // 1440
export const DURATION_SECONDS = DURATION_IN_FRAMES / FPS; // 48

/** seconds -> frames */
export const f = (seconds) => Math.round(seconds * FPS);

// ---------------------------------------------------------------------------
// Scene layout, declared in bars. Totals to 30 bars / 48s.
//
// Shortened from the kit's 65s cut: the reveal is compressed and every scene
// boundary moved onto a bar line. Product proof still holds the longest.
// ---------------------------------------------------------------------------
const LAYOUT = [
  {id: 'friction', title: 'The friction', bars: 3},
  {id: 'principle', title: 'The principle', bars: 3},
  {id: 'reveal', title: 'Product reveal', bars: 4},
  {id: 'chat', title: 'Chat', bars: 5},
  {id: 'agent', title: 'Agent', bars: 6},
  {id: 'native', title: 'Native Zotero', bars: 3},
  {id: 'montage', title: 'Capability montage', bars: 3},
  {id: 'end', title: 'End card', bars: 3},
];

let cursor = 0;
export const SCENES = LAYOUT.map((scene) => {
  const startFrame = cursor;
  const durationInFrames = scene.bars * BAR_FRAMES;
  cursor += durationInFrames;
  return {
    ...scene,
    startFrame,
    durationInFrames,
    startBar: startFrame / BAR_FRAMES,
    startSeconds: startFrame / FPS,
  };
});

export const sceneById = (id) => SCENES.find((scene) => scene.id === id);

/**
 * Beat offsets, relative to each scene's start, where something worth hearing
 * lands on screen. Scenes use them for entrances; `tools/audio.mjs` uses the
 * same list for UI clicks. One list, two consumers.
 */
export const ACCENTS = {
  friction: [0.5, 1, 3, 4.5],
  principle: [0, 3, 6],
  reveal: [0, 1.5],
  chat: [0, 2, 3.5, 5],
  agent: [0, 2, 3, 3.5, 16],
  native: [0, 3.2],
  montage: [0, 0.8, 1.5, 3],
  end: [0, 2.5, 3.5, 4.5],
};

/** Still frame at 00:12 — the Bilibili cover candidate. Falls inside `reveal`. */
export const COVER_FRAME = f(12);

/** The end card holds perfectly still for its final 24 frames. */
export const END_CARD_STILL_FRAMES = 24;

/** The Agent shot hard-cuts between two demos on this beat. */
export const AGENT_CUT_BEAT = 16;

// Shared geometry for the product close-ups (Chat / Agent).
export const PRODUCT_CARD = {
  width: 1264,
  height: Math.round(1264 / (1200 / 754)),
  left: 560,
  top: Math.round((HEIGHT - 1264 / (1200 / 754)) / 2),
  barHeight: 46,
};

export const COPY = {
  friction: {
    kicker: '在 Zotero 里用 AI',
    heroLines: ['为什么还要多一份', 'API 账单？'],
    apiKey: 'API KEY',
    receiptRows: ['按量计费', '随用随扣', '不可控'],
    receiptTotal: '账单',
  },
  principle: {
    left: 'Chat',
    leftSub: '只读 · 读论文',
    right: 'Agent',
    rightSub: '可执行 · 动文献库',
    statement: ['读论文', '≠', '动文献库'],
  },
  reveal: {
    tagline: 'Chat 读论文，Agent 动手',
    badges: ['No API Key', 'Native Zotero'],
  },
  chat: {
    titleInk: 'Chat，',
    titleAccent: '只读。',
    claims: ['官方 ChatGPT 页面', '不碰 API key', '不占 Codex 额度'],
    windowLabel: 'chatgpt.com',
  },
  agent: {
    titleInk: 'Agent，',
    titleAccent: '动手。',
    sub: '高亮 · 整理 · 下载 · 补元数据',
    chips: ['可验证', '可撤销'],
    windowLabel: 'Zotero',
  },
  native: {
    title: '它看起来，就应该像 Zotero。',
    sub: '原生入口 · 原生 tooltip · 原生阅读工作流',
    windowLabel: 'Zotero',
  },
  montage: {
    kicker: 'Agent 会做的事',
    items: [
      {label: '高亮', icon: 'highlight'},
      {label: '整理', icon: 'organize'},
      {label: '下载', icon: 'download'},
      {label: '标注', icon: 'annotate'},
      {label: '补元数据', icon: 'metadata'},
    ],
  },
  end: {
    wordmarkInk: 'zotero-',
    wordmarkAccent: 'chatgpt',
    tagline: 'Chat 读论文，Agent 动手',
    repo: 'github.com/kianmax0/zotero-chatgpt',
    cta: 'Releases 下载 .xpi',
    disclaimer: '独立社区项目，与 Zotero、OpenAI 无隶属或背书关系',
  },
};

export const DEMO = {
  chat: 'assets/demo/chat-more-details.mp4',
  agentHighlight: 'assets/demo/agent-highlight.mp4',
  agentReview: 'assets/demo/agent-review-output.mp4',
  nativePoster: 'assets/demo/chat-more-details-poster.png',
};
