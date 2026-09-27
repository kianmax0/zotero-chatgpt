import React from 'react';
import {Img, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {theme} from '../theme.js';
import {COPY, DEMO, b} from '../data.js';
import {Headline, SoftLight, Stage, Sub, Vignette} from '../components/index.js';

// Macro crop of the real screenshot. The card is deliberately wider than the
// 1200px source so the shot reads as a close-up rather than a zoomed-out window.
const CARD = {left: 240, top: 330, width: 1440, height: 600};
const SOURCE_ASPECT = 1200 / 754;

// Chrome coordinates in the source, measured from the screenshot's ink profile:
// the reading panel ends at x=558/1200 and the toolbar band sits at y~40-55/754.
const TOOLBAR_V = 0.08;
const PANEL_U = 0.4665;

/**
 * S06 — Native Zotero (bars 21-23)
 * Slow macro pan, then one thin red line on one piece of chrome at a time. Line
 * coordinates are derived from the same scale/translate that moves the image, so
 * they stay on the chrome for the whole shot.
 *
 * This is the half-time bar of the soundtrack: drums drop to beats 1 and 3 so
 * the screenshot can be read.
 */
export const S06Native = () => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const c = COPY.native;

  const p = frame / durationInFrames;
  const scale = 1 + 0.05 * p;
  const tx = -60 * p;
  const ty = -300 * p;

  const imgW = CARD.width * scale;
  const imgH = imgW / SOURCE_ASPECT;
  // Normalised source point -> card-local pixel.
  const px = (u) => u * imgW + tx;
  const py = (v) => v * imgH + ty;

  const on = (a, bb, c2, d) =>
    interpolate(frame, [b(a), b(bb), b(c2), b(d)], [0, 1, 1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });

  // The toolbar leaves the crop as the pan moves down, so it is highlighted first.
  const toolbarOn = on(0.5, 1.2, 3.0, 3.6);
  const panelOn = on(3.2, 3.8, 10.5, 11);

  const line = (style) => (
    <div
      style={{
        position: 'absolute',
        borderRadius: theme.radius.pill,
        background: theme.color.redBright,
        boxShadow: '0 0 0 7px rgba(206,36,48,0.10)',
        ...style,
      }}
    />
  );

  return (
    <Stage>
      <SoftLight />

      <div style={{position: 'absolute', left: 160, right: 160, top: 122, textAlign: 'center'}}>
        <Headline size={84}>{c.title}</Headline>
        <Sub size={30} style={{marginTop: 24}}>
          {c.sub}
        </Sub>
      </div>

      <div
        style={{
          position: 'absolute',
          left: CARD.left,
          top: CARD.top,
          width: CARD.width,
          height: CARD.height,
          borderRadius: theme.radius.medium,
          border: '1px solid rgba(255,255,255,0.55)',
          outline: '1px solid rgba(29,29,31,0.05)',
          boxShadow: theme.surface.card,
          overflow: 'hidden',
          background: '#fff',
        }}
      >
        <Img
          src={staticFile(DEMO.nativePoster)}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: CARD.width,
            transform: `scale(${scale}) translate(${tx / scale}px, ${ty / scale}px)`,
            transformOrigin: '0% 0%',
          }}
        />

        {/* Top toolbar strip. */}
        {line({
          left: px(0.008),
          top: py(TOOLBAR_V),
          width: Math.max(0, px(0.462) - px(0.008)),
          height: 3,
          opacity: toolbarOn,
        })}

        {/* Left reading panel. */}
        {line({
          left: px(PANEL_U),
          top: py(0.04),
          width: 3,
          height: Math.max(0, py(1) - py(0.04)),
          opacity: panelOn,
        })}

        {/* Depth-of-field imitation, not a real blur pass. */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(180deg, rgba(29,29,31,0.05) 0%, rgba(29,29,31,0) 14%, rgba(29,29,31,0) 82%, rgba(29,29,31,0.07) 100%)',
            pointerEvents: 'none',
          }}
        />
      </div>

      <Vignette />
    </Stage>
  );
};
