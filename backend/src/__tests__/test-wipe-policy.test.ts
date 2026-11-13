import { describe, expect, it } from "vitest";
import { isTestWipeAllowed } from "../ai/test-wipe-policy.js";

describe("isTestWipeAllowed", () => {
  it("nunca em produção, mesmo com o telefone na allowlist", () => {
    expect(isTestWipeAllowed("5511999990001", { NODE_ENV: "production", TEST_WIPE_PHONES: "5511999990001" })).toBe(false);
  });
  it("sem allowlist, «deletar» não apaga nada", () => {
    expect(isTestWipeAllowed("5511999990001", { NODE_ENV: "development" })).toBe(false);
    expect(isTestWipeAllowed("5511999990001", {})).toBe(false);
  });
  it("fora de produção só para telefones da allowlist", () => {
    const env = { NODE_ENV: "development", TEST_WIPE_PHONES: "+55 11 99999-0001, 5511988887777" };
    expect(isTestWipeAllowed("5511999990001", env)).toBe(true);
    expect(isTestWipeAllowed("5511988887777", env)).toBe(true);
    expect(isTestWipeAllowed("5511977776666", env)).toBe(false);
    expect(isTestWipeAllowed("", env)).toBe(false);
  });
});
