// Soundtrack for the promo film.
//
// Fully synthesised from oscillators and noise — no samples, no downloads, no
// copyrighted material. Deterministic: a fixed PRNG seed means the same WAV
// every run (verified by comparing SHA-256 across builds).
//
//   node tools/audio.mjs [outPath]
//
// The arrangement reads the scene boundaries and accent beats straight from
// src/data.js, so picture and sound share one timeline.
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  ACCENTS,
  AGENT_CUT_BEAT,
  BAR_SECONDS,
  BEAT_SECONDS,
  BPM,
  DURATION_BARS,
  DURATION_IN_FRAMES,
  FPS,
  SCENES,
} from '../src/data.js';

const SR = 44100;
const N = Math.round((DURATION_IN_FRAMES / FPS) * SR); // 2,116,800 samples
const SIXTEENTH = BEAT_SECONDS / 4;
const OUT = process.argv[2] ?? path.resolve(import.meta.dirname, '../public/audio/promo.wav');

// ---------------------------------------------------------------------------
// Deterministic noise
// ---------------------------------------------------------------------------
const mulberry32 = (a) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rnd = mulberry32(20260925);

// ---------------------------------------------------------------------------
// Bus
// ---------------------------------------------------------------------------
const L = new Float64Array(N);
const R = new Float64Array(N);

/** Constant-power pan. p in [-1, 1]. */
const add = (i, v, p = 0) => {
  if (i < 0 || i >= N || !Number.isFinite(v)) return;
  const a = ((p + 1) * Math.PI) / 4;
  L[i] += v * Math.cos(a);
  R[i] += v * Math.sin(a);
};

const at = (seconds) => Math.round(seconds * SR);

// ---------------------------------------------------------------------------
// Voices
// ---------------------------------------------------------------------------

/** Kick: pitch sweep 142 -> 46 Hz with phase accumulation (not sin(2*pi*f*t)). */
const kick = (s0, g = 1) => {
  const len = Math.round(0.46 * SR);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const f = 46 + 96 * Math.exp(-t / 0.026);
    ph += (2 * Math.PI * f) / SR;
    const body = Math.sin(ph) * Math.exp(-t / 0.115);
    const click = (rnd() * 2 - 1) * Math.exp(-t / 0.0032) * 0.45;
    add(s0 + i, (body + click) * g * 0.95, 0);
  }
};

/** Clap: three noise bursts 11 ms apart, band-limited, plus a short tail. */
const clap = (s0, g = 1) => {
  const len = Math.round(0.3 * SR);
  const hpA = 1 / (1 + (2 * Math.PI * 900) / SR);
  const lpA = 1 - Math.exp((-2 * Math.PI * 4600) / SR);
  let lp = 0;
  let prevIn = 0;
  let prevOut = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const burs =
      Math.exp(-t / 0.0042) +
      Math.exp(-Math.abs(t - 0.011) / 0.0042) +
      Math.exp(-Math.abs(t - 0.022) / 0.0042);
    const env = burs + Math.exp(-t / 0.13) * 0.45;
    let x = (rnd() * 2 - 1) * env;
    lp += lpA * (x - lp);
    x = lp;
    const y = hpA * (prevOut + x - prevIn);
    prevIn = x;
    prevOut = y;
    add(s0 + i, y * g * 1.5, 0.05);
  }
};

/** Hi-hat: high-passed noise with a fast decay. */
const hat = (s0, g = 1, decay = 0.032, p = 0.14) => {
  const len = Math.round(decay * 7 * SR);
  const hpA = 1 / (1 + (2 * Math.PI * 7600) / SR);
  const lpA = 1 - Math.exp((-2 * Math.PI * 15500) / SR);
  let lp = 0;
  let prevIn = 0;
  let prevOut = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const env = Math.exp(-t / decay);
    let x = (rnd() * 2 - 1) * env;
    lp += lpA * (x - lp);
    x = lp;
    const y = hpA * (prevOut + x - prevIn);
    prevIn = x;
    prevOut = y;
    add(s0 + i, y * g * 0.85, p);
  }
};

/** Bass: sine + third harmonic through a one-pole low-pass. */
const bass = (s0, dur, freq, g = 1) => {
  const len = Math.round(dur * SR);
  const lpA = 1 - Math.exp((-2 * Math.PI * 900) / SR);
  let ph = 0;
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const env = (1 - Math.exp(-t / 0.006)) * Math.exp(-t / (dur * 0.62));
    const s = Math.sin(ph) + 0.26 * Math.sin(ph * 3);
    ph += (2 * Math.PI * freq) / SR;
    lp += lpA * (s - lp);
    add(s0 + i, lp * env * g * 0.62, 0);
  }
};

/** Chord stab: four slightly detuned saws, short decay. */
const stab = (s0, dur, freqs, g = 1) => {
  const len = Math.round(dur * SR);
  const voices = [];
  for (const fq of freqs) {
    for (const d of [-0.55, 0.55]) voices.push({f: fq * (1 + d / 200), ph: rnd() * 6.283});
  }
  const lpA = 1 - Math.exp((-2 * Math.PI * 3200) / SR);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const env = Math.exp(-t / (dur * 0.32));
    let s = 0;
    for (const v of voices) {
      v.ph += (2 * Math.PI * v.f) / SR;
      const x = v.ph / (2 * Math.PI);
      s += 2 * (x - Math.floor(x + 0.5));
    }
    s /= voices.length;
    lp += lpA * (s - lp);
    add(s0 + i, lp * env * g * 0.3, 0.22);
  }
};

/** Pad: six detuned saws, slow attack, soft release. */
const pad = (s0, dur, freqs, g = 1) => {
  const len = Math.round(dur * SR);
  const voices = [];
  for (const fq of freqs) {
    for (const d of [-1.1, 1.1]) voices.push({f: fq * (1 + d / 300), ph: rnd() * 6.283});
  }
  const lpA = 1 - Math.exp((-2 * Math.PI * 1700) / SR);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.5) * Math.min(1, Math.max(0, (dur - t) / 0.7));
    let s = 0;
    for (const v of voices) {
      v.ph += (2 * Math.PI * v.f) / SR;
      const x = v.ph / (2 * Math.PI);
      s += 2 * (x - Math.floor(x + 0.5));
    }
    s /= voices.length;
    lp += lpA * (s - lp);
    add(s0 + i, lp * env * g * 0.2, 0);
  }
};

/** Riser: noise sweep 240 -> 7200 Hz on a quadratic curve, plus a rising tone. */
const riser = (s0, dur, g = 1) => {
  const len = Math.round(dur * SR);
  let lp = 0;
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const p = i / len;
    const fc = 240 * Math.pow(7200 / 240, p * p);
    const lpA = 1 - Math.exp((-2 * Math.PI * fc) / SR);
    let x = rnd() * 2 - 1;
    lp += lpA * (x - lp);
    const env = Math.pow(p, 1.7);
    add(s0 + i, lp * env * g * 0.5, (p - 0.5) * 0.5);
    const f = 300 * Math.pow(6, p * p);
    ph += (2 * Math.PI * f) / SR;
    add(s0 + i, Math.sin(ph) * env * Math.pow(p, 3) * g * 0.2, 0);
  }
};

/** Impact: three stacked sub frequencies plus a noise tail. */
const impact = (s0, g = 1) => {
  const len = Math.round(2.2 * SR);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const env = Math.exp(-t / 0.44) * (1 - Math.exp(-t / 0.004));
    const v =
      (Math.sin(2 * Math.PI * 43 * t) +
        0.72 * Math.sin(2 * Math.PI * 32 * t) +
        0.38 * Math.sin(2 * Math.PI * 64.5 * t)) *
      env *
      g *
      0.5;
    add(s0 + i, v, 0);
  }
  let lp = 0;
  const lpA = 1 - Math.exp((-2 * Math.PI * 2600) / SR);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const env = Math.exp(-t / 0.16);
    let x = (rnd() * 2 - 1) * env;
    lp += lpA * (x - lp);
    add(s0 + i, lp * g * 0.2, 0);
  }
};

/** Whoosh: band-limited noise on a bell envelope, panned across the frame. */
const whoosh = (s0, dur, g = 1, panFrom = -0.7) => {
  const len = Math.round(dur * SR);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const p = i / len;
    const env = Math.sin(Math.PI * p);
    const fc = 400 + 5600 * Math.pow(Math.sin(Math.PI * p), 1.2);
    const lpA = 1 - Math.exp((-2 * Math.PI * fc) / SR);
    let x = rnd() * 2 - 1;
    lp += lpA * (x - lp);
    add(s0 + i, lp * env * g * 0.5, panFrom + p * 1.2);
  }
};

/** UI click: dry, rounded, short. One per meaningful action. */
const click = (s0, g = 1, p = 0.1) => {
  const len = Math.round(0.055 * SR);
  const lpA = 1 - Math.exp((-2 * Math.PI * 6200) / SR);
  let ph = 0;
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const env = Math.exp(-t / 0.0075);
    const f = 320 + 1700 * Math.exp(-t / 0.011);
    ph += (2 * Math.PI * f) / SR;
    let x = Math.sin(ph) * 0.62 + (rnd() * 2 - 1) * 0.45;
    lp += lpA * (x - lp);
    add(s0 + i, lp * env * g * 0.55, p);
  }
};

// ---------------------------------------------------------------------------
// Arrangement
// ---------------------------------------------------------------------------

// Am7 - Fmaj7 - Cmaj7 - G6, one chord per bar, four-bar loop.
const CHORDS = [
  {root: 55.0, notes: [220.0, 261.63, 329.63, 392.0]},
  {root: 43.65, notes: [174.61, 220.0, 261.63, 329.63]},
  {root: 65.41, notes: [196.0, 261.63, 329.63, 392.0]},
  {root: 49.0, notes: [196.0, 246.94, 293.66, 392.0]},
];

/** Which bars each scene occupies, so texture follows the picture. */
const section = (bar) => {
  const scene = SCENES.find((s) => bar >= s.startBar && bar < s.startBar + s.bars);
  return scene ? scene.id : 'end';
};

const DENSITY = {
  // A pulse from the very first bar — a half-time heartbeat rather than
  // near-silence, so the opening does not read as four seconds of nothing.
  friction: {kick: [0, 8], clap: false, hat: 'quarter', bass: 'none', stab: false, pad: 0.95},
  principle: {kick: [0, 8], clap: false, hat: 'eighth', bass: 'sparse', stab: false, pad: 0.8},
  reveal: {kick: [0, 4, 8, 12], clap: true, hat: 'eighth', bass: 'mid', stab: true, pad: 0.55},
  chat: {kick: [0, 4, 8, 12], clap: true, hat: 'sixteenth', bass: 'mid', stab: true, pad: 0.5},
  agent: {kick: [0, 4, 8, 12, 14], clap: true, hat: 'sixteenth', bass: 'full', stab: true, pad: 0.42},
  native: {kick: [0, 8], clap: true, hat: 'quarter', bass: 'sparse', stab: false, pad: 0.7},
  montage: {kick: [0, 4, 8, 12], clap: true, hat: 'sixteenth', bass: 'full', stab: true, pad: 0.5},
  end: {kick: [0], clap: false, hat: 'quarter', bass: 'long', stab: false, pad: 1},
};

const BASS_PATTERNS = {
  none: [],
  sparse: [0, 8],
  mid: [0, 3, 8, 11],
  full: [0, 3, 6, 8, 11, 14],
  long: [0],
};

const HATS = {
  none: [],
  quarter: [[0, 1], [4, 0.85], [8, 1], [12, 0.85]],
  eighth: [
    [0, 1], [2, 0.5], [4, 0.9], [6, 0.5],
    [8, 1], [10, 0.5], [12, 0.9], [14, 0.5],
  ],
  sixteenth: [
    [0, 1], [1, 0.28], [2, 0.55], [3, 0.3],
    [4, 0.9], [5, 0.28], [6, 0.55], [7, 0.3],
    [8, 1], [9, 0.28], [10, 0.55], [11, 0.3],
    [12, 0.9], [13, 0.3], [14, 0.62], [15, 0.34],
  ],
};

const lastBar = DURATION_BARS - 1;

for (let bar = 0; bar < DURATION_BARS; bar++) {
  const t0 = bar * BAR_SECONDS;
  const d = DENSITY[section(bar)];
  const chord = CHORDS[bar % 4];
  const finalBar = bar === lastBar;

  // Pad holds under everything; the last bar lets it ring out alone.
  pad(at(t0), BAR_SECONDS * (finalBar ? 1.1 : 1.05), chord.notes, d.pad);

  if (finalBar) {
    kick(at(t0), 0.85);
    hat(at(t0), 0.55, 0.05);
    continue;
  }

  for (const s of d.kick) kick(at(t0 + s * SIXTEENTH), s === 14 ? 0.82 : 1);

  if (d.clap) {
    clap(at(t0 + 4 * SIXTEENTH), 0.85);
    clap(at(t0 + 12 * SIXTEENTH), 0.85);
  }

  for (const [s, v] of HATS[d.hat]) {
    // Open hat on the last 16th of every fourth bar.
    const open = s === 14 && bar % 4 === 3;
    hat(at(t0 + s * SIXTEENTH), v * 0.75, open ? 0.16 : 0.03, 0.12 + (s % 2) * 0.16);
  }

  for (const s of BASS_PATTERNS[d.bass]) {
    const dur = d.bass === 'long' ? BAR_SECONDS * 0.95 : SIXTEENTH * 2.4;
    const octave = s === 11 ? 2 : 1;
    bass(at(t0 + s * SIXTEENTH), dur, chord.root * octave, 1);
  }

  if (d.stab) {
    for (const s of [2, 6, 10, 14]) stab(at(t0 + s * SIXTEENTH), SIXTEENTH * 3.2, chord.notes, 0.85);
  }
}

// Scene-boundary whooshes. Every cut gets one, so the edit has a transient.
for (const scene of SCENES) {
  if (scene.startFrame === 0) continue;
  whoosh(at(scene.startSeconds - 0.22), 0.46, 0.9, -0.72);
}
// The Agent shot's internal hard cut lands on this bar, not a scene boundary.
whoosh(at(AGENT_CUT_BEAT * BEAT_SECONDS - 0.3), 0.52, 1, -0.8);

// Impacts under the four biggest downbeats: reveal, Chat, Agent, end card.
for (const bar of [6, 10, 15, 27]) impact(at(bar * BAR_SECONDS), 0.9);

// Risers ramp into the moments above.
for (const bar of [6, 10, 15, 24, 27]) riser(at((bar - 1) * BAR_SECONDS), BAR_SECONDS, 0.85);

// UI clicks on the accent beats that picture also uses.
for (const scene of SCENES) {
  for (const beat of ACCENTS[scene.id] ?? []) {
    click(at(scene.startSeconds + beat * BEAT_SECONDS), 0.85);
  }
}

// ---------------------------------------------------------------------------
// Master bus: gain to a target RMS, then soft-knee only above -1.9 dBFS.
//
// Straight peak normalisation would let one impact own the headroom and leave
// the bed too quiet. A whole-track tanh would flatten the transients. So the
// gain is set from RMS and only samples above the threshold are bent.
//
// The ceiling leaves ~1.1 dB of true-peak headroom. AAC is lossy and overshoots
// on transients: a WAV peaking at -0.45 dBFS decoded back at exactly 0 dBFS
// (79 samples), so the ceiling is set low enough that the round trip stays
// clear of full scale.
// ---------------------------------------------------------------------------
const TARGET_RMS_DBFS = -17.5;
const THRESHOLD = 0.8;
const CEILING = 0.88;

let sumSq = 0;
for (let i = 0; i < N; i++) sumSq += L[i] * L[i] + R[i] * R[i];
const rms = Math.sqrt(sumSq / (2 * N));
const gain = Math.pow(10, TARGET_RMS_DBFS / 20) / Math.max(1e-9, rms);

const soft = (x) => {
  const a = Math.abs(x);
  if (a <= THRESHOLD) return x;
  const range = CEILING - THRESHOLD;
  const y = THRESHOLD + range * Math.tanh((a - THRESHOLD) / range);
  return Math.sign(x) * Math.min(CEILING, y);
};

let peak = 0;
let clipped = 0;
for (let i = 0; i < N; i++) {
  L[i] = soft(L[i] * gain);
  R[i] = soft(R[i] * gain);
  const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
  if (a > peak) peak = a;
  if (a >= 0.9499) clipped++;
}

// ---------------------------------------------------------------------------
// 16-bit stereo PCM WAV
// ---------------------------------------------------------------------------
const wav = Buffer.alloc(44 + N * 4);
wav.write('RIFF', 0);
wav.writeUInt32LE(36 + N * 4, 4);
wav.write('WAVE', 8);
wav.write('fmt ', 12);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(SR, 24);
wav.writeUInt32LE(SR * 4, 28);
wav.writeUInt16LE(4, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  wav.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), 44 + i * 4);
  wav.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), 46 + i * 4);
}

mkdirSync(path.dirname(OUT), {recursive: true});
writeFileSync(OUT, wav);

const peakDb = 20 * Math.log10(Math.max(1e-9, peak));
const rmsDb = 20 * Math.log10(Math.max(1e-9, Math.sqrt(sumSq / (2 * N)) * gain));

console.log(`audio: ${OUT}`);
console.log(`  ${DURATION_BARS} bars @ ${BPM} BPM = ${(N / SR).toFixed(3)}s, ${N} frames/ch, ${SR} Hz stereo`);
console.log(`  peak ${peakDb.toFixed(2)} dBFS, RMS ${rmsDb.toFixed(2)} dBFS, crest ${(peakDb - rmsDb).toFixed(1)} dB`);
console.log(`  samples at ceiling: ${clipped}`);
