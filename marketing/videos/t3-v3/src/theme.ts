import { loadFont } from "@remotion/google-fonts/Montserrat";
import timeline from "./timeline.json";

export const { fontFamily } = loadFont("normal", {
  weights: ["600", "700", "800", "900"],
  subsets: ["latin"],
});

export const COLORS = {
  indigo: "#4D4FEF",
  white: "#FFFFFF",
  black: "#0B0B0B",
} as const;

export const SAFE = {
  top: 269,
  bottom: 384,
  side: 90,
} as const;

export const SAFE_WIDTH = timeline.width - SAFE.side * 2;

export const TIMELINE = timeline;
export const BEATS = timeline.beats;
export const SCENES = timeline.scenes;

export type SceneName = keyof typeof timeline.scenes;

export const sceneLength = (scene: SceneName): number =>
  SCENES[scene][1] - SCENES[scene][0];

/** Beat position relative to the start of the scene that contains it. */
export const local = (scene: SceneName, beat: keyof typeof BEATS): number =>
  BEATS[beat] - SCENES[scene][0];
