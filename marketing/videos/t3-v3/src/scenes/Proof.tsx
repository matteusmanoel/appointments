import type React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Card } from "../components/kit";
import { COLORS, SAFE, fontFamily, local } from "../theme";

const TYPING1 = local("proof", "typing1");
const REPLY = local("proof", "reply");
const CHOICE = local("proof", "choice");
const TYPING2 = local("proof", "typing2");
const CONFIRM = local("proof", "confirm");
const STAMP = local("proof", "stamp");

const PHONE = { width: 660, height: 960, top: 296, bezel: 16, scale: 1.15 } as const;
const BUBBLE_GRAY = "#262626";

/**
 * Hard camera cuts: each beat jumps to a new framing. Zoom is anchored at
 * y=700 so the chat header never leaves the top safe area.
 */
const CAMERA = [
  { at: 0, scale: 1, x: 0, rotate: 0 },
  { at: REPLY, scale: 1.1, x: 14, rotate: -1.5 },
  { at: CHOICE, scale: 1.04, x: -12, rotate: 1.2 },
  { at: CONFIRM, scale: 1.1, x: 0, rotate: -1 },
] as const;

const useCamera = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const shot = [...CAMERA].reverse().find((c) => frame >= c.at) ?? CAMERA[0];
  const settle = spring({
    frame: frame - shot.at,
    fps,
    config: { damping: 16, stiffness: 600, mass: 0.45 },
  });
  const kick = shot.at === 0 ? 0.14 : 0.04;
  return {
    scale: shot.scale + kick * (1 - settle),
    x: shot.x,
    rotate: shot.rotate,
  };
};

const Appear: React.FC<{
  readonly at: number;
  readonly until?: number;
  readonly side: "left" | "right";
  readonly top: number;
  readonly maxWidth?: number;
  readonly children: React.ReactNode;
}> = ({ at, until, side, top, maxWidth = 470, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < at || (until !== undefined && frame >= until)) {
    return null;
  }
  const pop = spring({
    frame: frame - at,
    fps,
    config: { damping: 13, stiffness: 520, mass: 0.45 },
  });
  return (
    <div
      style={{
        position: "absolute",
        top,
        [side]: 24,
        maxWidth,
        transformOrigin: side === "left" ? "0% 100%" : "100% 100%",
        scale: interpolate(pop, [0, 1], [0.55, 1]),
        opacity: interpolate(pop, [0, 0.35], [0, 1], { extrapolateRight: "clamp" }),
      }}
    >
      {children}
    </div>
  );
};

const bubble = (from: "client" | "assistant"): React.CSSProperties => ({
  backgroundColor: from === "client" ? COLORS.white : BUBBLE_GRAY,
  color: from === "client" ? COLORS.black : COLORS.white,
  borderRadius: 30,
  borderBottomRightRadius: from === "client" ? 8 : 30,
  borderBottomLeftRadius: from === "assistant" ? 8 : 30,
  padding: "18px 26px",
  fontFamily,
  fontWeight: 700,
  fontSize: 42,
  lineHeight: 1.18,
});

const TypingDots: React.FC<{ readonly at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ ...bubble("assistant"), display: "flex", gap: 12, padding: "26px 30px" }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            width: 16,
            height: 16,
            borderRadius: 8,
            backgroundColor: COLORS.white,
            opacity: (frame - at) % 3 === i ? 1 : 0.35,
          }}
        />
      ))}
    </div>
  );
};

const CheckIcon: React.FC<{ readonly size: number; readonly stroke: number }> = ({
  size,
  stroke,
}) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    <circle cx={50} cy={50} r={50} fill={COLORS.indigo} />
    <path
      d="M27 52 L44 68 L74 35"
      fill="none"
      stroke={COLORS.white}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const Chip: React.FC<{ readonly label: string; readonly picked: boolean }> = ({
  label,
  picked,
}) => (
  <div
    style={{
      border: `3px solid ${picked ? COLORS.indigo : COLORS.white}`,
      backgroundColor: picked ? COLORS.indigo : "transparent",
      color: COLORS.white,
      borderRadius: 999,
      padding: "8px 22px",
      fontWeight: 800,
      fontSize: 38,
    }}
  >
    {label}
  </div>
);

const Stamp: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < STAMP) {
    return null;
  }
  const hit = spring({
    frame: frame - STAMP,
    fps,
    config: { damping: 11, stiffness: 480, mass: 0.5 },
  });
  return (
    <div
      style={{
        position: "absolute",
        top: 745,
        right: 22,
        scale: interpolate(hit, [0, 1], [2.2, 1]),
        rotate: `${interpolate(hit, [0, 1], [-25, -8])}deg`,
        borderRadius: "50%",
        border: `8px solid ${COLORS.white}`,
        lineHeight: 0,
      }}
    >
      <CheckIcon size={140} stroke={13} />
    </div>
  );
};

const ChatScreen: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: "absolute",
        inset: PHONE.bezel,
        borderRadius: 64,
        backgroundColor: "#111111",
        overflow: "hidden",
        fontFamily,
      }}
    >
      <div
        style={{
          height: 130,
          paddingTop: 36,
          paddingLeft: 28,
          display: "flex",
          alignItems: "center",
          gap: 20,
          borderBottom: "2px solid #2C2C2C",
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 36,
            backgroundColor: COLORS.indigo,
            color: COLORS.white,
            fontWeight: 900,
            fontSize: 30,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          BC
        </div>
        <div>
          <div style={{ color: COLORS.white, fontWeight: 800, fontSize: 32 }}>Barbearia Central</div>
          <div style={{ color: "#BDBDBD", fontWeight: 600, fontSize: 24 }}>
            {frame >= TYPING1 && frame < REPLY ? "digitando..." : "online"}
          </div>
        </div>
      </div>

      <Appear at={0} side="right" top={155}>
        <div style={bubble("client")}>Oi! Tem horário hoje?</div>
      </Appear>

      <Appear at={TYPING1} until={REPLY} side="left" top={315}>
        <TypingDots at={TYPING1} />
      </Appear>
      <Appear at={REPLY} side="left" top={315}>
        <div style={bubble("assistant")}>
          Tem sim! Hoje às:
          <div style={{ display: "flex", gap: 14, marginTop: 16 }}>
            <Chip label="14h" picked={false} />
            <Chip label="15h30" picked={frame >= CHOICE} />
            <Chip label="18h" picked={false} />
          </div>
        </div>
      </Appear>

      <Appear at={CHOICE} side="right" top={510}>
        <div style={bubble("client")}>Quero 15h30!</div>
      </Appear>

      <Appear at={TYPING2} until={CONFIRM} side="left" top={625}>
        <TypingDots at={TYPING2} />
      </Appear>
      <Appear at={CONFIRM} side="left" top={625} maxWidth={580}>
        <div style={{ ...bubble("assistant"), display: "flex", gap: 18, alignItems: "center" }}>
          <CheckIcon size={64} stroke={12} />
          <div>
            <div style={{ fontWeight: 900, fontSize: 42 }}>Confirmado!</div>
            <div style={{ fontWeight: 600, fontSize: 32 }}>Hoje, 15h30 com o Rafa</div>
          </div>
        </div>
      </Appear>

      <Stamp />
    </div>
  );
};

export const Proof: React.FC = () => {
  const camera = useCamera();
  const { width } = useVideoConfig();

  return (
    <Card bg={COLORS.black}>
      <AbsoluteFill
        style={{
          transformOrigin: `${width / 2}px 700px`,
          scale: camera.scale,
          rotate: `${camera.rotate}deg`,
          translate: `${camera.x}px 0px`,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: (width - PHONE.width) / 2,
            top: PHONE.top,
            width: PHONE.width,
            height: PHONE.height,
            borderRadius: 80,
            scale: PHONE.scale,
            transformOrigin: "50% 0%",
            backgroundColor: "#1C1C1C",
            border: `6px solid ${COLORS.white}`,
            boxShadow: `0 0 0 10px ${COLORS.indigo}`,
          }}
        >
          <ChatScreen />
          <div
            style={{
              position: "absolute",
              top: PHONE.bezel + 14,
              left: "50%",
              width: 150,
              height: 34,
              marginLeft: -75,
              borderRadius: 17,
              backgroundColor: "#000000",
            }}
          />
        </div>
      </AbsoluteFill>

      <div
        style={{
          position: "absolute",
          right: SAFE.side,
          bottom: SAFE.bottom + 4,
          fontFamily,
          fontWeight: 600,
          fontSize: 22,
          color: COLORS.white,
          opacity: 0.38,
          letterSpacing: "0.02em",
        }}
      >
        Exemplo ilustrativo
      </div>
    </Card>
  );
};
