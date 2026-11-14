import type React from "react";
import { Composition } from "remotion";
import { CONTACT_SHEET_SIZE, ContactSheet } from "./ContactSheet";
import { T3V3 } from "./T3V3";
import { TIMELINE } from "./theme";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="T3V3"
      component={T3V3}
      durationInFrames={TIMELINE.durationInFrames}
      fps={TIMELINE.fps}
      width={TIMELINE.width}
      height={TIMELINE.height}
      defaultProps={{ showSafeArea: false, muted: false }}
    />
    {/* Same duration as the ad: frozen scenes keep their inner sequences mounted. */}
    <Composition
      id="ContactSheet"
      component={ContactSheet}
      durationInFrames={TIMELINE.durationInFrames}
      fps={TIMELINE.fps}
      width={CONTACT_SHEET_SIZE.width}
      height={CONTACT_SHEET_SIZE.height}
    />
  </>
);
