import { describe, it, expect } from "vitest";
import { detectViolations } from "../ai/agent.js";

describe("detectViolations", () => {
  it("returns empty when reply is clean", () => {
    expect(detectViolations("Tudo certo! Qual horário você prefere?")).toEqual([]);
  });

  it("detects phone_ask when asking for phone", () => {
    const r = detectViolations("Me passa seu telefone para confirmar.");
    expect(r).toContain("phone_ask");
  });

  it("detects uuid_leak when UUID appears", () => {
    const r = detectViolations("O barbeiro 550e8400-e29b-41d4-a716-446655440000 está disponível.");
    expect(r).toContain("uuid_leak");
  });

  it("detects excessive_emojis when more than 4", () => {
    const r = detectViolations("Oi! 😀 😃 😄 😁 😂 🤣");
    expect(r).toContain("excessive_emojis");
  });

  it("can return multiple violations", () => {
    const r = detectViolations(
      "Me manda seu telefone e o ID 550e8400-e29b-41d4-a716-446655440000"
    );
    expect(r).toContain("phone_ask");
    expect(r).toContain("uuid_leak");
    expect(r.length).toBeGreaterThanOrEqual(2);
  });
});
