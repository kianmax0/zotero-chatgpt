import React from 'react';
import {Img, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {theme} from '../theme.js';

/**
 * A short, intentional cursor cue: it arrives, pulses twice, leaves. No fake
 * frantic clicking (motion/motion-tokens.json).
 */
export const CursorPulse = ({size = 74, pulseEvery = 30, style}) => {
  const frame = useCurrentFrame();
  const local = Math.max(0, frame);
  const phase = (local % pulseEvery) / pulseEvery;
  const ringScale = 1 + phase * 1.5;
  const ringOpacity = interpolate(phase, [0, 0.65, 1], [0.42, 0.16, 0], {
    extrapolateRight: 'clamp',
  });

  return (
    <div style={{position: 'absolute', width: size, height: size, ...style}}>
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: size * 0.86,
          height: size * 0.86,
          marginLeft: -(size * 0.86) / 2,
          marginTop: -(size * 0.86) / 2,
          borderRadius: theme.radius.pill,
          border: `3px solid ${theme.color.red}`,
          opacity: ringOpacity,
          transform: `scale(${ringScale})`,
        }}
      />
      <Img
        src={staticFile('assets/svg/cursor.svg')}
        style={{position: 'absolute', inset: 0, width: size, height: size}}
      />
    </div>
  );
};
