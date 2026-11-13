import { describe, expect, it } from "vitest";
import { extractQr } from "../integrations/whatsapp/evolution-client.js";
import { withEvolutionInstance } from "../integrations/whatsapp/evolution-flight.js";
import {
  evolutionProbeCooldownMs,
  shouldOpenWhatsAppSocket,
  shouldSkipEvolutionProbe,
} from "../integrations/whatsapp/evolution-policy.js";

describe("evolution reconnect", () => {
  it("does not open a second socket while one is already up or starting", () => {
    expect(shouldOpenWhatsAppSocket("connected")).toBe(false);
    expect(shouldOpenWhatsAppSocket("connecting")).toBe(false);
    expect(shouldOpenWhatsAppSocket("disconnected")).toBe(true);
  });

  it("backs off after Evolution stops answering", () => {
    expect(shouldSkipEvolutionProbe(0, 0)).toBe(false);
    expect(evolutionProbeCooldownMs(1)).toBe(45_000);
    expect(evolutionProbeCooldownMs(2)).toBe(90_000);
    expect(evolutionProbeCooldownMs(8)).toBe(300_000);
    expect(shouldSkipEvolutionProbe(1, 44_000)).toBe(true);
    expect(shouldSkipEvolutionProbe(1, 45_000)).toBe(false);
  });

  it("reads the Evolution QR image and ignores the long code string", () => {
    const { qr, pairingCode } = extractQr({
      pairingCode: null,
      code: "x".repeat(237),
      base64: "abc",
      count: 6,
    });
    expect(qr).toBe("data:image/png;base64,abc");
    expect(pairingCode).toBeUndefined();
  });

  it("runs one socket operation at a time for the same instance", async () => {
    const order: string[] = [];
    const first = withEvolutionInstance("shop", async () => {
      order.push("first-start");
      await new Promise((r) => setTimeout(r, 30));
      order.push("first-end");
    });
    const second = withEvolutionInstance("shop", async () => {
      order.push("second");
    });
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });
});
