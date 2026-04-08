import type { Scenario } from "../../types.js";

/** Greeting scenarios — how the agent opens a conversation */
export const greetingScenarios: Scenario[] = [
  {
    id: "greet-01-vague",
    name: "Saudação vaga",
    description: "Cliente manda apenas 'Oi' sem contexto adicional",
    tags: ["greeting"],
    vertical: "barbershop",
    turns: [{ role: "user", content: "Oi" }],
    expected: {
      noViolations: ["ai_exposure", "uuid_leak", "phone_ask"],
      asserts: [
        {
          name: "Resposta não é genérica demais",
          severity: "medium",
          check: (_i, reply) => {
            const generic = /como posso (te |)ajudar|o que (posso|eu posso) fazer|estou aqui para/i;
            return !generic.test(reply);
          },
        },
        {
          name: "Resposta convida para agendamento ou serviços",
          severity: "medium",
          check: (_i, reply) => /serviç|agend|marcar|horário/i.test(reply),
        },
      ],
    },
  },
  {
    id: "greet-02-seco",
    name: "Cliente seco",
    description: "Cliente manda uma palavra sem pontuação",
    tags: ["greeting"],
    vertical: "barbershop",
    turns: [{ role: "user", content: "Salve" }],
    expected: {
      noViolations: ["ai_exposure", "uuid_leak"],
      asserts: [
        {
          name: "Resposta é relevante (não só eco de saudação)",
          severity: "light",
          check: (_i, reply) => reply.length > 30,
        },
      ],
    },
  },
  {
    id: "greet-03-cordial",
    name: "Cliente cordial",
    description: "Cliente cumprimenta com cordialidade e pergunta se pode agendar",
    tags: ["greeting"],
    vertical: "barbershop",
    turns: [{ role: "user", content: "Bom dia! Tudo bem? Gostaria de agendar um horário." }],
    expected: {
      noViolations: ["ai_exposure", "uuid_leak", "phone_ask"],
      asserts: [
        {
          name: "Agente responde à saudação e direciona ao fluxo",
          severity: "medium",
          check: (_i, reply) => /serviç|agend|corte|barba|horário/i.test(reply),
        },
      ],
    },
  },
  // ── Adicionado no ciclo de refinamento 2 (falha real — 03/04/2026) ──
  {
    id: "greet-04-tudo-bem",
    name: "Saudação social com pergunta de bem-estar",
    description:
      'Cliente manda "Olá tudo bem?" — agente deve reconhecer o cumprimento e depois ' +
      "direcionar ao agendamento em duas mensagens separadas (via [[MSG]])",
    tags: ["greeting"],
    vertical: "barbershop",
    turns: [{ role: "user", content: "Olá tudo bem?" }],
    expected: {
      noViolations: ["ai_exposure", "uuid_leak", "phone_ask"],
      asserts: [
        {
          name: "Resposta contém reconhecimento do cumprimento (tudo certo/bem/olá)",
          severity: "medium",
          check: (_i, reply) => /tudo\s+(certo|bem|ótimo|ok)|olá|oi\b/i.test(reply),
        },
        {
          name: "Resposta direciona ao agendamento ou serviços",
          severity: "medium",
          check: (_i, reply) => /serviç|agend|marcar|horário/i.test(reply),
        },
        {
          name: "Resposta usa duas mensagens separadas ([[MSG]])",
          severity: "light",
          check: (_i, reply) => reply.includes("[[MSG]]"),
        },
        {
          name: "Não usa frases genéricas de atendente virtual",
          severity: "medium",
          check: (_i, reply) =>
            !/como posso (te |)ajudar|estou aqui para|em que posso (ser útil|ajudar)/i.test(reply),
        },
      ],
    },
  },
];
