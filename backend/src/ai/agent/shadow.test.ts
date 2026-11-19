import { describe, expect, it } from "vitest";
import type OpenAI from "openai";
import { shadowEnabled, startTurnShadow, verdictsAgree } from "./shadow.js";

describe("shadowEnabled", () => {
  it("fica desligada por padrão", () => {
    expect(shadowEnabled("shop-1", "")).toBe(false);
  });

  it("liga por barbearia ou para todas", () => {
    expect(shadowEnabled("shop-1", "shop-2, shop-1")).toBe(true);
    expect(shadowEnabled("shop-3", "shop-1")).toBe(false);
    expect(shadowEnabled("shop-3", "*")).toBe(true);
  });
});

describe("verdictsAgree", () => {
  it("compara a intenção principal", () => {
    expect(verdictsAgree({ primary: "cancel", intents: ["cancel"] }, { primary: "cancel", intents: ["cancel"] })).toBe(true);
    expect(verdictsAgree({ primary: "unknown", intents: [] }, { primary: "schedule", intents: ["schedule"] })).toBe(false);
  });

  it("não compara sem os dois lados", () => {
    expect(verdictsAgree(null, { primary: "cancel", intents: [] })).toBeNull();
  });
});

describe("startTurnShadow", () => {
  it("não chama o modelo quando desligada", async () => {
    const shadow = startTurnShadow({ barbershopId: "desligada", conversationId: "c", openai: {} as OpenAI });
    await expect(shadow.finish(null)).resolves.toBeUndefined();
  });
});
