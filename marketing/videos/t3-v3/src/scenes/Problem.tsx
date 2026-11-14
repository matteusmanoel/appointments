import type React from "react";
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import {
  ABOVE_ECHOES,
  Card,
  Echoes,
  Quake,
  SafeArea,
  Slam,
  hardShadow,
  heavy,
  outline,
} from "../components/kit";
import { COLORS, local, sceneLength } from "../theme";

const PARE = local("problem", "pare");
const CLIENTE = local("problem", "cliente");
const MARCA = local("problem", "marca");
const REMARCA = local("problem", "remarca");
const AVISA = local("problem", "avisa");

const clienteStyle = heavy(176);

const Verb: React.FC<{
  readonly word: string;
  readonly at: number;
  readonly from: number;
  readonly seed: string;
}> = ({ word, at, from, seed }) => (
  <Slam at={at} from={from} shakeAmp={14} shakeFrames={6} drift={0.02} seed={seed}>
    <div style={{ ...heavy(168, COLORS.black), lineHeight: 1.12 }}>
      {word}
      <span style={{ color: COLORS.indigo }}>.</span>
    </div>
  </Slam>
);

export const Problem: React.FC = () => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill>
      <Sequence name="PARE DE PERDER CLIENTE." from={PARE} durationInFrames={MARCA - PARE} premountFor={fps}>
        <Card bg={COLORS.indigo}>
          <Quake hits={[CLIENTE - PARE]} amplitude={18} seed="cliente">
            <SafeArea style={{ gap: 18 }}>
              <Slam from={1.03} shakeAmp={10} drift={0.03} seed="pare">
                <div style={heavy(90)}>PARE DE PERDER</div>
              </Slam>
              <Slam at={CLIENTE - PARE} from={1.08} shakeAmp={20} drift={0.03} seed="cliente-word">
                <div style={{ position: "relative" }}>
                  <Echoes
                    textStyle={clienteStyle}
                    color={COLORS.white}
                    fill={COLORS.indigo}
                    strokeWidth={4}
                    spacing={150}
                    count={2}
                    mode="down"
                    at={CLIENTE - PARE}
                    fall={2.4}
                  >
                    CLIENTE.
                  </Echoes>
                  <div
                    style={{
                      ...clienteStyle,
                      ...outline(16, COLORS.black),
                      textShadow: hardShadow(0, 14, COLORS.black),
                      ...ABOVE_ECHOES,
                    }}
                  >
                    CLIENTE.
                  </div>
                </div>
              </Slam>
            </SafeArea>
          </Quake>
        </Card>
      </Sequence>

      <Sequence
        name="Marca. Remarca. Avisa."
        from={MARCA}
        durationInFrames={sceneLength("problem") - MARCA}
        premountFor={fps}
      >
        <Card bg={COLORS.white}>
          <SafeArea>
            <Verb word="Marca" at={0} from={1.4} seed="marca" />
            <Verb word="Remarca" at={REMARCA - MARCA} from={1.06} seed="remarca" />
            <Verb word="Avisa" at={AVISA - MARCA} from={1.45} seed="avisa" />
          </SafeArea>
        </Card>
      </Sequence>
    </AbsoluteFill>
  );
};
