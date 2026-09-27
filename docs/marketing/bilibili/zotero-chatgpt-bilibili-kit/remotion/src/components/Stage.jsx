import React from 'react';
import {AbsoluteFill} from 'remotion';
import {theme} from '../theme.js';

/**
 * Warm ivory stage. Every shot sits on this so the film keeps one background
 * language: soft daylight from the upper left, a barely-there shadow at the
 * lower right, no gradients that read as "tech".
 */
export const Stage = ({children, style}) => (
  <AbsoluteFill
    style={{
      background: [
        'radial-gradient(120% 92% at 16% 4%, #FEFDFB 0%, rgba(254,253,251,0) 54%)',
        'radial-gradient(100% 84% at 90% 104%, rgba(29,29,31,0.055) 0%, rgba(29,29,31,0) 62%)',
        'linear-gradient(158deg, #FAF8F5 0%, #F4F1EC 56%, #EEE9E3 100%)',
      ].join(', '),
      fontFamily: theme.font,
      color: theme.color.ink,
      overflow: 'hidden',
      WebkitFontSmoothing: 'antialiased',
      ...style,
    }}
  >
    {children}
  </AbsoluteFill>
);

/** Soft daylight pool. Sits under the composition, never moves. */
export const SoftLight = ({style}) => (
  <div
    style={{
      position: 'absolute',
      inset: '-18%',
      background:
        'radial-gradient(circle at 52% 32%, rgba(255,255,255,0.92), rgba(255,255,255,0) 46%)',
      pointerEvents: 'none',
      ...style,
    }}
  />
);

/** A very light vignette so the safe margin reads as intentional space. */
export const Vignette = () => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      background:
        'radial-gradient(130% 110% at 50% 45%, rgba(29,29,31,0) 62%, rgba(29,29,31,0.055) 100%)',
      pointerEvents: 'none',
    }}
  />
);
