import type { Scenario } from "../../types.js";

/** Goldens do contrato canônico — recusa, rascunho, RSVP, PIX. */
export const agendaContractScenarios: Scenario[] = [
  {
    id: "contract-01-abertos-hoje",
    name: "Pergunta de funcionamento não vira data de agendamento",
    description: "Estão abertos hoje? deve responder expediente, sem resumo de aceite.",
    tags: ["edge", "booking"],
    vertical: "barbershop",
    turns: [{ role: "user", content: "Olá tudo bem? Estão abertos hoje?" }],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask"],
      asserts: [
        {
          name: "Fala de funcionamento, não fecha horário",
          severity: "critical",
          check: (_i, reply) =>
            /abert|funcion|expediente|fecha|encerr|reabr/i.test(reply) && !/posso confirmar\?/i.test(reply),
        },
      ],
    },
  },
  {
    id: "contract-01b-fechado-agora",
    name: "Pergunta de funcionamento depois do expediente",
    description: "Às 22h a loja já fechou: não pode dizer que está aberta até as 19h.",
    tags: ["edge", "booking"],
    vertical: "barbershop",
    simulatedNow: "2026-09-21T22:00:00-03:00",
    turns: [{ role: "user", content: "Olá tudo bem? Estão abertos hoje?" }],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask"],
      asserts: [
        {
          name: "Reconhece que já fechou e oferece o próximo dia",
          severity: "critical",
          check: (_i, reply) =>
            /fech|encerr|já (passou|encerrou)|amanhã|reabre/i.test(reply) && !/estamos abertos/i.test(reply),
        },
      ],
    },
  },
  {
    id: "contract-02-sem-servico",
    name: "Horário sem serviço não dispara check",
    description: "Lucas 18:30 sem nomear serviço — pergunta o serviço.",
    tags: ["booking"],
    vertical: "barbershop",
    turns: [{ role: "user", content: "o Lucas tem disponibilidade as 18:30?" }],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask"],
      asserts: [
        {
          name: "Pede o serviço antes de tratar o slot como ocupado",
          severity: "critical",
          check: (_i, reply) =>
            /servi[cç]o|corte|barba|combo/i.test(reply) && !/já está preenchido/i.test(reply),
        },
      ],
    },
  },
  {
    id: "contract-03-overflow-combo",
    name: "Combo 18:30 não cabe — convite à janela, não preenchido",
    description: "Corte e Barba 50 min às 18:30 vs fecha 19h → overflow.",
    tags: ["booking"],
    vertical: "barbershop",
    turns: [
      {
        role: "user",
        content: "Quero corte e barba na próxima segunda às 18:30 com o Eduardo",
      },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask"],
      asserts: [
        {
          name: "Não diz que o horário está preenchido",
          severity: "critical",
          check: (_i, reply) => !/preenchido/i.test(reply),
        },
      ],
    },
  },
  {
    id: "contract-04-pix-loja",
    name: "Pedido de PIX da loja",
    description: "Usa send_shop_pix; não confirma presença.",
    tags: ["plans", "booking"],
    vertical: "barbershop",
    turns: [{ role: "user", content: "me manda a chave pix da loja" }],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask"],
      mustCallTools: ["send_shop_pix"],
      asserts: [
        {
          name: "Não confirma presença no caminho do PIX",
          severity: "critical",
          check: (_i, reply) => !/confirmou presença|presença confirmada/i.test(reply),
        },
      ],
    },
  },
  {
    id: "contract-05-aceite-create",
    name: "Aceite fecha create, não RSVP",
    description: "Pode agendar após oferta deve criar pending, sem confirm_appointment.",
    tags: ["booking", "multi-turn"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Quero corte masculino terça às 10h com o Lucas" },
      { role: "user", content: "Perfeito, pode agendar. Meu nome é Mateus" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask"],
      asserts: [
        {
          name: "Não fala confirmação de presença",
          severity: "critical",
          check: (_i, reply) => !/confirmou presença|presença confirmada/i.test(reply),
        },
      ],
    },
  },
  {
    id: "contract-06-apos-amanha-lucas",
    name: "Após as 18 com o Lucas amanhã não vira Eduardo hoje",
    description: "Piso de horário e data ficam no rascunho; o aceite não troca o barbeiro.",
    tags: ["booking", "multi-turn"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "O lucas pode me atender hoje as 18?\nOu após" },
      { role: "user", content: "Preciso cortar meu cabelo" },
      { role: "user", content: "Isso, corte e barba" },
      { role: "user", content: "Seria só com o Lucas mesmo, tem amanhã?" },
      { role: "user", content: "Pode ser" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask"],
      asserts: [
        {
          name: "Sem serviço, pergunta o serviço e não oferece outro barbeiro",
          severity: "critical",
          check: (i, reply) =>
            i !== 0 || (/servi[cç]o|corte|barba/i.test(reply) && !/Eduardo/i.test(reply)),
        },
        {
          name: "Cortar o cabelo pede corte simples ou combo",
          severity: "critical",
          check: (i, reply) =>
            i !== 1 || (/corte masculino/i.test(reply) && /corte e barba/i.test(reply)),
        },
        {
          name: "Combo após as 18 não troca para o Eduardo",
          severity: "critical",
          check: (i, reply) => i !== 2 || !/Eduardo/i.test(reply),
        },
        {
          name: "Amanhã com o Lucas não oferece só a manhã",
          severity: "critical",
          check: (i, reply) => {
            if (i !== 3) return true;
            const morningOnly = /9h/i.test(reply) && /10h30/i.test(reply) && !/18/.test(reply);
            return /Lucas/i.test(reply) && !/Eduardo/i.test(reply) && !morningOnly;
          },
        },
        {
          name: "Pode ser confirma o Lucas, não o Eduardo",
          severity: "critical",
          check: (i, reply) => i !== 4 || (/Lucas/i.test(reply) && !/Eduardo/i.test(reply)),
        },
      ],
    },
  },
];
