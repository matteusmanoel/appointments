import type React from "react";
import { Card, SafeArea, Slam, hardShadow, heavy } from "../components/kit";
import { COLORS, local } from "../theme";

const DELEGUE = local("delegate", "delegue");
const DOMINE = local("delegate", "domine");

export const Delegate: React.FC = () => (
  <Card bg={COLORS.indigo}>
    <SafeArea style={{ gap: 56 }}>
      <Slam at={DELEGUE} from={1.1} shakeAmp={16} rotate={-2} drift={0.03} seed="delegue">
        <div style={{ ...heavy(112), lineHeight: 1.08, textShadow: hardShadow(0, 10, COLORS.black) }}>
          Delegue o
          <br />
          atendimento.
        </div>
      </Slam>
      <Slam at={DOMINE} from={1.1} shakeAmp={18} rotate={2} drift={0.04} seed="domine">
        <div
          style={{
            ...heavy(112, COLORS.black),
            lineHeight: 1.08,
            backgroundColor: COLORS.white,
            padding: "26px 44px 30px",
            borderRadius: 22,
            boxShadow: hardShadow(0, 14, COLORS.black),
          }}
        >
          Domine sua
          <br />
          operação.
        </div>
      </Slam>
    </SafeArea>
  </Card>
);
