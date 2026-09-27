import React from 'react';
import {Sequence, Video, staticFile, useVideoConfig} from 'remotion';
import {theme} from '../theme.js';
import {AGENT_CUT_BEAT, COPY, DEMO, PRODUCT_CARD, b} from '../data.js';
import {
  Chip,
  FlashCard,
  Headline,
  Pop,
  ProductCard,
  Rise,
  SoftLight,
  Stage,
  Sub,
  Vignette,
  WindowBar,
} from '../components/index.js';

/**
 * S05 — Agent (bars 15-20)
 * Two demos, one hard cut on beat 16 hidden by a five-frame white card
 * expansion. The whole cut — flash, whoosh and the swap itself — lands on the
 * same downbeat the soundtrack hits.
 */
export const S05Agent = () => {
  const {durationInFrames} = useVideoConfig();
  const c = COPY.agent;
  const cut = b(AGENT_CUT_BEAT);

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

        <Rise delay={b(2)}>
          <Sub align="left" size={26} style={{marginTop: 30}}>
            {c.sub}
          </Sub>
        </Rise>

        <div style={{display: 'flex', gap: 14, marginTop: 52}}>
          {c.chips.map((chip, i) => (
            <Rise key={chip} delay={b(3 + i * 1.5)} distance={18}>
              <Chip>{chip}</Chip>
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
            <Sequence from={0} durationInFrames={cut}>
              <Video
                src={staticFile(DEMO.agentHighlight)}
                muted
                endAt={cut}
                style={{width: '100%', height: '100%', objectFit: 'cover'}}
              />
            </Sequence>
            <Sequence from={cut} durationInFrames={durationInFrames - cut}>
              <Video
                src={staticFile(DEMO.agentReview)}
                muted
                endAt={durationInFrames - cut}
                style={{width: '100%', height: '100%', objectFit: 'cover'}}
              />
            </Sequence>
            <FlashCard startFrame={cut - 5} />
          </div>
        </ProductCard>
      </Pop>

      <Vignette />
    </Stage>
  );
};
