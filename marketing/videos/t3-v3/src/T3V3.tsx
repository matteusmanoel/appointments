import { Audio } from "@remotion/media";
import type React from "react";
import { AbsoluteFill, Series, staticFile, useVideoConfig } from "remotion";
import { Close } from "./scenes/Close";
import { Delegate } from "./scenes/Delegate";
import { Hook } from "./scenes/Hook";
import { Problem } from "./scenes/Problem";
import { Proof } from "./scenes/Proof";
import { Value } from "./scenes/Value";
import { COLORS, SAFE, sceneLength } from "./theme";

export type T3V3Props = {
  /** Review-only overlay of the platform safe area. Never enable for delivery. */
  readonly showSafeArea: boolean;
  readonly muted: boolean;
};

const SafeAreaGuide: React.FC = () => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    <div
      style={{
        position: "absolute",
        top: SAFE.top,
        bottom: SAFE.bottom,
        left: SAFE.side,
        right: SAFE.side,
        outline: "3px dashed #FF2D55",
      }}
    />
  </AbsoluteFill>
);

export const T3V3: React.FC<T3V3Props> = ({ showSafeArea, muted }) => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.black }}>
      <Series>
        <Series.Sequence name="Gancho" durationInFrames={sceneLength("hook")} premountFor={fps}>
          <Hook />
        </Series.Sequence>
        <Series.Sequence name="Problema" durationInFrames={sceneLength("problem")} premountFor={fps}>
          <Problem />
        </Series.Sequence>
        <Series.Sequence name="Prova" durationInFrames={sceneLength("proof")} premountFor={fps}>
          <Proof />
        </Series.Sequence>
        <Series.Sequence name="Valor" durationInFrames={sceneLength("value")} premountFor={fps}>
          <Value />
        </Series.Sequence>
        <Series.Sequence name="Delegue / Domine" durationInFrames={sceneLength("delegate")} premountFor={fps}>
          <Delegate />
        </Series.Sequence>
        <Series.Sequence name="Fecho" durationInFrames={sceneLength("close")} premountFor={fps}>
          <Close />
        </Series.Sequence>
      </Series>

      {muted ? null : <Audio name="Trilha + SFX" src={staticFile("audio/mix.wav")} />}
      {showSafeArea ? <SafeAreaGuide /> : null}
    </AbsoluteFill>
  );
};
