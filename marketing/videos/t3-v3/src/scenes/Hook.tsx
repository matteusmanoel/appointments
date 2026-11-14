import type React from "react";
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import {
  ABOVE_ECHOES,
  Burst,
  Card,
  Echoes,
  Quake,
  SafeArea,
  Slam,
  hardShadow,
  heavy,
  outline,
} from "../components/kit";
import { COLORS, TIMELINE, local, sceneLength } from "../theme";

const VOCE = local("hook", "voceE");
const BARBEIRO = local("hook", "barbeiro");
const OU = local("hook", "ou");
const ATENDENTE = local("hook", "atendente");
/** BARBEIRO holds for two music beats; the second heartbeat kick lands here. */
const BARBEIRO_HEARTBEAT = TIMELINE.musicBeatFrames;

const barbeiroStyle = heavy(146);
const atendenteStyle = heavy(116);

export const Hook: React.FC = () => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill>
      <Sequence name="Você é" from={VOCE} durationInFrames={BARBEIRO - VOCE} premountFor={fps}>
        <Card bg={COLORS.black}>
          <SafeArea>
            <Slam from={1} drift={0.07}>
              <div style={{ ...heavy(240), lineHeight: 1.15 }}>Você é</div>
            </Slam>
          </SafeArea>
        </Card>
      </Sequence>

      <Sequence name="BARBEIRO" from={BARBEIRO} durationInFrames={OU - BARBEIRO} premountFor={fps}>
        <Card bg={COLORS.indigo}>
          <Burst color={COLORS.black} />
          <Quake hits={[BARBEIRO_HEARTBEAT]} amplitude={9} duration={8} seed="barbeiro-beat">
          <SafeArea>
            <Slam from={1.08} shakeAmp={24} rotate={-3} drift={0.04} seed="barbeiro">
              <div style={{ position: "relative" }}>
                <Echoes textStyle={barbeiroStyle} color={COLORS.black} fill={COLORS.indigo} strokeWidth={5} spacing={158} count={3} mode="both">
                  BARBEIRO
                </Echoes>
                <div
                  style={{
                    ...barbeiroStyle,
                    ...outline(18, COLORS.black),
                    textShadow: hardShadow(10, 14, COLORS.black),
                    ...ABOVE_ECHOES,
                  }}
                >
                  BARBEIRO
                </div>
              </div>
            </Slam>
          </SafeArea>
          </Quake>
        </Card>
      </Sequence>

      <Sequence name="ou" from={OU} durationInFrames={ATENDENTE - OU} premountFor={fps}>
        <Card bg={COLORS.white}>
          <SafeArea>
            <Slam from={1.7} drift={0.1}>
              <div style={{ ...heavy(320, COLORS.black), lineHeight: 1.1 }}>ou</div>
            </Slam>
          </SafeArea>
        </Card>
      </Sequence>

      <Sequence
        name="ATENDENTE?"
        from={ATENDENTE}
        durationInFrames={sceneLength("hook") - ATENDENTE}
        premountFor={fps}
      >
        <Card bg={COLORS.black}>
          <Burst color={COLORS.indigo} />
          <SafeArea>
            <Slam from={1.08} shakeAmp={24} rotate={3} drift={0.04} seed="atendente">
              <div style={{ position: "relative" }}>
                <Echoes textStyle={atendenteStyle} color={COLORS.indigo} fill={COLORS.black} strokeWidth={4} spacing={150} count={3} mode="both">
                  ATENDENTE?
                </Echoes>
                <div
                  style={{
                    ...atendenteStyle,
                    ...outline(16, COLORS.indigo),
                    textShadow: hardShadow(-10, 14, COLORS.indigo),
                    ...ABOVE_ECHOES,
                  }}
                >
                  ATENDENTE?
                </div>
              </div>
            </Slam>
          </SafeArea>
        </Card>
      </Sequence>
    </AbsoluteFill>
  );
};
