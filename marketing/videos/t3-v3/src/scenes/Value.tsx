import type React from "react";
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  Burst,
  Card,
  Quake,
  SafeArea,
  Slam,
  hardShadow,
  heavy,
  outline,
} from "../components/kit";
import { COLORS, local, sceneLength } from "../theme";

const CADEIRA = local("value", "cadeira");
const NAO_PAGA = local("value", "naoPaga");
const LEMBRETES = local("value", "lembretes");
const REATIVACOES = local("value", "reativacoes");
const OCUPACAO = local("value", "ocupacao");
const ARROW_LAND = local("value", "arrowLand");
const MAIS = local("value", "mais");
const CIFROES = local("value", "cifroes");

const RisingArrow: React.FC<{ readonly at: number; readonly land: number }> = ({ at, land }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rise = interpolate(frame, [at, land], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const bounce = spring({
    frame: frame - land,
    fps,
    config: { damping: 9, stiffness: 500, mass: 0.4 },
  });
  const lift = frame < land ? interpolate(rise, [0, 1], [70, -14]) : interpolate(bounce, [0, 1], [-14, 0]);

  return (
    <svg
      width={86}
      height={110}
      viewBox="0 0 86 110"
      style={{ translate: `0px ${lift}px`, overflow: "visible" }}
    >
      <path
        d="M43 4 L82 50 L58 50 L58 106 L28 106 L28 50 L4 50 Z"
        fill={COLORS.indigo}
        stroke={COLORS.black}
        strokeWidth={6}
        strokeLinejoin="round"
      />
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={20 + i * 20}
          y={118 + i * 10}
          width={6}
          height={interpolate(rise, [0, 1], [10, 60 - i * 12])}
          rx={3}
          fill={COLORS.black}
          opacity={frame < land + 6 ? 0.8 : 0}
        />
      ))}
    </svg>
  );
};

const Cifrao: React.FC<{ readonly at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  const pulse = interpolate(frame, [at, at + 4, at + 11], [1, 1.45, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <span
      style={{
        display: "inline-block",
        scale: pulse,
        color: COLORS.white,
        textShadow: hardShadow(0, 10, COLORS.indigo),
      }}
    >
      $
    </span>
  );
};

export const Value: React.FC = () => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill>
      <Sequence name="CADEIRA VAZIA NÃO PAGA CONTA." from={CADEIRA} durationInFrames={LEMBRETES - CADEIRA} premountFor={fps}>
        <Card bg={COLORS.white}>
          <Quake hits={[0, NAO_PAGA - CADEIRA]} amplitude={30} duration={12} seed="cadeira">
            <SafeArea style={{ gap: 6 }}>
              <Slam from={1.03} drift={0.03} seed="cadeira-a">
                <div style={{ ...heavy(172, COLORS.black), lineHeight: 0.98 }}>CADEIRA</div>
                <div
                  style={{
                    ...heavy(240, COLORS.white),
                    ...outline(14, COLORS.black),
                    lineHeight: 0.98,
                  }}
                >
                  VAZIA
                </div>
              </Slam>
              <Slam at={NAO_PAGA - CADEIRA} from={1.03} drift={0.03} seed="cadeira-b">
                <div style={{ ...heavy(144, COLORS.black), lineHeight: 1.12 }}>NÃO PAGA</div>
                <div style={{ ...heavy(204, COLORS.black), lineHeight: 0.98 }}>CONTA.</div>
              </Slam>
            </SafeArea>
          </Quake>
        </Card>
      </Sequence>

      <Sequence name="LEMBRETES + REATIVAÇÕES / ↑ OCUPAÇÃO" from={LEMBRETES} durationInFrames={MAIS - LEMBRETES} premountFor={fps}>
        <Card bg={COLORS.indigo}>
          <SafeArea style={{ gap: 14 }}>
            <Slam from={1.06} shakeAmp={12} drift={0.02} seed="lembretes">
              <div
                style={{
                  ...heavy(128),
                  ...outline(12, COLORS.black),
                  textShadow: hardShadow(0, 10, COLORS.black),
                }}
              >
                LEMBRETES
              </div>
            </Slam>
            <Slam at={REATIVACOES - LEMBRETES} from={1.06} shakeAmp={12} drift={0.02} seed="reativacoes">
              <div
                style={{
                  ...heavy(97),
                  ...outline(10, COLORS.black),
                  textShadow: hardShadow(0, 8, COLORS.black),
                  lineHeight: 1.18,
                }}
              >
                + REATIVAÇÕES
              </div>
            </Slam>
            <Slam
              at={OCUPACAO - LEMBRETES}
              from={1.08}
              shakeAmp={10}
              drift={0.03}
              seed="ocupacao"
              style={{ marginTop: 40 }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 26,
                  backgroundColor: COLORS.white,
                  border: `8px solid ${COLORS.black}`,
                  boxShadow: hardShadow(0, 14, COLORS.black),
                  borderRadius: 26,
                  padding: "26px 40px 22px",
                }}
              >
                <RisingArrow at={OCUPACAO - LEMBRETES} land={ARROW_LAND - LEMBRETES} />
                <div style={{ ...heavy(100, COLORS.black), lineHeight: 1.12 }}>OCUPAÇÃO</div>
              </div>
            </Slam>
          </SafeArea>
        </Card>
      </Sequence>

      <Sequence name="$MAIS FATURAMENTO$" from={MAIS} durationInFrames={sceneLength("value") - MAIS} premountFor={fps}>
        <Card bg={COLORS.black}>
          <Burst color={COLORS.indigo} />
          <SafeArea style={{ gap: 10 }}>
            <Slam from={1.06} shakeAmp={22} drift={0.04} seed="mais">
              <div style={{ ...heavy(250), textShadow: hardShadow(0, 12, COLORS.indigo) }}>
                <Cifrao at={CIFROES - MAIS} />
                MAIS
              </div>
            </Slam>
            <Slam from={1.06} shakeAmp={22} drift={0.04} seed="faturamento">
              <div style={{ ...heavy(96), textShadow: hardShadow(0, 8, COLORS.indigo) }}>
                FATURAMENTO
                <Cifrao at={CIFROES - MAIS} />
              </div>
            </Slam>
          </SafeArea>
        </Card>
      </Sequence>
    </AbsoluteFill>
  );
};
