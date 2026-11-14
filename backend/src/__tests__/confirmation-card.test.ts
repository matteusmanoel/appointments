import { describe, expect, it } from "vitest";
import {
  assistantMessageIsBookingConfirmCard,
  assistantMessageIsCancelCard,
  composeCancelConfirmAsk,
  composeWhichAppointmentCancel,
  CONFIRM_CARD_TTL_MS,
  isActiveAppointmentStatus,
  isLiveConfirmCard,
  parseConfirmCard,
  REMINDER_CARD_TTL_MS,
} from "../ai/agent/confirmation-card.js";

describe("confirmation-card", () => {
  it("só trata como vivo o card dentro do TTL", () => {
    const now = new Date("2026-11-14T20:00:00-03:00");
    const live = {
      kind: "create" as const,
      issuedAt: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
    };
    const expired = {
      kind: "create" as const,
      issuedAt: new Date(now.getTime() - CONFIRM_CARD_TTL_MS - 1000).toISOString(),
    };
    expect(isLiveConfirmCard(live, now, ["create"])).toBe(true);
    expect(isLiveConfirmCard(expired, now, ["create"])).toBe(false);
    expect(isLiveConfirmCard(live, now, ["cancel"])).toBe(false);
    const reminder = {
      kind: "reminder" as const,
      issuedAt: new Date(now.getTime() - REMINDER_CARD_TTL_MS + 60_000).toISOString(),
    };
    expect(isLiveConfirmCard(reminder, now, ["reminder"])).toBe(true);
  });

  it("reconhece o card de cancelar e o de confirmar/remarcar", () => {
    const cancel = composeCancelConfirmAsk({
      serviceName: "Corte masculino",
      when: "amanhã às 18h",
      barberName: "Lucas",
    });
    expect(cancel).toMatch(/Posso cancelar seu horário de Corte masculino amanhã às 18h/);
    expect(cancel).toMatch(/remarcar/);
    expect(assistantMessageIsCancelCard(cancel)).toBe(true);
    expect(assistantMessageIsBookingConfirmCard(cancel)).toBe(false);
    expect(assistantMessageIsBookingConfirmCard("Fica assim, então:\n\nPosso confirmar?")).toBe(true);
    expect(assistantMessageIsBookingConfirmCard("Quer que eu mude para amanhã às 15h?")).toBe(true);
  });

  it("lista os horários quando há mais de um e valida status ativo", () => {
    const which = composeWhichAppointmentCancel(
      [
        { serviceName: "Corte", date: "2026-11-16", time: "10:00" },
        { serviceName: "Barba", date: "2026-11-17", time: "18:00" },
      ],
      "2026-11-14",
    );
    expect(which).toMatch(/mais de um horário/);
    expect(which).toMatch(/Qual você quer cancelar/);
    expect(isActiveAppointmentStatus("pending")).toBe(true);
    expect(isActiveAppointmentStatus("confirmed")).toBe(true);
    expect(isActiveAppointmentStatus("cancelled")).toBe(false);
    expect(parseConfirmCard({ kind: "cancel", issuedAt: "nope" })).toBeUndefined();
  });
});
