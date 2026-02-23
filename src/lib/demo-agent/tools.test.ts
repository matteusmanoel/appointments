import { describe, it, expect } from "vitest";
import * as tools from "./tools";
import { DEFAULT_DEMO_CATALOG } from "./catalog";
import { createInitialState } from "./flow";

describe("demo-agent tools", () => {
  it("listServices returns catalog services", () => {
    const list = tools.listServices(DEFAULT_DEMO_CATALOG);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]).toHaveProperty("name");
    expect(list[0]).toHaveProperty("price");
    expect(list[0]).toHaveProperty("duration_minutes");
  });

  it("getNextSlots returns slots for open day", () => {
    const result = tools.getNextSlots(DEFAULT_DEMO_CATALOG, {
      date: "2025-03-16",
      serviceIds: [DEFAULT_DEMO_CATALOG.services[0].id],
      limit: 5,
    });
    expect(result.date).toBe("2025-03-16");
    expect(Array.isArray(result.slots)).toBe(true);
    if (result.slots.length > 0) {
      expect(result.slots[0]).toHaveProperty("time");
      expect(result.slots[0]).toHaveProperty("barber_name");
    }
  });

  it("checkAvailability returns available or alternatives", () => {
    const result = tools.checkAvailability(DEFAULT_DEMO_CATALOG, {
      date: "2025-03-16",
      time: "10:00",
      serviceIds: [DEFAULT_DEMO_CATALOG.services[0].id],
    });
    expect(result.date).toBe("2025-03-16");
    expect(result.time).toBe("10:00");
    expect(result.requested).toHaveProperty("available");
    expect(result.requested).toHaveProperty("barbers");
    expect(result).toHaveProperty("alternatives");
  });

  it("createAppointment returns summary", () => {
    const state = createInitialState();
    state.serviceIds = [DEFAULT_DEMO_CATALOG.services[0].id];
    state.barberId = DEFAULT_DEMO_CATALOG.barbers[0].id;
    state.date = "2025-03-16";
    state.time = "10:00";
    const created = tools.createAppointment(DEFAULT_DEMO_CATALOG, state);
    expect(created.ok).toBe(true);
    expect(created.summary).toMatch(/R\$|Corte|2025-03-16|10:00/);
  });
});
