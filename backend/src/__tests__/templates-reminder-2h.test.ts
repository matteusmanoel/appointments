import { describe, it, expect } from "vitest";
import {
  buildReminder24h,
  buildReminder2hConfirmed,
  buildReminder2hPending,
  resolveReminderSendBody,
} from "../outbound/templates.js";

const base = {
  clientName: "Mateus Ferreira",
  date: "2026-09-22",
  time: "18:00",
  serviceNames: "Corte e Barba",
  barberName: "Eduardo Gustavo",
  totalPrice: 55,
  todayIso: "2026-09-21",
};

describe("reminder templates", () => {
  it("24h asks for presence with a short card and no links", () => {
    const body = buildReminder24h(base);
    expect(body).toBe(
      [
        "Fala, Mateus! Passando para confirmar seu agendamento:",
        "",
        "✂️ *Corte e Barba*",
        "💈 *Eduardo Gustavo*",
        "📅 Amanhã, terça, 22/09 às 18h",
        "💰 R$ 55,00",
        "",
        "Seu horário está reservado. *Você confirma sua presença ou prefere reagendar?*",
        "",
        "Para não receber mensagens promocionais, responda PARAR.",
      ].join("\n"),
    );
    expect(body).not.toMatch(/https?:\/\//);
  });

  it("24h does not ask again when presence is already confirmed", () => {
    const body = buildReminder24h({ ...base, alreadyConfirmed: true });
    expect(body).toMatch(/Seu horário está confirmado/);
    expect(body).not.toMatch(/confirma sua presença/i);
  });

  it("2h confirmed only reinforces the visit", () => {
    const body = buildReminder2hConfirmed({ ...base, todayIso: "2026-09-22" });
    expect(body).toBe(
      "Tudo certo, Mateus! *Seu horário está confirmado.* 💈\n\nNos vemos hoje, às 18h.\nEsperamos por você!\n\nPara não receber mensagens promocionais, responda PARAR.",
    );
    expect(body).not.toMatch(/confirmação/i);
    expect(body).not.toMatch(/https?:\/\//);
  });

  it("2h pending puts a clear decision in front of the client", () => {
    const body = buildReminder2hPending({ ...base, todayIso: "2026-09-22" });
    expect(body).toBe(
      "Mateus, ainda não recebemos sua confirmação.\n\n*Você vem hoje às 18h?* Confirme agora para mantermos seu horário reservado. Caso não haja confirmação, precisaremos liberá-lo.\n\nPara não receber mensagens promocionais, responda PARAR.",
    );
    expect(body).not.toMatch(/https?:\/\//);
    expect(body).not.toMatch(/evitar cancelamento/i);
  });

  it("rebuilds a 2h reminder from the live status instead of the body stored at enqueue", () => {
    const stored = buildReminder2hPending({ ...base, todayIso: "2026-09-28" });
    const body = resolveReminderSendBody({
      type: "reminder_2h",
      storedBody: stored,
      todayIso: "2026-09-28",
      appointment: {
        status: "confirmed",
        clientName: "Mateus",
        date: "2026-09-28",
        time: "15:00",
        serviceNames: "Corte e Barba",
        barberName: "Lucas Lima",
        totalPrice: 55,
      },
    });
    expect(body).toMatch(/confirmado/i);
    expect(body).not.toMatch(/ainda não recebemos sua confirmação/i);
  });

  it("sends nothing when the appointment was cancelled", () => {
    expect(
      resolveReminderSendBody({
        type: "reminder_2h",
        storedBody: "Mateus, ainda não recebemos sua confirmação.",
        todayIso: "2026-09-28",
        appointment: {
          status: "cancelled",
          date: "2026-09-28",
          time: "15:00",
        },
      }),
    ).toBeNull();
  });
});
