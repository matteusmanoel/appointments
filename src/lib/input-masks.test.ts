import { describe, expect, it } from "vitest";
import { formatPhoneAsTyped, formatPhoneBR } from "./input-masks";

describe("formatPhoneAsTyped", () => {
  it("formats a Brazilian number", () => {
    expect(formatPhoneAsTyped("11987654321")).toBe("(11) 98765-4321");
    expect(formatPhoneAsTyped("1134567890")).toBe(formatPhoneBR("1134567890"));
  });

  it("keeps every digit past 11 and drops the mask", () => {
    expect(formatPhoneAsTyped("(11) 98765-43219")).toBe("119876543219");
    expect(formatPhoneAsTyped("004412345678901")).toBe("004412345678901");
  });

  it("does not leave a trailing hyphen that blocks backspace", () => {
    expect(formatPhoneAsTyped("4598823")).toBe("(45) 98823");
    const shown = formatPhoneAsTyped("4598823");
    expect(formatPhoneAsTyped(shown.slice(0, -1))).toBe("(45) 9882");
  });

  it("does not strip a foreign prefix or extra characters", () => {
    expect(formatPhoneAsTyped("+44 20 7946 0958")).toBe("+44 20 7946 0958");
    expect(formatPhoneAsTyped("+1")).toBe("+1");
  });
});
