import type { Scenario } from "../../types.js";

/** Cancellation scenarios — cancelamento de agendamentos */
export const cancellationScenarios: Scenario[] = [
  {
    id: "cancel-01-direto",
    name: "Cancelamento direto sem confirmação extra",
    description:
      "Cliente pede para cancelar de forma clara. " +
      "Agente deve cancelar imediatamente com mensagem afirmativa, sem perguntar 'Posso confirmar?' novamente.",
    tags: ["cancellation", "multi-turn"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Preciso cancelar meu agendamento" },
      { role: "user", content: "Sim, pode cancelar" },
    ],
    expected: {
      finalState: "appointment_cancelled",
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask"],
      mustCallTools: ["list_client_upcoming_appointments", "cancel_appointment"],
      asserts: [
        {
          name: "Confirmação de cancelamento é afirmativa (não pergunta)",
          severity: "critical",
          check: (_i, reply, state) =>
            state !== "appointment_cancelled" ||
            !/posso\s+cancelar\?|confirma\s+o\s+cancelamento\?|tem\s+certeza\?/i.test(reply),
        },
        {
          name: "Confirmação cita horário/serviço cancelado",
          severity: "medium",
          check: (_i, reply, state) =>
            state !== "appointment_cancelled" ||
            /cancelad|desmarcad|\d{1,2}[h:]\d{0,2}/i.test(reply),
        },
        {
          name: "Mensagem de cancelamento não re-confirma ('posso confirmar?')",
          severity: "medium",
          check: (i, reply) =>
            i !== 1 ||
            !/posso confirmar\?|confirma\?/i.test(reply),
        },
      ],
    },
  },
  {
    id: "cancel-02-cancelar-todos",
    name: "Cancelar todos os agendamentos",
    description:
      "Cliente pede para cancelar todos os agendamentos pendentes. " +
      "Agente deve listar e cancelar sequencialmente.",
    tags: ["cancellation", "multi-turn", "edge"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Pode cancelar todos os meus agendamentos" },
      { role: "user", content: "Sim, cancele todos" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask"],
      mustCallTools: ["list_client_upcoming_appointments", "cancel_appointment"],
      asserts: [
        {
          name: "Agente reconhece pedido de cancelamento múltiplo",
          severity: "medium",
          check: (i, reply) =>
            i === 0
              ? /agendamento|horário|cancelar|confirmar/i.test(reply)
              : true,
        },
        {
          name: "Após cancelamento, mensagem afirmativa sem nova pergunta de confirmação",
          severity: "critical",
          check: (i, reply) =>
            i !== 1 ||
            !/posso confirmar\?|tem certeza\?/i.test(reply),
        },
        {
          name: "Após cancelamento, oferece reagendar ou encerra de forma amigável",
          severity: "medium",
          check: (i, reply) =>
            i !== 1 ||
            /cancelad|cancelados|precisar\s+de|reagendar|qualquer\s+coisa/i.test(reply),
        },
      ],
    },
  },
];
