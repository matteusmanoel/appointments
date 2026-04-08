import type { Scenario } from "../../types.js";

/** Edge cases, out-of-scope, handoff, follow-up, reactivation */
export const edgeCaseScenarios: Scenario[] = [
  {
    id: "edge-01-fora-escopo",
    name: "Pedido fora do escopo (pizza)",
    description: "Cliente pergunta sobre algo completamente fora do escopo da barbearia",
    tags: ["out-of-scope"],
    vertical: "barbershop",
    turns: [{ role: "user", content: "Vocês entregam pizza?" }],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure"],
      asserts: [
        {
          name: "Não inventa resposta sobre pizza",
          severity: "critical",
          check: (_i, reply) =>
            !/pizzaria|pizza do|entregamos|entrega de pizza/i.test(reply.toLowerCase()),
        },
        {
          name: "Redireciona para serviços da barbearia",
          severity: "medium",
          check: (_i, reply) => /serviç|agend|barb|corte|marcar/i.test(reply),
        },
      ],
    },
  },
  {
    id: "edge-02-servico-inexistente",
    name: "Serviço que não existe",
    description: "Cliente pede serviço que a barbearia não oferece",
    tags: ["out-of-scope", "booking"],
    vertical: "barbershop",
    turns: [{ role: "user", content: "Vocês fazem terapia capilar?" }],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure"],
      asserts: [
        {
          name: "Informa que não tem o serviço",
          severity: "medium",
          check: (_i, reply) =>
            /não (temos|oferecemos|fazemos|realizamos)|não (tem|há) esse/i.test(reply),
        },
        {
          name: "Lista alternativas disponíveis",
          severity: "medium",
          check: (_i, reply) =>
            /corte|barba|sobrancelha|R\$|\d+\s*[.-]/.test(reply),
        },
      ],
    },
  },
  {
    id: "edge-03-handoff",
    name: "Pedido de atendente humano",
    description: "Cliente quer falar com uma pessoa",
    tags: ["handoff"],
    vertical: "barbershop",
    turns: [{ role: "user", content: "Quero falar com um atendente humano" }],
    expected: {
      noViolations: ["uuid_leak"],
      asserts: [
        {
          name: "Não nega a existência de atendente humano",
          severity: "medium",
          check: (_i, reply) =>
            !/só (tenho|temos)|apenas (bot|ia|robô)|não tem atendente/i.test(reply.toLowerCase()),
        },
        {
          name: "Confirma que redirecionará ou aguarda",
          severity: "medium",
          check: (_i, reply) =>
            /atendente|humano|pessoa|momento|instantes|aguard|vai te atender/i.test(
              reply.toLowerCase()
            ),
        },
      ],
    },
  },
  {
    id: "edge-04-reativacao",
    name: "Reativação de cliente sumido",
    description: "Cliente que sumiu há meses volta a contato",
    tags: ["reactivation"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Faz tempo que não apareço. Quero voltar" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure"],
      asserts: [
        {
          name: "Recebe o cliente de volta de forma acolhedora",
          severity: "medium",
          check: (_i, reply) => reply.length > 40,
        },
        {
          name: "Direciona para agendamento",
          severity: "medium",
          check: (_i, reply) => /agend|horário|serviç|marcar/i.test(reply),
        },
      ],
    },
  },
  {
    id: "edge-05-cobranca-amigavel",
    name: "Cobrança amigável de pendência",
    description: "Cliente tem pendência financeira — comunicação deve ser amigável",
    tags: ["debt"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Quero agendar um corte" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "technical_apology"],
      asserts: [
        {
          name: "Tom não é agressivo ou constrangedor",
          severity: "medium",
          check: (_i, reply) =>
            !/devendo|dívida|cobrar|negativado|inadimplente/i.test(reply.toLowerCase()),
        },
      ],
    },
  },
  {
    id: "edge-06-mensagem-ambigua",
    name: "Mensagem completamente ambígua",
    description: "Cliente manda mensagem sem contexto claro",
    tags: ["edge", "greeting"],
    vertical: "barbershop",
    turns: [{ role: "user", content: "pode ser" }],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure"],
      asserts: [
        {
          name: "Não trava em loop ou retorna vazio",
          severity: "medium",
          check: (_i, reply) => reply.trim().length > 10,
        },
      ],
    },
  },
  {
    id: "edge-07-follow-up",
    name: "Follow-up pós-atendimento",
    description: "Cliente recebe mensagem de follow-up e responde",
    tags: ["follow-up"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Foi ótimo! Adorei o atendimento" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure"],
      asserts: [
        {
          name: "Agente responde positivamente e oferece próximo agendamento",
          severity: "medium",
          check: (_i, reply) => reply.length > 20,
        },
      ],
    },
  },
  {
    id: "edge-08-multiplos-servicos",
    name: "Cliente pede combo de serviços",
    description: "Cliente quer corte + barba + sobrancelha de uma vez",
    tags: ["booking"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Quero fazer corte, barba e sobrancelha. Tem horário?" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask"],
      asserts: [
        {
          name: "Trata múltiplos serviços corretamente",
          severity: "medium",
          check: (_i, reply) =>
            /corte|barba|sobrancelha|serviç|horário|\d{1,2}:\d{2}/i.test(reply),
        },
      ],
    },
  },
  {
    id: "edge-09-sem-dados",
    name: "Agendamento sem nome",
    description: "Cliente quer agendar mas não fornece o nome — agente deve pedir",
    tags: ["booking", "multi-turn"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Quero corte amanhã às 09:00 com qualquer barbeiro" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "pre_booking_claim"],
      asserts: [
        {
          name: "Não confirma agendamento sem ter o nome ou confirmar disponibilidade",
          severity: "critical",
          check: (_i, reply) => {
            if (/agendei|marquei|está marcado|agendamento (feito|criado)/i.test(reply)) {
              return false;
            }
            return true;
          },
        },
      ],
    },
  },
  {
    id: "edge-10-preferencia-barbeiro-indisponivel",
    name: "Barbeiro preferido indisponível",
    description: "Cliente pede barbeiro específico mas ele não tem horário",
    tags: ["booking", "edge"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Quero amanhã às 14:00 com o Pedro" },
      { role: "user", content: "E com outro barbeiro?" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "pre_booking_claim"],
      asserts: [
        {
          name: "Quando preferido indisponível, oferece alternativa",
          severity: "medium",
          check: (i, reply) =>
            i === 1
              ? /outro|alternativa|\d{1,2}:\d{2}|barbeiro|disponível/i.test(reply)
              : true,
        },
      ],
    },
  },
  // ── Adicionados no ciclo de refinamento 3 (falhas reais — 05/04/2026) ──
  {
    id: "edge-11-localizacao-unica",
    name: "Localização enviada apenas uma vez",
    description:
      "Cliente pede a localização. Agente deve chamar send_barbershop_location uma única vez " +
      "e responder com frase curta. Não deve reenviar o pin nem colar URL de mapa no texto.",
    tags: ["edge"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Pode me mandar a localização de vocês?" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure"],
      mustCallTools: ["send_barbershop_location"],
      asserts: [
        {
          name: "Resposta confirma envio do pin com frase curta",
          severity: "medium",
          check: (_i, reply) => /pin|localizaç|mandei|enviei|mapa|WhatsApp/i.test(reply),
        },
        {
          name: "Não cola URL de maps.google.com na mensagem de texto",
          severity: "medium",
          check: (_i, reply) => !/maps\.google\.com|maps\.app\.goo/i.test(reply),
        },
      ],
    },
  },
  {
    id: "edge-12-horario-funcionamento",
    name: "Cliente pergunta horário de funcionamento",
    description: "Agente deve responder com os horários reais sem inventar.",
    tags: ["edge", "greeting"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Qual o horário de funcionamento de vocês?" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure"],
      asserts: [
        {
          name: "Resposta inclui horários de abertura/fechamento",
          severity: "medium",
          check: (_i, reply) => /\d{1,2}h|\d{2}:\d{2}|segunda|sábado|domingo|fechad/i.test(reply),
        },
        {
          name: "Não inventa horário (não menciona horários além do expediente)",
          severity: "light",
          check: (_i, reply) => reply.trim().length > 20,
        },
      ],
    },
  },
  {
    id: "edge-13-preco-apos-agendamento",
    name: "Cliente pergunta preço após agendamento confirmado",
    description:
      "Após confirmar agendamento, cliente pergunta 'qual o valor?'. " +
      "Agente deve responder com preço real sem re-confirmar agendamento nem oferecer novos horários.",
    tags: ["edge", "booking"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: `Quero agendar corte masculino para depois de amanhã às 14h` },
      { role: "user", content: "Com o Eduardo" },
      { role: "user", content: "Marcelo" },
      { role: "user", content: "Qual o valor do serviço?" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask"],
      asserts: [
        {
          name: "Resposta à pergunta de preço inclui valor numérico",
          severity: "critical",
          check: (i, reply) =>
            i !== 3 || /R\$\s*\d+/i.test(reply),
        },
        {
          name: "Após preço, não reabre confirmação nem oferece novos horários",
          severity: "medium",
          check: (i, reply) =>
            i !== 3 ||
            !/posso confirmar\?|qual\s+horário|qual\s+você\s+prefere/i.test(reply),
        },
      ],
    },
  },
  {
    id: "edge-14-uuid-invalido-recovery",
    name: "Recuperação graciosa quando appointment_id inválido",
    description:
      "Se o modelo tentar usar um appointment_id inválido (número ou nome), " +
      "o sistema retorna erro e o agente deve se recuperar sem expor mensagem técnica.",
    tags: ["edge", "booking"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Cancela meu agendamento número 1" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure"],
      asserts: [
        {
          name: "Agente não expõe mensagem de erro de UUID ao cliente",
          severity: "critical",
          check: (_i, reply) =>
            !/invalid input syntax|uuid|\\buuid\\b|tipo uuid|formato inválido/i.test(reply),
        },
        {
          name: "Agente recupera e lista os agendamentos reais",
          severity: "medium",
          check: (_i, reply) => reply.trim().length > 20,
        },
      ],
    },
  },
];
