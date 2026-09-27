// Mix check for the promo soundtrack.
//
//   node tools/mix-check.mjs [wavPath]
//   node tools/mix-check.mjs public/audio/promo.wav bars
//
// Reports, as recomputable numbers:
//   * overall peak / RMS / crest, and how many samples hit the ceiling
//   * per-bar RMS, grouped by the scene each bar belongs to, so you can see
//     whether the arrangement actually follows the picture
//   * low-band (kick) and high-band (hat) onset strength on the beat vs off it
//
// Deliberately not a "looks about right" check: every figure below can be
// recomputed from the WAV alone.
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {BAR_SECONDS, BEAT_SECONDS, DURATION_BARS, SCENES} from '../src/data.js';

const FILE = process.argv[2] ?? path.resolve(import.meta.dirname, '../public/audio/promo.wav');
const MODE = process.argv[3] ?? 'all';

// ---------------------------------------------------------------------------
// Minimal WAV reader (16-bit PCM, stereo)
// ---------------------------------------------------------------------------
const buf = readFileSync(FILE);
if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
  throw new Error('not a RIFF/WAVE file');
}
let pos = 12;
let fmt = null;
let data = null;
while (pos + 8 <= buf.length) {
  const id = buf.toString('ascii', pos, pos + 4);
  const size = buf.readUInt32LE(pos + 4);
  const body = pos + 8;
  if (id === 'fmt ') {
    fmt = {
      format: buf.readUInt16LE(body),
      channels: buf.readUInt16LE(body + 2),
      sampleRate: buf.readUInt32LE(body + 4),
      bits: buf.readUInt16LE(body + 14),
    };
  } else if (id === 'data') {
    data = {start: body, size};
  }
  pos = body + size + (size % 2);
}
if (!fmt || !data) throw new Error('missing fmt or data chunk');
if (fmt.format !== 1 || fmt.bits !== 16) throw new Error(`unsupported WAV: format=${fmt.format} bits=${fmt.bits}`);

const SR = fmt.sampleRate;
const CH = fmt.channels;
const N = Math.floor(data.size / (2 * CH));
const mono = new Float64Array(N);
for (let i = 0; i < N; i++) {
  let s = 0;
  for (let c = 0; c < CH; c++) s += buf.readInt16LE(data.start + (i * CH + c) * 2);
  mono[i] = s / CH / 32768;
}

console.log(`${FILE}`);
console.log(`  ${fmt.sampleRate} Hz, ${CH} ch, ${fmt.bits}-bit, ${N} samples = ${(N / SR).toFixed(3)}s`);

// ---------------------------------------------------------------------------
// Overall level
// ---------------------------------------------------------------------------
let peak = 0;
let sumSq = 0;
let atCeiling = 0;
for (let i = 0; i < N; i++) {
  const a = Math.abs(mono[i]);
  if (a > peak) peak = a;
  sumSq += mono[i] * mono[i];
  if (a >= 0.9499) atCeiling++;
}
const db = (x) => 20 * Math.log10(Math.max(1e-12, x));
const rmsDb = db(Math.sqrt(sumSq / N));
console.log(
  `  peak ${db(peak).toFixed(2)} dBFS, RMS ${rmsDb.toFixed(2)} dBFS, crest ${(db(peak) - rmsDb).toFixed(1)} dB, samples at ceiling ${atCeiling}`,
);

// ---------------------------------------------------------------------------
// Per-bar RMS, grouped by scene
// ---------------------------------------------------------------------------
const rmsOf = (from, to) => {
  let s = 0;
  let n = 0;
  for (let i = Math.max(0, from); i < Math.min(N, to); i++) {
    s += mono[i] * mono[i];
    n++;
  }
  return n ? Math.sqrt(s / n) : 0;
};

const barRms = [];
for (let bar = 0; bar < DURATION_BARS; bar++) {
  barRms.push(rmsOf(Math.round(bar * BAR_SECONDS * SR), Math.round((bar + 1) * BAR_SECONDS * SR)));
}

if (MODE === 'all' || MODE === 'bars') {
  console.log('\n  per-bar RMS dBFS (one row per scene):');
  for (const scene of SCENES) {
    const seg = barRms.slice(scene.startBar, scene.startBar + scene.bars);
    const avg = Math.sqrt(seg.reduce((a, v) => a + v * v, 0) / seg.length);
    console.log(
      `    ${scene.id.padEnd(10)} bars ${String(scene.startBar).padStart(2)}-${String(
        scene.startBar + scene.bars - 1,
      ).padStart(2)}  avg ${db(avg).toFixed(1).padStart(6)}  [${seg.map((v) => db(v).toFixed(1)).join(' ')}]`,
    );
  }
}

// ---------------------------------------------------------------------------
// Groove: is there actually a pulse, and does it sit on the grid?
//
// Measured per band with a one-pole filter and a short RMS window at each
// sixteenth. Reporting the whole-band average would hide the answer, so the
// kick and hat positions are scored separately.
// ---------------------------------------------------------------------------
const lowA = 1 - Math.exp((-2 * Math.PI * 200) / SR);
const highA = 1 / (1 + (2 * Math.PI * 2000) / SR);
const low = new Float64Array(N);
const high = new Float64Array(N);
{
  let lp = 0;
  let prevIn = 0;
  let prevOut = 0;
  for (let i = 0; i < N; i++) {
    lp += lowA * (mono[i] - lp);
    low[i] = lp;
    const y = highA * (prevOut + mono[i] - prevIn);
    prevIn = mono[i];
    prevOut = y;
    high[i] = y;
  }
}

const onset = (band, seconds) => {
  const from = Math.round(seconds * SR);
  const win = Math.round(0.03 * SR);
  let s = 0;
  let n = 0;
  for (let i = from; i < Math.min(N, from + win); i++) {
    s += band[i] * band[i];
    n++;
  }
  return n ? Math.sqrt(s / n) : 0;
};

// Group sixteenths into "on the beat" (1 and 3), "backbeat" (2 and 4) and
// "offbeat" (the odd sixteenths). Averaging across all of them would report a
// misleading near-zero difference.
const groups = {downbeat: [], backbeat: [], offbeat: []};
for (let bar = 0; bar < DURATION_BARS; bar++) {
  for (let s = 0; s < 16; s++) {
    const t = bar * BAR_SECONDS + s * (BEAT_SECONDS / 4);
    const l = onset(low, t);
    const h = onset(high, t);
    const key = s % 4 === 0 ? 'downbeat' : s % 2 === 0 ? 'backbeat' : 'offbeat';
    groups[key].push({l, h});
  }
}
const mean = (arr, k) => arr.reduce((a, v) => a + v[k], 0) / arr.length;

if (MODE === 'all' || MODE === 'groove') {
  const d = mean(groups.downbeat, 'l');
  const b = mean(groups.backbeat, 'l');
  const o = mean(groups.offbeat, 'l');
  const hd = mean(groups.downbeat, 'h');
  const hb = mean(groups.backbeat, 'h');
  const ho = mean(groups.offbeat, 'h');
  console.log('\n  groove (RMS per 30 ms window, all bars):');
  console.log(`    low  <200 Hz   downbeat ${db(d).toFixed(1)}  backbeat ${db(b).toFixed(1)}  offbeat ${db(o).toFixed(1)}`);
  console.log(`                   downbeat - offbeat = ${db(d / Math.max(1e-12, o)).toFixed(1)} dB`);
  console.log(`    high >2 kHz    downbeat ${db(hd).toFixed(1)}  backbeat ${db(hb).toFixed(1)}  offbeat ${db(ho).toFixed(1)}`);
  console.log(`                   downbeat - offbeat = ${db(hd / Math.max(1e-12, ho)).toFixed(1)} dB`);
}
