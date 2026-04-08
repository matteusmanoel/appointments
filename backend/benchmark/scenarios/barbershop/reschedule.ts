import type { Scenario } from "../../types.js";

function futureDate(offsetDays = 1): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split("T")[0];
}

/** Reschedule scenarios — reagendamento de horários existentes */
export const rescheduleScenarios: Scenario[] = [
  {
    id: "resched-01-basico",
    name: "Reagendamento básico para outro horário",
    description:
      "Cliente quer reagendar para outro horário no mesmo dia ou dia seguinte. " +
      "Agente deve usar reschedule_appointment, não create_appointment.",
    tags: ["reschedule", "multi-turn"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Quero reagendar meu horário" },
      { role: "user", content: `Para ${futureDate(2)} às 14h está bom` },
      { role: "user", content: "Sim, pode confirmar" },
    ],
    expected: {
      finalState: "appointment_rescheduled",
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask", "pre_booking_claim"],
      mustCallTools: ["list_client_upcoming_appointments", "reschedule_appointment"],
      asserts: [
        {
          name: "Agente usa reschedule_appointment, não create_appointment para reagendar",
          severity: "critical",
          check: (_i, _reply, state) =>
            state !== "appointment_created",
        },
        {
          name: "Confirmação de reagendamento inclui data/hora nova",
          severity: "medium",
          check: (_i, reply, state) =>
            state !== "appointment_rescheduled" ||
            /\d{1,2}[h:]\d{0,2}|reagend|remarcad/i.test(reply),
        },
      ],
    },
  },
  {
    id: "resched-02-outro-dia",
    name: "Reagendamento para outro dia da semana",
    description: "Cliente pede para reagendar para uma data diferente.",
    tags: ["reschedule", "multi-turn"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Preciso reagendar para amanhã de manhã" },
      { role: "user", content: "Às 9h30 está ótimo" },
      { role: "user", content: "Pode confirmar" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask", "pre_booking_claim"],
      mustCallTools: ["list_client_upcoming_appointments"],
      asserts: [
        {
          name: "Agente confirma novo horário sem re-perguntar dados já fornecidos",
          severity: "medium",
          check: (i, reply) =>
            i !== 2 ||
            /9[h:]30|9h|reagend|remarcad|confirmad/i.test(reply),
        },
      ],
    },
  },
  {
    id: "resched-03-servico-mantido",
    name: "Serviço original mantido após reagendamento",
    description:
      "Ao reagendar, o agente NÃO deve trocar 'Corte e Barba' por 'Barba completa'. " +
      "reschedule_appointment só altera data/hora/barbeiro.",
    tags: ["reschedule", "multi-turn", "edge"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Olá, quero reagendar meu corte e barba" },
      { role: "user", content: `Para ${futureDate(3)} às 10h` },
      { role: "user", content: "Sim" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask"],
      mustCallTools: ["list_client_upcoming_appointments", "reschedule_appointment"],
      asserts: [
        {
          name: "Confirmação do reagendamento não menciona 'Barba completa' como único serviço",
          severity: "critical",
          check: (_i, reply, state) =>
            state !== "appointment_rescheduled" ||
            !/^\s*Barba\s+completa\s*$/im.test(reply),
        },
        {
          name: "Resposta afirmativa de reagendamento (sem pergunta de confirmação dupla)",
          severity: "medium",
          check: (i, reply) =>
            i !== 2 ||
            !/posso confirmar\?|gostaria de confirmar\?/i.test(reply),
        },
      ],
    },
  },
  {
    id: "resched-04-horario-indisponivel",
    name: "Reagendamento para horário ocupado — agente oferece alternativas",
    description:
      "Horário solicitado para reagendamento está indisponível. " +
      "Agente deve oferecer 2–3 alternativas de forma conversacional (sem bullets).",
    tags: ["reschedule", "edge"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Quero reagendar para amanhã às 09:00" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask", "pre_booking_claim"],
      asserts: [
        {
          name: "Não confirma reagendamento se horário está indisponível",
          severity: "critical",
          check: (_i, reply) =>
            !/reagendad|remarcad.*com\s+sucesso/i.test(reply),
        },
        {
          name: "Oferece alternativas quando horário está indisponível",
          severity: "medium",
          check: (_i, reply) =>
            /\d{1,2}h|\d{1,2}:\d{2}|alternativ|disponív|outro horário|preenchid/i.test(reply),
        },
        {
          name: "Não usa lista em bullet para alternativas",
          severity: "medium",
          check: (_i, reply) =>
            !/\n\s*[-•]\s*\*?\d{1,2}([:h]\d{2})?\*?\s*$/m.test(reply),
        },
      ],
    },
  },
];
