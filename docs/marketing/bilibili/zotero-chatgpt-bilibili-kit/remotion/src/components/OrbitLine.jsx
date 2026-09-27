import React from 'react';
import {theme} from '../theme.js';

// Same orbit path as assets/svg/orbit-line.svg, drawn inline so it can be
// traced instead of blitted. `pathLength="1"` normalises the dash maths.
const ORBIT_D =
  'M160 520C360 120 1010 80 1360 320c270 184 195 446-115 512';

/**
 * The film's one decorative red line. It traces on as connective punctuation
 * and is never a persistent effect.
 */
export const OrbitLine = ({
  progress = 1,
  width = 1600,
  opacity = 0.5,
  strokeWidth = 5,
  d = ORBIT_D,
  style,
}) => (
  <svg
    viewBox="0 0 1600 900"
    width={width}
    fill="none"
    style={{position: 'absolute', overflow: 'visible', ...style}}
  >
    <path
      d={d}
      pathLength={1}
      strokeDasharray={1}
      strokeDashoffset={1 - Math.max(0, Math.min(1, progress))}
      stroke={theme.color.redBright}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      opacity={opacity}
    />
  </svg>
);
