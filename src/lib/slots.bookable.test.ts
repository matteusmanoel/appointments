import { describe, expect, it } from "vitest";
import { isSlotBookable } from "./slots";

const day = new Date(2026, 10, 16, 0, 0); // segunda
const sched = { monday: { start: "09:00", end: "18:00" } };

describe("isSlotBookable", () => {
  it("esconde horários passados no dia de hoje", () => {
    const now = new Date(2026, 10, 16, 14, 10);
    expect(isSlotBookable({ slot: "14:00", date: day, now, durationMinutes: 30, occupied: [] })).toBe(false);
    expect(isSlotBookable({ slot: "14:30", date: day, now, durationMinutes: 30, occupied: [] })).toBe(true);
  });
  it("não esconde nada em dia futuro", () => {
    const now = new Date(2026, 10, 15, 23, 0);
    expect(isSlotBookable({ slot: "09:00", date: day, now, durationMinutes: 30, occupied: [] })).toBe(true);
  });
  it("respeita a escala do barbeiro (início e fim, considerando a duração)", () => {
    const now = new Date(2026, 10, 15, 8, 0);
    expect(isSlotBookable({ slot: "08:30", date: day, now, durationMinutes: 30, occupied: [], barberSchedule: sched })).toBe(false);
    expect(isSlotBookable({ slot: "17:30", date: day, now, durationMinutes: 60, occupied: [], barberSchedule: sched })).toBe(false);
    expect(isSlotBookable({ slot: "17:30", date: day, now, durationMinutes: 30, occupied: [], barberSchedule: sched })).toBe(true);
  });
  it("serviço longo não pode invadir o agendamento seguinte", () => {
    const now = new Date(2026, 10, 15, 8, 0);
    const occ = [{ scheduled_time: "10:30:00", duration_minutes: 30 }];
    expect(isSlotBookable({ slot: "10:00", date: day, now, durationMinutes: 30, occupied: occ })).toBe(true);
    expect(isSlotBookable({ slot: "10:00", date: day, now, durationMinutes: 60, occupied: occ })).toBe(false);
  });
});

import { isPastDay, isSlotConflictError } from "./slots";

describe("dias passados e 409", () => {
  const now = new Date(2026, 10, 13, 15, 0); // 13/11/2026 15:00 local
  it("isPastDay ignora a hora e só marca dias anteriores a hoje", () => {
    expect(isPastDay(new Date(2026, 10, 12, 23, 59), now)).toBe(true);
    expect(isPastDay(new Date(2026, 10, 13, 0, 0), now)).toBe(false);
    expect(isPastDay(new Date(2026, 10, 14, 0, 0), now)).toBe(false);
  });
  it("isSlotBookable recusa qualquer horário de um dia passado, mesmo que a hora ainda 'não tenha passado'", () => {
    const yesterday = new Date(2026, 10, 12);
    expect(isSlotBookable({ slot: "18:00", date: yesterday, now, durationMinutes: 30, occupied: [] })).toBe(false);
    expect(isSlotBookable({ slot: "09:00", date: new Date(2026, 10, 14), now, durationMinutes: 30, occupied: [] })).toBe(true);
  });
  it("isSlotConflictError reconhece 409 por status e pela mensagem do backend", () => {
    expect(isSlotConflictError(Object.assign(new Error("x"), { status: 409 }))).toBe(true);
    expect(isSlotConflictError(new Error("Horário já ocupado para este barbeiro"))).toBe(true);
    expect(isSlotConflictError(new Error("Invalid body"))).toBe(false);
    expect(isSlotConflictError(undefined)).toBe(false);
  });
});
