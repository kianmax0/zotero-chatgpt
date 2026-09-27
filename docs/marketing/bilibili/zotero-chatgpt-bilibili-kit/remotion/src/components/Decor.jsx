import React from 'react';
import {Img, staticFile} from 'remotion';

/** Floating paper / bubble / cursor / sparkles from the kit's SVG set. */
export const Decor = ({kind, width, drift = 0, rotate = 0, opacity = 1, style}) => (
  <Img
    src={staticFile(`assets/svg/${kind}.svg`)}
    style={{
      position: 'absolute',
      width,
      opacity,
      transform: `translateY(${drift}px) rotate(${rotate}deg)`,
      ...style,
    }}
  />
);

/** Horizontally drifting paper sheet, used as the parallax layer. */
export const DriftingPaper = ({width = 430, x = 0, y = 0, rotate = -2, opacity = 0.95, style}) => (
  <Decor kind="paper-card" width={width} rotate={rotate} opacity={opacity} style={{left: x, top: y, ...style}} />
);
