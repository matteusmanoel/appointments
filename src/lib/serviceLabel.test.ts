import { describe, it, expect } from "vitest";
import { serviceLabel } from "./api";

describe("serviceLabel", () => {
  it("returns fallback when serviceNames is empty", () => {
    expect(serviceLabel([], "Corte")).toBe("Corte");
    expect(serviceLabel(undefined, "Barba")).toBe("Barba");
  });

  it("returns single name when one service", () => {
    expect(serviceLabel(["Corte"], undefined)).toBe("Corte");
  });

  it("returns first name + count for multiple services", () => {
    expect(serviceLabel(["Corte", "Barba"], undefined)).toBe("Corte + 1");
    expect(serviceLabel(["Corte", "Barba", "Sobrancelha"], undefined)).toBe("Corte + 2");
  });

  it("returns fallback when no names and no fallback", () => {
    expect(serviceLabel([], undefined)).toBe("");
    expect(serviceLabel(undefined, undefined)).toBe("");
  });
});
