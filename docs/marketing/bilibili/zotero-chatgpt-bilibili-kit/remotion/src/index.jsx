import React from 'react';
import {Composition, registerRoot} from 'remotion';
import {PromoVideo} from './PromoVideo.jsx';
import {DURATION_IN_FRAMES, FPS, HEIGHT, WIDTH} from './data.js';

const Root = () => (
  <Composition
    id="PromoVideo"
    component={PromoVideo}
    durationInFrames={DURATION_IN_FRAMES}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
  />
);

registerRoot(Root);
