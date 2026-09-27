import { Composition } from "remotion";
import "./fonts";
import { Pitch } from "./Pitch";
import { DURATION, FPS, HEIGHT, WIDTH } from "./timeline";

export function RemotionRoot() {
  return (
    <Composition id="Pitch" component={Pitch} durationInFrames={DURATION} fps={FPS} width={WIDTH} height={HEIGHT} />
  );
}
