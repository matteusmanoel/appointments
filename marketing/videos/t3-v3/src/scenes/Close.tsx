import type React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  random,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Card, Quake, Slam, heavy, punchScale } from "../components/kit";
import { COLORS, TIMELINE, fontFamily, local } from "../theme";

const DRAW = local("close", "katanaDraw");
const SLASH = local("close", "slash");
const MENOS = local("close", "menos");
const MAIS_NAVALHIA = local("close", "maisNavalhia");
const BUTTON = local("close", "button");
const BEAT = TIMELINE.musicBeatFrames;

const SLASH_TRAVEL = 3;
const CUT = SLASH + SLASH_TRAVEL;

const LOGO = { width: 840, height: (840 * 259) / 1456, top: 360 } as const;
const LOGO_LEFT = (TIMELINE.width - LOGO.width) / 2;
const LOGO_CY = LOGO.top + LOGO.height / 2;
const ANGLE_DEG = -14;
const ANGLE = (ANGLE_DEG * Math.PI) / 180;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** y of the cut line at logo-local x (the line crosses the logo center). */
const cutY = (x: number) => LOGO.height / 2 + (x - LOGO.width / 2) * Math.tan(ANGLE);

const EDGE_L = -40;
const EDGE_R = LOGO.width + 40;
const TOP_HALF = `polygon(${EDGE_L}px -400px, ${EDGE_R}px -400px, ${EDGE_R}px ${cutY(EDGE_R)}px, ${EDGE_L}px ${cutY(EDGE_L)}px)`;
const BOTTOM_HALF = `polygon(${EDGE_L}px ${cutY(EDGE_L)}px, ${EDGE_R}px ${cutY(EDGE_R)}px, ${EDGE_R}px 600px, ${EDGE_L}px 600px)`;

const LogoImg: React.FC<{
  readonly clipPath?: string;
  readonly shift?: readonly [number, number];
}> = ({ clipPath, shift = [0, 0] }) => (
  <Img
    src={staticFile("navalhia-logo.png")}
    style={{
      position: "absolute",
      inset: 0,
      width: LOGO.width,
      height: LOGO.height,
      clipPath,
      translate: `${shift[0]}px ${shift[1]}px`,
    }}
  />
);

const Sparks: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame - CUT;
  if (t < 0 || t > 12) {
    return null;
  }
  return (
    <AbsoluteFill>
      {new Array(14).fill(true).map((_, i) => {
        const along = (random(`spark-x-${i}`) - 0.5) * 900;
        const side = i % 2 === 0 ? 1 : -1;
        const dist = (40 + random(`spark-d-${i}`) * 120) * (t / 12) ** 0.6;
        const nx = -Math.sin(ANGLE) * side + (random(`spark-a-${i}`) - 0.5) * 0.8;
        const ny = Math.cos(ANGLE) * side;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: TIMELINE.width / 2 + Math.cos(ANGLE) * along + nx * dist,
              top: LOGO_CY + Math.sin(ANGLE) * along + ny * dist,
              width: 4,
              height: interpolate(t, [0, 12], [28, 6]),
              borderRadius: 2,
              backgroundColor: i % 3 === 0 ? COLORS.indigo : COLORS.white,
              rotate: `${(Math.atan2(ny, nx) * 180) / Math.PI - 90}deg`,
              opacity: interpolate(t, [0, 12], [1, 0]),
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/** Blade glint while the katana is drawn, then the diagonal slash that reveals and splits the logo. */
const KatanaReveal: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();

  const glintWidth = interpolate(frame, [DRAW, SLASH], [0, width * 0.86], {
    ...clamp,
    easing: (t) => t * t,
  });
  const glintOpacity = interpolate(frame, [DRAW, SLASH - 2, SLASH], [0.4, 1, 0.8], clamp);

  const travel = interpolate(frame, [SLASH, CUT], [0.3, 1], clamp);
  const beamThickness = interpolate(frame, [CUT, CUT + 10], [10, 1], clamp);
  const beamOpacity = interpolate(frame, [CUT, CUT + 12], [1, 0], clamp);

  const beamTipX = width / 2 + (2600 * travel - 1300) * Math.cos(ANGLE);
  const revealX = beamTipX - LOGO_LEFT;
  const settle = spring({
    frame: frame - CUT,
    fps,
    config: { damping: 12, stiffness: 260, mass: 0.6 },
  });
  const gap = frame < CUT ? 0 : 26 * (1 - settle);
  const apart = frame < CUT ? 0 : 8 * (1 - settle);
  const dx = Math.cos(ANGLE) * gap;
  const dy = Math.sin(ANGLE) * gap;

  const glow = interpolate(frame, [CUT, CUT + 4, CUT + 24], [0, 0.55, 0], clamp);

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: LOGO_LEFT - 120,
          top: LOGO_CY - 220,
          width: LOGO.width + 240,
          height: 440,
          background: `radial-gradient(closest-side, ${COLORS.indigo}, transparent)`,
          opacity: glow,
        }}
      />

      {frame >= SLASH ? (
        <div
          style={{
            position: "absolute",
            left: LOGO_LEFT,
            top: LOGO.top,
            width: LOGO.width,
            height: LOGO.height,
          }}
        >
          {frame < CUT ? (
            <LogoImg clipPath={`inset(-20px ${LOGO.width - revealX}px -20px -20px)`} />
          ) : (
            <>
              <LogoImg clipPath={TOP_HALF} shift={[dx, dy - apart]} />
              <LogoImg clipPath={BOTTOM_HALF} shift={[-dx, -dy + apart]} />
            </>
          )}
        </div>
      ) : null}

      {frame < SLASH ? (
        <div
          style={{
            position: "absolute",
            left: width / 2 - glintWidth / 2,
            top: LOGO_CY - 2,
            width: glintWidth,
            height: 4,
            borderRadius: 2,
            backgroundColor: COLORS.white,
            boxShadow: `0 0 14px 3px ${COLORS.white}, 0 0 46px 12px ${COLORS.indigo}`,
            opacity: glintOpacity,
          }}
        />
      ) : null}

      {frame >= SLASH && beamOpacity > 0 ? (
        <div
          style={{
            position: "absolute",
            left: width / 2 - 1300,
            top: LOGO_CY,
            width: 2600,
            height: 0,
            rotate: `${ANGLE_DEG}deg`,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: -beamThickness / 2,
              width: 2600 * travel,
              height: beamThickness,
              borderRadius: beamThickness,
              background: `linear-gradient(90deg, transparent, ${COLORS.white} 70%)`,
              boxShadow: `0 0 18px 4px ${COLORS.white}, 0 0 60px 18px ${COLORS.indigo}`,
              opacity: beamOpacity,
            }}
          />
        </div>
      ) : null}

      <Sparks />
    </AbsoluteFill>
  );
};

const Chevrons: React.FC<{ readonly flip?: boolean }> = ({ flip = false }) => (
  <svg width={74} height={60} viewBox="0 0 74 60" style={{ scale: flip ? "-1 1" : "1 1" }}>
    <polyline
      points="6,6 30,30 6,54"
      fill="none"
      stroke={COLORS.white}
      strokeOpacity={0.5}
      strokeWidth={9}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <polyline
      points="40,6 64,30 40,54"
      fill="none"
      stroke={COLORS.white}
      strokeWidth={9}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** Shimmering indigo CTA with arrows pointing at it, both locked to the music beat. */
const CtaButton: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame - BUTTON;
  if (t < 0) {
    return null;
  }
  const beatPhase = (t % BEAT) / BEAT;
  const pulse = 1 + 0.035 * (1 - beatPhase) ** 3;
  const nudge = 12 * (0.5 - 0.5 * Math.cos(beatPhase * Math.PI * 2));
  const shimmerCycle = BEAT * 2;
  const shimmerX = interpolate(t % shimmerCycle, [0, shimmerCycle * 0.55], [-60, 160], clamp);
  const arrowsIn = interpolate(t, [3, 9], [0, 1], clamp);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        scale: punchScale(t, fps, 0.4),
      }}
    >
      <div style={{ translate: `${nudge - 30 * (1 - arrowsIn)}px 0px`, opacity: arrowsIn }}>
        <Chevrons />
      </div>
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          scale: pulse,
          backgroundColor: COLORS.indigo,
          color: COLORS.white,
          fontFamily,
          fontWeight: 800,
          fontSize: 48,
          letterSpacing: "-0.01em",
          whiteSpace: "nowrap",
          borderRadius: 999,
          padding: "32px 46px",
          boxShadow: `0 0 0 4px ${COLORS.white}, 0 0 ${30 + 30 * (1 - beatPhase)}px ${COLORS.indigo}`,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${shimmerX}%`,
            width: "38%",
            translate: "-50% 0px",
            background:
              "linear-gradient(105deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.5) 50%, rgba(255,255,255,0) 100%)",
          }}
        />
        <span style={{ position: "relative" }}>Quero minha NavalhIA</span>
      </div>
      <div style={{ translate: `${-nudge + 30 * (1 - arrowsIn)}px 0px`, opacity: arrowsIn }}>
        <Chevrons flip />
      </div>
    </div>
  );
};

const Row: React.FC<{ readonly top: number; readonly children: React.ReactNode }> = ({
  top,
  children,
}) => (
  <div
    style={{
      position: "absolute",
      top,
      left: 0,
      right: 0,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
    }}
  >
    {children}
  </div>
);

export const Close: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <Card bg={COLORS.black}>
      <Quake hits={[CUT]} amplitude={16} duration={10} seed="katana">
        <KatanaReveal />
      </Quake>

      <Row top={720}>
        <Slam at={MENOS} from={1.08} shakeAmp={10} drift={0.02} seed="menos">
          <div style={{ ...heavy(92), lineHeight: 1.1 }}>Menos conversa.</div>
        </Slam>
        <Slam
          at={MAIS_NAVALHIA}
          from={1.12}
          shakeAmp={12}
          drift={0.02}
          seed="mais-navalhia"
          style={{ marginTop: 22 }}
        >
          <div
            style={{
              ...heavy(92),
              lineHeight: 1.1,
              backgroundColor: COLORS.indigo,
              padding: "12px 30px 18px",
              borderRadius: 18,
              rotate: `${interpolate(frame, [MAIS_NAVALHIA, MAIS_NAVALHIA + 6], [-6, -2], clamp)}deg`,
            }}
          >
            Mais NavalhIA.
          </div>
        </Slam>
      </Row>

      <Row top={1190}>
        <CtaButton />
      </Row>
    </Card>
  );
};
