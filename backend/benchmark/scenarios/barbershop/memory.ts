import type { Scenario } from "../../types.js";

/** Memory & preference scenarios — client context, "o de sempre", etc. */
export const memoryScenarios: Scenario[] = [
  {
    id: "mem-01-o-de-sempre",
    name: "Cliente pede 'o de sempre'",
    description: "Cliente recorrente pede o serviço habitual sem especificar",
    tags: ["booking", "memory"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Faz o de sempre pra mim amanhã" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask"],
      asserts: [
        {
          name: "Agente tenta recuperar preferência ou pede confirmação do serviço",
          severity: "medium",
          check: (_i, reply) =>
            /corte|barba|de sempre|último|costuma|habitual|qual serviç|que serviç/i.test(reply),
        },
        {
          name: "Não pede informação já fornecida (dia: amanhã)",
          severity: "medium",
          check: (_i, reply) => !/para quando|que dia|qual dia/i.test(reply),
        },
      ],
    },
  },
  {
    id: "mem-02-contexto-repetido",
    name: "Agente não repete pergunta",
    description: "Cliente informa nome no primeiro turno — agente não deve pedir de novo",
    tags: ["booking", "memory", "multi-turn"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Oi, sou o Carlos. Quero agendar uma barba completa" },
      { role: "user", content: "Qualquer horário na quarta-feira" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "redundant_info_request"],
      asserts: [
        {
          name: "Agente não pede o nome de novo no segundo turno",
          severity: "medium",
          check: (i, reply) =>
            i === 1 ? !/qual (seu nome|nome)|como você se chama/i.test(reply) : true,
        },
      ],
    },
  },
  {
    id: "mem-03-cliente-recorrente",
    name: "Cliente recorrente com preferência conhecida",
    description: "Cliente diz que já veio antes e quer o mesmo serviço",
    tags: ["booking", "memory"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Já sou cliente, faço sempre corte + barba. Quero marcar de novo" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure"],
      asserts: [
        {
          name: "Agente reconhece contexto e avança para data/hora",
          severity: "medium",
          check: (_i, reply) =>
            /quando|data|horário|dia|que dia|qual dia|amanhã/i.test(reply),
        },
      ],
    },
  },
  {
    id: "mem-04-memoria-vs-conversa-atual",
    name: "Conversa atual prevalece sobre memória",
    description: "Cliente tem preferência histórica por corte, mas agora quer barba. Agente deve seguir a conversa.",
    tags: ["booking", "memory", "multi-turn"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Quero fazer a barba desta vez, não o corte" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure"],
      asserts: [
        {
          name: "Agente não insiste no serviço histórico (corte)",
          severity: "medium",
          check: (_i, reply) =>
            !/\bcostuma\s+fazer\s+corte\b|\bda\s+última\s+vez\s+foi\s+corte\b/i.test(reply),
        },
        {
          name: "Agente avança com barba",
          severity: "medium",
          check: (_i, reply) => /barba|quando|horário|dia/i.test(reply),
        },
      ],
    },
  },
  {
    id: "mem-05-baixa-confianca-nao-afirma",
    name: "Memória de baixa confiança não vira afirmação",
    description: "Agente com memória incerta não deve afirmar preferência com certeza",
    tags: ["memory"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Oi, quero agendar" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure"],
      asserts: [
        {
          name: "Resposta não contém afirmações absolutas sobre preferência passada",
          severity: "medium",
          check: (_i, reply) =>
            !/\bvocê\s+sempre\s+faz\b|\bvocê\s+gosta\s+de\b|\bseu\s+serviço\s+(favorito|preferido)\s+é\b/i.test(reply),
        },
      ],
    },
  },
  {
    id: "mem-06-barbeiro-preferido",
    name: "Sugestão de barbeiro preferido",
    description: "Agente com memória de barbeiro preferido deve sugerir (não impor)",
    tags: ["booking", "memory"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Quero corte amanhã, sem preferência de barbeiro" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure"],
      asserts: [
        {
          name: "Quando cliente diz sem preferência, agente escolhe e avança",
          severity: "medium",
          check: (_i, reply) =>
            !/qual barbeiro|prefere qual|com quem/i.test(reply) ||
            /qualquer|escolhi|encaixar/i.test(reply),
        },
      ],
    },
  },
  {
    id: "mem-07-horario-preferido",
    name: "Sugestão de horário preferido",
    description: "Cliente com preferência histórica por manhã — agente deve sugerir de manhã primeiro",
    tags: ["booking", "memory"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Tem horário amanhã pra corte?" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure"],
      asserts: [
        {
          name: "Agente apresenta horários (não ignora a pergunta)",
          severity: "medium",
          check: (_i, reply) => /\d{1,2}:\d{2}|horário|cheio|lotado/i.test(reply),
        },
      ],
    },
  },
  {
    id: "mem-08-estilo-comunicacao-formal",
    name: "Tom ajustado a cliente formal",
    description: "Cliente usa linguagem formal — agente deve manter tom compatível",
    tags: ["booking", "memory"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Gostaria de agendar um horário para amanhã, se possível." },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "undesired_slang"],
      asserts: [
        {
          name: "Agente não usa gírias com cliente formal",
          severity: "medium",
          check: (_i, reply) =>
            !/\b(mano|véi|parceiro|cara|irmão|brother)\b/i.test(reply),
        },
      ],
    },
  },
  {
    id: "mem-09-completed-reforco",
    name: "Completed reforça preferência de serviço",
    description:
      "Agente com histórico de 3 atendimentos concluídos com corte+barba deve sugerir esse combo ao cliente recorrente",
    tags: ["memory", "booking"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Oi, quero marcar de novo" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask"],
      asserts: [
        {
          name: "Agente avança para agendamento (não fica pedindo escolha de serviço sem necessidade)",
          severity: "medium",
          check: (_i, reply) =>
            /corte|barba|serviço|quando|horário|dia/i.test(reply),
        },
        {
          name: "Agente não pergunta telefone nem dados já conhecidos",
          severity: "critical",
          check: (_i, reply) =>
            !/telefone|celular|número/i.test(reply),
        },
      ],
    },
  },
  {
    id: "mem-10-no-show-nao-quebra-atendimento",
    name: "No-show registrado não impede atendimento",
    description:
      "Cliente com 1 no-show anterior ainda deve ser atendido normalmente — sem bloqueio, sem menção ao histórico",
    tags: ["memory", "booking"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Oi quero agendar um corte" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure"],
      asserts: [
        {
          name: "Agente não menciona o no-show histórico",
          severity: "critical",
          check: (_i, reply) =>
            !/não compareceu|faltou|no.show|perdeu|cancelamento sem aviso/i.test(reply),
        },
        {
          name: "Agente avança com o agendamento normalmente",
          severity: "medium",
          check: (_i, reply) =>
            /corte|quando|horário|dia|serviço/i.test(reply),
        },
      ],
    },
  },
  {
    id: "mem-11-historico-baixo-nao-infere-forte",
    name: "Histórico insuficiente não gera preferência forte",
    description:
      "Cliente com apenas 1 atendimento anterior — agente não deve afirmar com certeza preferências passadas",
    tags: ["memory"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Quero marcar" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure"],
      asserts: [
        {
          name: "Agente não afirma preferência com certeza para cliente de baixo histórico",
          severity: "medium",
          check: (_i, reply) =>
            !/você\s+sempre\s+faz|seu\s+serviço\s+favorito\s+é|você\s+prefere\s+sempre/i.test(reply),
        },
      ],
    },
  },
  {
    id: "mem-12-historico-contraditorio",
    name: "Histórico contraditório não vira preferência forte",
    description:
      "Cliente que alternou entre barbeiros diferentes — agente não deve afirmar preferência de barbeiro",
    tags: ["memory"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Pode ser qualquer barbeiro, tanto faz" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure"],
      asserts: [
        {
          name: "Agente aceita sem preferência e avança sem insistir em barbeiro específico",
          severity: "medium",
          check: (_i, reply) =>
            !/qual barbeiro você prefere|costuma ir com/i.test(reply),
        },
        {
          name: "Agente avança para data/horário",
          severity: "medium",
          check: (_i, reply) =>
            /dia|horário|quando|serviço|qual/i.test(reply),
        },
      ],
    },
  },
];
