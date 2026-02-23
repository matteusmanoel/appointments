import { describe, it, expect } from "vitest";
import { normalizeFromPhone, parseUazapiInbound } from "../routes/webhooks.js";

describe("normalizeFromPhone", () => {
  it("strips @s.whatsapp.net suffix", () => {
    expect(normalizeFromPhone("5511999999999@s.whatsapp.net")).toBe("5511999999999");
  });
  it("strips @c.us suffix", () => {
    expect(normalizeFromPhone("5511999999999@c.us")).toBe("5511999999999");
  });
  it("removes non-digits", () => {
    expect(normalizeFromPhone("+55 11 99999-9999")).toBe("5511999999999");
  });
  it("returns only digits when mixed", () => {
    expect(normalizeFromPhone("55 11 9 9999 9999")).toBe("5511999999999");
  });
});

describe("parseUazapiInbound", () => {
  it("skips when fromMe is true", () => {
    const body = {
      event: "message",
      instance: "inst1",
      data: {
        message: {
          id: "msg1",
          from: "5511999999999@c.us",
          type: "chat",
          body: "Hi",
          fromMe: true,
        },
      },
    };
    const r = parseUazapiInbound(body);
    expect(r.skip).toBe(true);
  });

  it("skips when type is not chat", () => {
    const body = {
      event: "message",
      instance: "inst1",
      data: {
        message: {
          id: "msg1",
          from: "5511999999999@c.us",
          type: "image",
          body: "x",
        },
      },
    };
    const r = parseUazapiInbound(body);
    expect(r.skip).toBe(true);
  });

  it("parses valid text message", () => {
    const body = {
      event: "message",
      instance: "inst1",
      instanceId: 33,
      data: {
        message: {
          id: "msg1",
          from: "5511999999999@c.us",
          type: "chat",
          body: "Quero agendar",
        },
      },
    };
    const r = parseUazapiInbound(body);
    expect(r.skip).toBe(false);
    expect(r.instanceKey).toBe("inst1");
    expect(r.fromPhone).toBe("5511999999999");
    expect(r.text).toBe("Quero agendar");
    expect(r.providerEventId).toBe("msg1");
  });

  it("skips when no body", () => {
    const body = {
      event: "message",
      instance: "inst1",
      data: { message: { id: "m1", from: "5511@c.us", type: "chat" } },
    };
    const r = parseUazapiInbound(body);
    expect(r.skip).toBe(true);
  });

  it("uses instanceId when instance is missing", () => {
    const body = {
      instanceId: 42,
      data: {
        message: {
          id: "m1",
          from: "5511888888888@s.whatsapp.net",
          type: "chat",
          body: "Oi",
        },
      },
    };
    const r = parseUazapiInbound(body);
    expect(r.instanceKey).toBe("42");
    expect(r.fromPhone).toBe("5511888888888");
    expect(r.text).toBe("Oi");
  });
});
