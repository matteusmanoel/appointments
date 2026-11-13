import { describe, expect, it } from "vitest";
import { classifySendError, providerHttpStatus } from "../integrations/whatsapp/send-error-policy.js";

describe("classifySendError", () => {
  it("treats an Evolution 400 Bad Request as rejected (no agent retry)", () => {
    const msg =
      'Evolution POST /message/sendText/nh-abc failed: 400 {"status":400,"error":"Bad Request","response":{"message":["x"]}}';
    expect(providerHttpStatus(msg)).toBe(400);
    expect(classifySendError(msg)).toBe("rejected");
  });

  it("detects a number without WhatsApp in compact JSON", () => {
    const msg =
      'Evolution POST /message/sendText/nh-abc failed: 400 {"response":{"message":[{"exists":false,"number":"5545"}]}}';
    expect(classifySendError(msg)).toBe("not_on_whatsapp");
  });

  it("detects Uazapi rejections with the same status format", () => {
    expect(classifySendError("Uazapi send/text failed: 422 invalid number")).toBe("rejected");
  });

  it("keeps rate limits, timeouts and 5xx retryable", () => {
    expect(classifySendError("Evolution POST /message/sendText/x failed: 429 Too Many Requests")).toBe("transient");
    expect(classifySendError("Evolution POST /message/sendText/x failed: 502 Bad Gateway")).toBe("transient");
    expect(classifySendError("Evolution não respondeu a tempo (25s). Verifique EVOLUTION_API_URL e rede.")).toBe(
      "transient",
    );
    expect(classifySendError("fetch failed")).toBe("transient");
  });
});
