import { describe, expect, it } from "vitest";
import {
  OPT_OUT_MARKETING_LINE,
  OPT_OUT_PROMO_LINE,
  buildBirthdayMessage,
  buildFollowUp30d,
  buildFollowUpFirstVisit,
  buildReminder24h,
  buildReminder2hConfirmed,
  buildReminder2hPending,
  resolveReminderSendBody,
  hasOptOutInstruction,
  withOptOutLine,
} from "../outbound/templates.js";
import { reactivationMessage } from "../outbound/reactivation.js";
import { composeBookingCreated } from "../ai/agent.js";

const link = "https://app.example/b/cavalier";
const rem = { clientName: "Mateus", date: "2026-09-22", time: "18:00", todayIso: "2026-09-21" };
const parar = /\bresponda PARAR\b/;

describe("instrução PARAR nas mensagens automáticas (lp-correcoes §16.6)", () => {
  it("withOptOutLine é idempotente e ignora texto vazio", () => {
    const once = withOptOutLine("Oi");
    expect(once).toBe(`Oi\n\n${OPT_OUT_MARKETING_LINE}`);
    expect(withOptOutLine(once)).toBe(once);
    expect(withOptOutLine("responda parar para sair")).toBe("responda parar para sair");
    expect(withOptOutLine("Para sair, envie SAIR")).toBe("Para sair, envie SAIR");
    expect(withOptOutLine("   ")).toBe("");
  });

  it("lembretes 24h e 2h (pendente/confirmado) terminam com a linha de opt-out", () => {
    for (const body of [buildReminder24h(rem), buildReminder24h({ ...rem, alreadyConfirmed: true }), buildReminder2hPending(rem), buildReminder2hConfirmed(rem)]) {
      expect(body.endsWith(OPT_OUT_PROMO_LINE)).toBe(true);
      expect(body.match(/PARAR/g)).toHaveLength(1);
    }
  });

  it("o texto reconstruído no envio do lembrete também leva a linha", () => {
    const appt = { status: "scheduled", clientName: "Mateus", date: "2026-09-22", time: "18:00" };
    for (const type of ["reminder_24h", "reminder_2h"]) {
      expect(resolveReminderSendBody({ type, storedBody: "", todayIso: "2026-09-21", appointment: appt })).toMatch(parar);
    }
  });

  it("reativação, primeira visita e aniversário trazem a linha", () => {
    for (const body of [buildFollowUp30d({ bookingLink: link }), buildFollowUpFirstVisit({ bookingLink: link }), buildBirthdayMessage({ bookingLink: link })]) {
      expect(body.endsWith(OPT_OUT_MARKETING_LINE)).toBe(true);
    }
  });

  it("reativação: QUALQUER motivo e texto próprio do dono recebem a linha no envio (uma vez)", () => {
    for (const reason of ["birthday", "waitlist_missed", "no_visit", "talked_without_booking"]) {
      const m = reactivationMessage({ reason, clientName: "Ana", bookingLink: link, bodyOverride: "Passa aqui essa semana!" });
      expect(m.match(/PARAR/g)).toHaveLength(1);
      expect(m.endsWith(OPT_OUT_MARKETING_LINE)).toBe(true);
    }
    const custom = reactivationMessage({ reason: "birthday", clientName: "Ana", bookingLink: link, bodyOverride: "Feliz aniversário!" });
    expect(custom).toBe(`Feliz aniversário!\n\n${OPT_OUT_MARKETING_LINE}`);
    // texto do dono que já cita PARAR não duplica
    expect(reactivationMessage({ reason: "birthday", clientName: null, bookingLink: link, bodyOverride: "Responda PARAR para sair" })).toBe("Responda PARAR para sair");
  });

  it("confirmação de agendamento traz a instrução (com e sem lembrete 2h)", () => {
    const base = { firstName: "Mateus", serviceName: "Corte", when: "amanhã às 18h" };
    const plain = composeBookingCreated(base);
    // sem lembrete de 2h NÃO promete lembretes (o review apontou a promessa falsa), só a instrução de opt-out
    expect(plain.endsWith(OPT_OUT_PROMO_LINE)).toBe(true);
    expect(plain).not.toMatch(/receberá lembretes/i);
    expect(plain.match(/PARAR/g)).toHaveLength(1);
    const withRemind = composeBookingCreated({ ...base, remindBefore: true });
    expect(withRemind).toContain("[[MSG]]Enviaremos um lembrete 2h antes");
    expect(withRemind.endsWith(OPT_OUT_PROMO_LINE)).toBe(true);
    expect(withRemind.match(/PARAR/g)).toHaveLength(1);
  });
});

describe("a linha de opt-out some só quando o texto já TEM a instrução (não a palavra «parar» solta)", () => {
  it("«parar» em outro sentido NÃO suprime a linha", () => {
    for (const t of ["Vamos parar para um café na semana?", "Passa aqui, sem parar!", "Vou parar aí amanhã"]) {
      const out = withOptOutLine(t);
      expect(out).toBe(`${t}\n\n${OPT_OUT_MARKETING_LINE}`);
      expect(hasOptOutInstruction(t)).toBe(false);
    }
    expect(reactivationMessage({ reason: "birthday", clientName: null, bookingLink: link, bodyOverride: "Vamos parar para um café?" })).toBe(
      `Vamos parar para um café?\n\n${OPT_OUT_MARKETING_LINE}`,
    );
  });
  it("a instrução de verdade é reconhecida", () => {
    for (const t of ["Responda PARAR para sair", "para não receber, responda *PARAR*.", "Envie SAIR", "digite \"parar\""]) expect(hasOptOutInstruction(t)).toBe(true);
  });
});
