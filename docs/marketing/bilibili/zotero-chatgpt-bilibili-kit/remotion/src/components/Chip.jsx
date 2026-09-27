import React from 'react';
import {theme} from '../theme.js';

/** Small white pill used for claims, badges and mode capabilities. */
export const Chip = ({children, tone = 'plain', style}) => {
  const red = tone === 'red';
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 12,
        height: 54,
        padding: '0 26px',
        borderRadius: theme.radius.pill,
        background: red ? 'rgba(180,22,31,0.075)' : theme.color.white,
        color: red ? theme.color.red : theme.color.ink,
        fontSize: 24,
        fontWeight: 520,
        letterSpacing: '-0.2px',
        boxShadow: theme.surface.chip,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** The API-key chip that the opening shot gently pushes out of focus. */
export const ApiKeyChip = ({label}) => (
  <div
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 14,
      height: 62,
      padding: '0 26px',
      borderRadius: theme.radius.small,
      background: theme.color.white,
      boxShadow: theme.surface.chip,
      fontFamily: theme.fontLatin,
      fontSize: 24,
      fontWeight: 620,
      letterSpacing: '0.06em',
      color: theme.color.ink,
    }}
  >
    <span style={{width: 12, height: 12, borderRadius: theme.radius.pill, background: theme.color.red}} />
    {label}
  </div>
);

/** Abstract receipt: bars, not invented numbers. */
export const ReceiptCard = ({rows, total}) => (
  <div
    style={{
      width: 300,
      borderRadius: theme.radius.small,
      background: theme.color.paperBright,
      boxShadow: theme.surface.chip,
      padding: '24px 26px 22px',
      border: '1px solid rgba(29,29,31,0.05)',
    }}
  >
    {rows.map((row, i) => (
      <div key={row} style={{display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14}}>
        <span style={{fontSize: 17, color: theme.color.inkFaint, width: 76, letterSpacing: '0.02em'}}>{row}</span>
        <span
          style={{
            flex: 1,
            height: 8,
            borderRadius: theme.radius.pill,
            background: 'rgba(29,29,31,0.10)',
            maxWidth: 150 - i * 22,
          }}
        />
      </div>
    ))}
    <div style={{height: 1, background: 'rgba(29,29,31,0.08)', margin: '6px 0 16px'}} />
    <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
      <span style={{fontSize: 18, color: theme.color.red, fontWeight: 600}}>{total}</span>
      <span style={{width: 74, height: 10, borderRadius: theme.radius.pill, background: theme.color.redSoft}} />
    </div>
  </div>
);
