// Spot-check tool for the promo film.
//
// Renders nothing by itself: it reads still frames (PNG) and reports objective
// numbers about them, so composition can be reviewed without eyeballing every
// frame. Usage:
//
//   node tools/spot-check.mjs .work/spot/f360.png
//   node tools/spot-check.mjs .work/spot/*.png --map
//
// Reports luminance spread, ink/white coverage, red coverage with its bounding
// box, and how much ink sits outside the 96px safe margin.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';

const WIDTH = 1920;
const HEIGHT = 1080;
const SAFE = 96;

const args = process.argv.slice(2);
const showMap = args.includes('--map');
const files = args.filter((a) => !a.startsWith('--'));

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const readFrame = (file) =>
  execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    {maxBuffer: 256 * 1024 * 1024},
  );

const analyse = (file) => {
  const buf = readFrame(file);
  let sum = 0;
  let sumSq = 0;
  let ink = 0;
  let white = 0;
  let red = 0;
  let inkOutsideSafe = 0;
  let redMinX = WIDTH;
  let redMinY = HEIGHT;
  let redMaxX = -1;
  let redMaxY = -1;
  const mapCols = 64;
  const mapRows = 36;
  const map = new Array(mapCols * mapRows).fill(0);
  const mapCount = new Array(mapCols * mapRows).fill(0);

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 3;
      const r = buf[i];
      const g = buf[i + 1];
      const b = buf[i + 2];
      const L = lum(r, g, b);
      sum += L;
      sumSq += L * L;
      if (L < 120) {
        ink++;
        const outside = x < SAFE || x >= WIDTH - SAFE || y < SAFE || y >= HEIGHT - SAFE;
        if (outside) inkOutsideSafe++;
      }
      if (L > 246) white++;
      if (r - g > 45 && r - b > 45) {
        red++;
        if (x < redMinX) redMinX = x;
        if (y < redMinY) redMinY = y;
        if (x > redMaxX) redMaxX = x;
        if (y > redMaxY) redMaxY = y;
      }
      const mx = Math.floor((x / WIDTH) * mapCols);
      const my = Math.floor((y / HEIGHT) * mapRows);
      map[my * mapCols + mx] += L;
      mapCount[my * mapCols + mx]++;
    }
  }

  const n = WIDTH * HEIGHT;
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  const std = Math.sqrt(Math.max(0, variance));

  const rows = [`${file.split('/').pop()}`];
  rows.push(
    `  mean=${mean.toFixed(1)} std=${std.toFixed(1)} ink=${((ink / n) * 100).toFixed(2)}% white=${(
      (white / n) *
      100
    ).toFixed(2)}% red=${((red / n) * 100).toFixed(3)}% inkOutsideSafe=${inkOutsideSafe}`,
  );
  if (red > 0) {
    rows.push(`  red bbox=[${redMinX},${redMinY} .. ${redMaxX},${redMaxY}]`);
  }

  if (showMap) {
    const ramp = ' .:-=+*#%@';
    for (let my = 0; my < mapRows; my++) {
      let line = '  ';
      for (let mx = 0; mx < mapCols; mx++) {
        const idx = my * mapCols + mx;
        const v = map[idx] / Math.max(1, mapCount[idx]);
        line += ramp[Math.min(9, Math.floor(v / 25.6))];
      }
      rows.push(line);
    }
  }

  return rows.join('\n');
};

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.log(`${file}: MISSING`);
    continue;
  }
  console.log(analyse(file));
}
