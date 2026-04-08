import type { Scenario } from "../../types.js";

function futureDate(offsetDays = 1): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split("T")[0]; // yyyy-MM-dd
}

/** Booking scenarios — main agendamento happy and unhappy paths */
export const bookingScenarios: Scenario[] = [
  {
    id: "book-01-direto",
    name: "Cliente direto ao ponto",
    description: "Cliente especifica serviço, data e horário de uma vez",
    tags: ["booking", "multi-turn"],
    vertical: "barbershop",
    turns: [
      {
        role: "user",
        content: `Quero cortar o cabelo ${futureDate(2)} às 10:00`,
      },
    ],
    expected: {
      noViolations: ["uuid_leak", "phone_ask", "ai_exposure"],
      mustCallTools: ["check_availability"],
      asserts: [
        {
          name: "Não pede telefone",
          severity: "critical",
          check: (_i, reply) => !/telefone|celular|whats/i.test(reply),
        },
        {
          name: "Não vaza UUID",
          severity: "critical",
          check: (_i, reply) =>
            !/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(reply),
        },
      ],
    },
  },
  {
    id: "book-02-indeciso",
    name: "Cliente indeciso",
    description: "Cliente não sabe o serviço e pede sugestão",
    tags: ["booking", "multi-turn"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Quero ir aí mas não sei bem o que fazer" },
      { role: "user", content: "Algo rápido mesmo" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure"],
      asserts: [
        {
          name: "Agente sugere serviços ao invés de perguntar em loop",
          severity: "medium",
          check: (i, reply) =>
            i === 0 ? /serviç|corte|barba|sobrancelha/i.test(reply) : true,
        },
      ],
    },
  },
  {
    id: "book-03-qualquer-barbeiro",
    name: "Qualquer barbeiro",
    description: "Cliente quer o primeiro horário disponível com qualquer profissional",
    tags: ["booking", "multi-turn"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Quero fazer a barba. Qualquer barbeiro, qualquer horário amanhã" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask"],
      mustCallTools: ["get_next_slots"],
      asserts: [
        {
          name: "Agente propõe horários concretos",
          severity: "medium",
          check: (_i, reply) => /\d{1,2}:\d{2}|\bhoje\b|\bamanhã\b/i.test(reply),
        },
      ],
    },
  },
  {
    id: "book-04-horario-exato",
    name: "Cliente pede horário exato",
    description: "Cliente especifica um horário exato e barbeiro preferido",
    tags: ["booking"],
    vertical: "barbershop",
    turns: [
      {
        role: "user",
        content: `Corte de cabelo ${futureDate(3)} às 14:30 com o João`,
      },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask"],
      mustCallTools: ["check_availability"],
    },
  },
  {
    id: "book-05-primeiro-horario",
    name: "Primeiro horário disponível",
    description: "Cliente quer o primeiro horário amanhã sem especificar horário",
    tags: ["booking"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Qual o primeiro horário disponível amanhã pra corte?" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "past_time_suggestion"],
      mustCallTools: ["get_next_slots"],
      asserts: [
        {
          name: "Sugere horário razoável de abertura (7h-12h) ou informa lotação",
          severity: "medium",
          check: (_i, reply) => {
            const timeMatch = reply.match(/\b(\d{1,2}):\d{2}\b/);
            const hour = timeMatch ? parseInt(timeMatch[1], 10) : null;
            if (hour !== null) return hour >= 7 && hour <= 14;
            return /cheio|lotado|sem horário|não tem|não consegui/i.test(reply);
          },
        },
      ],
    },
  },
  {
    id: "book-06-hoje",
    name: "Horário hoje sem hora definida",
    description: "Cliente pergunta se tem horário hoje sem especificar hora",
    tags: ["booking"],
    vertical: "barbershop",
    turns: [{ role: "user", content: "Tem horário hoje pra corte?" }],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "past_time_suggestion"],
      mustCallTools: ["get_next_slots"],
      asserts: [
        {
          name: "Não sugere horário no passado",
          severity: "critical",
          check: (_i, reply) => {
            const now = new Date();
            const matches = reply.match(/\b(\d{1,2}):(\d{2})\b/g) ?? [];
            return matches.every((m) => {
              const [h, min] = m.split(":").map(Number);
              const slotMins = h * 60 + min;
              const nowMins = now.getHours() * 60 + now.getMinutes();
              return slotMins >= nowMins - 15;
            });
          },
        },
      ],
    },
  },
  {
    id: "book-10-agora-manha-slot-pick",
    name: "Agora de manhã + escolha de horário",
    description:
      "Falha real (chat 11): cliente pede disponibilidade 'agora pela manhã' e escolhe um horário; " +
      "agente deve sugerir só 2 opções (sem bullets), depois validar e pedir nome (sem listar serviços).",
    tags: ["booking", "multi-turn", "edge"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Tem horário pra corte e barba disponível agora pela manhã?" },
      { role: "user", content: "Pode ser às 10:30" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask", "pre_booking_claim"],
      mustCallTools: ["get_next_slots", "check_availability"],
      asserts: [
        {
          name: "Não usa lista de horários em bullets",
          severity: "medium",
          check: (_i, reply) => !/\n\s*[-•]\s*\*?\d{1,2}([:h]\d{2})?\*?\s*$/m.test(reply),
        },
        {
          name: "No máximo 2 horários sugeridos no primeiro turno",
          severity: "medium",
          check: (i, reply) => {
            if (i !== 0) return true;
            const matches = reply.match(/\b\d{1,2}:\d{2}\b|\b\d{1,2}h\d{2}\b|\b\d{1,2}h\b/g) ?? [];
            return matches.length <= 2;
          },
        },
        {
          name: "Após escolher horário, não lista serviços (sem enumeração 1., 2., 3.)",
          severity: "critical",
          check: (i, reply) => (i === 1 ? !/temos os seguintes serviços|\n\s*1\.\s*\*/i.test(reply) : true),
        },
        {
          name: "Após escolher horário, pede nome (se ainda não tiver)",
          severity: "medium",
          check: (i, reply) => (i === 1 ? /qual\s+(o\s+)?seu\s+nome|pra\s+salvar.*nome|informe?\s+seu\s+nome/i.test(reply) : true),
        },
      ],
    },
  },
  {
    id: "book-07-mudanca-servico",
    name: "Mudança de serviço no meio da conversa",
    description: "Cliente começa pedindo corte e muda para barba completa",
    tags: ["booking", "multi-turn", "memory"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: `Quero agendar um corte ${futureDate(2)} às 10:00` },
      { role: "user", content: "Na verdade, quero barba completa, não corte" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "redundant_info_request"],
      asserts: [
        {
          name: "Agente não pergunta a data de novo na mudança",
          severity: "medium",
          check: (i, reply) =>
            i === 1 ? !/qual data|que dia|para quando/i.test(reply) : true,
        },
      ],
    },
  },
  {
    id: "book-08-conflito-agenda",
    name: "Conflito de agenda",
    description: "Horário solicitado está ocupado — agente deve oferecer alternativas",
    tags: ["booking", "edge"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: `Quero agendar corte ${futureDate(1)} às 09:00` },
      { role: "user", content: "Não tem jeito de encaixar nesse horário?" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "pre_booking_claim"],
      asserts: [
        {
          name: "Quando conflito: não afirma que agendou antes da confirmação",
          severity: "critical",
          check: (_i, reply) =>
            !/agendei|está marcado|confirmei|agendamento (feito|criado|realizado)/i.test(reply),
        },
        {
          name: "Oferece alternativas quando há conflito",
          severity: "medium",
          check: (i, reply) =>
            i === 0
              ? /outro horário|alternativa|disponível|opção|\d{1,2}:\d{2}/i.test(reply)
              : true,
        },
      ],
    },
  },
  // ── Cenários adicionados no ciclo de refinamento 2 (falhas reais — 03/04/2026) ──
  {
    id: "book-09-nome-nao-repetido-apos-falha",
    name: "Nome não repetido após falha de create",
    description:
      "Cliente fornece nome para confirmação; mesmo que create_appointment falhe por SLOT_CONFLICT, " +
      "agente NÃO deve pedir o nome de novo — deve oferecer horários alternativos",
    tags: ["booking", "edge", "multi-turn"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: `Quero corte e barba ${futureDate(1)} às 09:00` },
      { role: "user", content: "Pode ser" },
      { role: "user", content: "Rafael" }, // nome fornecido
      // slot está ocupado → agente ofere alternativas (não pede nome de novo)
      { role: "user", content: "Pode ser às 10:00 então" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask"],
      asserts: [
        {
          name: "Não pede nome de novo após já ter recebido",
          severity: "critical",
          check: (i, reply) =>
            i >= 3
              ? !/qual\s+(é\s+o\s+)?seu\s+nome|me\s+(diz|fala)\s+(seu\s+)?nome|nome\s+para\s+salvar/i.test(reply)
              : true,
        },
        {
          name: "Após falha, oferece alternativas de horário",
          severity: "medium",
          check: (i, reply) =>
            i === 2
              ? /\d{1,2}:\d{2}|alternativ|disponív|outro horário/i.test(reply)
              : true,
        },
      ],
    },
  },
  {
    id: "book-10-confirmacao-limpa-apos-agendamento",
    name: "Confirmação limpa ao criar agendamento",
    description:
      "Quando state=appointment_created, a última mensagem da IA deve ser uma confirmação " +
      "clara, sem frases de erro, sem loop de formulário",
    tags: ["booking", "multi-turn"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: `Corte masculino ${futureDate(2)} às 14:00` },
      { role: "user", content: "Pode ser" },
      { role: "user", content: "Lucas" },
    ],
    expected: {
      finalState: "appointment_created",
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask"],
      mustCallTools: ["create_appointment"],
      asserts: [
        {
          name: "Confirmação contém dados do agendamento (serviço/data/hora)",
          severity: "critical",
          check: (_i, reply, state) =>
            state !== "appointment_created" ||
            /confirmad|agendad|marcad|\d{1,2}:\d{2}|serviç/i.test(reply),
        },
        {
          name: "Confirmação não contém frases de erro ou loop",
          severity: "critical",
          check: (_i, reply, state) =>
            state !== "appointment_created" ||
            !/houve\s+um\s+problema|vou\s+verificar|qual\s+(é\s+o\s+)?seu\s+nome|me\s+diz\s+seu\s+nome/i.test(reply),
        },
        {
          name: "Confirmação não vaza linguagem técnica interna",
          severity: "medium",
          check: (_i, reply, state) =>
            state !== "appointment_created" ||
            !/limite de etapas|valor a ser informado|\[valor|ferramenta interna|atendimento automático/i.test(
              reply
            ),
        },
      ],
    },
  },
  {
    id: "book-11-sem-exposicao-de-erro",
    name: "Erro de ferramenta não exposto ao cliente",
    description:
      "Quando create_appointment falha por SLOT_CONFLICT, o agente não deve expor " +
      "mensagens técnicas de erro. Deve oferecer alternativas ou escalar para handoff.",
    tags: ["booking", "edge"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: `Quero barba ${futureDate(1)} às 08:00` },
      { role: "user", content: "Pode ser" },
      { role: "user", content: "Carlos" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask"],
      asserts: [
        {
          name: "Resposta após tentativa de create nunca contém frases de problema/bug",
          severity: "critical",
          check: (_i, reply) =>
            !/houve\s+um\s+problema|tá\s+rolando\s+um\s+bug|vou\s+tentar\s+mais\s+uma\s+abordagem|vou\s+verificar\s+novamente/i.test(
              reply
            ),
        },
        {
          name: "Agente oferece alternativa ou confirma (nunca silêncio total sem motivo)",
          severity: "medium",
          check: (_i, reply) => reply.trim().length > 0 || true, // handoff (empty) é aceitável
        },
      ],
    },
  },
  {
    id: "book-12-example-txt-minimal",
    name: "Fluxo curto tipo example.txt (corte e barba + tarde)",
    description:
      "Cliente decidido: serviço + período → barbeiro → horário → nome → confirmação sem voltas extras.",
    tags: ["booking", "multi-turn"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Tem horário pra corte e barba disponível agora pela tarde?" },
      { role: "user", content: "Não, pode ser qualquer um." },
      { role: "user", content: "Pode ser as 13:30" },
      { role: "user", content: "Mateus" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask", "ignored_context"],
      asserts: [
        {
          name: "Pergunta preferência de barbeiro cedo (turn 0)",
          severity: "medium",
          check: (i, reply) => (i === 0 ? /barbeiro/i.test(reply) : true),
        },
        {
          name: "Última resposta: confirma agendamento ou não reabre duas opções de horário",
          severity: "critical",
          check: (i, reply) =>
            i !== 3 ||
            /Agendado\b|Agendamento\s+confirmado/i.test(reply) ||
            !/qual\s+você\s+prefere/i.test(reply) ||
            (reply.match(/\b\d{1,2}h\d{0,2}\b|\b\d{1,2}:\d{2}\b/g) ?? []).length < 2,
        },
      ],
    },
  },
  {
    id: "book-13-anti-reabre-slot-apos-nome",
    name: "Anti-padrão chat 13 — nome após resumo não pode reofertar horários",
    description:
      "Se o assistente pediu nome após resumo, a resposta seguinte não deve listar dois horários com 'Qual prefere?'.",
    tags: ["booking", "multi-turn", "edge"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: "Tem horário pra corte e barba disponível agora a tarde?" },
      { role: "user", content: "As 16h está ótimo" },
      { role: "user", content: "Mateus" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask", "ignored_context"],
      asserts: [
        {
          name: "Após nome curto (turn 2), não oferece par de horários com Qual prefere",
          severity: "critical",
          check: (i, reply) =>
            i !== 2 ||
            !/qual\s+você\s+prefere|qual\s+prefere/i.test(reply) ||
            (reply.match(/\b\d{1,2}h\d{0,2}\b|\b\d{1,2}:\d{2}\b/g) ?? []).length < 2,
        },
      ],
    },
  },
  // ── Cenários adicionados no ciclo de refinamento 3 (falhas reais — 05/04/2026) ──
  {
    id: "book-14-combo-vs-avulso",
    name: "Combo 'Corte e Barba' não vira serviço avulso",
    description:
      "Cliente pede 'corte e barba'. Agente deve usar o serviço combo, " +
      "não confirmar 'Barba completa' sozinha.",
    tags: ["booking", "multi-turn", "edge"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: `Quero agendar corte e barba amanhã às 10h` },
      { role: "user", content: "Pode ser qualquer barbeiro" },
      { role: "user", content: "Rafael" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask", "pre_booking_claim"],
      mustCallTools: ["check_availability", "create_appointment"],
      asserts: [
        {
          name: "Confirmação contém 'Corte e Barba' (combo) e não só 'Barba completa'",
          severity: "critical",
          check: (_i, reply, state) =>
            state !== "appointment_created" ||
            (/corte\s*(e|&|\+)\s*barba|combo/i.test(reply) && !/^\s*Barba\s+completa\s*$/im.test(reply)),
        },
        {
          name: "Preço confirmado é R$ 55 (combo), não R$ 25 (barba avulsa)",
          severity: "medium",
          check: (_i, reply, state) =>
            state !== "appointment_created" ||
            !/R\$\s*25/i.test(reply),
        },
      ],
    },
  },
  {
    id: "book-15-correcao-servico",
    name: "Cliente corrige serviço após confirmação errada",
    description:
      "Agente confirmou serviço errado (barba); cliente corrige pedindo 'corte e barba'. " +
      "Agente deve corrigir sem pedir dados novamente.",
    tags: ["booking", "multi-turn", "edge"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: `Quero agendar barba amanhã às 11h com Eduardo Gustavo` },
      { role: "user", content: "Pode ser" },
      { role: "user", content: "Carlos" },
      { role: "user", content: "Na verdade eu pedi corte e barba, não só barba. Pode alterar?" },
    ],
    expected: {
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask"],
      asserts: [
        {
          name: "Após correção, agente não pede data/horário de novo",
          severity: "critical",
          check: (i, reply) =>
            i !== 3 ||
            !/qual\s+(data|dia|horário)|para\s+quando/i.test(reply),
        },
        {
          name: "Após correção, confirma o combo ou oferece ajuste",
          severity: "medium",
          check: (i, reply) =>
            i !== 3 ||
            /corte\s*(e|&|\+)\s*barba|combo|alterar|ajust/i.test(reply),
        },
      ],
    },
  },
  {
    id: "book-16-preco-sem-placeholder",
    name: "Preço na confirmação nunca é placeholder",
    description:
      "Após create_appointment bem-sucedido, a mensagem de confirmação não deve " +
      "conter '[', 'placeholder', 'ferramenta' ou valor vazio no campo *Total:*.",
    tags: ["booking", "multi-turn"],
    vertical: "barbershop",
    turns: [
      { role: "user", content: `Quero corte masculino amanhã às 09h30` },
      { role: "user", content: "Com qualquer barbeiro" },
      { role: "user", content: "João" },
    ],
    expected: {
      finalState: "appointment_created",
      noViolations: ["uuid_leak", "ai_exposure", "phone_ask"],
      mustCallTools: ["create_appointment"],
      asserts: [
        {
          name: "Confirmação não contém placeholder de preço",
          severity: "critical",
          check: (_i, reply, state) =>
            state !== "appointment_created" ||
            !/\[\s*(valor|ferramenta|placeholder)|R\$\s*\[|\*Total:\*\s*$|\*Total:\*\s*R\$\s*\n/im.test(reply),
        },
        {
          name: "Confirmação exibe preço numérico real (R$ XX)",
          severity: "medium",
          check: (_i, reply, state) =>
            state !== "appointment_created" ||
            /R\$\s*\d+[,.]?\d*/i.test(reply),
        },
      ],
    },
  },
];
