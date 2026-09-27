import React from 'react';
import {theme} from '../theme.js';

/**
 * The wordmark is rebuilt in type rather than blitted from the SVG so the
 * red/ink split and the tagline share the film's exact typography.
 */
export const LogoLockup = ({wordmarkSize = 150, taglineSize = 46, tagline, showTagline = true, style}) => (
  <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', ...style}}>
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        fontFamily: theme.fontLatin,
        fontSize: wordmarkSize,
        fontWeight: 700,
        letterSpacing: -6,
        lineHeight: 1,
        color: theme.color.ink,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{color: theme.color.red}}>zotero-</span>
      <span>chatgpt</span>
    </div>
    {showTagline ? (
      <div
        style={{
          marginTop: taglineSize * 0.58,
          fontSize: taglineSize,
          fontWeight: 600,
          letterSpacing: -0.8,
          color: theme.color.ink,
          whiteSpace: 'nowrap',
        }}
      >
        {tagline}
      </div>
    ) : null}
  </div>
);
