import { describe, expect, it } from "vitest";
import { formatDateShortPt } from "../ai/agent.js";

describe("formatDateShortPt", () => {
  it("converte yyyy-MM-dd para dd/MM/yyyy", () => {
    expect(formatDateShortPt("2026-04-09")).toBe("09/04/2026");
    expect(formatDateShortPt("2026-12-01")).toBe("01/12/2026");
  });
});
