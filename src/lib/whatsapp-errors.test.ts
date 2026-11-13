import { describe, it, expect } from "vitest";
import { friendlyConnectionError } from "./whatsapp-errors";

describe("friendlyConnectionError", () => {
  it("vazio → null; erros técnicos viram frases em português sem vazar o texto cru", () => {
    expect(friendlyConnectionError("")).toBeNull();
    expect(friendlyConnectionError(undefined)).toBeNull();
    const cases: Array<[string, RegExp]> = [
      ["QR code expired", /QR Code expirou/],
      ["Request timed out after 30000ms", /QR Code expirou/],
      ["Instance logged out (401 Unauthorized)", /desconectado/],
      ["connect ECONNREFUSED 10.0.0.5:8080", /Não conseguimos falar/],
      ["Evolution API 502 Bad Gateway", /Não conseguimos falar/],
      ["Number banned by WhatsApp", /restringiu/],
      ["algo totalmente inesperado: stack at foo.js:12", /Não foi possível manter/],
    ];
    for (const [raw, re] of cases) {
      const out = friendlyConnectionError(raw)!;
      expect(out).toMatch(re);
      expect(out).not.toContain(raw);
    }
  });
});
