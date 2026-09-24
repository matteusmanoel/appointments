import type { Scenario } from "../../types.js";
import { seedHarnessAppointment, seedSlotBlockers } from "./seed-appointment.js";

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
    setup: (ctx) => seedHarnessAppointment({ ...ctx, offsetDays: 1, time: "10:00" }),
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
    setup: (ctx) => seedHarnessAppointment({ ...ctx, offsetDays: 3, time: "16:00" }),
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
    setup: (ctx) =>
      seedHarnessAppointment({
        ...ctx,
        offsetDays: 1,
        time: "11:00",
        serviceNameIncludes: "corte e barba",
      }),
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
    setup: async (ctx) => {
      await seedHarnessAppointment({ ...ctx, offsetDays: 1, time: "16:00" });
      await seedSlotBlockers({ barbershopId: ctx.barbershopId, offsetDays: 1, time: "09:00" });
    },
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
  {
    id: "resched-05-rebook-pos-cancel",
    name: "Rebook após cancelamento: agente seeda serviço da memória",
    description:
      "Cliente cancela um agendamento e em seguida pede para remarcar. " +
      "O agente NÃO deve perguntar qual serviço — deve sedar o serviço da memória e pedir dia/horário.",
    tags: ["reschedule", "cancellation", "memory", "multi-turn"],
    vertical: "barbershop",
    setup: (ctx) => seedHarnessAppointment({ ...ctx, offsetDays: 1, time: "14:00" }),
    turns: [
      { role: "user", content: "Quero cancelar meu horário" },
      { role: "user", content: "Pode cancelar" },
      { role: "user", content: "Quero remarcar" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask", "pre_booking_claim"],
      mustCallTools: ["list_client_upcoming_appointments", "cancel_appointment"],
      asserts: [
        {
          name: "Após remarcar, agente NÃO pergunta qual serviço",
          severity: "critical",
          check: (_i, reply) =>
            _i !== 2 ||
            !/qual\s+servi[cç]o|que\s+servi[cç]o|qual\s+corte/i.test(reply),
        },
        {
          name: "Após remarcar, agente pede dia ou horário",
          severity: "critical",
          check: (_i, reply) =>
            _i !== 2 ||
            /qual\s+dia|que\s+dia|hor[aá]rio|quando/i.test(reply),
        },
      ],
    },
  },
  {
    id: "resched-06-affirmation-service",
    name: "Afirmação resolve proposta de serviço anterior",
    description:
      "Agente sugere o serviço e cliente responde apenas 'isso mesmo'. " +
      "Agente NÃO deve repetir a pergunta de qual serviço — deve avançar para perguntar dia/horário.",
    tags: ["reschedule", "booking", "memory", "multi-turn"],
    vertical: "barbershop",
    setup: undefined,
    turns: [
      { role: "user", content: "Quero agendar" },
      { role: "user", content: "Isso mesmo" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask", "pre_booking_claim"],
      asserts: [
        {
          name: "Após afirmação, agente NÃO pergunta qual serviço novamente",
          severity: "critical",
          check: (_i, reply) =>
            _i !== 1 ||
            !/^qual\s+servi[cç]o/im.test(reply),
        },
      ],
    },
  },
  // ── Adicionados na correção do diagnóstico "Understanding" (transcript 23/09) ──
  {
    id: "resched-07-barbeiro-pedido-nao-ignorado",
    name: "Barbeiro pedido no reagendamento não é ignorado pelo antigo",
    description:
      "Reprodução fiel do bug real: agendamento existente é com o Eduardo Gustavo; cliente " +
      "pede para reagendar citando explicitamente outro barbeiro (Lucas). O agente NÃO pode " +
      "checar/ofertar a disponibilidade do Eduardo (barbeiro antigo) — tem que ser a do Lucas.",
    tags: ["reschedule", "edge"],
    vertical: "barbershop",
    setup: (ctx) =>
      seedHarnessAppointment({
        ...ctx,
        offsetDays: 1,
        time: "10:00",
        serviceNameIncludes: "corte e barba",
      }),
    turns: [{ role: "user", content: "Quero reagendar para as 17h com o Lucas" }],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask", "pre_booking_claim"],
      mustCallTools: ["list_client_upcoming_appointments"],
      asserts: [
        {
          name: "Resposta fala do barbeiro pedido (Lucas), nunca do antigo (Eduardo)",
          severity: "critical",
          check: (_i, reply) => /lucas/i.test(reply) && !/eduardo/i.test(reply),
        },
      ],
    },
  },
  {
    id: "resched-08-mantem-barbeiro-quando-nao-especificado",
    name: "Reagendamento sem citar barbeiro mantém o original (guarda de regressão)",
    description:
      "Guarda de regressão para o fix do resched-07: quando o cliente NÃO cita outro " +
      "barbeiro, o reagendamento deve preservar o barbeiro original do agendamento — o fix " +
      "de 'não ignorar o barbeiro pedido' não pode virar 'trocar de barbeiro à toa'.",
    tags: ["reschedule", "edge"],
    vertical: "barbershop",
    setup: (ctx) =>
      seedHarnessAppointment({
        ...ctx,
        offsetDays: 1,
        time: "10:00",
        serviceNameIncludes: "corte e barba",
      }),
    turns: [{ role: "user", content: "Quero reagendar para as 17h" }],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask", "pre_booking_claim"],
      mustCallTools: ["list_client_upcoming_appointments"],
      asserts: [
        {
          name: "Não troca de barbeiro sem o cliente pedir",
          severity: "critical",
          check: (_i, reply) => !/lucas/i.test(reply),
        },
        {
          name: "Segue com o reagendamento (novo horário ou barbeiro original)",
          severity: "medium",
          check: (_i, reply) => /17h|17:00|eduardo/i.test(reply),
        },
      ],
    },
  },
];
