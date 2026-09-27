import React from 'react';
import {spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {theme} from '../theme.js';
import {COPY, b} from '../data.js';
import {Headline, ModeToggle, Pop, Rise, SoftLight, Stage, Sub, Vignette} from '../components/index.js';

/**
 * S02 — The principle (bars 3-5)
 * Typography only. Two words, two permissions, one hairline between them.
 */
export const S02Principle = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const c = COPY.principle;

  const separator = spring({
    frame: frame + 4,
    fps,
    config: {damping: 20, stiffness: 110, mass: 0.9},
  });

  // Slow, deliberate, single move: Chat -> Agent.
  const knob = spring({
    frame: Math.max(0, frame - b(6)),
    fps,
    config: {damping: 27, stiffness: 55, mass: 1},
  });

  return (
    <Stage>
      <SoftLight />

      <div
        style={{
          position: 'absolute',
          left: 160,
          right: 160,
          top: 236,
          display: 'grid',
          gridTemplateColumns: '1fr 1px 1fr',
          alignItems: 'center',
          gap: 84,
        }}
      >
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
          <Rise delay={b(-0.7)} distance={28}>
            <Headline size={148} tracking={-4}>
              {c.left}
            </Headline>
          </Rise>
          <Rise delay={b(0.5)}>
            <Sub size={30} style={{marginTop: 22}}>
              {c.leftSub}
            </Sub>
          </Rise>
        </div>

        <div
          style={{
            width: 2,
            height: 300,
            background: theme.color.line,
            transform: `scaleY(${separator})`,
            transformOrigin: '50% 50%',
          }}
        />

        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
          <Rise delay={0} distance={28}>
            <Headline size={148} tracking={-4} color={theme.color.red}>
              {c.right}
            </Headline>
          </Rise>
          <Rise delay={b(1.2)}>
            <Sub size={30} style={{marginTop: 22}}>
              {c.rightSub}
            </Sub>
          </Rise>
        </div>
      </div>

      <div style={{position: 'absolute', left: 0, right: 0, top: 660, display: 'flex', justifyContent: 'center'}}>
        <Rise delay={b(3)} distance={22}>
          <Headline size={56} tracking={-0.5}>
            {c.statement[0]}
            <span style={{color: theme.color.red, margin: '0 18px'}}>{c.statement[1]}</span>
            {c.statement[2]}
          </Headline>
        </Rise>
      </div>

      <div style={{position: 'absolute', left: 0, right: 0, top: 800, display: 'flex', justifyContent: 'center'}}>
        <Pop delay={b(5.5)} from={0.94}>
          <ModeToggle progress={knob} />
        </Pop>
      </div>

      <Vignette />
    </Stage>
  );
};
