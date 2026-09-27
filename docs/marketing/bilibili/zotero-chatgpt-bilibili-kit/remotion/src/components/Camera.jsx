import React from 'react';
import {interpolate, useCurrentFrame, useVideoConfig} from 'remotion';

/**
 * Slow camera drift. Zoom stays under 7% per shot and always eases from a
 * still start, per motion/motion-tokens.json.
 */
export const Camera = ({
  children,
  from = 1,
  to = 1,
  driftX = 0,
  driftY = 0,
  origin = '50% 46%',
  style,
}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const p = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const scale = from + (to - from) * p;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        transform: `scale(${scale}) translate(${driftX * p}px, ${driftY * p}px)`,
        transformOrigin: origin,
        ...style,
      }}
    >
      {children}
    </div>
  );
};
