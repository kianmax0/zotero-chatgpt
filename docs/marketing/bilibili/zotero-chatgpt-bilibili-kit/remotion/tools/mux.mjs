// Mux the rendered picture with the synthesised soundtrack.
//
// Why this exists instead of Remotion's built-in muxing:
//
// Remotion encodes the audio itself and pads the AAC track to whole frames.
// Its 48.000s WAV comes out as 48.0427s — two extra 1024-sample frames, i.e.
// 42.7 ms of trailing silence — so the container duration disagrees with the
// video. Here the video stream is copied untouched and the *original* WAV is
// encoded exactly once with `-t <exact duration>`, which keeps both streams the
// same length and avoids a second lossy audio generation.
//
//   node tools/mux.mjs [videoIn] [audioIn] [out]
import {execFileSync} from 'node:child_process';
import {existsSync, rmSync, statSync} from 'node:fs';
import path from 'node:path';
import {DURATION_IN_FRAMES, FPS} from '../src/data.js';

const ROOT = path.resolve(import.meta.dirname, '..');

const videoIn = process.argv[2] ?? path.join(ROOT, '.work/render.mp4');
const audioIn = process.argv[3] ?? path.join(ROOT, 'public/audio/promo.wav');
const out = process.argv[4] ?? path.join(ROOT, 'out/zotero-chatgpt-promo.mp4');

/**
 * Audio muxing needs a full ffmpeg. Remotion ships a `compositor-<platform>`
 * ffmpeg binary, but it is a dylib-based internal build: invoked directly it
 * dies with "Library not loaded: libavdevice.dylib" because Remotion normally
 * supplies a DYLD_LIBRARY_PATH. So probe the system binary instead and fail
 * with a clear message rather than a dyld crash.
 *
 * Keep glob patterns out of this comment: a `*` immediately followed by a `/`
 * closes the block comment early, and the syntax error then surfaces far from
 * here.
 */
const findFfmpeg = () => {
  const candidates = [process.env.FFMPEG, 'ffmpeg'].filter(Boolean);
  for (const cmd of candidates) {
    try {
      execFileSync(cmd, ['-hide_banner', '-version'], {stdio: 'ignore'});
      return cmd;
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    'ffmpeg not found on PATH. The audio mux step needs a full ffmpeg build ' +
      '(Remotion\'s bundled compositor binary cannot encode AAC standalone). ' +
      'Install it, or point FFMPEG at one: FFMPEG=/path/to/ffmpeg npm run render',
  );
};

const ffmpeg = findFfmpeg();
const ffprobe = process.env.FFPROBE ?? 'ffprobe';

const probe = (file, entries) =>
  execFileSync(ffprobe, ['-v', 'error', ...entries, '-of', 'default=noprint_wrappers=1', file], {
    encoding: 'utf8',
  }).trim();

const durationOf = (file) =>
  Number(
    probe(file, ['-show_entries', 'format=duration'])
      .split('=')
      .pop(),
  );

const expect = DURATION_IN_FRAMES / FPS; // 48.000

if (!existsSync(videoIn)) throw new Error(`missing video input: ${videoIn}`);
if (!existsSync(audioIn)) throw new Error(`missing audio input: ${audioIn}`);

console.log(`mux: ${path.relative(ROOT, videoIn)} + ${path.relative(ROOT, audioIn)}`);
console.log(`  ffmpeg: ${ffmpeg}`);

execFileSync(
  ffmpeg,
  [
    '-y',
    '-v', 'error',
    '-i', videoIn,
    '-i', audioIn,
    // Take picture from the render and sound from the WAV, discarding
    // Remotion's padded audio track.
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-t', String(expect),
    // Put the index at the front so the file can start playing before it is
    // fully downloaded.
    '-movflags', '+faststart',
    out,
  ],
  {stdio: ['ignore', 'ignore', 'inherit']},
);

rmSync(videoIn, {force: true});

const videoDuration = durationOf(`${out}`);
const audioDuration = Number(
  probe(out, ['-select_streams', 'a:0', '-show_entries', 'stream=duration'])
    .split('=')
    .pop(),
);
const videoFrames = probe(out, ['-select_streams', 'v:0', '-show_entries', 'stream=nb_frames']).split('=').pop();

console.log(`  out: ${path.relative(ROOT, out)} (${(statSync(out).size / 1e6).toFixed(1)} MB)`);
console.log(`  frames ${videoFrames} (expected ${DURATION_IN_FRAMES})`);
console.log(`  container ${videoDuration.toFixed(6)}s, audio ${audioDuration.toFixed(6)}s, expected ${expect.toFixed(6)}s`);

const flat = [videoDuration, audioDuration, expect];
const exact = flat.every((v) => Math.abs(v - expect) < 0.0005);
console.log(`  duration match: ${exact ? 'PASS' : 'FAIL'}`);
if (!exact) process.exit(1);
