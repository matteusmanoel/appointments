/**
 * Default demo catalog: services, barbers, business hours.
 * Used by tools and flow to simulate a real barbershop.
 */

import type { DemoCatalog, DayKey } from "./types";

const WEEKDAY: Record<DayKey, { start: string; end: string }> = {
  sunday: { start: "09:00", end: "14:00" },
  monday: { start: "09:00", end: "19:00" },
  tuesday: { start: "09:00", end: "19:00" },
  wednesday: { start: "09:00", end: "19:00" },
  thursday: { start: "09:00", end: "19:00" },
  friday: { start: "09:00", end: "19:00" },
  saturday: { start: "09:00", end: "18:00" },
};

export const DEFAULT_DEMO_CATALOG: DemoCatalog = {
  barbershopName: "NavalhIA Demo",
  services: [
    { id: "s1", name: "Corte", price: 35, durationMinutes: 30, category: "cabelo" },
    { id: "s2", name: "Barba", price: 25, durationMinutes: 20, category: "barba" },
    { id: "s3", name: "Corte + Barba", price: 55, durationMinutes: 50, category: "combo" },
    { id: "s4", name: "Sobrancelha", price: 15, durationMinutes: 15, category: "sobrancelha" },
    { id: "s5", name: "Corte infantil", price: 25, durationMinutes: 25, category: "cabelo" },
  ],
  barbers: [
    {
      id: "b1",
      name: "João",
      schedule: { ...WEEKDAY },
    },
    {
      id: "b2",
      name: "Carlos",
      schedule: { ...WEEKDAY },
    },
    {
      id: "b3",
      name: "Miguel",
      schedule: { ...WEEKDAY },
    },
  ],
  businessHours: { ...WEEKDAY },
};
