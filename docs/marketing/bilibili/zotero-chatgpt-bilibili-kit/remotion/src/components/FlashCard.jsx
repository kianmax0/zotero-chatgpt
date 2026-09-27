import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';
import {theme} from '../theme.js';

/**
 * The Agent shot hard-cuts between two demos. A white rounded card expands
 * across the frame in five frames to cover the cut, then dissolves. No glitch,
 * no cross-dissolve of two UI clips.
 */
export const FlashCard = ({startFrame, grow = 5, hold = 4, fade = 8, size = 900}) => {
  const frame = useCurrentFrame();
  const t = frame - startFrame;
  if (t < 0) return null;

  const growP = interpolate(t, [0, grow], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const opacity =
    t <= grow + hold
      ? 1
      : interpolate(t, [grow + hold, grow + hold + fade], [1, 0], {extrapolateRight: 'clamp'});

  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', pointerEvents: 'none'}}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: interpolate(growP, [0, 1], [46, 0]),
          background: theme.color.white,
          transform: `scale(${0.08 + growP * 2.6})`,
          opacity,
          boxShadow: '0 30px 90px rgba(29,29,31,0.10)',
        }}
      />
    </AbsoluteFill>
  );
};
