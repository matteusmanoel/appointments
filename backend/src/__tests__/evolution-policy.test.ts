import { describe, it, expect } from "vitest";
import {
  shouldOpenWhatsAppSocket,
  shouldRestoreDroppedSession,
  webhookNeedsRepair,
} from "../integrations/whatsapp/evolution-policy.js";

describe("evolution session policy", () => {
  it("does not open a second socket while connected or pairing", () => {
    expect(shouldOpenWhatsAppSocket("connected")).toBe(false);
    expect(shouldOpenWhatsAppSocket("connecting")).toBe(false);
    expect(shouldOpenWhatsAppSocket("disconnected")).toBe(true);
  });

  it("restores only a previously connected session that dropped", () => {
    expect(shouldRestoreDroppedSession({ dbStatus: "connected", evolutionState: "disconnected" })).toBe(true);
    expect(shouldRestoreDroppedSession({ dbStatus: "connecting", evolutionState: "disconnected" })).toBe(false);
    expect(shouldRestoreDroppedSession({ dbStatus: "disconnected", evolutionState: "disconnected" })).toBe(false);
    expect(shouldRestoreDroppedSession({ dbStatus: "connected", evolutionState: "connected" })).toBe(false);
  });

  it("does not restore while Evolution is already connecting (avoids conflict/replaced)", () => {
    expect(shouldRestoreDroppedSession({ dbStatus: "connected", evolutionState: "connecting" })).toBe(false);
    expect(shouldOpenWhatsAppSocket("connecting")).toBe(false);
  });

  it("repairs webhook when disabled, URL drifted, or required events missing", () => {
    const expectedUrl = "http://api:3000/api/webhooks/evolution";
    expect(
      webhookNeedsRepair({ enabled: true, url: expectedUrl, expectedUrl, events: ["MESSAGES_UPSERT"] }),
    ).toBe(true);
    expect(webhookNeedsRepair({ enabled: false, url: expectedUrl, expectedUrl, events: ["MESSAGES_UPSERT"] })).toBe(
      true,
    );
    expect(
      webhookNeedsRepair({
        enabled: true,
        url: "http://localhost:3000/api/webhooks/evolution",
        expectedUrl,
        events: ["MESSAGES_UPSERT"],
      }),
    ).toBe(true);
    expect(webhookNeedsRepair({ enabled: true, url: expectedUrl, expectedUrl, events: ["CONNECTION_UPDATE"] })).toBe(
      true,
    );
    expect(
      webhookNeedsRepair({
        enabled: true,
        url: expectedUrl,
        expectedUrl,
        events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
      }),
    ).toBe(false);
  });
});
