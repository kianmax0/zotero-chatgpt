# zotero-chatgpt — Bilibili promo film (Remotion)

A 1920×1080 / 30fps / **48s** product film built with Remotion + React + CSS/SVG.
Git contains the source and package lockfile. Demo videos, screenshots, and rendered
outputs are kept locally; a source checkout needs those assets before rendering.
The soundtrack is synthesized from code, with no sampled music.

## Build

```bash
npm install
npm run check:copy     # runs without local media
npm run audio          # generates public/audio/promo.wav
npm run assets         # copies locally held demos and SVGs into public/assets/
npm run render   # copy check -> soundtrack -> render -> mux   (~95s)
npm run cover    # -> out/cover-12s.png                        (still at 00:12)
npm run start    # Remotion Studio, for interactive review
```

Place the three demo MP4 files and `chat-more-details-poster.png` in the
parent kit's `assets/demo/` directory. `npm run assets` copies these plus
the tracked SVG sources into `public/assets/`; that output is ignored by Git.

`npm run render` is four steps and aborts on the first failure:

1. `tools/copy-check.mjs` — mechanical copy compliance gate
2. `tools/audio.mjs` — synthesises `public/audio/promo.wav`
3. `remotion render` — picture to `.work/render.mp4`
4. `tools/mux.mjs` — re-muxes picture with the WAV at exact duration

**Requirements.** Set `REMOTION_BROWSER_EXECUTABLE` to use an installed Chrome;
otherwise Remotion manages its own browser. The mux step needs a full `ffmpeg`
on `PATH` (override with `FFMPEG=/path/to/ffmpeg`); Remotion's
bundled compositor binary is a dylib-based internal build and cannot encode AAC
standalone. `tsconfig.json` exists only because Remotion requires one to load a
TypeScript config file.

## Structure

| File | Role |
| --- | --- |
| `src/data.js` | **The single source of truth**: tempo grid, scene layout, all Chinese copy, accent beats, cover frame index, product-card geometry |
| `src/theme.js` | Current colour, type, radius, shadow and spring tokens |
| `src/PromoVideo.jsx` | Maps `SCENES` to `<Sequence>`s, attaches the soundtrack |
| `src/components/` | Reusable pieces: `Stage`, `Camera`, `Rise`/`Pop`/`Fade`, `Headline`/`Sub`/`Kicker`, `ProductCard`/`WindowBar`, `OrbitLine`, `Decor`, `Chip`, `LogoLockup`, `ModeToggle`, `FeatureCard`, `CursorPulse`, `FlashCard` |
| `src/scenes/` | One file per storyboard beat (S01–S08) |
| `tools/audio.mjs` | Synthesises the 48s soundtrack from oscillators and noise |
| `tools/mux.mjs` | Muxes picture + WAV at exact duration, with faststart |
| `tools/mix-check.mjs` | Reports per-bar RMS by scene, and low/high-band onset strength on the beat vs off it |
| `tools/spot-check.mjs` | Reports luminance spread, ink/white/red coverage and red bounding boxes from a rendered PNG |
| `tools/copy-check.mjs` | Mechanical copy compliance gate |

## Tempo grid

150 BPM at 30fps gives 12 frames per beat and 48 frames (1.6s) per bar. The film is
**30 bars = 1440 frames = 48.000s**, and every scene boundary is a whole number of bars,
so every cut lands on a downbeat. `data.js` declares scenes in *bars*, not seconds —
integer arithmetic, no float drift.

Frame-first arithmetic matters: `BEAT_FRAMES` is computed as `(FPS * 60) / BPM`, and
`BEAT_SECONDS` is derived from it. Deriving frames from seconds instead produces
values like `143.99999999999997`.

Changing copy or timings means editing `src/data.js` only. Scenes use the `b(beats)`
helper for their internal delays, and `tools/audio.mjs` imports the same file, so the
picture and the soundtrack cannot drift apart.

## Output

| | |
| --- | --- |
| `out/zotero-chatgpt-promo.mp4` | H.264 High / L4.0, 1920×1080, 30fps, 1440 frames, 48.000s, AAC LC 44.1 kHz stereo, faststart |
| `out/cover-12s.png` | 1920×1080 PNG, frame 360 |
| `public/audio/promo.wav` | Synthesised soundtrack, 48.000s, peak −1.11 dBFS, RMS −17.50 dBFS |

## Fidelity notes

- Product footage is never distorted: the demo clips are 1200×754, and the close-up
  card is sized to the same ratio, so `object-fit: cover` shows the whole frame.
- The S04 shot is exactly 240 frames and the Chat clip is exactly 240 frames, so it
  plays once end to end with no loop and no seam.
- **S06 chrome callouts:** The two red lines are placed at coordinates measured from the screenshot's own ink
  profile (the reading panel ends at x=558/1200; the toolbar band sits at y≈40–55/754)
  rather than guessed, and both are derived from the same transform that moves the
  image, so they stay on the chrome through the pan. If the screenshot changes, the
  measured constants in `src/scenes/S06Native.jsx` must be re-measured.
- The end card holds perfectly still for its final 24 frames.
- The soundtrack is original and fully synthesised. It is not a replacement for
  professionally produced music, but it needs no licence.

## Gotchas worth keeping

- **A `*/` inside a block comment ends it early.** A glob like `compositor-*/ffmpeg`
  written inside `/** ... */` closes the comment, and the resulting syntax error is
  reported many lines further down. `tools/mux.mjs:26` carries a note about this.
- **`"type": "module"` makes the bundler require fully specified imports.** Every
  internal import here carries its extension (`.js`, `.jsx`, or `/index.js`).
- **Prefer `.mjs` for tools.** They are always ESM regardless of `package.json`.
