import React from 'react';
import {Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {theme} from '../theme.js';
import {COPY, b} from '../data.js';
import {
  Chip,
  Decor,
  Fade,
  LogoLockup,
  OrbitLine,
  SoftLight,
  Stage,
  Vignette,
} from '../components/index.js';

/**
 * S03 — Product reveal (bars 6-9)
 * The brand lockup lands inside the cover's own composition. Frame 360 (00:12)
 * is the Bilibili cover candidate, so the lockup and badges are both settled by
 * then; the lockup spring is bounded so it cannot still be travelling.
 */
export const S03Reveal = () => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const c = COPY.reveal;

  const lockup = spring({frame, fps, config: theme.spring.gentle, durationInFrames: 20});

  const orbit = interpolate(frame, [0, b(11)], [0, 0.4], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  const up = (a, z) => interpolate(frame, [0, durationInFrames], [a, z], {extrapolateRight: 'clamp'});

  return (
    <Stage>
      <SoftLight />
      <OrbitLine progress={orbit} width={1620} opacity={0.4} style={{left: 158, top: 60}} />

      <Decor kind="paper-card" width={392} opacity={0.95} style={{left: 68, top: 196, transform: `translateY(${up(-18, 18)}px) rotate(-3deg)`}} />
      <Decor kind="chat-bubble" width={300} style={{right: 216, top: 118, transform: `translateY(${up(-26, 14)}px)`}} />
      <Decor kind="sparkles" width={168} style={{right: 128, top: 300, opacity: 0.9}} />
      <Decor kind="cursor" width={196} style={{right: 268, bottom: 92, transform: `translateY(${up(18, -12)}px)`}} />

      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          paddingBottom: 30,
        }}
      >
        <div style={{opacity: lockup, transform: `scale(${0.97 + 0.03 * lockup})`}}>
          <LogoLockup wordmarkSize={150} taglineSize={46} tagline={c.tagline} />
        </div>

        <Fade delay={b(1.5)} durationInFrames={18} style={{marginTop: 66, display: 'flex', gap: 18}}>
          <Chip tone="red">{c.badges[0]}</Chip>
          <Chip>{c.badges[1]}</Chip>
        </Fade>
      </div>

      <Vignette />
    </Stage>
  );
};
