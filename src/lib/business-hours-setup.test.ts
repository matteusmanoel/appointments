import { describe, it, expect, beforeEach } from "vitest";
import {
  DB_DEFAULT_HOURS,
  confirmHours,
  hoursStepDone,
  isDefaultBusinessHours,
  isHoursConfirmed,
  summarizeBusinessHours,
} from "./business-hours-setup";
import { getDefaultBusinessHours } from "./api";

describe("checklist: horário de funcionamento", () => {
  beforeEach(() => localStorage.clear());

  it("o padrão do frontend e o padrão do banco são o mesmo (senão a regra falha silenciosamente)", () => {
    expect(isDefaultBusinessHours(getDefaultBusinessHours())).toBe(true);
    expect(isDefaultBusinessHours(DB_DEFAULT_HOURS)).toBe(true);
  });

  it("horário padrão NÃO conta como feito até o dono confirmar; horário alterado conta", () => {
    expect(hoursStepDone(DB_DEFAULT_HOURS, "shop-1")).toBe(false);
    const changed = { ...DB_DEFAULT_HOURS, monday: null };
    expect(hoursStepDone(changed, "shop-1")).toBe(true);
    const sunday = { ...DB_DEFAULT_HOURS, sunday: { start: "09:00", end: "13:00" } };
    expect(hoursStepDone(sunday, "shop-1")).toBe(true); // domingo agora entra na checagem
  });

  it("confirmar o padrão libera o passo, por barbearia", () => {
    confirmHours("shop-1");
    expect(isHoursConfirmed("shop-1")).toBe(true);
    expect(hoursStepDone(DB_DEFAULT_HOURS, "shop-1")).toBe(true);
    expect(hoursStepDone(DB_DEFAULT_HOURS, "shop-2")).toBe(false);
  });

  it("sem horário nenhum nunca está feito", () => {
    expect(hoursStepDone(null, "s")).toBe(false);
    expect(hoursStepDone(undefined, "s")).toBe(false);
  });

  it("resumo agrupa dias consecutivos iguais", () => {
    expect(summarizeBusinessHours(DB_DEFAULT_HOURS)).toBe("Seg–Sex 09:00–19:00 · Sáb 09:00–18:00 · Dom fechado");
    expect(summarizeBusinessHours({ ...DB_DEFAULT_HOURS, monday: null })).toBe(
      "Seg fechado · Ter–Sex 09:00–19:00 · Sáb 09:00–18:00 · Dom fechado"
    );
  });
});
