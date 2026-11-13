import { describe, it, expect } from "vitest";
import {
  clampInboundQuietSeconds,
  DEFAULT_INBOUND_QUIET_SECONDS,
  isUserTurnQuiet,
  shouldDropReplyBecauseTurnGrew,
} from "../integrations/whatsapp/inbound-turn.js";
import { lastUserTurnText } from "../ai/conversation-intents.js";
import { composeAskService, composeAmbiguousCorte, resolveServiceFromText } from "../ai/booking-draft.js";

describe("inbound turn quiet window", () => {
  it("does not flush while a follow-up bubble can still arrive (6s gap, 8s quiet)", () => {
    const quietMs = clampInboundQuietSeconds(DEFAULT_INBOUND_QUIET_SECONDS) * 1000;
    const first = Date.parse("2026-09-21T07:00:45-03:00");
    const secondGap = Date.parse("2026-09-21T07:00:51-03:00");
    expect(isUserTurnQuiet({ lastUserAtMs: first, nowMs: secondGap, quietMs })).toBe(false);
    expect(
      isUserTurnQuiet({ lastUserAtMs: secondGap, nowMs: secondGap + quietMs, quietMs }),
    ).toBe(true);
  });

  it("drops a half-turn reply when a newer bubble lands after lock", () => {
    const locked = Date.parse("2026-09-21T07:00:47-03:00");
    const laterBubble = Date.parse("2026-09-21T07:00:51-03:00");
    expect(
      shouldDropReplyBecauseTurnGrew({ latestUserAtMs: laterBubble, jobLockedAtMs: locked }),
    ).toBe(true);
    expect(
      shouldDropReplyBecauseTurnGrew({ latestUserAtMs: locked, jobLockedAtMs: locked }),
    ).toBe(false);
  });
});

describe("inbound turn text", () => {
  it("joins consecutive user bubbles as one turn, including a follow-up fragment", () => {
    const turn = lastUserTurnText([
      { role: "assistant", content: "Olá! Bem-vindo à Cavalier Barbearia!" },
      { role: "user", content: "O lucas pode me atender hoje as 18?" },
      { role: "user", content: "Ou apos" },
    ]);
    expect(turn).toMatch(/lucas pode me atender hoje as 18/i);
    expect(turn).toMatch(/Ou apos/i);
    expect(turn).not.toMatch(/Bem-vindo/);
  });
});

describe("ask service before availability", () => {
  it("asks a short service question, not a numbered catalog", () => {
    const out = composeAskService();
    expect(out).toBe("Qual serviço deseja?");
    expect(out).not.toMatch(/R\$/);
    expect(out).not.toMatch(/1\./);
  });

  it("confirms corte vs combo instead of assuming one", () => {
    const catalog = [
      { id: "d4ad6587-1437-4853-b6f0-8d059485b99d", name: "Corte masculino" },
      { id: "522142c0-7621-4f88-825b-ad5f0c82c6a5", name: "Corte e Barba", category: "combo" },
    ];
    const r = resolveServiceFromText("corte", catalog);
    expect(r.match).toBeUndefined();
    expect(r.ambiguous?.simple.name).toMatch(/Corte masculino/);
    expect(composeAmbiguousCorte({
      simpleName: r.ambiguous!.simple.name,
      comboName: r.ambiguous!.combo.name,
    })).toMatch(/só o \*Corte masculino\* ou o combo \*Corte e Barba\*/);
  });
});
