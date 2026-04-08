import type { Scenario } from "../../types.js";

/** Scenarios for barbershop plan subscriptions. */
export const planScenarios: Scenario[] = [
  {
    id: "plan-01-pergunta-planos",
    name: "Cliente pergunta sobre planos mensais",
    description: "Agente lista planos disponíveis sem inventar preços",
    tags: ["plans"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Vocês têm algum plano mensal?" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "price_placeholder"],
      mustCallTools: ["list_plans"],
      asserts: [
        {
          name: "Não inventa preço sem chamar list_plans",
          severity: "critical",
          check: (_i, reply) =>
            !/R\$\s*\d+[.,]\d{2}.*(?:inventado|placeholder|\[valor)/i.test(reply),
        },
        {
          name: "Menciona plano ou informa que não há planos cadastrados",
          severity: "medium",
          check: (_i, reply) =>
            /plano|assinatura|mensal|nenhum|não há|não temos/i.test(reply),
        },
        {
          name: "Não vaza UUIDs",
          severity: "critical",
          check: (_i, reply) =>
            !/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(reply),
        },
      ],
    },
  },
  {
    id: "plan-02-contratacao-whatsapp",
    name: "Cliente decide contratar plano",
    description: "Agente confirma detalhes, explica PIX e só assina com confirmação explícita",
    tags: ["plans", "multi-turn"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Quero assinar o plano mensal de barba" },
      { role: "user", content: "Sim, quero assinar!" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "pre_booking_claim"],
      mustCallTools: ["list_plans"],
      asserts: [
        {
          name: "Explica cobrança via PIX antes de confirmar",
          severity: "medium",
          check: (i, reply) =>
            i === 0 ? /pix|pagament|cobran/i.test(reply) : true,
        },
        {
          name: "Não confirma assinatura sem cliente concordar",
          severity: "critical",
          check: (i, reply) =>
            i === 0 ? !/assina[dt]a|confirmad[ao]|contratad[ao]/i.test(reply) : true,
        },
        {
          name: "Aguarda confirmação explícita",
          severity: "high",
          check: (i, reply) =>
            i === 0 ? /quer|deseja|confirma|posso|bora/i.test(reply) : true,
        },
      ],
    },
  },
  {
    id: "plan-03-sem-pix-configurado",
    name: "Barbearia sem chave PIX cadastrada",
    description: "Agente informa que pagamento será combinado diretamente — não expõe erro técnico",
    tags: ["plans", "edge"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Posso pagar o plano por aqui agora?" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure"],
      asserts: [
        {
          name: "Não expõe mensagem de erro técnico ao cliente",
          severity: "critical",
          check: (_i, reply) =>
            !/pix_key|chave pix não cadastrada|erro interno|exception|stack/i.test(reply),
        },
        {
          name: "Redireciona para equipe sem revelar falha técnica",
          severity: "high",
          check: (_i, reply) =>
            /equipe|diretamente|combinar|contato|falar/i.test(reply) ||
            /pix|pagament/i.test(reply),
        },
      ],
    },
  },
  {
    id: "plan-04-plano-inexistente",
    name: "Cliente pede plano que não existe",
    description: "Agente redireciona sem inventar preço ou plano",
    tags: ["plans", "edge"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Tem plano anual com desconto?" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "price_placeholder"],
      mustCallTools: ["list_plans"],
      asserts: [
        {
          name: "Não inventa plano anual inexistente",
          severity: "critical",
          check: (_i, reply) =>
            !/plano anual.{0,50}R\$\s*\d+/i.test(reply),
        },
        {
          name: "Informa o que está disponível ou que não há plano anual",
          severity: "medium",
          check: (_i, reply) =>
            /não tem|não temos|apenas|somente|disponív|mensal|nenhum/i.test(reply),
        },
      ],
    },
  },
];
