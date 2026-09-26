import { createContext, useContext, type ReactNode } from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { easeIn, progress } from "./motion";

/**
 * Scenes are authored against their nominal start, but each one begins a few
 * frames early so it can dissolve in over the previous scene. The lead is
 * carried in context so a scene's frame 0 stays its downbeat.
 */
const LeadContext = createContext(0);

export function useSceneFrame() {
  return useCurrentFrame() - useContext(LeadContext);
}

export function Scene({
  from,
  to,
  lead = 0,
  tail = 0,
  fadeOut = 0,
  children,
}: {
  /** Nominal first frame (the downbeat the scene is written against). */
  from: number;
  /** Nominal end; the next scene's start. */
  to: number;
  /** Frames of dissolve before `from`. */
  lead?: number;
  /** Frames the scene stays underneath the next one's dissolve. */
  tail?: number;
  /** Frames over which the scene fades to the stage before `to`, for a dip instead of a dissolve. */
  fadeOut?: number;
  children: ReactNode;
}) {
  const length = to - from + lead + tail;
  return (
    <Sequence from={from - lead} durationInFrames={length}>
      <LeadContext.Provider value={lead}>
        <Dissolve lead={lead} fadeOutAt={fadeOut > 0 ? to - from + lead - fadeOut : null} fadeOut={fadeOut}>
          {children}
        </Dissolve>
      </LeadContext.Provider>
    </Sequence>
  );
}

function Dissolve({
  lead,
  fadeOutAt,
  fadeOut,
  children,
}: {
  lead: number;
  fadeOutAt: number | null;
  fadeOut: number;
  children: ReactNode;
}) {
  const frame = useCurrentFrame();
  const fadeIn = lead > 0 ? progress(frame, 0, lead * 2) : 1;
  const out = fadeOutAt === null ? 1 : 1 - progress(frame, fadeOutAt, fadeOut, easeIn);
  return <AbsoluteFill style={{ opacity: fadeIn * out }}>{children}</AbsoluteFill>;
}
