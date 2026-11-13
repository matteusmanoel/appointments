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
