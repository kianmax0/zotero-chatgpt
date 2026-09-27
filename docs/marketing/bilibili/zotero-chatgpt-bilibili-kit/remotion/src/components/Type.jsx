import React from 'react';
import {theme} from '../theme.js';

/** Very large, very quiet type. One idea per shot. */
export const Headline = ({
  children,
  size = theme.type.hero.size,
  weight = theme.type.hero.weight,
  tracking = theme.type.hero.tracking,
  lineHeight = theme.type.hero.lineHeight,
  color = theme.color.ink,
  align = 'center',
  style,
}) => (
  <div
    style={{
      fontSize: size,
      fontWeight: weight,
      letterSpacing: tracking,
      lineHeight,
      color,
      textAlign: align,
      ...style,
    }}
  >
    {children}
  </div>
);

export const Sub = ({children, size = theme.type.body.size, color = theme.color.inkSoft, align = 'center', style}) => (
  <div
    style={{
      fontSize: size,
      fontWeight: theme.type.body.weight,
      letterSpacing: theme.type.body.tracking,
      lineHeight: theme.type.body.lineHeight,
      color,
      textAlign: align,
      ...style,
    }}
  >
    {children}
  </div>
);

export const Micro = ({children, color = theme.color.inkSoft, align = 'center', style}) => (
  <div
    style={{
      fontSize: theme.type.micro.size,
      fontWeight: theme.type.micro.weight,
      letterSpacing: theme.type.micro.tracking,
      lineHeight: theme.type.micro.lineHeight,
      color,
      textAlign: align,
      ...style,
    }}
  >
    {children}
  </div>
);

/** Small spaced label with an optional red dot. */
export const Kicker = ({children, dot = true, color = theme.color.inkSoft, style}) => (
  <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 15, ...style}}>
    {dot ? (
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: theme.radius.pill,
          background: theme.color.red,
          display: 'inline-block',
          flex: '0 0 auto',
        }}
      />
    ) : null}
    <span
      style={{
        fontSize: 23,
        fontWeight: 520,
        letterSpacing: '0.24em',
        color,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  </div>
);
