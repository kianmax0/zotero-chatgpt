import React from 'react';
import {theme} from '../theme.js';

/**
 * The product's own top-shell mode switch, reproduced from
 * assets/svg/mode-switch.svg. The knob moves once, slowly, and never bounces:
 * the point is that the two modes are separate, not that switching is fun.
 */
export const ModeToggle = ({progress = 0, width = 470, height = 104, labels = ['Chat', 'Agent'], style}) => {
  const pad = 10;
  const half = width / 2;
  const knobWidth = half - pad * 2;
  const knobX = pad + Math.max(0, Math.min(1, progress)) * (half + pad);

  const Side = ({label, activeAmount, accent}) => (
    <div style={{flex: 1, position: 'relative', display: 'grid', placeItems: 'center', height: '100%'}}>
      <span style={{position: 'absolute', fontSize: 38, fontWeight: 660, letterSpacing: '-0.5px', color: theme.color.inkFaint}}>
        {label}
      </span>
      <span
        style={{
          position: 'relative',
          fontSize: 38,
          fontWeight: 660,
          letterSpacing: '-0.5px',
          color: accent,
          opacity: activeAmount,
        }}
      >
        {label}
      </span>
    </div>
  );

  return (
    <div
      style={{
        position: 'relative',
        width,
        height,
        borderRadius: theme.radius.pill,
        background: '#EFEBE5',
        boxShadow: 'inset 0 2px 5px rgba(29,29,31,0.07)',
        ...style,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: pad,
          left: knobX,
          width: knobWidth,
          height: height - pad * 2,
          borderRadius: theme.radius.pill,
          background: theme.color.white,
          boxShadow: theme.surface.soft,
        }}
      />
      <div style={{position: 'relative', display: 'flex', height: '100%'}}>
        <Side label={labels[0]} accent={theme.color.ink} activeAmount={1 - progress} />
        <Side label={labels[1]} accent={theme.color.red} activeAmount={progress} />
      </div>
    </div>
  );
};
