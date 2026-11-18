import { describe, expect, it } from "vitest";
import { FRESH_BOOKING_GRACE_MINUTES, MANAGE_CUTOFF_MINUTES, manageChangeBlock } from "./manage-window.js";

const MIN = 60_000;

describe("manageChangeBlock", () => {
  const now = Date.parse("2026-11-16T15:00:00.000Z");

  it("deixa alterar um horário recém marcado mesmo dentro das 2 horas", () => {
    expect(
      manageChangeBlock({
        startMs: now + 30 * MIN,
        createdAtMs: now - 2 * MIN,
        nowMs: now,
      }),
    ).toBeNull();
  });

  it("volta a bloquear quando a tolerância do cadastro acaba", () => {
    expect(
      manageChangeBlock({
        startMs: now + 30 * MIN,
        createdAtMs: now - (FRESH_BOOKING_GRACE_MINUTES + 1) * MIN,
        nowMs: now,
      }),
    ).toBe("cutoff");
  });

  it("não abre a tolerância para horário que já passou", () => {
    expect(
      manageChangeBlock({
        startMs: now - MIN,
        createdAtMs: now - 2 * MIN,
        nowMs: now,
      }),
    ).toBe("past");
  });

  it("mantém a antecedência de 2 horas quando o cadastro não é recente", () => {
    expect(
      manageChangeBlock({
        startMs: now + (MANAGE_CUTOFF_MINUTES - 10) * MIN,
        createdAtMs: now - 3 * 60 * MIN,
        nowMs: now,
      }),
    ).toBe("cutoff");
    expect(
      manageChangeBlock({
        startMs: now + (MANAGE_CUTOFF_MINUTES + 10) * MIN,
        createdAtMs: now - 3 * 60 * MIN,
        nowMs: now,
      }),
    ).toBeNull();
  });
});
