import { Audio } from "@remotion/media";
import { AbsoluteFill, staticFile } from "remotion";
import { Scene } from "./scene-frame";
import { AnywhereScene } from "./scenes/AnywhereScene";
import { EndCard } from "./scenes/EndCard";
import { MemoryScene } from "./scenes/MemoryScene";
import { PluginsScene } from "./scenes/PluginsScene";
import { ReaderScene } from "./scenes/ReaderScene";
import { color } from "./theme";
import { SCENES } from "./timeline";

/** Each dissolve straddles the downbeat: half before it, half after. */
const DISSOLVE = 6;

export function Pitch() {
  return (
    <AbsoluteFill style={{ background: color.stage }}>
      <Scene from={SCENES.opening.from} to={SCENES.ask.to} tail={DISSOLVE}>
        <ReaderScene />
      </Scene>
      <Scene from={SCENES.memory.from} to={SCENES.memory.to} lead={DISSOLVE} tail={DISSOLVE}>
        <MemoryScene />
      </Scene>
      {/* The layout changes completely here, so dip to the stage rather than dissolve. */}
      <Scene from={SCENES.plugins.from} to={SCENES.plugins.to} lead={DISSOLVE} fadeOut={8}>
        <PluginsScene />
      </Scene>
      <Scene from={SCENES.anywhere.from} to={SCENES.anywhere.to} tail={2}>
        <AnywhereScene />
      </Scene>
      <Scene from={SCENES.card.from} to={SCENES.card.to} lead={2}>
        <EndCard />
      </Scene>
      <Audio src={staticFile("score.wav")} />
    </AbsoluteFill>
  );
}
