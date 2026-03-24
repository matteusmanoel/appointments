import { describe, it, expect, beforeAll } from "vitest";
import { pool } from "../db.js";
import { getNextSlots } from "../ai/tools.js";

function isMultipleOf5(timeStr: string): boolean {
  const match = timeStr.match(/^\d{2}:(\d{2})/);
  if (!match) return false;
  const minutes = parseInt(match[1], 10);
  return minutes % 5 === 0;
}

describe("getNextSlots time invariants", () => {
  let barbershopId: string | null = null;
  let serviceId: string | null = null;
  let dateStr: string;

  beforeAll(async () => {
    try {
      const shop = await pool.query<{ id: string }>(
        "SELECT id FROM public.barbershops ORDER BY created_at ASC LIMIT 1"
      );
      barbershopId = shop.rows[0]?.id ?? null;
      if (barbershopId) {
        const svc = await pool.query<{ id: string }>(
          "SELECT id FROM public.services WHERE barbershop_id = $1 AND is_active = true LIMIT 1",
          [barbershopId]
        );
        serviceId = svc.rows[0]?.id ?? null;
      }
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      dateStr = tomorrow.toISOString().slice(0, 10);
    } catch {
      barbershopId = null;
      serviceId = null;
      dateStr = "";
    }
  });

  it("returns slot times in multiples of 5 minutes when after_time is used", async () => {
    if (!barbershopId || !serviceId) return;
    const result = (await getNextSlots(barbershopId, {
      date: dateStr,
      service_id: serviceId,
      after_time: "08:07",
      limit: 5,
    })) as { error?: string; slots?: Array<{ time: string }> };
    if (result.error || !result.slots?.length) return;
    for (const slot of result.slots) {
      expect(isMultipleOf5(slot.time), `slot time ${slot.time} should be multiple of 5 minutes`).toBe(true);
    }
  });

  it("returns slot times in multiples of 5 minutes without after_time", async () => {
    if (!barbershopId || !serviceId) return;
    const result = (await getNextSlots(barbershopId, {
      date: dateStr,
      service_id: serviceId,
      limit: 5,
    })) as { error?: string; slots?: Array<{ time: string }> };
    if (result.error || !result.slots?.length) return;
    for (const slot of result.slots) {
      expect(isMultipleOf5(slot.time), `slot time ${slot.time} should be multiple of 5 minutes`).toBe(true);
    }
  });
});
