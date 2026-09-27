import React from 'react';
import {COPY, b} from '../data.js';
import {FeatureCard, Kicker, Pop, SoftLight, Stage, Vignette} from '../components/index.js';

const CARD = {width: 296, height: 320, gap: 22, top: 404};
const LEFT = Math.round((1920 - (CARD.width * 5 + CARD.gap * 4)) / 2);

/**
 * S07 — Capability montage (bars 24-26)
 * Five cards, three arrival groups on the beat, then quiet. The montage carries
 * the riser that lands on the end card.
 */
export const S07Montage = () => (
  <Stage>
    <SoftLight />

    <div style={{position: 'absolute', left: 0, right: 0, top: 172, display: 'flex', justifyContent: 'center'}}>
      <Pop delay={b(-0.5)} from={0.96}>
        <Kicker>{COPY.montage.kicker}</Kicker>
      </Pop>
    </div>

    <div style={{position: 'absolute', left: LEFT, top: CARD.top, display: 'flex', gap: CARD.gap}}>
      {COPY.montage.items.map((item, i) => (
        <Pop
          key={item.label}
          delay={b(0.8) + Math.floor(i / 2) * b(1.5) + (i % 2) * b(0.5) - 6}
          from={0.965}
        >
          <FeatureCard
            label={item.label}
            icon={item.icon}
            style={{width: CARD.width, height: CARD.height}}
          />
        </Pop>
      ))}
    </div>

    <Vignette />
  </Stage>
);
