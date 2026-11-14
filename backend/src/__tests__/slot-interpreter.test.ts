import { describe, expect, it } from "vitest";
import {
  createFakeSlotInterpreter,
  draftPatchFromInterpretedSlots,
  shouldInterpretSlotsWithModel,
  validateInterpretedSlots,
} from "../ai/agent/slot-interpreter.js";

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
