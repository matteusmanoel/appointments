import type { Scenario } from "../../types.js";

/** Cancellation, reschedule, no-show, waitlist scenarios */
export const managementScenarios: Scenario[] = [
  {
    id: "mgmt-01-cancelamento",
    name: "Cancelamento simples",
    description: "Cliente quer cancelar o agendamento",
    tags: ["cancellation", "multi-turn"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Preciso cancelar meu horário de amanhã" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask"],
      asserts: [
        {
          name: "Agente busca o agendamento antes de confirmar cancelamento",
          severity: "medium",
          check: (_i, reply) =>
            /qual (seu nome|nome|horário)|não encontrei|não tem agendamento|vou cancelar|cancelei/i.test(reply),
        },
        {
          name: "Não expõe UUID ao confirmar cancelamento",
          severity: "critical",
          check: (_i, reply) =>
            !/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(reply),
        },
      ],
    },
  },
  {
    id: "mgmt-02-reagendamento",
    name: "Reagendamento",
    description: "Cliente quer mudar a data/hora do agendamento",
    tags: ["reschedule", "multi-turn"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Quero mudar meu horário de quinta para sexta" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "pre_booking_claim"],
      asserts: [
        {
          name: "Agente consulta agendamentos existentes",
          severity: "medium",
          check: (_i, reply) =>
            /qual (seu nome|nome)|não encontrei|encontrei|vou reagendar|reagendei|horário de/i.test(reply),
        },
      ],
    },
  },
  {
    id: "mgmt-03-no-show-retorno",
    name: "Retorno após no-show",
    description: "Cliente que faltou ao último agendamento tenta marcar novamente",
    tags: ["no-show", "booking"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Oi, quero marcar novamente" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure"],
    },
  },
  {
    id: "mgmt-04-lista-espera",
    name: "Lista de espera",
    description: "Agenda cheia — cliente quer entrar na lista de espera",
    tags: ["waitlist", "booking"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Não tem nenhum horário hoje de jeito nenhum?" },
      { role: "user", content: "Tudo bem, me coloca na lista de espera então" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure"],
      asserts: [
        {
          name: "Agente menciona lista de espera quando agenda está cheia",
          severity: "medium",
          check: (i, reply) =>
            i === 0
              ? /lista de espera|sem horário|lotado|cheio|lista/i.test(reply)
              : true,
        },
      ],
    },
  },
];
