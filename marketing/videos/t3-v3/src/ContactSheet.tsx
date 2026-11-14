import type React from "react";
import { AbsoluteFill, Freeze } from "remotion";
import { T3V3 } from "./T3V3";
import { COLORS, TIMELINE, fontFamily } from "./theme";

/** One representative (settled) frame per card of the edit. */
export const CONTACT_SHEET_FRAMES: readonly { frame: number; label: string }[] = [
  { frame: 10, label: "Você é" },
  { frame: 34, label: "BARBEIRO" },
  { frame: 47, label: "ou" },
  { frame: 68, label: "ATENDENTE?" },
  { frame: 104, label: "PARE DE PERDER CLIENTE." },
  { frame: 144, label: "Marca. Remarca. Avisa." },
  { frame: 216, label: "Prova (chat)" },
  { frame: 255, label: "CADEIRA VAZIA..." },
  { frame: 298, label: "LEMBRETES / OCUPAÇÃO" },
  { frame: 335, label: "$MAIS FATURAMENTO$" },
  { frame: 384, label: "Delegue / Domine" },
  { frame: 449, label: "Fecho (último frame)" },
];

const COLUMNS = 4;
const SCALE = 0.25;
const TILE_W = TIMELINE.width * SCALE;
const TILE_H = TIMELINE.height * SCALE;
const GAP = 24;
const LABEL_H = 64;
const PAD = 40;

export const CONTACT_SHEET_SIZE = {
  width: PAD * 2 + COLUMNS * TILE_W + (COLUMNS - 1) * GAP,
  height:
    PAD * 2 +
    Math.ceil(CONTACT_SHEET_FRAMES.length / COLUMNS) * (TILE_H + LABEL_H + GAP) -
    GAP,
};

export const ContactSheet: React.FC = () => (
  <AbsoluteFill
    style={{
      backgroundColor: "#1A1A1A",
      padding: PAD,
      display: "flex",
      flexDirection: "row",
      flexWrap: "wrap",
      gap: GAP,
      alignContent: "flex-start",
      fontFamily,
    }}
  >
    {CONTACT_SHEET_FRAMES.map(({ frame, label }) => (
      <div key={frame} style={{ width: TILE_W }}>
        <div
          style={{
            width: TILE_W,
            height: TILE_H,
            position: "relative",
            overflow: "hidden",
            outline: `2px solid ${COLORS.white}`,
          }}
        >
          <div
            style={{
              position: "absolute",
              width: TIMELINE.width,
              height: TIMELINE.height,
              scale: SCALE,
              transformOrigin: "0 0",
            }}
          >
            <Freeze frame={frame}>
              <T3V3 showSafeArea={false} muted />
            </Freeze>
          </div>
        </div>
        <div
          style={{
            height: LABEL_H,
            color: COLORS.white,
            fontSize: 20,
            fontWeight: 700,
            paddingTop: 10,
            lineHeight: 1.3,
          }}
        >
          <span style={{ color: "#9FA0FF" }}>f{frame}</span> · {label}
        </div>
      </div>
    ))}
  </AbsoluteFill>
);
