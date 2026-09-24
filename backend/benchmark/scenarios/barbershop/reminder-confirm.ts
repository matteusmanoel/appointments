import type { Scenario } from "../../types.js";
import { seedHarnessAppointment } from "./seed-appointment.js";

function futureDate(offsetDays = 1): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split("T")[0]; // yyyy-MM-dd
}

/** Cliente responde ao lembrete no chat — RSVP, não novo agendamento. */
export const reminderConfirmScenarios: Scenario[] = [
  {
    id: "remind-01-confirma-no-chat",
    name: "Lembrete → cliente confirma no chat",
    description:
      "Após lembrete 24h/2h o cliente responde 'sim'/'confirmo'. Deve usar confirm_appointment no pending existente, nunca create_appointment.",
    tags: ["follow-up", "booking", "multi-turn"],
    vertical: "barbershop",
    setup: (ctx) =>
      seedHarnessAppointment({
        ...ctx,
        offsetDays: 1,
        time: "14:00",
        clientName: "Marcelo",
        markReminderSent: true,
      }),
    turns: [
      { role: "user", content: "confirmo" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask"],
      mustCallTools: ["confirm_appointment"],
      asserts: [
        {
          name: "Não trata RSVP como agendamento novo",
          severity: "critical",
          check: (_i, reply, state) => state !== "appointment_created" && !/novo horário|acabei de agendar/i.test(reply),
        },
      ],
    },
  },
  {
    id: "remind-02-vou-sim",
    name: "Lembrete → cliente responde 'Vou sim'",
    description:
      "Após lembrete o cliente responde 'Vou sim'. Deve usar confirm_appointment no pending existente, nunca create_appointment ou perguntar serviço.",
    tags: ["follow-up", "booking"],
    vertical: "barbershop",
    setup: (ctx) =>
      seedHarnessAppointment({
        ...ctx,
        offsetDays: 1,
        time: "16:00",
        clientName: "Carlos",
        markReminderSent: true,
      }),
    turns: [
      { role: "user", content: "Vou sim" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask"],
      mustCallTools: ["confirm_appointment"],
      asserts: [
        {
          name: "Não pergunta serviço após RSVP",
          severity: "critical",
          check: (_i, reply) => !/qual servi[cç]o/i.test(reply),
        },
        {
          name: "Não trata RSVP como agendamento novo",
          severity: "critical",
          check: (_i, reply, state) => state !== "appointment_created",
        },
      ],
    },
  },
  {
    id: "remind-03-estarei-ai",
    name: "Lembrete → cliente responde 'Estarei aí'",
    description:
      "Após lembrete o cliente responde 'Estarei aí'. Deve usar confirm_appointment no pending existente.",
    tags: ["follow-up", "booking"],
    vertical: "barbershop",
    setup: (ctx) =>
      seedHarnessAppointment({
        ...ctx,
        offsetDays: 1,
        time: "10:00",
        clientName: "Ana",
        markReminderSent: true,
      }),
    turns: [
      { role: "user", content: "Estarei aí" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask"],
      mustCallTools: ["confirm_appointment"],
      asserts: [
        {
          name: "Não pergunta serviço após RSVP",
          severity: "critical",
          check: (_i, reply) => !/qual servi[cç]o/i.test(reply),
        },
        {
          name: "Não cria agendamento novo",
          severity: "critical",
          check: (_i, reply, state) => state !== "appointment_created",
        },
      ],
    },
  },
  // ── Adicionado na correção do diagnóstico "Understanding" (transcript 23/09) ──
  {
    id: "remind-04-desired-nao-reabre-apos-fechar",
    name: "Data/hora do agendamento fechado não reabre em turno não relacionado",
    description:
      "Reprodução fiel do bug real: cliente agenda em 3 turnos (serviço/data/hora → aceite → " +
      "barbeiro), o agendamento fecha (create_appointment), depois vem uma pergunta informativa " +
      "sem relação com agenda, e por fim uma confirmação de presença espontânea ('Estarei aí'). " +
      "A data/hora já fechada NÃO pode 'ressurgir' nos turnos seguintes e fazer o agente pedir o " +
      "serviço de novo ou tratar a presença como um novo agendamento — o histórico usado para " +
      "inferir 'data desejada' deve parar no último fechamento (create_appointment).",
    tags: ["follow-up", "booking", "multi-turn", "edge"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: `Corte e barba ${futureDate(2)} às 14:00` },
      { role: "user", content: "Pode ser" },
      { role: "user", content: "Rodrigo" },
      { role: "user", content: "Vocês têm estacionamento por aí perto?" },
      { role: "user", content: "Estarei aí" },
    ],
    expected: {
      finalState: "appointment_created",
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask"],
      mustCallTools: ["create_appointment"],
      asserts: [
        {
          name: "Após confirmar presença num turno não relacionado, NÃO pergunta qual serviço de novo",
          severity: "critical",
          check: (i, reply) => i !== 4 || !/qual\s+servi[cç]o|que\s+servi[cç]o/i.test(reply),
        },
        {
          name: "Turno de presença não repete o resumo do agendamento como se fosse novo",
          severity: "medium",
          check: (i, reply) => i !== 4 || !/posso confirmar\?/i.test(reply),
        },
      ],
    },
  },
];
