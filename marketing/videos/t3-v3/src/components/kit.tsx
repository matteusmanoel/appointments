import type React from "react";
import {
  AbsoluteFill,
  random,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, SAFE, fontFamily } from "../theme";

export const Card: React.FC<{
  readonly bg: string;
  readonly children?: React.ReactNode;
}> = ({ bg, children }) => (
  <AbsoluteFill style={{ backgroundColor: bg, fontFamily }}>
    {children}
  </AbsoluteFill>
);

/** Centers its content inside the platform safe area (top 269, bottom 384, sides 90). */
export const SafeArea: React.FC<{
  readonly children?: React.ReactNode;
  readonly style?: React.CSSProperties;
}> = ({ children, style }) => (
  <AbsoluteFill
    style={{
      paddingTop: SAFE.top,
      paddingBottom: SAFE.bottom,
      paddingLeft: SAFE.side,
      paddingRight: SAFE.side,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      ...style,
    }}
  >
    {children}
  </AbsoluteFill>
);

export const heavy = (
  fontSize: number,
  color: string = COLORS.white,
): React.CSSProperties => ({
  fontFamily,
  fontWeight: 900,
  fontSize,
  color,
  lineHeight: 1,
  letterSpacing: "-0.03em",
  whiteSpace: "nowrap",
  textAlign: "center",
});

/** Heavy contour drawn behind the fill so the glyph keeps its weight. */
export const outline = (
  width: number,
  color: string,
): React.CSSProperties => ({
  WebkitTextStroke: `${width}px ${color}`,
  paintOrder: "stroke fill",
});

export const hardShadow = (dx: number, dy: number, color: string): string =>
  `${dx}px ${dy}px 0 ${color}`;

export const punchScale = (
  frame: number,
  fps: number,
  from: number,
): number => {
  const progress = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 560, mass: 0.5 },
  });
  return from + (1 - from) * progress;
};

export const shake = (
  frame: number,
  amplitude: number,
  duration: number,
  seed: string,
): { x: number; y: number; r: number } => {
  if (frame < 0 || frame >= duration || amplitude === 0) {
    return { x: 0, y: 0, r: 0 };
  }
  const k = amplitude * (1 - frame / duration) ** 1.5;
  return {
    x: (random(`${seed}-x-${frame}`) * 2 - 1) * k,
    y: (random(`${seed}-y-${frame}`) * 2 - 1) * k,
    r: (random(`${seed}-r-${frame}`) * 2 - 1) * k * 0.06,
  };
};

/**
 * Kinetic word block: hidden before `at` (layout is kept stable), then a
 * scale punch with decaying shake and a slow push until the end of its
 * sequence.
 */
export const Slam: React.FC<{
  readonly at?: number;
  readonly from?: number;
  readonly shakeAmp?: number;
  readonly shakeFrames?: number;
  readonly rotate?: number;
  readonly drift?: number;
  readonly seed?: string;
  readonly style?: React.CSSProperties;
  readonly children: React.ReactNode;
}> = ({
  at = 0,
  from = 1.25,
  shakeAmp = 0,
  shakeFrames = 8,
  rotate = 0,
  drift = 0.035,
  seed = "slam",
  style,
  children,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = frame - at;
  const visible = t >= 0;
  const push = 1 + drift * Math.max(0, t) / Math.max(1, durationInFrames - at);
  const s = shake(t, shakeAmp, shakeFrames, seed);

  return (
    <div
      style={{
        visibility: visible ? "visible" : "hidden",
        scale: visible ? punchScale(t, fps, from) * push : 1,
        translate: `${s.x}px ${s.y}px`,
        rotate: `${rotate + s.r}deg`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** Whole-frame tremor, used for impact moments. */
export const Quake: React.FC<{
  readonly hits: readonly number[];
  readonly amplitude: number;
  readonly duration?: number;
  readonly seed: string;
  readonly children: React.ReactNode;
}> = ({ hits, amplitude, duration = 10, seed, children }) => {
  const frame = useCurrentFrame();
  const offset = hits.reduce(
    (acc, hit, i) => {
      const s = shake(frame - hit, amplitude, duration, `${seed}-${i}`);
      return { x: acc.x + s.x, y: acc.y + s.y, r: acc.r + s.r };
    },
    { x: 0, y: 0, r: 0 },
  );
  return (
    <AbsoluteFill
      style={{
        translate: `${offset.x}px ${offset.y}px`,
        rotate: `${offset.r}deg`,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

/** Echoes are absolutely positioned, so the solid word must stack above them. */
export const ABOVE_ECHOES: React.CSSProperties = { position: "relative", zIndex: 1 };

/**
 * Outline-only copies of a word that burst out of it ("both") or slide away
 * below it ("down"). Render inside a `position: relative` box, before the
 * solid word. Spacing/count must keep the outermost copy inside the safe area.
 */
export const Echoes: React.FC<{
  readonly children: React.ReactNode;
  readonly textStyle: React.CSSProperties;
  readonly color: string;
  /** Background color: fills the glyph to hide the font's overlapping contours. */
  readonly fill: string;
  readonly strokeWidth: number;
  readonly spacing: number;
  readonly count: number;
  readonly mode: "both" | "down";
  readonly at?: number;
  readonly fall?: number;
}> = ({ children, textStyle, color, fill, strokeWidth, spacing, count, mode, at = 0, fall = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame - at;
  if (t < 0) {
    return null;
  }
  const open = spring({
    frame: t,
    fps,
    config: { damping: 18, stiffness: 320, mass: 0.5 },
  });
  const steps = new Array(count).fill(true).map((_, i) => i + 1);
  const offsets = mode === "both" ? steps.flatMap((k) => [k, -k]) : steps;

  return (
    <>
      {offsets.map((k) => (
        <div
          key={k}
          style={{
            ...textStyle,
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            color: fill,
            textShadow: "none",
            WebkitTextStroke: `${strokeWidth * 2}px ${color}`,
            paintOrder: "stroke fill",
            translate: `0px ${k * spacing * open + Math.sign(k) * Math.abs(k) * fall * t}px`,
            opacity: 1 - Math.abs(k) / (count + 1),
          }}
        >
          {children}
        </div>
      ))}
    </>
  );
};

/** Comic-style explosion rays + shockwave ring behind a word. */
export const Burst: React.FC<{
  readonly color: string;
  readonly at?: number;
  readonly rays?: number;
  readonly cy?: number;
}> = ({ color, at = 0, rays = 0, cy }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = frame - at;
  if (t < 0) {
    return null;
  }
  const centerY = cy ?? SAFE.top + (height - SAFE.top - SAFE.bottom) / 2;
  const grow = Math.min(1, t / 5);
  const inner = 120 + 260 * grow;
  const ring = 200 + t * 130;
  const ringOpacity = Math.max(0, 1 - t / 9);

  return (
    <AbsoluteFill>
      <svg width={width} height={height}>
        {new Array(rays).fill(true).map((_, i) => {
          const angle = (i / rays) * Math.PI * 2 + 0.13;
          const outer = inner + (i % 2 === 0 ? 1400 : 900) * grow;
          const spread = i % 2 === 0 ? 0.07 : 0.045;
          const p = (r: number, a: number) =>
            `${width / 2 + Math.cos(a) * r},${centerY + Math.sin(a) * r}`;
          return (
            <polygon
              key={i}
              points={`${p(inner, angle)} ${p(outer, angle - spread)} ${p(outer, angle + spread)}`}
              fill={color}
              opacity={0.9}
            />
          );
        })}
        <circle
          cx={width / 2}
          cy={centerY}
          r={ring}
          fill="none"
          stroke={color}
          strokeWidth={26}
          opacity={ringOpacity}
        />
      </svg>
    </AbsoluteFill>
  );
};
