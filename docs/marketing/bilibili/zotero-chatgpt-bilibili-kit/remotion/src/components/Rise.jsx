import React from 'react';
import {spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {theme} from '../theme.js';

const useSpring = (delay, preset, durationInFrames) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return spring({
    frame: Math.max(0, frame - delay),
    fps,
    config: theme.spring[preset] ?? theme.spring.gentle,
    durationInFrames,
  });
};

/**
 * Masked vertical rise: the words are revealed through a fixed window rather
 * than typewritten. Preferred text entrance across the whole film.
 */
export const Rise = ({children, delay = 0, distance = 26, preset = 'gentle', durationInFrames, style}) => {
  const p = useSpring(delay, preset, durationInFrames);
  return (
    <div style={{overflow: 'hidden', padding: '0.1em 0.02em', margin: '-0.1em 0', ...style}}>
      <div
        style={{
          transform: `translateY(${(1 - p) * distance}px)`,
          opacity: Math.min(1, p * 1.35),
        }}
      >
        {children}
      </div>
    </div>
  );
};

/** Card entrance: a restrained 0.965 -> 1.0 scale, optionally without a fade. */
export const Pop = ({children, delay = 0, from = 0.965, preset = 'gentle', durationInFrames, fade = true, style}) => {
  const p = useSpring(delay, preset, durationInFrames);
  return (
    <div
      style={{
        opacity: fade ? p : 1,
        transform: `scale(${from + (1 - from) * p})`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** Plain opacity fade, for punctuation and hand-offs. */
export const Fade = ({children, delay = 0, preset = 'gentle', durationInFrames, style}) => {
  const p = useSpring(delay, preset, durationInFrames);
  return <div style={{opacity: p, ...style}}>{children}</div>;
};
