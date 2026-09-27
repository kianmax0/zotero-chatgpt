import {Config} from '@remotion/cli/config';

// Set this when a local Chrome is preferred over Remotion's managed browser.
if (process.env.REMOTION_BROWSER_EXECUTABLE) {
  Config.setBrowserExecutable(process.env.REMOTION_BROWSER_EXECUTABLE);
}
Config.setCodec('h264');
Config.setCrf(16);
Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
