import { describe, expect, it } from "vitest";
import type { TurnInterpretation } from "../turn-interpreter.js";
import {
  OFFER_TTL_MS,
  persistSnapshot,
  restoreSnapshot,
  stepResult,
  stepTurn,
  type ConversationSnapshot,
  type TurnFacts,
  type UpcomingFact,
} from "./machine.js";

const NOW = Date.parse("2026-11-18T13:00:00.000Z");
const interpretation = (patch: Partial<TurnInterpretation>): TurnInterpretation => ({
  intents: [patch.primary ?? "unknown"],
  primary: "unknown",
  service_id: null,
  service_ambiguous: false,
  barber_id: null,
  barber_any: false,
  unknown_barber_name: null,
  date: null,
  time: null,
  after_time: null,
  wants_next_slot: false,
  offer_response: "none",
  person_name: null,
  social: "none",
  confidence: 0.9,
  ...patch,
});
const appointment: UpcomingFact = {
  id: "a1",
  date: "2026-11-20",
  time: "18:00",
  service_ids: ["s1"],
  service_names: "Corte masculino",
  barber_id: "b1",
  barber_name: "Lucas Lima",
  status: "pending",
  price: 35,
};
const facts = (patch: Partial<TurnInterpretation>, extra: Partial<TurnFacts> = {}): TurnFacts => ({
  interpretation: interpretation(patch),
  upcoming: [],
  reminderAppointmentId: null,
  personName: "Mateus",
  services: [{ id: "s1", name: "Corte masculino", price: 35 }],
  barbers: [{ id: "b1", name: "Lucas Lima" }],
  usualService: null,
  todayIso: "2026-11-18",
  nowHHmm: "10:00",
  nowMs: NOW,
  ...extra,
});
const slot = { date: "2026-11-19", time: "15:00", barber_id: "b1", barber_name: "Lucas Lima", price: 35, service_name: "Corte masculino" };

function offered(): ConversationSnapshot {
  const checking = stepTurn(
    restoreSnapshot(null),
    facts({ primary: "schedule", service_id: "s1", date: "2026-11-19", time: "15:00" }),
  );
  return stepResult(checking, { type: "SLOT_FREE", slot, nowMs: NOW });
}

describe("máquina de estados da conversa", () => {
  it("confere a agenda antes de oferecer", () => {
    const next = stepTurn(restoreSnapshot(null), facts({ primary: "schedule", service_id: "s1", date: "2026-11-19", time: "15:00" }));
    expect(next.value).toBe("checking");
    expect(next.context.command).toEqual({ type: "check_slot" });
  });

  it("pergunta o serviço sem inventar um", () => {
    const next = stepTurn(restoreSnapshot(null), facts({ primary: "schedule", date: "2026-11-19", time: "15:00" }));
    expect(next.value).toBe("collecting");
    expect(next.context.say).toEqual({ kind: "ask_service" });
    expect(next.context.date).toBe("2026-11-19");
  });

  it("sugere o de sempre e só preenche depois do sim", () => {
    const usualService = { service_ids: ["s1"], service_name: "Corte masculino" };
    const asked = stepTurn(restoreSnapshot(null), facts({ primary: "schedule" }, { usualService }));
    expect(asked.context.say).toEqual({ kind: "ask_usual_service", service_name: "Corte masculino" });
    expect(asked.context.service_ids).toEqual([]);
    const yes = stepTurn(asked, facts({ offer_response: "accept" }, { usualService }));
    expect(yes.context.service_ids).toEqual(["s1"]);
    expect(yes.context.say).toEqual({ kind: "ask_datetime" });
  });

  it("não repete a sugestão do de sempre depois de um não", () => {
    const usualService = { service_ids: ["s1"], service_name: "Corte masculino" };
    const asked = stepTurn(restoreSnapshot(null), facts({ primary: "schedule" }, { usualService }));
    const no = stepTurn(asked, facts({ primary: "schedule", offer_response: "reject" }, { usualService }));
    expect(no.context.say).toEqual({ kind: "ask_service" });
  });

  it("só grava depois do aceite da oferta", () => {
    const state = offered();
    expect(state.value).toBe("slot_offered");
    const accepted = stepTurn(state, facts({ offer_response: "accept" }));
    expect(accepted.value).toBe("writing");
    expect(accepted.context.command).toEqual({ type: "write_create" });
  });

  it("pede o nome antes de gravar para quem ainda não disse", () => {
    const asked = stepTurn(offered(), facts({ offer_response: "accept" }, { personName: null }));
    expect(asked.value).toBe("awaiting_name");
    expect(asked.context.say).toEqual({ kind: "ask_name" });
    const named = stepTurn(asked, facts({ person_name: "Mateus" }, { personName: null }));
    expect(named.context.command).toEqual({ type: "write_create" });
  });

  it("não grava aceite de oferta vencida", () => {
    const late = stepTurn(offered(), facts({ offer_response: "accept" }, { nowMs: NOW + OFFER_TTL_MS + 1 }));
    expect(late.value).toBe("idle");
    expect(late.context.command).toBeNull();
    expect(late.context.say).toEqual({ kind: "offer_expired" });
  });

  it("volta a conferir quando o cliente corrige a oferta", () => {
    const corrected = stepTurn(offered(), facts({ primary: "schedule", offer_response: "correct", time: "16:00" }));
    expect(corrected.value).toBe("checking");
    expect(corrected.context.time).toBe("16:00");
  });

  it("mantém a oferta ao responder uma pergunta lateral", () => {
    const side = stepTurn(offered(), facts({ primary: "location" }));
    expect(side.value).toBe("slot_offered");
    expect(side.context.date).toBe("2026-11-19");
    expect(side.context.say).toEqual({ kind: "side_only" });
  });

  it("cancela só depois da confirmação", () => {
    const asked = stepTurn(restoreSnapshot(null), facts({ primary: "cancel" }, { upcoming: [appointment] }));
    expect(asked.value).toBe("cancel_offered");
    expect(asked.context.command).toBeNull();
    const yes = stepTurn(asked, facts({ offer_response: "accept" }, { upcoming: [appointment] }));
    expect(yes.context.command).toEqual({ type: "write_cancel", appointment_id: "a1" });
  });

  it("mantém o horário quando o cliente desiste de cancelar", () => {
    const asked = stepTurn(restoreSnapshot(null), facts({ primary: "cancel" }, { upcoming: [appointment] }));
    const no = stepTurn(asked, facts({ offer_response: "reject" }, { upcoming: [appointment] }));
    expect(no.value).toBe("idle");
    expect(no.context.say).toEqual({ kind: "cancel_kept" });
  });

  it("pergunta qual horário quando há mais de um", () => {
    const other = { ...appointment, id: "a2", date: "2026-11-22" };
    const next = stepTurn(restoreSnapshot(null), facts({ primary: "cancel" }, { upcoming: [appointment, other] }));
    expect(next.context.say).toEqual({ kind: "which_appointment", verb: "cancelar" });
    expect(next.context.cancel_id).toBeNull();
  });

  it("remarca herdando serviço e barbeiro do horário atual", () => {
    const next = stepTurn(restoreSnapshot(null), facts({ primary: "reschedule", date: "2026-11-21", time: "10:00" }, { upcoming: [appointment] }));
    expect(next.value).toBe("checking");
    expect(next.context).toMatchObject({ moving_id: "a1", service_ids: ["s1"], barber_id: "b1" });
  });

  it("confirma presença só com lembrete em aberto", () => {
    const withReminder = stepTurn(restoreSnapshot(null), facts({ primary: "presence" }, { reminderAppointmentId: "a1" }));
    expect(withReminder.context.command).toEqual({ type: "write_presence", appointment_id: "a1" });
    const without = stepTurn(restoreSnapshot(null), facts({ primary: "presence" }));
    expect(without.context.command).toBeNull();
  });

  it("oferece alternativa e limpa a hora quando o horário está ocupado", () => {
    const checking = stepTurn(restoreSnapshot(null), facts({ primary: "schedule", service_id: "s1", date: "2026-11-19", time: "15:00" }));
    const busy = stepResult(checking, { type: "SLOT_BUSY", times: ["15:30", "16:00"] });
    expect(busy.value).toBe("collecting");
    expect(busy.context.time).toBeNull();
    expect(busy.context.say).toEqual({ kind: "slot_busy", times: ["15:30", "16:00"] });
  });

  it("retoma o estado salvo sem comando pendente", () => {
    const saved = persistSnapshot(offered());
    expect(saved.context.command).toBeNull();
    const restored = restoreSnapshot(JSON.parse(JSON.stringify(saved)));
    expect(restored.value).toBe("slot_offered");
    expect(restored.context.time).toBe("15:00");
  });

  it("não depende do texto enviado ao cliente", () => {
    const state = restoreSnapshot(JSON.parse(JSON.stringify(persistSnapshot(offered()))));
    expect(stepTurn(state, facts({ offer_response: "accept" })).context.command).toEqual({ type: "write_create" });
  });
});
