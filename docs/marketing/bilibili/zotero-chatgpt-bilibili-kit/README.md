# Bilibili promo source

The current Remotion project produces a 48-second, 1920 × 1080 film. Scene timing,
Chinese copy, and sound cues are defined in `remotion/src/data.js`; the older
65-second storyboard and agent prompt are superseded.

Git tracks the production source, package lockfile, SVG motifs, and text notes.
Rendered video, covers, screenshots, demo footage, and the synthesized WAV stay
local. The source checkout alone therefore cannot reproduce the finished film.
To render it, supply the locally held demo clips and poster at the paths in
`remotion/src/data.js` under this kit's `assets/demo/`. `npm run assets` copies
these and the tracked SVGs to Remotion's ignored `public/assets/` directory.
Then follow `remotion/README.md`.

The film is an independent community promotion, with no Zotero or OpenAI
endorsement. Product behavior and verification status are described by the
repository's product and progress documents.
