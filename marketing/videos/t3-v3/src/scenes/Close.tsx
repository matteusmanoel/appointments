import type React from "react";
import {
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Card, SafeArea, Slam, heavy, punchScale } from "../components/kit";
import { COLORS, SAFE, fontFamily, local } from "../theme";

const LOGO = local("close", "logo");
const MENOS = local("close", "menos");
const MAIS_NAVALHIA = local("close", "maisNavalhia");
const BUTTON = local("close", "button");

const PULSE_PERIOD = 15;
const LOGO_WIDTH = 640;
const LOGO_RATIO = 259 / 1456;

/** Pulses from its entrance until the very last frame of the video. */
const CtaButton: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame - BUTTON;
  if (t < 0) {
    return null;
  }
  const cycle = (t % PULSE_PERIOD) / PULSE_PERIOD;
  const beat = 0.5 - 0.5 * Math.cos(cycle * Math.PI * 2);
  const entrance = punchScale(t, fps, 0.4);

  return (
    <div style={{ position: "relative", scale: entrance * (1 + 0.06 * beat) }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 999,
          border: `5px solid ${COLORS.white}`,
          scale: `${1 + cycle * 0.18} ${1 + cycle * 0.6}`,
          opacity: 0.7 * (1 - cycle),
        }}
      />
      <div
        style={{
          backgroundColor: COLORS.white,
          color: COLORS.indigo,
          fontFamily,
          fontWeight: 800,
          fontSize: 54,
          letterSpacing: "-0.01em",
          whiteSpace: "nowrap",
          borderRadius: 999,
          padding: "34px 54px",
          boxShadow: `0 0 0 6px ${COLORS.indigo}`,
        }}
      >
        Quero minha NavalhIA
      </div>
    </div>
  );
};

export const Close: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <Card bg={COLORS.black}>
      <SafeArea style={{ justifyContent: "flex-start", paddingTop: SAFE.top + 40 }}>
        <Slam at={LOGO} from={1.18} shakeAmp={10} drift={0.02} seed="logo">
          <Img
            src={staticFile("navalhia-logo-white.png")}
            style={{ width: LOGO_WIDTH, height: LOGO_WIDTH * LOGO_RATIO, display: "block" }}
          />
        </Slam>

        <div style={{ height: 230 }} />

        <Slam at={MENOS} from={1.08} shakeAmp={10} drift={0.02} seed="menos">
          <div style={{ ...heavy(92), lineHeight: 1.1 }}>Menos conversa.</div>
        </Slam>
        <Slam at={MAIS_NAVALHIA} from={1.12} shakeAmp={12} drift={0.02} seed="mais-navalhia" style={{ marginTop: 22 }}>
          <div
            style={{
              ...heavy(92),
              lineHeight: 1.1,
              backgroundColor: COLORS.indigo,
              padding: "12px 30px 18px",
              borderRadius: 18,
              rotate: `${interpolate(frame, [MAIS_NAVALHIA, MAIS_NAVALHIA + 6], [-6, -2], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              })}deg`,
            }}
          >
            Mais NavalhIA.
          </div>
        </Slam>

        <div style={{ height: 250 }} />

        <CtaButton />
      </SafeArea>
    </Card>
  );
};
