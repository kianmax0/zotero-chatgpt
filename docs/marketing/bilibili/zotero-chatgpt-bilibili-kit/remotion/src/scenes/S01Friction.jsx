import React from 'react';
import {Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {theme} from '../theme.js';
import {COPY, b} from '../data.js';
import {
  ApiKeyChip,
  Camera,
  Decor,
  Headline,
  Kicker,
  OrbitLine,
  Pop,
  ReceiptCard,
  Rise,
  SoftLight,
  Stage,
  Vignette,
} from '../components/index.js';

/**
 * S01 — The friction (bars 0-2)
 * An empty warm-white stage. A paper sheet drifts in, an API-key chip and a
 * receipt appear, then soften out of focus. One red curve draws behind it.
 */
export const S01Friction = () => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const c = COPY.friction;

  // Pre-rolled by six frames so frame 0 is already a composed picture rather
  // than an empty stage — the first frame is what a player shows while loading.
  const paper = spring({frame: frame + 6, fps, config: theme.spring.gentle});
  const paperX = interpolate(paper, [0, 1], [-70, 0]);
  const paperY = interpolate(frame, [0, durationInFrames], [-14, 12], {
    extrapolateRight: 'clamp',
  });

  const orbit = interpolate(frame, [0, b(11)], [0, 0.58], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  // The API bill is pushed out of focus rather than dismissed.
  const defocus = interpolate(frame, [b(7.5), b(10.5)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <Stage>
      <SoftLight />
      <Camera from={1} to={1.03} driftX={-8} driftY={-5}>
        <OrbitLine progress={orbit} width={1600} opacity={0.32} style={{left: 160, top: 84}} />
        <Decor
          kind="paper-card"
          width={430}
          opacity={0.94}
          style={{left: -64, top: 214, transform: `translate(${paperX}px, ${paperY}px) rotate(-2deg)`}}
        />

        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            paddingBottom: 40,
          }}
        >
          <Rise delay={b(-0.5)}>
            <Kicker>{c.kicker}</Kicker>
          </Rise>

          <Rise delay={b(0.2)} distance={30}>
            <Headline size={116} style={{marginTop: 30}}>
              {c.heroLines[0]}
              <br />
              <span style={{color: theme.color.red}}>{c.heroLines[1]}</span>
            </Headline>
          </Rise>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 28,
              marginTop: 76,
              filter: `blur(${defocus * 9}px)`,
              opacity: 1 - defocus * 0.62,
              transform: `translateY(${defocus * 16}px)`,
            }}
          >
            <Pop delay={b(3)}>
              <ApiKeyChip label={c.apiKey} />
            </Pop>
            <Pop delay={b(4.5)}>
              <ReceiptCard rows={c.receiptRows} total={c.receiptTotal} />
            </Pop>
          </div>
        </div>
      </Camera>
      <Vignette />
    </Stage>
  );
};
