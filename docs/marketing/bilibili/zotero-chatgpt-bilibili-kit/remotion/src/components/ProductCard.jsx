import React from 'react';
import {theme} from '../theme.js';

/**
 * Product footage frame: 28-36px corners, 1px white border at 55% opacity,
 * soft dual shadow. Optional window bar with a traffic-light trio.
 */
export const ProductCard = ({children, radius = theme.radius.medium, style}) => (
  <div
    style={{
      background: theme.color.white,
      border: '1px solid rgba(255,255,255,0.55)',
      outline: '1px solid rgba(29,29,31,0.05)',
      borderRadius: radius,
      boxShadow: theme.surface.card,
      overflow: 'hidden',
      ...style,
    }}
  >
    {children}
  </div>
);

const Dot = ({color}) => (
  <span style={{width: 11, height: 11, borderRadius: theme.radius.pill, background: color, display: 'inline-block'}} />
);

/** Neutral window chrome. The label states exactly what the footage shows. */
export const WindowBar = ({label, height = 46}) => (
  <div
    style={{
      height,
      display: 'flex',
      alignItems: 'center',
      gap: 11,
      padding: '0 22px',
      background: '#F3F1ED',
      borderBottom: '1px solid rgba(29,29,31,0.06)',
      flex: '0 0 auto',
    }}
  >
    <Dot color="#DAD5CE" />
    <Dot color="#DAD5CE" />
    <Dot color="#DAD5CE" />
    <div
      style={{
        marginLeft: 14,
        height: 26,
        borderRadius: theme.radius.pill,
        background: '#FFFFFF',
        padding: '0 20px',
        display: 'flex',
        alignItems: 'center',
        fontSize: 15,
        letterSpacing: '-0.1px',
        color: theme.color.inkSoft,
        boxShadow: 'inset 0 0 0 1px rgba(29,29,31,0.05)',
      }}
    >
      {label}
    </div>
  </div>
);
