import { describe, expect, it } from "vitest";
import {
  composeSuggestUsualService,
  emptyBookingDraft,
  mergeBookingDraft,
  parseBookingDraft,
  resolveUsualService,
  type CatalogService,
} from "../ai/booking-draft.js";
import { isClientRefusal } from "../ai/conversation-intents.js";
import { orchestrate, ASK_SERVICE } from "../ai/agent/orchestrator.js";
import type { IntentSet } from "../ai/agent/types.js";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const catalog: CatalogService[] = [
  { id: U(1), name: "Corte masculino" },
  { id: U(2), name: "Barba" },
  { id: U(3), name: "Corte + Barba" },
];

describe("resolveUsualService", () => {
  it("prefere o combo mais frequente (2+ vezes) ao último agendamento", () => {
    const r = resolveUsualService({
      favorites: {
        last: { service_ids: [U(1)] },
        frequent: [{ service_ids: [U(3)], count: 3 }],
      },
      memory: null,
      catalog,
    });
    expect(r).toEqual({ service_ids: [U(3)], service_name: "Corte + Barba" });
  });

  it("sem repetição usa o último; junta nomes do catálogo de um combo em vários serviços", () => {
    const r = resolveUsualService({
      favorites: { last: { service_ids: [U(1), U(2)] }, frequent: [{ service_ids: [U(1)], count: 1 }] },
      memory: null,
      catalog,
    });
    expect(r).toEqual({ service_ids: [U(1), U(2)], service_name: "Corte masculino + Barba" });
  });

  it("serviço que saiu do catálogo não vira sugestão", () => {
    expect(
      resolveUsualService({ favorites: { last: { service_ids: [U(99)] }, frequent: [] }, memory: null, catalog }),
    ).toBeNull();
  });

  it("memória só vale com confiança >= 0.5 e nome do catálogo", () => {
    expect(
      resolveUsualService({
        favorites: null,
        memory: { preferred_services: ["barba"], preferred_services_conf: 0.8 },
        catalog,
      }),
    ).toEqual({ service_ids: [U(2)], service_name: "Barba" });
    expect(
      resolveUsualService({
        favorites: null,
        memory: { preferred_services: ["barba"], preferred_services_conf: 0.3 },
        catalog,
      }),
    ).toBeNull();
  });

  it("sem histórico: null", () => {
    expect(resolveUsualService({ favorites: null, memory: null, catalog })).toBeNull();
  });
});

describe("sugestão do de sempre", () => {
  it("texto sugere e pergunta, sem pedir 'confirma' (não vira fechamento de agendamento)", () => {
    const t = composeSuggestUsualService({ usualName: "Corte + Barba" });
    expect(t).toBe("Vai ser o de sempre, *Corte + Barba*?");
    expect(t).not.toMatch(/confirma/i);
  });

  it("isClientRefusal: recusa curta sim, recusa com fato novo não", () => {
    for (const t of ["Não", "nao", "Não, obrigado", "dessa vez não", "quero outro", "Outro"]) {
      expect(isClientRefusal(t)).toBe(true);
    }
    for (const t of ["Não, quero barba às 10h", "Sim", "corte e barba", "não vou conseguir ir amanhã cedo, pode ser mais tarde?"]) {
      expect(isClientRefusal(t)).toBe(false);
    }
  });

  it("mergeBookingDraft guarda e limpa a proposta e a pergunta (null limpa)", () => {
    const withProposal = mergeBookingDraft(emptyBookingDraft(), {
      pendingProposal: { service_ids: [U(1)], service_name: "Corte masculino" },
      lastAgentQuestion: "usual_service",
    });
    expect(withProposal.pendingProposal).toEqual({ service_ids: [U(1)], service_name: "Corte masculino" });
    expect(parseBookingDraft(JSON.parse(JSON.stringify(withProposal))).lastAgentQuestion).toBe("usual_service");
    const cleared = mergeBookingDraft(withProposal, { pendingProposal: null, lastAgentQuestion: null });
    expect(cleared.pendingProposal).toBeUndefined();
    expect(cleared.lastAgentQuestion).toBeUndefined();
  });
});

describe("orchestrate: sugestão do serviço de sempre", () => {
  const schedule: IntentSet = {
    intents: ["schedule"],
    primary: "schedule",
    service: null,
    barber: null,
    dateTime: { date: "2026-11-15", time: "10:00" },
    rawSignals: [],
    confidence: 0.9,
  } as IntentSet;
  const base = {
    previousTurnConfidence: undefined,
    hasUpcomingAppointment: false,
    hasActiveBookingDraft: false,
    pendingIntents: { intents: [], offered: false },
    conversationState: "idle" as const,
  };
  const usual = { service_ids: [U(1)], service_name: "Corte masculino" };

  it("pergunta de serviço de quem tem histórico traz a sugestão; ainda é ASK_SERVICE e nada de agendar", () => {
    const r = orchestrate({ ...base, intentSet: schedule, usualService: usual });
    expect(r.turnDirective).toBe(ASK_SERVICE);
    expect(r.usualServiceSuggestion).toEqual(usual);
    expect(r.allowedTools).not.toContain("check_availability");
    expect(r.allowedTools).not.toContain("create_appointment");
  });

  it("sem histórico, ou depois da recusa, pergunta simples sem sugestão", () => {
    expect(orchestrate({ ...base, intentSet: schedule }).usualServiceSuggestion).toBeNull();
    expect(orchestrate({ ...base, intentSet: schedule, usualService: usual, usualServiceRefused: true }).usualServiceSuggestion).toBeNull();
  });

  it("depois do sim (serviço já no rascunho) segue para conferir a agenda", () => {
    const yes: IntentSet = { ...schedule, intents: ["unknown"], primary: "unknown", dateTime: null } as IntentSet;
    const r = orchestrate({
      ...base,
      intentSet: yes,
      isAffirmative: true,
      carriedClock: "10:00",
      carriedServiceIds: usual.service_ids,
      usualService: usual,
      usualServiceAccepted: true,
    });
    expect(r.primaryIntent).toBe("schedule");
    expect(r.allowedTools).toContain("check_availability");
    expect(r.allowedTools).not.toContain("create_appointment");
  });
});
