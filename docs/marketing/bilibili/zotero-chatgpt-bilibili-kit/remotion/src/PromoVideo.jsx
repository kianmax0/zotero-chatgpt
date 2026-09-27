import React from 'react';
import {AbsoluteFill, Audio, Sequence, staticFile} from 'remotion';
import {SCENES} from './data.js';
import {theme} from './theme.js';
import {
  S01Friction,
  S02Principle,
  S03Reveal,
  S04Chat,
  S05Agent,
  S06Native,
  S07Montage,
  S08End,
} from './scenes/index.js';

const REGISTRY = {
  friction: S01Friction,
  principle: S02Principle,
  reveal: S03Reveal,
  chat: S04Chat,
  agent: S05Agent,
  native: S06Native,
  montage: S07Montage,
  end: S08End,
};

/**
 * 1920x1080 / 30fps / 48s on a 150 BPM grid. Scene boundaries live in data.js
 * only, so the picture, the cover frame and the soundtrack cannot drift apart.
 */
export const PromoVideo = () => (
  <AbsoluteFill style={{background: theme.color.paper}}>
    {/* Synthesised by tools/audio.mjs. The WAV is 2,116,800 samples, exactly
        1440 frames at 44.1 kHz / 30fps, so it lines up with the picture. */}
    <Audio src={staticFile('audio/promo.wav')} />

    {SCENES.map((scene) => {
      const Component = REGISTRY[scene.id];
      return (
        <Sequence key={scene.id} from={scene.startFrame} durationInFrames={scene.durationInFrames}>
          <Component />
        </Sequence>
      );
    })}
  </AbsoluteFill>
);
