import React from 'react';
import {interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {theme} from '../theme.js';
import {COPY, END_CARD_STILL_FRAMES, b} from '../data.js';
import {
  Chip,
  Decor,
  Fade,
  Headline,
  LogoLockup,
  Micro,
  OrbitLine,
  Rise,
  SoftLight,
  Stage,
  Vignette,
} from '../components/index.js';

/**
 * S08 — End card (bars 27-29)
 * Back to the cover language, then the composition holds perfectly still for the
 * final 24 frames. The soundtrack's last bar is pad only, so the film breathes.
 */
export const S08End = () => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const c = COPY.end;
  const still = durationInFrames - END_CARD_STILL_FRAMES;

  // Everything is settled before the static hold: nothing moves after `settle`.
  const settle = still - 6;
  const progress = interpolate(frame, [0, settle], [0.55, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const up = (a, z) => interpolate(frame, [0, settle], [a, z], {extrapolateRight: 'clamp'});

  return (
    <Stage>
      <SoftLight />
      <OrbitLine progress={progress} width={1552} opacity={0.42} style={{left: 200, top: 46}} />

      <Decor
        kind="paper-card"
        width={330}
        opacity={0.92}
        style={{left: 74, top: 156, transform: `translateY(${up(-12, 10)}px) rotate(-3deg)`}}
      />
      <Decor kind="chat-bubble" width={268} style={{right: 206, top: 132, transform: `translateY(${up(-18, 10)}px)`}} />
      <Decor kind="sparkles" width={140} style={{right: 150, top: 300, opacity: 0.85}} />
      <Decor kind="cursor" width={172} style={{right: 286, bottom: 96, transform: `translateY(${up(14, -8)}px)`}} />

      <div style={{position: 'absolute', left: 0, right: 0, top: 296, display: 'flex', justifyContent: 'center'}}>
        <Fade delay={b(0.4)}>
          <LogoLockup wordmarkSize={150} taglineSize={46} tagline={c.tagline} />
        </Fade>
      </div>

      <div style={{position: 'absolute', left: 0, right: 0, top: 640, display: 'flex', justifyContent: 'center'}}>
        <Rise delay={b(2.5)} distance={18}>
          <Micro size={28} color={theme.color.inkSoft}>
            {c.repo}
          </Micro>
        </Rise>
      </div>

      <div style={{position: 'absolute', left: 0, right: 0, top: 700, display: 'flex', justifyContent: 'center'}}>
        <Rise delay={b(3.5)} distance={18}>
          <Chip tone="red">{c.cta}</Chip>
        </Rise>
      </div>

      <div style={{position: 'absolute', left: 0, right: 0, top: 930, display: 'flex', justifyContent: 'center'}}>
        <Fade delay={b(4.5)}>
          <Headline size={22} weight={460} tracking={0} lineHeight={1.3} color={theme.color.inkFaint} align="center">
            {c.disclaimer}
          </Headline>
        </Fade>
      </div>

      <Vignette />
    </Stage>
  );
};
