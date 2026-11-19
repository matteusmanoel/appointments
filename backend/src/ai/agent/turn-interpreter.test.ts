import { describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import { interpretTurnWithOpenAI, normalizeInterpretation, type InterpretTurnInput } from "./turn-interpreter.js";

const catalog = {
  services: [{ id: "s1", name: "Corte masculino" }],
  barbers: [{ id: "b1", name: "Lucas Lima" }],
};
const raw = {
  intents: ["schedule"],
  service_id: "s1",
  service_ambiguous: false,
  barber_id: "b1",
  barber_any: false,
  unknown_barber_name: null,
  date: "2026-11-19",
  time: "9:30",
  after_time: null,
  wants_next_slot: false,
  offer_response: "none",
  person_name: null,
  social: "none",
  confidence: 0.9,
};
const input: InterpretTurnInput = {
  text: "quero cortar",
  history: [],
  state: "idle",
  openFacts: [],
  todayIso: "2026-11-18",
  nowHHmm: "10:00",
  calendar: "",
  ...catalog,
};

describe("normalizeInterpretation", () => {
  it("normaliza a hora e mantém ids do catálogo", () => {
    expect(normalizeInterpretation(raw, { ...catalog, state: "idle" })).toMatchObject({
      primary: "schedule",
      service_id: "s1",
      barber_id: "b1",
      time: "09:30",
    });
  });

  it("descarta id inventado e data inválida", () => {
    const result = normalizeInterpretation(
      { ...raw, service_id: "x", barber_id: "y", date: "amanhã", time: "25:00" },
      { ...catalog, state: "idle" },
    );
    expect(result).toMatchObject({ service_id: null, barber_id: null, date: null, time: null });
  });

  it("não aceita presença sem lembrete em aberto", () => {
    const result = normalizeInterpretation({ ...raw, intents: ["presence"] }, { ...catalog, state: "idle" });
    expect(result?.primary).toBe("unknown");
  });

  it("aceita presença com lembrete em aberto", () => {
    const result = normalizeInterpretation({ ...raw, intents: ["presence"] }, { ...catalog, state: "reminder_24h_pending" });
    expect(result?.primary).toBe("presence");
  });

  it("deixa remarcar prevalecer sobre cancelar", () => {
    const result = normalizeInterpretation({ ...raw, intents: ["cancel", "reschedule"] }, { ...catalog, state: "idle" });
    expect(result?.intents).toEqual(["reschedule"]);
  });

  it("recusa saída fora do formato", () => {
    expect(normalizeInterpretation({ intents: ["voar"] }, { ...catalog, state: "idle" })).toBeNull();
  });
});

describe("interpretTurnWithOpenAI", () => {
  it("devolve erro sem lançar quando a API falha", async () => {
    const create = vi.fn().mockRejectedValue(new Error("fora do ar"));
    const openai = { chat: { completions: { create } } } as unknown as OpenAI;
    const result = await interpretTurnWithOpenAI(openai, input);
    expect(result).toMatchObject({ interpretation: null, error: "fora do ar" });
  });
});
