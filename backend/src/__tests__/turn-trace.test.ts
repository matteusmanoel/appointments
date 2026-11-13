import { describe, it, expect } from "vitest";
import { maskPhone, previewError, previewText } from "../ai/turn-trace.js";

describe("turn trace sanitizers", () => {
  it("keeps only the last four digits of a phone", () => {
    expect(maskPhone("5511999887766")).toBe("***7766");
    expect(maskPhone("+55 (11) 99988-7766")).toBe("***7766");
    expect(maskPhone("")).toBe("****");
    expect(maskPhone(null)).toBe("****");
  });

  it("collapses whitespace and caps the inbound preview", () => {
    expect(previewText("quero\ncorte   amanhã")).toBe("quero corte amanhã");
    const long = "a".repeat(200);
    expect(previewText(long).endsWith("…")).toBe(true);
    expect(previewText(long).length).toBe(121);
  });

  it("caps error text so a provider payload cannot flood the log", () => {
    expect(previewError("x".repeat(400)).length).toBeLessThanOrEqual(180);
  });
});
