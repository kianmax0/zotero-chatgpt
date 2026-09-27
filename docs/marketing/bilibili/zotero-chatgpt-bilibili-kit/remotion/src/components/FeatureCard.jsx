import React from 'react';
import {theme} from '../theme.js';

const PATHS = {
  highlight: ['M10 35h28', 'M18 26l13-13 7 7-13 13z'],
  organize: ['M16 16h20', 'M16 24h20', 'M16 32h14'],
  download: ['M24 12v18', 'M17 24l7 7 7-7', 'M12 37h24'],
  annotate: ['M24 12a12 12 0 1 0 0 24a12 12 0 1 0 0-24', 'M18 24l5 5 8-9'],
  metadata: ['M14 17h20', 'M14 26h20', 'M14 35h11', 'M36 30v10', 'M31 35h10'],
};

const DOTS = {
  organize: [
    [10, 16],
    [10, 24],
    [10, 32],
  ],
};

/** One-line glyph per capability. Red stroke only, no fills. */
export const Glyph = ({name, size = 52, color = theme.color.red}) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
    {(PATHS[name] ?? PATHS.highlight).map((d, i) => (
      <path
        key={i}
        d={d}
        stroke={color}
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    ))}
    {(DOTS[name] ?? []).map(([cx, cy], i) => (
      <circle key={i} cx={cx} cy={cy} r={2.7} fill={color} />
    ))}
  </svg>
);

/** Capability card for the montage: one verb, one glyph, no paragraphs. */
export const FeatureCard = ({label, icon, style}) => (
  <div
    style={{
      background: theme.color.white,
      borderRadius: 42,
      boxShadow: theme.surface.card,
      border: '1px solid rgba(255,255,255,0.55)',
      outline: '1px solid rgba(29,29,31,0.05)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 22,
      ...style,
    }}
  >
    <div
      style={{
        width: 96,
        height: 96,
        borderRadius: theme.radius.pill,
        background: 'rgba(180,22,31,0.07)',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <Glyph name={icon} />
    </div>
    <div style={{fontSize: 38, fontWeight: 630, letterSpacing: '-1px', color: theme.color.ink}}>{label}</div>
  </div>
);
