import { describe, expect, it } from "vitest";
import {
  createFakeSlotInterpreter,
  draftPatchFromInterpretedSlots,
  interpretSlotsWithOpenAI,
  shouldInterpretSlotsWithModel,
  validateInterpretedSlots,
} from "../ai/agent/slot-interpreter.js";
import type OpenAI from "openai";

describe("validateInterpretedSlots", () => {
  it("aceita o schema e descarta campos inválidos", () => {
    const slots = validateInterpretedSlots({
      intent: "schedule",
      service: "Corte",
      barber: "any",
      date: "2026-11-17",
      time: "14:00",
      after_time: "13:00",
    });
    expect(slots).toEqual({
      intent: "schedule",
      service: "Corte",
      barber: "any",
      date: "2026-11-17",
      time: "14:00",
      after_time: null,
    });
    expect(validateInterpretedSlots({ intent: "fly", date: "17/11" })).toBeNull();
    expect(validateInterpretedSlots({ time: "25:00" })).toBeNull();
    expect(validateInterpretedSlots({ time: "9:05" })?.time).toBe("09:05");
  });
});

describe("shouldInterpretSlotsWithModel", () => {
  const base = {
    text: "Fecha o visual do combinado na folha quatorze",
    primaryIntent: "unknown",
    slots: {},
  };
  it("só pede o modelo quando as regras não extraíram nada útil", () => {
    expect(shouldInterpretSlotsWithModel(base)).toBe(true);
    expect(shouldInterpretSlotsWithModel({ ...base, slots: { date: "2026-11-17" } })).toBe(false);
    expect(shouldInterpretSlotsWithModel({ ...base, primaryIntent: "schedule" })).toBe(false);
    expect(shouldInterpretSlotsWithModel({ ...base, isConfirmation: true })).toBe(false);
    expect(shouldInterpretSlotsWithModel({ ...base, text: "ok" })).toBe(false);
  });
});

describe("createFakeSlotInterpreter", () => {
  it("é determinístico e vira patch de rascunho", async () => {
    const interpret = createFakeSlotInterpreter({
      "Fecha o visual do combinado na folha quatorze": {
        intent: "schedule",
        service: "Corte",
        barber: "any",
        date: "2026-11-17",
        time: "14:00",
      },
    });
    const slots = await interpret({
      text: "Fecha o visual do combinado na folha quatorze",
      todayIso: "2026-11-16",
      services: [{ id: "s1", name: "Corte" }],
      barbers: [{ id: "b1", name: "Lucas" }],
    });
    expect(slots?.time).toBe("14:00");
    const patch = draftPatchFromInterpretedSlots(slots!, {
      services: [{ id: "s1", name: "Corte", price: 40 }],
      barbers: [{ id: "b1", name: "Lucas" }],
    });
    expect(patch.service_ids).toEqual(["s1"]);
    expect(patch.date).toBe("2026-11-17");
    expect(patch.time).toBe("14:00");
    expect(patch.barber_id).toBeUndefined();
  });
});

describe("interpretSlotsWithOpenAI", () => {
  const input = {
    text: "Fecha o visual do combinado na folha quatorze",
    todayIso: "2026-11-14",
    services: [{ id: "s1", name: "Corte" }],
    barbers: [{ id: "b1", name: "Lucas" }],
  };

  it("estoura o timeout e cai no fallback determinístico (slots nulos)", async () => {
    const openai = {
      chat: {
        completions: {
          create: (_body: unknown, init?: { signal?: AbortSignal }) =>
            new Promise((_, reject) => {
              init?.signal?.addEventListener("abort", () => {
                const err = new Error("aborted");
                err.name = "AbortError";
                reject(err);
              });
            }),
        },
      },
    } as unknown as OpenAI;
    const result = await interpretSlotsWithOpenAI(openai, input, { timeoutMs: 40 });
    expect(result.slots).toBeNull();
    expect(result.timedOut).toBe(true);
    expect(result.usage).toBeUndefined();
  });

  it("registra o uso de tokens quando a chamada completa", async () => {
    const openai = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { content: JSON.stringify({ intent: "schedule", service: "Corte", time: "14:00" }) } }],
            usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
          }),
        },
      },
    } as unknown as OpenAI;
    const result = await interpretSlotsWithOpenAI(openai, input);
    expect(result.slots?.service).toBe("Corte");
    expect(result.usage).toEqual({ prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 });
    expect(result.timedOut).toBeUndefined();
  });
});
