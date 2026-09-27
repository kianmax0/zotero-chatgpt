import React from 'react';
import {Video, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {theme} from '../theme.js';
import {COPY, DEMO, PRODUCT_CARD, b} from '../data.js';
import {
  CursorPulse,
  Headline,
  Pop,
  ProductCard,
  Rise,
  SoftLight,
  Stage,
  Vignette,
  WindowBar,
} from '../components/index.js';

/**
 * S04 — Chat (bars 10-14)
 * The interface is the hero. The scene is 240 frames and the clip is exactly
 * 240 frames, so it plays once from end to end — no loop, no seam.
 */
export const S04Chat = () => {
  const frame = useCurrentFrame();
  const c = COPY.chat;

  // The cursor cue is short and intentional: in on beat 5, gone by beat 14.
  const cursorOpacity = interpolate(frame, [b(5), b(6), b(13), b(14)], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <Stage>
      <SoftLight />

      <div
        style={{
          position: 'absolute',
          left: 150,
          top: 0,
          height: 1080,
          width: 380,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        <Rise delay={b(-0.7)}>
          <Headline align="left" size={80} tracking={-2.4}>
            {c.titleInk}
          </Headline>
        </Rise>
        <Rise delay={0}>
          <Headline align="left" size={80} tracking={-2.4} color={theme.color.red}>
            {c.titleAccent}
          </Headline>
        </Rise>

        <div style={{marginTop: 46}}>
          {c.claims.map((claim, i) => (
            <Rise key={claim} delay={b(2 + i * 1.5)} distance={20}>
              <div style={{display: 'flex', alignItems: 'center', gap: 14, marginTop: i === 0 ? 0 : 20}}>
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: theme.radius.pill,
                    background: theme.color.red,
                    flex: '0 0 auto',
                  }}
                />
                <span style={{fontSize: 27, letterSpacing: '-0.2px', color: theme.color.ink}}>{claim}</span>
              </div>
            </Rise>
          ))}
        </div>
      </div>

      <Pop
        delay={0}
        fade={false}
        style={{
          position: 'absolute',
          left: PRODUCT_CARD.left,
          top: PRODUCT_CARD.top,
          width: PRODUCT_CARD.width,
          height: PRODUCT_CARD.height,
        }}
      >
        <ProductCard style={{width: '100%', height: '100%', display: 'flex', flexDirection: 'column'}}>
          <WindowBar label={c.windowLabel} height={PRODUCT_CARD.barHeight} />
          <div style={{position: 'relative', flex: 1, overflow: 'hidden', background: '#fff'}}>
            <Video
              src={staticFile(DEMO.chat)}
              muted
              style={{width: '100%', height: '100%', objectFit: 'cover'}}
            />
            <CursorPulse size={72} style={{left: '15%', top: '45%', opacity: cursorOpacity}} />
          </div>
        </ProductCard>
      </Pop>

      <Vignette />
    </Stage>
  );
};
